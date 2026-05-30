import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import type { ExecToolResult, PluginContext } from '@bakin/core/plugin-types'
import type { RuntimeImageGenerationResult } from '@bakin/core/adapters/runtime'
import type { ImageProviderId } from '../types'
import { effectiveImageSettings, getImageProvider, providerReadiness } from './providers'
import { resolveImageRoute } from './routing'
import { getImageProfile } from './platform-profiles'
import { runBilledImageCall, type ImageCallKey } from './idempotency'
import { getContentDir } from '../../../src/core/content-dir'

/** Largest edge we send to a provider / feed into sharp, to bound cost. */
const MAX_IMAGE_EDGE = 2048

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
  savePromptPacket?: boolean
}

export interface ImagesImportParams {
  filePath: string
  taskId: string
  description?: string
  tags?: string[]
}

export interface ImagesEditParams extends ImagesGenerateParams {
  /** Managed asset filename to edit (preferred), resolved to its stored path. */
  filename?: string
  /** Or an explicit local source-image path. */
  sourcePath?: string
}

export interface ImagesExportParams {
  filename: string
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

function hashPrompt(prompt: string): string {
  return `sha256:${createHash('sha256').update(prompt).digest('hex')}`
}

function compilePrompt(params: Pick<ImagesGenerateParams, 'prompt' | 'promptPacket'>): string | null {
  if (params.prompt && params.prompt.trim().length > 0) return params.prompt
  if (params.promptPacket && Object.keys(params.promptPacket).length > 0) {
    return Object.entries(params.promptPacket)
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
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

async function savePromptPacketAsset(
  ctx: PluginContext,
  agent: string,
  taskId: string,
  prompt: string,
  promptPacket: Record<string, unknown> | undefined,
): Promise<string | undefined> {
  const dir = mkdtempSync(join(tmpdir(), 'bakin-image-prompt-'))
  const filePath = join(dir, 'prompt-packet.md')
  const body = [
    '# Image Prompt Packet',
    '',
    '```text',
    prompt,
    '```',
    '',
    promptPacket ? '```json' : '',
    promptPacket ? JSON.stringify(promptPacket, null, 2) : '',
    promptPacket ? '```' : '',
  ].filter(Boolean).join('\n')
  writeFileSync(filePath, body, 'utf-8')
  const saved = await ctx.assets.save({
    filePath,
    taskId,
    type: 'text',
    agent,
    tool: 'bakin_exec_images_generate',
    description: 'Approved image prompt packet',
    tags: ['image-prompt-packet'],
    slug: 'image-prompt-packet',
  })
  return saved.ok ? saved.filename : undefined
}

async function imageDimensions(filePath: string): Promise<{ width: number; height: number }> {
  try {
    const metadata = await sharp(filePath).metadata()
    return { width: metadata.width ?? 0, height: metadata.height ?? 0 }
  } catch {
    return { width: 0, height: 0 }
  }
}

export async function importImage(ctx: PluginContext, params: ImagesImportParams, agent: string): Promise<ExecToolResult> {
  if (!existsSync(params.filePath)) return fail(`File not found: ${params.filePath}`)
  const dims = await imageDimensions(params.filePath)
  const saved = await ctx.assets.save({
    filePath: params.filePath,
    taskId: params.taskId,
    type: 'images',
    agent,
    tool: 'bakin_exec_images_import',
    description: (params.description || basename(params.filePath)).slice(0, 200),
    tags: params.tags ?? ['imported'],
    slug: params.description || basename(params.filePath),
  })
  if (!saved.ok) return fail(`Asset save failed: ${saved.error}`)
  return {
    ok: true,
    path: saved.path,
    metadataPath: saved.metadataPath,
    filename: saved.filename,
    image_filename: saved.filename,
    width: dims.width,
    height: dims.height,
    model: 'import',
  }
}

interface PreparedImageRequest {
  prompt: string
  dims: { surface: string; width: number; height: number }
  route: { provider: ImageProviderId; model: string }
  quality: 'draft' | 'standard' | 'premium'
}

/** Shared prologue for generate + edit: compile prompt, resolve surface + route, validate routability. */
async function prepareImageRequest(ctx: PluginContext, params: ImagesGenerateParams): Promise<PreparedImageRequest | { error: string }> {
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

  return { prompt, dims, route, quality: params.quality ?? settings.quality }
}

/**
 * Persist a runtime image result (from generate or edit) as a managed asset
 * with generation provenance, and build the tool result. Records the ACTUAL
 * produced pixel dimensions (a provider may snap to its own nearest supported
 * size) by probing the file; surface intent stays in `generation.surface`.
 */
async function persistImageAsset(
  ctx: PluginContext,
  params: ImagesGenerateParams,
  agent: string,
  opts: { req: PreparedImageRequest; result: RuntimeImageGenerationResult; tool: string; tag: 'generated' | 'edited' },
): Promise<ExecToolResult> {
  const { req, result, tool, tag } = opts
  const image = result.images[0]
  if (!image?.filePath) return fail('Runtime image operation returned no image file')

  const servedBy = typeof result.metadata?.servedBy === 'string' ? result.metadata.servedBy : undefined
  const routeSource = servedBy === 'shim' ? 'shim' : 'runtime'
  const credentialSource = typeof result.metadata?.credentialSource === 'string' ? result.metadata.credentialSource : undefined

  const probed = await imageDimensions(image.filePath)
  const width = probed.width || image.width || req.dims.width
  const height = probed.height || image.height || req.dims.height

  const promptAssetFilename = params.savePromptPacket
    ? await savePromptPacketAsset(ctx, agent, params.taskId, req.prompt, params.promptPacket)
    : undefined
  const promptHash = hashPrompt(req.prompt)
  const saved = await ctx.assets.save({
    filePath: image.filePath,
    taskId: params.taskId,
    type: 'images',
    agent,
    tool,
    description: req.prompt.slice(0, 200),
    tags: [tag, req.dims.surface, req.route.provider, req.route.model],
    slug: `${req.dims.surface}-image`,
    generation: {
      provider: req.route.provider,
      model: req.route.model,
      surface: req.dims.surface,
      width,
      height,
      quality: req.quality,
      promptHash,
      routeSource,
      ...(promptAssetFilename ? { promptAssetFilename } : {}),
      createdByTool: tool,
    },
  })
  if (!saved.ok) return fail(`Image ${tag} but asset save failed: ${saved.error}`)

  return {
    ok: true,
    path: saved.path,
    metadataPath: saved.metadataPath,
    filename: saved.filename,
    image_filename: saved.filename,
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
    ...(promptAssetFilename ? { promptAssetFilename } : {}),
    ...(result.providerText ? { providerText: result.providerText } : {}),
  }
}

export async function generateImage(ctx: PluginContext, params: ImagesGenerateParams, agent: string): Promise<ExecToolResult> {
  const req = await prepareImageRequest(ctx, params)
  if ('error' in req) return fail(req.error)

  // The runtime capability owns transport: it serves the route natively when it
  // can, or composes the shared direct-provider shim when it can't. The plugin
  // never touches provider HTTP or credentials.
  if (!ctx.runtime.images) return fail('The active runtime does not provide an image generation capability')
  const runGenerate = ctx.runtime.images.generate

  // Idempotent: a client (mcporter) timeout that retries this identical billed
  // call must not bill twice — return the in-flight / just-saved result instead.
  const key: ImageCallKey = {
    taskId: params.taskId,
    op: 'generate',
    source: null,
    promptHash: hashPrompt(req.prompt),
    provider: req.route.provider,
    model: req.route.model,
    width: req.dims.width,
    height: req.dims.height,
    quality: req.quality,
  }
  return runBilledImageCall(key, async () => {
    try {
      const result = await runGenerate({
        prompt: req.prompt,
        provider: req.route.provider,
        model: req.route.model,
        width: req.dims.width,
        height: req.dims.height,
        outputFormat: 'png',
        metadata: { quality: req.quality },
      })
      return await persistImageAsset(ctx, params, agent, { req, result, tool: 'bakin_exec_images_generate', tag: 'generated' })
    } catch (err) {
      return fail(`Image generation failed: ${errorMessage(err)}`)
    }
  })
}

export async function editImage(ctx: PluginContext, params: ImagesEditParams, agent: string): Promise<ExecToolResult> {
  // Resolve the source image: a managed asset filename or an explicit path.
  let sourcePath: string | undefined
  if (params.filename) {
    const asset = await ctx.assets.getByFilename(params.filename)
    if (!asset) return fail(`Asset not found: ${params.filename}`)
    sourcePath = join(getContentDir(), asset.path)
  } else if (params.sourcePath) {
    sourcePath = params.sourcePath
  }
  if (!sourcePath || !existsSync(sourcePath)) {
    return fail('edit requires an existing source image (pass filename for a managed asset or sourcePath for a local file)')
  }

  const req = await prepareImageRequest(ctx, params)
  if ('error' in req) return fail(req.error)

  // Edit is runtime-only — the shared shim does generation, not editing.
  if (!ctx.runtime.images?.edit) return fail('The active runtime does not provide an image edit capability')
  const runEdit = ctx.runtime.images.edit

  // Idempotent like generate: an identical retried edit must not double-bill.
  const key: ImageCallKey = {
    taskId: params.taskId,
    op: 'edit',
    source: params.filename ?? params.sourcePath ?? null,
    promptHash: hashPrompt(req.prompt),
    provider: req.route.provider,
    model: req.route.model,
    width: req.dims.width,
    height: req.dims.height,
    quality: req.quality,
  }
  return runBilledImageCall(key, async () => {
    try {
      const result = await runEdit({
        prompt: req.prompt,
        provider: req.route.provider,
        model: req.route.model,
        width: req.dims.width,
        height: req.dims.height,
        outputFormat: 'png',
        files: [sourcePath],
        metadata: { quality: req.quality },
      })
      return await persistImageAsset(ctx, params, agent, { req, result, tool: 'bakin_exec_images_edit', tag: 'edited' })
    } catch (err) {
      return fail(`Image edit failed: ${errorMessage(err)}`)
    }
  })
}

export async function exportImage(ctx: PluginContext, params: ImagesExportParams, agent: string): Promise<ExecToolResult> {
  const asset = await ctx.assets.getByFilename(params.filename)
  if (!asset) return fail(`Asset not found: ${params.filename}`)
  const surfaceId = params.surface || 'custom'
  const dims = surfaceId === 'custom'
    ? (params.width && params.height ? { surface: 'custom', ...clampDimensions(params.width, params.height) } : null)
    : dimensionsForSurface(surfaceId, params.width, params.height)
  if (!dims) return fail(`Unknown image surface or missing custom dimensions: ${surfaceId}`)

  const format = params.format ?? 'jpg'
  const sourcePath = join(getContentDir(), asset.path)
  const outDir = mkdtempSync(join(tmpdir(), 'bakin-image-export-'))
  const outPath = join(outDir, `${params.filename.replace(/\.[^.]+$/, '')}.${format}`)
  let pipeline = sharp(sourcePath).resize(dims.width, dims.height, { fit: 'cover' })
  if (format === 'jpg') pipeline = pipeline.jpeg({ quality: params.quality ?? 82 })
  if (format === 'png') pipeline = pipeline.png()
  if (format === 'webp') pipeline = pipeline.webp({ quality: params.quality ?? 82 })
  await pipeline.toFile(outPath)

  const saved = await ctx.assets.save({
    filePath: outPath,
    taskId: params.taskId,
    type: 'images',
    agent,
    tool: 'bakin_exec_images_export',
    description: `Exported ${params.filename} for ${dims.surface}`,
    tags: ['exported', dims.surface],
    slug: `${dims.surface}-export`,
  })
  if (!saved.ok) return fail(`Export failed while saving asset: ${saved.error}`)
  return {
    ok: true,
    filename: saved.filename,
    image_filename: saved.filename,
    path: saved.path,
    metadataPath: saved.metadataPath,
    sourceFilename: params.filename,
    surface: dims.surface,
    width: dims.width,
    height: dims.height,
    format,
  }
}
