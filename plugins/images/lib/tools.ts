import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { AssetVersionDetail } from '@makinbakin/sdk/types'
import { isValidAssetId } from '@makinbakin/sdk/utils'
import { translateAgentPath } from '@bakin/core/agent-path-map'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { loadSharp } from '@bakin/core/media/sharp-loader'
import type { ExecToolResult, PluginContext } from '@bakin/core/plugin-types'
import type { RuntimeImageGenerationResult } from '@bakin/core/adapters/runtime'
import { RUNTIME_MEDIA_URI_SCHEME } from '@bakin/core/adapters/runtime'
import type { ImageProviderId, ImageProviderReadiness } from '../types'
import { effectiveImageSettings, getImageProvider, providerReadiness } from './providers'
import { resolveImageRoute } from './routing'
import { getImageProfile } from './platform-profiles'
import { runBilledImageCall, type ImageCallKey } from './idempotency'
import { meterImageTurn } from '../../../src/core/agent-cost'
import { gateBilledMediaCall } from '../../../src/core/media-gate'

/** Largest edge we send to a provider / feed into sharp, to bound cost. */
const MAX_IMAGE_EDGE = 2048
/** Upper bound on reference/context images per call (#418). Providers cap input
 *  images; keep it conservative and bump here if a workflow needs more. */
const MAX_REFERENCE_IMAGES = 4

export interface ImagesGenerateParams {
  prompt?: string
  promptPacket?: Record<string, unknown>
  /** Task to link the asset to. Omit during an interactive chat turn — the
   *  tool auto-binds to the agent's active chat via `chat.resolveActiveTurn`. */
  taskId?: string
  surface?: string
  provider?: ImageProviderId | 'auto'
  model?: string
  width?: number
  height?: number
  quality?: 'draft' | 'standard' | 'premium'
  /** Managed assetIds and/or file paths used as reference/context images (#418). */
  referenceImages?: string[]
  /** Brand-conditioned generation (#419): palette + style merge into the prompt, defaultImageReferences fill empty reference slots, provenance is recorded. Unknown/draft brand = hard error. */
  brandId?: string
  /** Append the render as a new VERSION of this asset (iteration/re-roll) instead of minting a new asset. */
  versionOf?: string
  /** Explicit intent: this generate references own same-task output but is a deliberately separate companion asset. */
  allowNewAsset?: boolean
}

export interface ImagesImportParams {
  filePath: string
  taskId: string
  description?: string
  tags?: string[]
}

export interface ImagesEditParams extends ImagesGenerateParams {
  /** Managed asset id to edit — edits the current version, appends a new one. */
  assetId: string
}

export interface ImagesExportParams {
  assetId: string
  taskId: string
  surface?: string
  width?: number
  height?: number
  format?: 'jpg' | 'png' | 'webp'
  quality?: number
}

function fail(error: string): ExecToolResult {
  return { ok: false, error }
}

/**
 * Billing/asset context for a generation or edit: an explicit taskId, or —
 * during an interactive chat turn — the agent's active chat resolved via
 * the `chat.resolveActiveTurn` hook. contextKey feeds the billed-call
 * idempotency signature; taskId (null for chat) feeds asset linkage.
 */
async function resolveImageContext(
  params: { taskId?: string },
  agent: string,
): Promise<{ taskId: string | null; contextKey: string } | { error: string }> {
  if (params.taskId) return { taskId: params.taskId, contextKey: params.taskId }
  const active = await getHookRegistry().invoke<{ chatId: string; turnId: string } | null>('chat.resolveActiveTurn', { agentId: agent })
  if (!active?.chatId) {
    return { error: 'No taskId given and no unambiguous active chat turn — pass taskId when working a task; in an interactive chat, call this during your reply turn (if you are replying in several chats at once, this cannot bind safely).' }
  }
  // Scope idempotency to THIS turn: a chat-lifetime key made every later
  // identical prompt silently return the first billed image.
  return { taskId: null, contextKey: `chat:${active.chatId}:${active.turnId}` }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function hashPrompt(prompt: string): string {
  return `sha256:${createHash('sha256').update(prompt).digest('hex')}`
}

function sortJsonValue(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sortJsonValue)
  const sorted = Object.keys(value as Record<string, unknown>).sort()
  const out: Record<string, unknown> = {}
  for (const key of sorted) out[key] = sortJsonValue((value as Record<string, unknown>)[key])
  return out
}

