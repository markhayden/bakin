/**
 * bakin_exec_gen_image — Image generation via Gemini Imagen (Nano Banana).
 *
 * Models:
 * - gemini-3.1-flash-image-preview (Nano Banana 2) — default, cheaper
 * - gemini-3-pro-image-preview (Nano Banana Pro) — higher quality
 *
 * Social-media-first defaults:
 * - Default preset: social-portrait (1080x1920, 9:16 for Stories/Reels/TikTok)
 * - Max 1200px on any edge for custom sizes
 * - Auto-generates WebP thumbnail via ffmpeg for performant UI previews
 */
import { z } from 'zod'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { getBakinPaths } from '../../src/core/content-dir'
import {
  succeed,
  fail,
  withRetry,
  generateThumbnail,
  resolveImageDimensions,
  MAX_IMAGE_EDGE,
} from './common'
import type { ImagePreset } from './common'
import { saveAsset } from '../../plugins/assets/lib/save-asset'
import { addExecTool } from './registry'
import type { ExecToolResult } from '../../src/lib/plugin-types'

const PRESET_NAMES = ['social-portrait', 'social-square', 'social-landscape', 'custom'] as const
const MODEL_NAMES = ['flash', 'pro'] as const
type ModelTier = typeof MODEL_NAMES[number]

const GEMINI_MODELS: Record<ModelTier, string> = {
  flash: 'gemini-3.1-flash-image-preview',
  pro: 'gemini-3-pro-image-preview',
}

// ---------------------------------------------------------------------------
// API key resolution
// ---------------------------------------------------------------------------

function getApiKey(): string | null {
  // Check environment first
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
  if (process.env.GOOGLE_AI_API_KEY) return process.env.GOOGLE_AI_API_KEY

  // Check openclaw config
  try {
    const configPath = join(homedir(), '.openclaw', 'openclaw.json')
    const config = JSON.parse(readFileSync(configPath, 'utf-8'))
    return config?.skills?.entries?.['nano-banana-pro']?.apiKey || null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Gemini Imagen implementation
// ---------------------------------------------------------------------------

interface GeneratedImage {
  filePath: string
  width: number
  height: number
  mimeType: string
}

interface ImageGenerator {
  generate(prompt: string, width: number, height: number, opts?: {
    model?: ModelTier
  }): Promise<GeneratedImage>
}

class GeminiImagenGenerator implements ImageGenerator {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async generate(prompt: string, width: number, height: number, opts?: {
    model?: ModelTier
  }): Promise<GeneratedImage> {
    const model = GEMINI_MODELS[opts?.model || 'flash']
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`

    // Include aspect ratio guidance in the prompt for better results
    const aspectHint = width === height ? '' :
      width > height ? ' (landscape orientation)' : ' (portrait orientation)'

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt + aspectHint }],
        }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT'],
        },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Gemini API error (${response.status}): ${errorText}`)
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { mimeType: string; data: string }
            text?: string
          }>
        }
      }>
      error?: { message: string }
    }

    if (data.error) {
      throw new Error(`Gemini API error: ${data.error.message}`)
    }

    // Extract image from response
    const parts = data.candidates?.[0]?.content?.parts || []
    const imagePart = parts.find(p => p.inlineData)

    if (!imagePart?.inlineData) {
      throw new Error('No image data in Gemini response')
    }

    const { mimeType, data: base64Data } = imagePart.inlineData
    const ext = mimeType === 'image/png' ? 'png' : 'jpg'

    // Write to temp file
    const paths = getBakinPaths()
    const tmpDir = join(paths.home, '.tmp')
    mkdirSync(tmpDir, { recursive: true })

    const outputFile = join(tmpDir, `nbp-${Date.now()}.${ext}`)
    writeFileSync(outputFile, Buffer.from(base64Data, 'base64'))

    return { filePath: outputFile, width, height, mimeType }
  }
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export interface GenImageParams {
  prompt: string
  taskId: string
  agent: string
  preset?: ImagePreset
  width?: number
  height?: number
  model?: ModelTier
  thumbnail?: boolean
}

export async function generateImage(params: GenImageParams): Promise<ExecToolResult> {
  const {
    prompt,
    taskId,
    agent,
    preset = 'social-portrait',
    model = 'flash',
    thumbnail = true,
  } = params

  const apiKey = getApiKey()
  if (!apiKey) {
    return fail('No Gemini API key found. Set GEMINI_API_KEY env var or configure in ~/.openclaw/openclaw.json')
  }

  // Resolve dimensions
  const { width, height } = resolveImageDimensions(preset, params.width, params.height)

  // Generate image with retry
  const generator = new GeminiImagenGenerator(apiKey)
  let generated: GeneratedImage
  try {
    generated = await withRetry(
      () => generator.generate(prompt, width, height, { model }),
      { maxAttempts: 2, baseDelayMs: 3000 },
    )
  } catch (err) {
    return fail(`Image generation failed after retries: ${String(err)}`)
  }

  // Save via standard asset pipeline
  const modelName = GEMINI_MODELS[model]
  const assetResult = await saveAsset({
    filePath: generated.filePath,
    taskId,
    agent,
    type: 'images',
    tool: modelName,
    description: prompt.slice(0, 200),
    tags: [preset !== 'custom' ? preset : `${width}x${height}`, model],
  })

  if (!assetResult.ok) {
    return fail(`Image generated but asset save failed: ${assetResult.error}`)
  }

  // Generate thumbnail if requested
  let thumbnailPath: string | null = null
  if (thumbnail && assetResult.path) {
    const paths = getBakinPaths()
    const fullAssetPath = join(paths.home, assetResult.path as string)
    const thumbPath = fullAssetPath.replace(/\.\w+$/, '.thumb.jpg')
    thumbnailPath = generateThumbnail(fullAssetPath, thumbPath)
    if (thumbnailPath) {
      thumbnailPath = thumbnailPath.replace(paths.home + '/', '')
    }
  }

  return succeed({
    path: assetResult.path,
    metadataPath: assetResult.metadataPath,
    thumbnailPath,
    width,
    height,
    preset,
    model: GEMINI_MODELS[model],
    prompt: prompt.slice(0, 500),
  })
}

// ---------------------------------------------------------------------------
// MCP tool registration
// ---------------------------------------------------------------------------

addExecTool({
  name: 'bakin_exec_gen_image',
  description: `Generate an image via Gemini Imagen (Nano Banana). Default model: flash (cheaper). Use model=pro for higher quality. Default: 1080x1920 portrait (9:16) for Stories/Reels. Presets: social-portrait, social-square, social-landscape, custom. Auto-generates thumbnail. Max ${MAX_IMAGE_EDGE}px on any edge.`,
  source: 'core',
  parameters: {
    prompt: z.string().describe('Image generation prompt — front-load the most important visual elements'),
    taskId: z.string().describe('Task ID for asset organization'),
    preset: z.enum(PRESET_NAMES).optional().describe('Size preset (default: social-portrait = 1080x1920)'),
    width: z.number().optional().describe(`Custom width (only when preset=custom, max ${MAX_IMAGE_EDGE})`),
    height: z.number().optional().describe(`Custom height (only when preset=custom, max ${MAX_IMAGE_EDGE})`),
    model: z.enum(MODEL_NAMES).optional().describe('Model tier: flash (default, cheaper) or pro (higher quality)'),
    thumbnail: z.boolean().optional().describe('Generate a 400px WebP thumbnail for UI previews (default: true)'),
  },
  handler: async (params: Record<string, unknown>, agent: string) => {
    return generateImage({ ...params, agent } as GenImageParams)
  },
})
