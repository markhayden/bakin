import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import type { ExecToolResult, PluginContext } from '@bakin/core/plugin-types'
import type { ImageProviderId } from '../types'
import { effectiveImageSettings, getImageProvider, providerReadiness } from './providers'
import { resolveImageRoute } from './routing'
import { getImageProfile } from './platform-profiles'
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

export async function generateImage(ctx: PluginContext, params: ImagesGenerateParams, agent: string): Promise<ExecToolResult> {
  const prompt = compilePrompt(params)
  if (!prompt) return fail('prompt or promptPacket is required')
  const settings = effectiveImageSettings(ctx)
  const surfaceId = params.surface || settings.defaultSurface
  const dims = dimensionsForSurface(surfaceId, params.width, params.height)
  if (!dims) return fail(`Unknown image surface: ${surfaceId}`)

  const readiness = await providerReadiness(ctx)
  const route = resolveImageRoute(readiness, settings, { provider: params.provider, model: params.model })
  if (!route) return fail('No image provider route available')

  const provider = getImageProvider(route.provider)
  const readyProvider = readiness.find(candidate => candidate.id === route.provider)
  const knownModel = provider?.models.some(model => model.id === route.model && model.status === 'routable')
    || readyProvider?.models.some(model => model.id === route.model && model.status === 'routable')
  if (!knownModel) {
    return fail(`Image model is not routable: ${route.provider}/${route.model}`)
  }

  // The runtime capability owns transport: it serves the route natively when it
  // can, or composes the shared direct-provider shim when it can't. The plugin
  // never touches provider HTTP or credentials.
  if (!ctx.runtime.images) {
    return fail('The active runtime does not provide an image generation capability')
  }

  const quality = params.quality ?? settings.quality
  let generated: { filePath: string; mimeType: string; width: number; height: number; providerText?: string }
  let routeSource: string
  let credentialSource: string | undefined
  try {
    const result = await ctx.runtime.images.generate({
      prompt,
      provider: route.provider,
      model: route.model,
      width: dims.width,
      height: dims.height,
      outputFormat: 'png',
      metadata: { quality },
    })
    const image = result.images[0]
    if (!image?.filePath) return fail('Runtime image generation returned no image file')
    generated = {
      filePath: image.filePath,
      mimeType: image.mimeType ?? 'image/png',
      width: image.width ?? dims.width,
      height: image.height ?? dims.height,
      ...(result.providerText ? { providerText: result.providerText } : {}),
    }
    const servedBy = typeof result.metadata?.servedBy === 'string' ? result.metadata.servedBy : undefined
    routeSource = servedBy === 'shim' ? 'shim' : 'runtime'
    credentialSource = typeof result.metadata?.credentialSource === 'string' ? result.metadata.credentialSource : undefined
  } catch (err) {
    return fail(`Image generation failed: ${errorMessage(err)}`)
  }

  // Record the ACTUAL produced pixel dimensions — a provider may snap to its
  // own nearest supported size (e.g. OpenAI 1024x1536), so the surface intent
  // (dims.surface) and the real file size can differ. Probe the file; fall back
  // to the provider-reported / requested dims if the probe fails.
  const probed = await imageDimensions(generated.filePath)
  const actualWidth = probed.width || generated.width || dims.width
  const actualHeight = probed.height || generated.height || dims.height

  const promptAssetFilename = params.savePromptPacket
    ? await savePromptPacketAsset(ctx, agent, params.taskId, prompt, params.promptPacket)
    : undefined
  const promptHash = hashPrompt(prompt)
  const saved = await ctx.assets.save({
    filePath: generated.filePath,
    taskId: params.taskId,
    type: 'images',
    agent,
    tool: 'bakin_exec_images_generate',
    description: prompt.slice(0, 200),
    tags: ['generated', dims.surface, route.provider, route.model],
    slug: `${dims.surface}-image`,
    generation: {
      provider: route.provider,
      model: route.model,
      surface: dims.surface,
      width: actualWidth,
      height: actualHeight,
      quality,
      promptHash,
      routeSource,
      ...(promptAssetFilename ? { promptAssetFilename } : {}),
      createdByTool: 'bakin_exec_images_generate',
    },
  })
  if (!saved.ok) return fail(`Image generated but asset save failed: ${saved.error}`)

  return {
    ok: true,
    path: saved.path,
    metadataPath: saved.metadataPath,
    filename: saved.filename,
    image_filename: saved.filename,
    width: actualWidth,
    height: actualHeight,
    surface: dims.surface,
    provider: route.provider,
    model: route.model,
    quality,
    routeSource,
    ...(credentialSource ? { credentialSource } : {}),
    prompt: prompt.slice(0, 500),
    promptHash,
    ...(promptAssetFilename ? { promptAssetFilename } : {}),
    ...(generated.providerText ? { providerText: generated.providerText } : {}),
  }
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