function stablePromptValue(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function compilePrompt(params: Pick<ImagesGenerateParams, 'prompt' | 'promptPacket'>): string | null {
  if (params.prompt && params.prompt.trim().length > 0) return params.prompt
  if (params.promptPacket && Object.keys(params.promptPacket).length > 0) {
    return Object.entries(params.promptPacket)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : stablePromptValue(value)}`)
      .join('\n')
  }
  return null
}

/** Clamp to MAX_IMAGE_EDGE while preserving aspect ratio (scales both edges). */
function clampDimensions(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  const scale = longest > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / longest : 1
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function dimensionsForSurface(surfaceId: string, width?: number, height?: number): { surface: string; width: number; height: number } | null {
  const profile = getImageProfile(surfaceId)
  if (!profile && (!width || !height)) return null
  const clamped = clampDimensions(width ?? profile!.width, height ?? profile!.height)
  return { surface: profile?.id ?? 'custom', ...clamped }
}

async function imageDimensions(filePath: string): Promise<{ width: number; height: number }> {
  try {
    const sharp = await loadSharp()
    if (!sharp) return { width: 0, height: 0 }
    const metadata = await sharp(filePath).metadata()
    return { width: metadata.width ?? 0, height: metadata.height ?? 0 }
  } catch {
    return { width: 0, height: 0 }
  }
}

export async function importImage(ctx: PluginContext, params: ImagesImportParams, agent: string): Promise<ExecToolResult> {
  if (!existsSync(params.filePath)) return fail(`File not found: ${params.filePath}`)
  const dims = await imageDimensions(params.filePath)
  try {
    const ref = await ctx.assets.createAsset({
      sourceFilePath: params.filePath,
      type: 'images',
      agent,
      taskId: params.taskId,
      op: 'import',
      tool: 'bakin_exec_images_import',
      // No machine-tag default: provenance lives in op/source, tags are the
      // user's organizational namespace.
      description: (params.description || basename(params.filePath)).slice(0, 200),
      tags: params.tags,
      slug: params.description || basename(params.filePath),
      source: { kind: 'import', path: params.filePath },
    })
    return { ok: true, assetId: ref.assetId, version: ref.version, width: dims.width, height: dims.height, model: 'import' }
  } catch (err) {
    return fail(`Asset import failed: ${errorMessage(err)}`)
  }
}

/** Reference/context images resolved to concrete paths + their managed lineage. */
interface ResolvedReferences {
  /** Concrete file paths handed to the runtime capability. */
  paths: string[]
  /** Managed identity recorded in generation provenance + the dedupe key. */
  lineage: Array<{ assetId: string; version: number }>
  /** Order-stable fingerprint of the reference set (assetId@version, sorted). */
  fingerprint: string
}

const EMPTY_REFERENCES: ResolvedReferences = { paths: [], lineage: [], fingerprint: '' }

interface PreparedImageRequest {
  prompt: string
  dims: { surface: string; width: number; height: number }
  route: { provider: ImageProviderId; model: string }
  quality: 'draft' | 'standard' | 'premium'
  references: ResolvedReferences
  /** Brand conditioning (#419) — recorded in generation provenance + the dedupe key. */
  brand?: { brandId: string; fingerprint: string | null }
}

/** Structural mirror of the brands.get hook result — no plugin imports. */
interface BrandHookResult {
  manifest?: {
    id: string
    name: string
    description?: string
    draft?: boolean
    palette: Array<{ name: string; hex: string; usage?: string }>
    defaultImageReferences?: string[]
  }
  fingerprint?: string | null
}

/** Resolve a brandId via the brands.get hook. Unknown/draft brands are typed hard errors — never silently off-brand (#419). */
async function resolveBrandForImage(
  ctx: PluginContext,
  brandId: string,
): Promise<{ brand: NonNullable<BrandHookResult['manifest']>; fingerprint: string | null } | { error: string }> {
  if (!ctx.hooks.has('brands.get')) return { error: `Brand not found: ${brandId} (brands plugin unavailable)` }
  let result: BrandHookResult | undefined
  try {
    result = await ctx.hooks.invoke<BrandHookResult | undefined>('brands.get', { brandId })
  } catch {
    return { error: `Brand lookup failed for '${brandId}' — refusing to generate off-brand` }
  }
  if (!result?.manifest) return { error: `Brand not found: ${brandId}` }
  if (result.manifest.draft) return { error: `Brand '${brandId}' is a draft — publish it before branded generation` }
  return { brand: result.manifest, fingerprint: result.fingerprint ?? null }
}

/** The brand's visual identity as a prompt suffix — palette + identity line. */
function brandPromptSuffix(brand: NonNullable<BrandHookResult['manifest']>): string {
  const lines = [`Brand: ${brand.name}.`]
  if (brand.description) lines.push(brand.description)
  if (brand.palette.length) {
    lines.push(
      `Brand palette (use these colors): ${brand.palette.map(c => `${c.name} ${c.hex}${c.usage ? ` (${c.usage})` : ''}`).join(', ')}.`,
    )
  }
  lines.push('Stay strictly within this brand\'s visual identity.')
  return lines.join(' ')
}

/**
 * Resolve reference images for a generate/edit (#418). AssetIds resolve to their
 * current version; raw paths are auto-imported (source-path dedup) so every
 * reference becomes a tracked, navigable asset. Gates BEFORE billing on the
 * count cap, the model's `reference-images` capability, and the serving path
 * (references require the native runtime — the direct shim can't take inputs).
 */
async function resolveReferences(
  ctx: PluginContext,
  params: ImagesGenerateParams,
  agent: string,
  route: { provider: ImageProviderId; model: string },
  readyProvider: ImageProviderReadiness | undefined,
  opts: { dropOnUnsupported?: boolean } = {},
): Promise<ResolvedReferences | { error: string }> {
  const entries = params.referenceImages ?? []
  if (entries.length === 0) return EMPTY_REFERENCES
  if (entries.length > MAX_REFERENCE_IMAGES) {
    return { error: `Too many reference images: ${entries.length} (max ${MAX_REFERENCE_IMAGES})` }
  }

  // Prefer the curated static descriptor for capabilities — runtime-discovered
  // capabilities are best-effort and would otherwise clobber the static
  // reference-images flag in the merge (see #381 capability-drift).
  const modelDesc = getImageProvider(route.provider)?.models.find(model => model.id === route.model)
    ?? readyProvider?.models.find(model => model.id === route.model)
  // References ride the runtime path natively AND the direct shim (which
  // takes input images since pi-ecosystem WS3) — only an unconfigured
  // provider or an incapable model blocks them now.
  const supportsReferences = !!modelDesc?.capabilities.includes('reference-images')
    && (readyProvider?.servedBy === 'runtime' || readyProvider?.servedBy === 'shim')
  if (!supportsReferences) {
    // Brand default references (#419) are best-effort — drop them and let the
    // palette prompt conditioning stand, rather than fail the whole generation.
    if (opts.dropOnUnsupported) return EMPTY_REFERENCES
    if (!modelDesc?.capabilities.includes('reference-images')) {
      return { error: `Model does not support reference images: ${route.provider}/${route.model}` }
    }
    return { error: `Reference images need a configured provider; ${route.provider} is not configured` }
  }

  const paths: string[] = []
  const lineage: Array<{ assetId: string; version: number }> = []
  for (const rawEntry of entries) {
    // Runtime-private media URIs (e.g. a channel attachment the runtime
    // stored) resolve to a local path adapter-side, then flow through the
    // same auto-import as any raw path — tracked, task-linked. The scheme
    // constant is the contract's; the adapter owns what the URI means.
    let entry = rawEntry
    if (rawEntry.startsWith(RUNTIME_MEDIA_URI_SCHEME)) {
      if (!ctx.runtime.media?.resolveUri) {
        return { error: `The active runtime cannot resolve ${RUNTIME_MEDIA_URI_SCHEME} URIs (reference ${rawEntry}); pass an assetId or local path instead` }
      }
      const resolved = await ctx.runtime.media.resolveUri(rawEntry)
      if (!resolved) return { error: `Reference media URI not found: ${rawEntry}` }
      entry = resolved
    }
    // Dev-rig seam: agent-reported container paths → host paths
    // (BAKIN_AGENT_PATH_MAP). Asset ids and host paths pass through.
    entry = translateAgentPath(entry)
    // A path INSIDE the asset store is already managed — reflect it to its
    // identity (and to the real version file when given a thumb) instead of
    // letting auto-import clone it.
    const managed = await ctx.assets.resolveStoreFile(entry)
    if (managed) {
      paths.push(managed.absPath)
      lineage.push({ assetId: managed.assetId, version: managed.version })
      continue
    }
    if (isValidAssetId(entry)) {
      const ref = await ctx.assets.resolveVersionFile(entry)
      if (!ref) return { error: `Reference asset not found: ${entry}` }
      paths.push(ref.absPath)
      lineage.push({ assetId: entry, version: ref.version })
    } else {
      if (!existsSync(entry)) return { error: `Reference file not found: ${entry}` }
      // Auto-import the loose file so the reference is tracked provenance, not a
      // path+hash that can't be browsed later. Source-path dedup avoids dupes.
      const up = await ctx.assets.upsertFromSource(entry, {
        sourceFilePath: entry, type: 'images', agent, taskId: params.taskId ?? null,
        op: 'import', tool: 'bakin_exec_images_import',
        description: basename(entry), source: { kind: 'import', path: entry },
        // Tagged so the assets view can filter reference material out of
        // deliverables (and the self-iteration guard can tell them apart).
        tags: ['reference'],
      })
      paths.push(entry)
      lineage.push({ assetId: up.assetId, version: up.version })
    }
  }
  const fingerprint = lineage.map(ref => `${ref.assetId}@${ref.version}`).sort().join(',')
  return { paths, lineage, fingerprint }
}

/** Shared prologue for generate + edit: compile prompt, resolve surface + route, validate routability + references. */
async function prepareImageRequest(ctx: PluginContext, params: ImagesGenerateParams, agent: string): Promise<PreparedImageRequest | { error: string }> {
  let prompt = compilePrompt(params)
  if (!prompt) return { error: 'prompt or promptPacket is required' }

  // Second line of defense behind server-side abort (2026-07-09 incident:
  // a deleted task's turn kept running and billed a generation): billable
  // work for a task that no longer exists is refused BEFORE routing/billing.
  // Chat-bound generations (no taskId) have no task to gate on — the chat
  // turn's own abort already cancels the stream.
  if (params.taskId) {
    const task = await ctx.tasks.get(params.taskId)
    if (!task) {
      return { error: `Task ${params.taskId} no longer exists (deleted). Do not continue work for it — stop and re-check your assignment with bakin_exec_tasks_get.` }
    }
  }

  // Brand conditioning (#419): resolve BEFORE routing/billing — a bad brandId
  // fails loudly here, never ships off-palette art. Agent-passed references
  // win; the brand's defaults fill only when none were given (max-4 upstream).
  let brand: PreparedImageRequest['brand']
  // Brand DEFAULT references are best-effort: on a model/serving path that
  // can't take reference images, drop them silently and let the palette prompt
  // conditioning stand (a usable branded image), rather than hard-fail. Only
  // AGENT-passed references are a hard error on an incapable route.
  let referencesAreBrandDefaults = false
  if (params.brandId) {
    const resolved = await resolveBrandForImage(ctx, params.brandId)
    if ('error' in resolved) return resolved
    prompt = `${prompt}\n\n${brandPromptSuffix(resolved.brand)}`
    brand = { brandId: params.brandId, fingerprint: resolved.fingerprint }
    if (!(params.referenceImages?.length) && resolved.brand.defaultImageReferences?.length) {
      params = { ...params, referenceImages: resolved.brand.defaultImageReferences.slice(0, MAX_REFERENCE_IMAGES) }
      referencesAreBrandDefaults = true
    }
  }
  const settings = effectiveImageSettings(ctx)
  const surfaceId = params.surface || settings.defaultSurface
  const dims = dimensionsForSurface(surfaceId, params.width, params.height)
  if (!dims) return { error: `Unknown image surface: ${surfaceId}` }

  // Capability gate (P4.1): the runtime's descriptor is the top-level truth —
  // 'unavailable' fails honestly BEFORE any provider fusing or route math.
  const imageGen = (await ctx.runtime.capabilities()).imageGen
  if (imageGen.mode === 'unavailable') {
    return { error: 'Image generation is unavailable on this runtime — no native image path is authenticated and no Bakin provider key is configured.' }
  }

  const readiness = await providerReadiness(ctx)
  const route = resolveImageRoute(readiness, settings, { provider: params.provider, model: params.model })
  if (!route) return { error: 'No image provider route available' }

  const provider = getImageProvider(route.provider)
  const readyProvider = readiness.find(candidate => candidate.id === route.provider)
  const knownModel = provider?.models.some(model => model.id === route.model && model.status === 'routable')
    || readyProvider?.models.some(model => model.id === route.model && model.status === 'routable')
  if (!knownModel) return { error: `Image model is not routable: ${route.provider}/${route.model}` }

  const references = await resolveReferences(ctx, params, agent, route, readyProvider, { dropOnUnsupported: referencesAreBrandDefaults })
  if ('error' in references) return references

  return { prompt, dims, route, quality: params.quality ?? settings.quality, references, ...(brand ? { brand } : {}) }
}

/**
 * Persist a runtime image result as a managed asset — a new asset (generate) or
 * a new version of an existing one (edit) — and build the tool result.
 * Probes the ACTUAL produced dimensions (a provider may snap to its nearest
 * supported size); surface intent stays in `generation.surface`.
 */
async function persistImageResult(
  ctx: PluginContext,
  params: ImagesGenerateParams,
  agent: string,
  opts: { req: PreparedImageRequest; result: RuntimeImageGenerationResult; tool: string } & ({ create: true } | { create: false; assetId: string; op?: 'edit' | 'generate' }),
): Promise<ExecToolResult> {
  const { req, result, tool } = opts
  const image = result.images[0]
  if (!image?.filePath) return fail('Runtime image operation returned no image file')

  const servedBy = typeof result.metadata?.servedBy === 'string' ? result.metadata.servedBy : undefined
  const routeSource = servedBy === 'shim' ? 'shim' : 'runtime'
  const credentialSource = typeof result.metadata?.credentialSource === 'string' ? result.metadata.credentialSource : undefined

  const probed = await imageDimensions(image.filePath)
  const width = probed.width || image.width || req.dims.width
  const height = probed.height || image.height || req.dims.height
  const promptHash = hashPrompt(req.prompt)
  const description = req.prompt.slice(0, 200)
  const generation = {
    provider: req.route.provider,
    model: req.route.model,
    surface: req.dims.surface,
    routeSource,
    // Quality is honored only on the shim path; the native runtime has no
    // quality knob, so don't record a tier it never applied (#379).
    ...(routeSource === 'shim' ? { quality: req.quality } : {}),
    // Reference lineage — which managed assets conditioned this generation (#418).
    ...(req.references.lineage.length ? { references: req.references.lineage } : {}),
    // Brand provenance (#419, D14): the V2 staleness hook.
    ...(req.brand ? { brandId: req.brand.brandId, ...(req.brand.fingerprint ? { brandFingerprint: req.brand.fingerprint } : {}) } : {}),
  }

  const ref = opts.create
    ? await ctx.assets.createAsset({
        sourceFilePath: image.filePath, type: 'images', agent, taskId: params.taskId ?? null,
        slug: `${req.dims.surface}-image`, op: 'generate', tool,
        // No machine tags: provenance (surface/provider/model) lives in
        // `generation` + `op`; tags stay the user's organizational namespace.
        prompt: req.prompt, promptHash, description,
        source: { kind: 'generated', path: null }, generation,
      })
    : await ctx.assets.addVersion(opts.assetId, {
        sourceFilePath: image.filePath, op: opts.op ?? 'edit', tool,
        prompt: req.prompt, promptHash, description,
        generation,
      })

  // Meter the image generation as a spend event (counts toward the budget
  // cap; priced by flat per-image rate where the model declares one). Image
  // inference is a separate billed path from chat-turn tokens.
  await meterImageTurn({
    agent,
    model: `${req.route.provider}/${req.route.model}`,
    count: result.images.length,
    taskId: params.taskId ?? null,
  })

  return {
    ok: true,
    assetId: ref.assetId,
    version: ref.version,
    width,
    height,
    surface: req.dims.surface,
    provider: req.route.provider,
    model: req.route.model,
    quality: req.quality,
    routeSource,
    ...(credentialSource ? { credentialSource } : {}),
    prompt: req.prompt.slice(0, 500),
    promptHash,
    ...(result.providerText ? { providerText: result.providerText } : {}),
  }
}

function referencesFingerprint(version: AssetVersionDetail | undefined): string {
  const refs = version?.generation?.references ?? []
  return refs.map(ref => `${ref.assetId}@${ref.version}`).sort().join(',')
}

function versionMatchesRequest(version: AssetVersionDetail | undefined, req: PreparedImageRequest, promptHash: string, tool: string): boolean {
  if (!version) return false
  // Quality only participates when it was actually recorded (shim path). A
  // native version omits quality, so comparing it would wrongly miss the reuse
  // for an otherwise-identical native re-request (#379).
  const qualityMatches = version.generation?.quality === undefined
    || version.generation.quality === req.quality
  // Same prompt with different references is NOT a duplicate (#418).
  const referencesMatch = referencesFingerprint(version) === req.references.fingerprint
  // A changed brand — or a changed VERSION of the brand — is a different
  // generation, not a duplicate (#419).
  const brandMatches = (version.generation?.brandId ?? '') === (req.brand?.brandId ?? '')
    && (version.generation?.brandFingerprint ?? '') === (req.brand?.fingerprint ?? '')
  return version.tool === tool
    && version.promptHash === promptHash
    && version.generation?.provider === req.route.provider
    && version.generation?.model === req.route.model
    && version.generation?.surface === req.dims.surface
    && qualityMatches
    && referencesMatch
    && brandMatches
}

async function reusableGenerateResult(ctx: PluginContext, params: ImagesGenerateParams, req: PreparedImageRequest, promptHash: string): Promise<ExecToolResult | null> {
  // Task-scoped reuse only — chat-bound generations rely on the ledger's
  // billed-call idempotency (cross-chat prompt dedupe would be surprising).
  if (!params.taskId) return null
  const existing = await ctx.assets.listAssets({ type: 'images', taskId: params.taskId })
  for (const summary of existing) {
    const current = await currentVersionOf(ctx, summary.assetId)
    if (!current) continue
    if (!versionMatchesRequest(current, req, promptHash, 'bakin_exec_images_generate')) continue
    return imageToolResultFromVersion(summary.assetId, current, req, { reused: true, idempotency: 'asset' })
  }
  return null
}

/** Reuse check for a versionOf re-roll: only the target asset's current version counts. */
async function reusableVersionOfResult(ctx: PluginContext, assetId: string, req: PreparedImageRequest, promptHash: string): Promise<ExecToolResult | null> {
  const current = await currentVersionOf(ctx, assetId)
  if (!current || !versionMatchesRequest(current, req, promptHash, 'bakin_exec_images_generate')) return null
  return imageToolResultFromVersion(assetId, current, req, { reused: true, idempotency: 'asset' })
}

async function reusableEditResult(ctx: PluginContext, assetId: string, req: PreparedImageRequest, promptHash: string): Promise<ExecToolResult | null> {
  const current = await currentVersionOf(ctx, assetId)
  if (!current || !versionMatchesRequest(current, req, promptHash, 'bakin_exec_images_edit')) return null
  return imageToolResultFromVersion(assetId, current, req, { reused: true, idempotency: 'asset' })
}

/** The asset's current version detail (one versions fetch), or undefined. */
async function currentVersionOf(ctx: PluginContext, assetId: string): Promise<AssetVersionDetail | undefined> {
  const history = await ctx.assets.getAssetVersions(assetId)
  return history?.versions.find(version => version.version === history.currentVersion)
}

function imageToolResultFromVersion(
  assetId: string,
  version: AssetVersionDetail,
  req: PreparedImageRequest,
  extra: Record<string, unknown> = {},
): ExecToolResult {
  return {
    ok: true,
    assetId,
    version: version.version,
    width: version.width ?? req.dims.width,
    height: version.height ?? req.dims.height,
    surface: req.dims.surface,
    provider: req.route.provider,
    model: req.route.model,
    quality: req.quality,
    routeSource: version.generation?.routeSource ?? 'runtime',
    prompt: (version.prompt ?? req.prompt).slice(0, 500),
    promptHash: version.promptHash ?? hashPrompt(req.prompt),
    ...extra,
  }
}

export async function generateImage(ctx: PluginContext, params: ImagesGenerateParams, agent: string): Promise<ExecToolResult> {
  const context = await resolveImageContext(params, agent)
  if ('error' in context) return fail(context.error)
  const req = await prepareImageRequest(ctx, params, agent)
  if ('error' in req) return fail(req.error)

  // Iteration lands as a VERSION, not a sibling asset (live-test incident:
  // a correction pass referencing the first pass minted a second asset).
  if (params.versionOf && params.allowNewAsset) {
    return fail('versionOf and allowNewAsset contradict — versionOf appends a version of an existing asset, allowNewAsset declares a separate companion asset. Pass exactly one.')
  }
  if (params.versionOf) {
    const target = await ctx.assets.getAsset(params.versionOf)
    if (!target) return fail(`versionOf asset not found: ${params.versionOf}`)
    if (target.type !== 'images') {
      return fail(`versionOf must target an images asset; ${params.versionOf} is type '${target.type}'`)
    }
  } else if (!params.allowNewAsset) {
    // Guard the iteration trap: referencing your own generated output from
    // THIS task without declaring intent. Imported reference material (op
    // import/upload) on the same task is the normal flow and never trips this.
    for (const ref of req.references.lineage) {
      const summary = await ctx.assets.getAsset(ref.assetId)
      const current = await currentVersionOf(ctx, ref.assetId)
      if (!summary || !current) continue
      if (params.taskId && summary.taskId === params.taskId && (current.op === 'generate' || current.op === 'edit')) {
        return fail(
          `Reference ${ref.assetId} is your own output on this task. If this is an iteration/correction of that deliverable, pass versionOf="${ref.assetId}" so the render appends a new VERSION (one asset, stable id). If it is a deliberately separate companion image, pass allowNewAsset=true.`,
        )
      }
    }
  }

  const promptHash = hashPrompt(req.prompt)
  // With versionOf, reuse is scoped to the TARGET asset only — a matching
  // sibling must not hijack an explicit re-roll into a different asset.
  const reused = params.versionOf
    ? await reusableVersionOfResult(ctx, params.versionOf, req, promptHash)
    : await reusableGenerateResult(ctx, params, req, promptHash)
  if (reused) return reused

  // The runtime capability owns transport: native when it can, the shared
  // direct-provider shim when it can't. The plugin never touches provider HTTP.
  if (!ctx.runtime.images) return fail('The active runtime does not provide an image generation capability')
  const runGenerate = ctx.runtime.images.generate

  // Idempotent: a client timeout that retries this identical billed
  // call must not bill twice. Reference identity participates so the same prompt
  // with different references is not treated as a duplicate (#418); versionOf
  // participates so a re-roll into an asset is distinct from a fresh generate.
  const key: ImageCallKey = {
    taskId: context.contextKey, op: 'generate', source: params.versionOf ?? null,
    promptHash, provider: req.route.provider, model: req.route.model,
    width: req.dims.width, height: req.dims.height, quality: req.quality,
    references: req.references.fingerprint,
  }
  return runBilledImageCall(key, async () => {
    // Budget/kill-switch gate INSIDE the idempotent wrapper (cost-control
    // v2): it must run only when we would actually BILL — a retry of an
    // already-billed identical call dedupes into the cached/in-flight result
    // first and always receives what was paid for. Refusals are ok:false and
    // never cached.
    const generateGate = await gateBilledMediaCall({ agent, model: `${req.route.provider}/${req.route.model}` })
    if (!generateGate.allowed) return { ok: false, error: generateGate.refusal.message, budget: generateGate.refusal }
    try {
      const result = await runGenerate({
        prompt: req.prompt, provider: req.route.provider, model: req.route.model,
        width: req.dims.width, height: req.dims.height, outputFormat: 'png', metadata: { quality: req.quality },
        ...(req.references.paths.length ? { referenceImages: req.references.paths } : {}),
      })
      const persist = params.versionOf
        ? { req, result, tool: 'bakin_exec_images_generate', create: false as const, assetId: params.versionOf, op: 'generate' as const }
        : { req, result, tool: 'bakin_exec_images_generate', create: true as const }
      return await persistImageResult(ctx, params, agent, persist)
    } catch (err) {
      return fail(`Image generation failed: ${errorMessage(err)}`)
    }
  })
}

export async function editImage(ctx: PluginContext, params: ImagesEditParams, agent: string): Promise<ExecToolResult> {
  if (!params.assetId) return fail('edit requires a managed assetId')
  if (params.versionOf) return fail('versionOf is a generate parameter — edit already appends a new version to assetId')
  if (params.referenceImages?.includes(params.assetId)) {
    return fail(`Reference ${params.assetId} equals the asset being edited — the edit already includes its current version; references add OTHER context images`)
  }
  // Source is the current version of the managed asset.
  const source = await ctx.assets.resolveVersionFile(params.assetId)
  if (!source) return fail(`Asset not found: ${params.assetId}`)

  const context = await resolveImageContext(params, agent)
  if ('error' in context) return fail(context.error)
  const req = await prepareImageRequest(ctx, params, agent)
  if ('error' in req) return fail(req.error)
  // Re-check after resolution: a raw path or media:// reference whose
  // auto-import deduped to the base asset would send the base file twice.
  if (req.references.lineage.some(ref => ref.assetId === params.assetId)) {
    return fail(`Reference resolves to the asset being edited (${params.assetId}) — the edit already includes its current version; references add OTHER context images`)
  }
  const promptHash = hashPrompt(req.prompt)
  const reused = await reusableEditResult(ctx, params.assetId, req, promptHash)
  if (reused) return reused

  // Edit is runtime-only — the shared shim does generation, not editing.
  if (!ctx.runtime.images?.edit) return fail('The active runtime does not provide an image edit capability')
  const runEdit = ctx.runtime.images.edit

  const key: ImageCallKey = {
    taskId: context.contextKey, op: 'edit', source: params.assetId,
    promptHash, provider: req.route.provider, model: req.route.model,
    width: req.dims.width, height: req.dims.height, quality: req.quality,
    references: req.references.fingerprint,
  }
  return runBilledImageCall(key, async () => {
    // Same gate placement as generate — only when we would actually bill.
    const editGate = await gateBilledMediaCall({ agent, model: `${req.route.provider}/${req.route.model}` })
    if (!editGate.allowed) return { ok: false, error: editGate.refusal.message, budget: editGate.refusal }
    try {
      // The base (current version) stays first; extra references append after it.
      const result = await runEdit({
        prompt: req.prompt, provider: req.route.provider, model: req.route.model,
        width: req.dims.width, height: req.dims.height, outputFormat: 'png',
        files: [source.absPath, ...req.references.paths], metadata: { quality: req.quality },
      })
      return await persistImageResult(ctx, params, agent, { req, result, tool: 'bakin_exec_images_edit', create: false, assetId: params.assetId })
    } catch (err) {
      return fail(`Image edit failed: ${errorMessage(err)}`)
    }
  })
}

export async function exportImage(ctx: PluginContext, params: ImagesExportParams, _agent: string): Promise<ExecToolResult> {
  const surfaceId = params.surface || 'custom'
  const dims = surfaceId === 'custom'
    ? (params.width && params.height ? { surface: 'custom', ...clampDimensions(params.width, params.height) } : null)
    : dimensionsForSurface(surfaceId, params.width, params.height)
  if (!dims) return fail(`Unknown image surface or missing custom dimensions: ${surfaceId}`)

  const format = params.format ?? 'jpg'
  try {
    const { name, file } = await ctx.assets.addExport(params.assetId, {
      surface: dims.surface, format, width: dims.width, height: dims.height, quality: params.quality,
    })
    return { ok: true, assetId: params.assetId, exportName: name, file, surface: dims.surface, width: dims.width, height: dims.height, format }
  } catch (err) {
    return fail(`Export failed: ${errorMessage(err)}`)
  }
}
