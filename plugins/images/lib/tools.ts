import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import type { ExecToolResult, PluginContext } from '@bakin/core/plugin-types'
import type { RuntimeImageGenerationResult, RuntimeImageProvider } from '@bakin/core/adapters/runtime'
import type { ImagePluginSettings, ImageProviderId, NativeImageProviderId } from '../types'
import { getImageAdapter, type ImageAdapterResult } from './adapters'
import { resolveImageApiKey } from './credentials'
import { DEFAULT_IMAGE_SETTINGS, fetchRuntimeImageProviders, getImageProvider, isNativeImageProvider, providerReadiness } from './providers'
import { resolveImageRoute } from './routing'
import { getImageProfile } from './platform-profiles'
import { getContentDir } from '../../../src/core/content-dir'

/** Largest edge we send to a provider / feed into sharp, to bound cost. */
const MAX_IMAGE_EDGE = 2048
/** Number of attempts for a transient provider failure (1 retry). */
const IMAGE_GENERATION_ATTEMPTS = 2
const IMAGE_RETRY_DELAY_MS = 2000

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

function effectiveSettings(ctx: PluginContext): Required<ImagePluginSettings> {
  const settings = ctx.getSettings<ImagePluginSettings>()
  return {
    defaultProvider: settings.defaultProvider ?? DEFAULT_IMAGE_SETTINGS.defaultProvider,
    defaultSurface: settings.defaultSurface ?? DEFAULT_IMAGE_SETTINGS.defaultSurface,
    fallbackOrder: settings.fallbackOrder ?? DEFAULT_IMAGE_SETTINGS.fallbackOrder,
    quality: settings.quality ?? DEFAULT_IMAGE_SETTINGS.quality,
  }
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

function clampEdge(value: number): number {
  return Math.min(Math.max(1, Math.round(value)), MAX_IMAGE_EDGE)
}

function dimensionsForSurface(surfaceId: string, width?: number, height?: number): { surface: string; width: number; height: number } | null {
  const profile = getImageProfile(surfaceId)
  if (!profile && (!width || !height)) return null
  return {
    surface: profile?.id ?? 'custom',
    width: clampEdge(width ?? profile!.width),
    height: clampEdge(height ?? profile!.height),
  }
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

function nativeProvider(provider: ImageProviderId): NativeImageProviderId | null {
  return isNativeImageProvider(provider) ? provider : null
}

function runtimeRouteReady(runtimeProviders: RuntimeImageProvider[], route: { provider: ImageProviderId; model: string }): boolean {
  const provider = runtimeProviders.find(candidate => candidate.id === route.provider)
  if (!provider || provider.configured !== true) return false
  const models = provider.models?.length ? provider.models : provider.defaultModel ? [provider.defaultModel] : []
  return models.includes(route.model)
}

function isTransientError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /\b(408|429|5\d\d)\b/.test(message)
    || /timeout|timed out|network|fetch failed|econn|socket|temporarily|rate limit/i.test(message)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Retry a provider call once on a transient error; surface other errors immediately. */
async function withImageRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= IMAGE_GENERATION_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt >= IMAGE_GENERATION_ATTEMPTS || !isTransientError(err)) throw err
      await delay(IMAGE_RETRY_DELAY_MS)
    }
  }
  throw lastError
}

/**
 * Generate directly through a native provider adapter. Returns null when the
 * provider has no native adapter or no configured API key (so the caller can
 * decide whether that's a hard failure or just an unavailable fallback).
 */
async function generateNative(
  ctx: PluginContext,
  route: { provider: ImageProviderId; model: string },
  prompt: string,
  dims: { width: number; height: number },
  quality: 'draft' | 'standard' | 'premium',
): Promise<ImageAdapterResult | null> {
  const directProvider = nativeProvider(route.provider)
  if (!directProvider) return null
  const apiKey = await resolveImageApiKey(ctx, directProvider)
  if (!apiKey) return null
  const adapter = getImageAdapter(directProvider)
  return withImageRetry(() => adapter.generate({
    provider: directProvider,
    model: route.model,
    prompt,
    width: dims.width,
    height: dims.height,
    quality,
    apiKey,
  }))
}

