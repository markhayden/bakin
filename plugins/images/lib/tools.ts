import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import type { ExecToolResult, PluginContext } from '@bakin/core/plugin-types'
import type { ImagePluginSettings, ImageProviderId } from '../types'
import { getImageAdapter } from './adapters'
import { resolveImageApiKey } from './credentials'
import { DEFAULT_IMAGE_SETTINGS, getImageProvider, providerReadiness } from './providers'
import { getImageProfile } from './platform-profiles'
import { getContentDir } from '../../../src/core/content-dir'

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

function dimensionsForSurface(surfaceId: string, width?: number, height?: number): { surface: string; width: number; height: number } | null {
  const profile = getImageProfile(surfaceId)
  if (!profile && (!width || !height)) return null
  return {
    surface: profile?.id ?? 'custom',
    width: width ?? profile!.width,
    height: height ?? profile!.height,
  }
}

function parseProviderModel(route: string): { provider: ImageProviderId; model: string } | null {
  const [provider, ...modelParts] = route.split('/')
  const model = modelParts.join('/')
  if ((provider === 'openai' || provider === 'google') && model) return { provider, model }
  return null
}

function defaultModelForProvider(provider: ImageProviderId): string {
  return provider === 'openai' ? 'gpt-image-2' : 'gemini-3.1-flash-image'
}

async function resolveRoute(ctx: PluginContext, params: ImagesGenerateParams): Promise<{ provider: ImageProviderId; model: string } | null> {
  if (params.provider && params.provider !== 'auto') {
    return { provider: params.provider, model: params.model ?? defaultModelForProvider(params.provider) }
  }

  if (params.model) {
    const explicit = parseProviderModel(params.model)
    if (explicit) return explicit
  }

  const settings = effectiveSettings(ctx)
  if (settings.defaultProvider !== 'auto') {
    return { provider: settings.defaultProvider, model: params.model ?? defaultModelForProvider(settings.defaultProvider) }
  }

  const readiness = await providerReadiness(ctx)
  for (const route of settings.fallbackOrder) {
    const parsed = parseProviderModel(route)
    if (!parsed) continue
    if (readiness.find(provider => provider.id === parsed.provider)?.routable) return parsed
  }

  const first = parseProviderModel(settings.fallbackOrder[0])
  return first ?? { provider: 'google', model: defaultModelForProvider('google') }
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
  const settings = effectiveSettings(ctx)
  const surfaceId = params.surface || settings.defaultSurface
  const dims = dimensionsForSurface(surfaceId, params.width, params.height)
  if (!dims) return fail(`Unknown image surface: ${surfaceId}`)
  const route = await resolveRoute(ctx, params)
  if (!route) return fail('No image provider route available')
  const provider = getImageProvider(route.provider)
  if (!provider || !provider.models.some(model => model.id === route.model && model.status === 'routable')) {
    return fail(`Image model is not routable: ${route.provider}/${route.model}`)
  }

  const apiKey = await resolveImageApiKey(ctx, route.provider)
  if (!apiKey) return fail(`No API key configured for image provider: ${route.provider}`)

  const quality = params.quality ?? settings.quality
  const adapter = getImageAdapter(route.provider)
  let generated
  try {
    generated = await adapter.generate({
      provider: route.provider,
      model: route.model,
      prompt,
      width: dims.width,
      height: dims.height,
      quality,
      apiKey,
    })
  } catch (err) {
    return fail(`Image generation failed: ${err instanceof Error ? err.message : String(err)}`)
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
    ? (params.width && params.height ? { surface: 'custom', width: params.width, height: params.height } : null)
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
