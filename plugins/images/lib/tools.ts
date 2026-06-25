import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { ExecToolResult, PluginContext } from '@bakin/core/plugin-types'
import type { RuntimeImageGenerationResult } from '@bakin/core/adapters/runtime'
import { getAsset, listAssets, upsertFromSource, resolveStoreFile } from '../../assets/lib/asset-service'
import { isValidAssetId } from '../../assets/lib/asset-id'
import type { AssetManifest, AssetVersion } from '../../assets/lib/manifest'
import type { ImageProviderId, ImageProviderReadiness } from '../types'
import { effectiveImageSettings, getImageProvider, providerReadiness } from './providers'
import { resolveImageRoute } from './routing'
import { getImageProfile } from './platform-profiles'
import { runBilledImageCall, type ImageCallKey } from './idempotency'
import { meterImageTurn } from '../../../src/core/agent-cost'

/** Largest edge we send to a provider / feed into sharp, to bound cost. */
const MAX_IMAGE_EDGE = 2048
/** Upper bound on reference/context images per call (#418). Providers cap input
 *  images; keep it conservative and bump here if a workflow needs more. */
const MAX_REFERENCE_IMAGES = 4
type Sharp = typeof import('sharp')
let sharpModule: Promise<Sharp | null> | null = null

export interface ImagesGenerateParams {
  prompt?: string
  promptPacket?: Record<string, unknown>
  taskId: string
  surface?: string
  provider?: ImageProviderId | 'auto'
  model?: string
  width?: number
  height?: number
  quality?: 'draft' | 'standard' | 'premium'
  /** Managed assetIds and/or file paths used as reference/context images (#418). */
  referenceImages?: string[]
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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function loadSharp(): Promise<Sharp | null> {
  sharpModule ??= import('sharp')
    .then((mod): Sharp => (mod as unknown as { default?: Sharp }).default ?? (mod as unknown as Sharp))
    .catch(() => null)
  return sharpModule
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
  if (!modelDesc?.capabilities.includes('reference-images')) {
    return { error: `Model does not support reference images: ${route.provider}/${route.model}` }
  }
  if (readyProvider?.servedBy !== 'runtime') {
    const via = readyProvider?.servedBy === 'shim' ? 'served via the direct shim' : 'not natively configured'
    return { error: `Reference images require the native runtime; ${route.provider} is ${via}` }
  }

  const paths: string[] = []
  const lineage: Array<{ assetId: string; version: number }> = []
  for (const rawEntry of entries) {
    // Runtime-private media URIs (e.g. a Discord attachment OpenClaw stored as
    // media://inbound/…) resolve to a local path adapter-side, then flow
    // through the same auto-import as any raw path — tracked, task-linked.
    let entry = rawEntry
    if (/^media:\/\//.test(rawEntry)) {
      if (!ctx.runtime.media?.resolveUri) {
        return { error: `The active runtime cannot resolve media:// URIs (reference ${rawEntry}); pass an assetId or local path instead` }
      }
      const resolved = await ctx.runtime.media.resolveUri(rawEntry)
      if (!resolved) return { error: `Reference media URI not found: ${rawEntry}` }
      entry = resolved
    }
    // A path INSIDE the asset store is already managed — reflect it to its
    // identity (and to the real version file when given a thumb) instead of
    // letting auto-import clone it.
    const managed = resolveStoreFile(entry)
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
      const up = await upsertFromSource(entry, {
        sourceFilePath: entry, type: 'images', agent, taskId: params.taskId,
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
  const prompt = compilePrompt(params)
  if (!prompt) return { error: 'prompt or promptPacket is required' }
  const settings = effectiveImageSettings(ctx)
  const surfaceId = params.surface || settings.defaultSurface
  const dims = dimensionsForSurface(surfaceId, params.width, params.height)
  if (!dims) return { error: `Unknown image surface: ${surfaceId}` }

  const readiness = await providerReadiness(ctx)
  const route = resolveImageRoute(readiness, settings, { provider: params.provider, model: params.model })
  if (!route) return { error: 'No image provider route available' }

  const provider = getImageProvider(route.provider)
  const readyProvider = readiness.find(candidate => candidate.id === route.provider)
  const knownModel = provider?.models.some(model => model.id === route.model && model.status === 'routable')
    || readyProvider?.models.some(model => model.id === route.model && model.status === 'routable')
  if (!knownModel) return { error: `Image model is not routable: ${route.provider}/${route.model}` }

  const references = await resolveReferences(ctx, params, agent, route, readyProvider)
  if ('error' in references) return references

  return { prompt, dims, route, quality: params.quality ?? settings.quality, references }
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
  }

  const ref = opts.create
    ? await ctx.assets.createAsset({
        sourceFilePath: image.filePath, type: 'images', agent, taskId: params.taskId,
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
    taskId: params.taskId,
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

function referencesFingerprint(version: AssetVersion | undefined): string {
  const refs = version?.generation?.references ?? []
  return refs.map(ref => `${ref.assetId}@${ref.version}`).sort().join(',')
}

function versionMatchesRequest(version: AssetVersion | undefined, req: PreparedImageRequest, promptHash: string, tool: string): boolean {
  if (!version) return false
  // Quality only participates when it was actually recorded (shim path). A
  // native version omits quality, so comparing it would wrongly miss the reuse
  // for an otherwise-identical native re-request (#379).
  const qualityMatches = version.generation?.quality === undefined
    || version.generation.quality === req.quality
  // Same prompt with different references is NOT a duplicate (#418).
  const referencesMatch = referencesFingerprint(version) === req.references.fingerprint
  return version.tool === tool
    && version.promptHash === promptHash
    && version.generation?.provider === req.route.provider
    && version.generation?.model === req.route.model
    && version.generation?.surface === req.dims.surface
    && qualityMatches
    && referencesMatch
}

function reusableGenerateResult(params: ImagesGenerateParams, req: PreparedImageRequest, promptHash: string): ExecToolResult | null {
  const existing = listAssets({ type: 'images', taskId: params.taskId })
  for (const summary of existing) {
    const manifest = getAsset(summary.assetId)
    const current = currentVersion(manifest)
    if (!current) continue
    if (!versionMatchesRequest(current, req, promptHash, 'bakin_exec_images_generate')) continue
    return imageToolResultFromVersion(summary.assetId, current, req, { reused: true, idempotency: 'asset' })
  }
  return null
}

/** Reuse check for a versionOf re-roll: only the target asset's current version counts. */
function reusableVersionOfResult(assetId: string, req: PreparedImageRequest, promptHash: string): ExecToolResult | null {
  const manifest = getAsset(assetId)
  const current = currentVersion(manifest)
  if (!current || !versionMatchesRequest(current, req, promptHash, 'bakin_exec_images_generate')) return null
  return imageToolResultFromVersion(assetId, current, req, { reused: true, idempotency: 'asset' })
}

function reusableEditResult(assetId: string, req: PreparedImageRequest, promptHash: string): ExecToolResult | null {
  const manifest = getAsset(assetId)
  const current = currentVersion(manifest)
  if (!current || !versionMatchesRequest(current, req, promptHash, 'bakin_exec_images_edit')) return null
  return imageToolResultFromVersion(assetId, current, req, { reused: true, idempotency: 'asset' })
}

function currentVersion(manifest: AssetManifest | null): AssetVersion | undefined {
  return manifest?.versions.find(version => version.version === manifest.currentVersion)
}

function imageToolResultFromVersion(
  assetId: string,
  version: AssetVersion,
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
  const req = await prepareImageRequest(ctx, params, agent)
  if ('error' in req) return fail(req.error)

  // Iteration lands as a VERSION, not a sibling asset (live-test incident:
  // a correction pass referencing the first pass minted a second asset).
  if (params.versionOf && params.allowNewAsset) {
    return fail('versionOf and allowNewAsset contradict — versionOf appends a version of an existing asset, allowNewAsset declares a separate companion asset. Pass exactly one.')
  }
  if (params.versionOf) {
    const targetManifest = getAsset(params.versionOf)
    if (!targetManifest) return fail(`versionOf asset not found: ${params.versionOf}`)
    if (targetManifest.type !== 'images') {
      return fail(`versionOf must target an images asset; ${params.versionOf} is type '${targetManifest.type}'`)
    }
  } else if (!params.allowNewAsset) {
    // Guard the iteration trap: referencing your own generated output from
    // THIS task without declaring intent. Imported reference material (op
    // import/upload) on the same task is the normal flow and never trips this.
    for (const ref of req.references.lineage) {
      const manifest = getAsset(ref.assetId)
      const current = currentVersion(manifest)
      if (!manifest || !current) continue
      if (manifest.taskId === params.taskId && (current.op === 'generate' || current.op === 'edit')) {
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
    ? reusableVersionOfResult(params.versionOf, req, promptHash)
    : reusableGenerateResult(params, req, promptHash)
  if (reused) return reused

  // The runtime capability owns transport: native when it can, the shared
  // direct-provider shim when it can't. The plugin never touches provider HTTP.
  if (!ctx.runtime.images) return fail('The active runtime does not provide an image generation capability')
  const runGenerate = ctx.runtime.images.generate

  // Idempotent: a client (mcporter) timeout that retries this identical billed
  // call must not bill twice. Reference identity participates so the same prompt
  // with different references is not treated as a duplicate (#418); versionOf
  // participates so a re-roll into an asset is distinct from a fresh generate.
  const key: ImageCallKey = {
    taskId: params.taskId, op: 'generate', source: params.versionOf ?? null,
    promptHash, provider: req.route.provider, model: req.route.model,
    width: req.dims.width, height: req.dims.height, quality: req.quality,
    references: req.references.fingerprint,
  }
  return runBilledImageCall(key, async () => {
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

  const req = await prepareImageRequest(ctx, params, agent)
  if ('error' in req) return fail(req.error)
  // Re-check after resolution: a raw path or media:// reference whose
  // auto-import deduped to the base asset would send the base file twice.
  if (req.references.lineage.some(ref => ref.assetId === params.assetId)) {
    return fail(`Reference resolves to the asset being edited (${params.assetId}) — the edit already includes its current version; references add OTHER context images`)
  }
  const promptHash = hashPrompt(req.prompt)
  const reused = reusableEditResult(params.assetId, req, promptHash)
  if (reused) return reused

  // Edit is runtime-only — the shared shim does generation, not editing.
  if (!ctx.runtime.images?.edit) return fail('The active runtime does not provide an image edit capability')
  const runEdit = ctx.runtime.images.edit

  const key: ImageCallKey = {
    taskId: params.taskId, op: 'edit', source: params.assetId,
    promptHash, provider: req.route.provider, model: req.route.model,
    width: req.dims.width, height: req.dims.height, quality: req.quality,
    references: req.references.fingerprint,
  }
  return runBilledImageCall(key, async () => {
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