async function generateWithRuntime(
  ctx: PluginContext,
  route: { provider: ImageProviderId; model: string },
  prompt: string,
  dims: { width: number; height: number },
  quality: 'draft' | 'standard' | 'premium',
): Promise<RuntimeImageGenerationResult> {
  if (!ctx.runtime.images) throw new Error('Runtime image generation is unavailable')
  return ctx.runtime.images.generate({
    prompt,
    provider: route.provider,
    model: route.model,
    width: dims.width,
    height: dims.height,
    outputFormat: 'png',
    metadata: { quality },
  })
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
  const settings = effectiveSettings(ctx)
  const surfaceId = params.surface || settings.defaultSurface
  const dims = dimensionsForSurface(surfaceId, params.width, params.height)
  if (!dims) return fail(`Unknown image surface: ${surfaceId}`)

  // Resolve runtime providers and readiness once, then reuse for routing, the
  // routable check, and the runtime-readiness gate — these used to each issue
  // their own provider/config probe (a subprocess per call in the real adapter).
  const runtimeProviders = await fetchRuntimeImageProviders(ctx)
  const readiness = await providerReadiness(ctx, runtimeProviders)
  const route = resolveImageRoute(readiness, settings, { provider: params.provider, model: params.model })
  if (!route) return fail('No image provider route available')

  const provider = getImageProvider(route.provider)
  const readyProvider = readiness.find(candidate => candidate.id === route.provider)
  const knownModel = provider?.models.some(model => model.id === route.model && model.status === 'routable')
    || readyProvider?.models.some(model => model.id === route.model && model.status === 'routable')
  if (!knownModel) {
    return fail(`Image model is not routable: ${route.provider}/${route.model}`)
  }

  const quality = params.quality ?? settings.quality
  let generated: { filePath: string; mimeType: string; width: number; height: number; providerText?: string }
  let routeSource: 'runtime' | 'native' = 'native'
  if (runtimeRouteReady(runtimeProviders, route)) {
    try {
      const runtimeGenerated = await withImageRetry(() => generateWithRuntime(ctx, route, prompt, dims, quality))
      const image = runtimeGenerated.images[0]
      if (!image?.filePath) throw new Error('runtime returned no image file')
      generated = {
        filePath: image.filePath,
        mimeType: image.mimeType ?? 'image/png',
        width: image.width ?? dims.width,
        height: image.height ?? dims.height,
        ...(runtimeGenerated.providerText ? { providerText: runtimeGenerated.providerText } : {}),
      }
      routeSource = 'runtime'
    } catch (runtimeErr) {
      // Degrade to the native adapter when one is configured rather than
      // hard-failing on a transient runtime error.
      try {
        const fallback = await generateNative(ctx, route, prompt, dims, quality)
        if (!fallback) return fail(`Runtime image generation failed: ${errorMessage(runtimeErr)}`)
        generated = fallback
        routeSource = 'native'
      } catch (nativeErr) {
        return fail(`Runtime image generation failed: ${errorMessage(runtimeErr)}; native fallback also failed: ${errorMessage(nativeErr)}`)
      }
    }
  } else {
    if (!nativeProvider(route.provider)) {
      return fail(`No runtime image provider route or native adapter is configured for: ${route.provider}`)
    }
    try {
      const native = await generateNative(ctx, route, prompt, dims, quality)
      if (!native) return fail(`No API key configured for image provider: ${route.provider}`)
      generated = native
    } catch (err) {
      return fail(`Image generation failed: ${errorMessage(err)}`)
    }
  }

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
      width: dims.width,
      height: dims.height,
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
    width: dims.width,
    height: dims.height,
    surface: dims.surface,
    provider: route.provider,
    model: route.model,
    quality,
    routeSource,
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
    ? (params.width && params.height ? { surface: 'custom', width: clampEdge(params.width), height: clampEdge(params.height) } : null)
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
