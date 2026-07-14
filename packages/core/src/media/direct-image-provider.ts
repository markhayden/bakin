/**
 * Shared, runtime-agnostic direct image provider transport.
 *
 * This is the "shim" in the media-generation adapter architecture
 * (.claude/knowledge/media-generation-adapter-architecture.md): when a runtime
 * adapter cannot serve an image request natively, it composes this module to
 * call the provider's HTTP API directly. It is owned by no plugin and no
 * runtime — every adapter (and, later, every media modality) reuses it.
 *
 * Credentials are NOT resolved here beyond the Bakin-owned env fallback
 * (`resolveDirectImageKey`). The native path's credentials stay inside the
 * runtime; the shim's key is a Bakin-owned secret (env in Phase 1, a
 * settings-backed store in Phase 2). The caller passes the resolved key in.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { IMAGE_PROVIDER_ENV_VARS, extensionForImageMime, mimeTypeForImagePath, type DirectImageProviderId } from './image-format'

export interface DirectImageRequest {
  provider: DirectImageProviderId
  model: string
  prompt: string
  width: number
  height: number
  quality: 'draft' | 'standard' | 'premium'
  apiKey: string
  // Generation options the native path forwards but the shim cannot honor.
  // Carried so the shim can reject them loudly (see assertShimCanHonor) rather
  // than silently dropping them — the divergence #379 was filed to close.
  count?: number
  aspectRatio?: string
  resolution?: string
  background?: string
  outputFormat?: string
  size?: string
  /**
   * Absolute paths of input images conditioning the output — the base image
   * first for edits, then references. Routes OpenAI to /v1/images/edits
   * (multipart) and adds inline_data parts on Gemini. Empty/absent = plain
   * generation.
   */
  inputImages?: string[]
}

/** OpenAI's images/edits endpoint caps input images at 16. */
const MAX_INPUT_IMAGES = 16

/** Formats the shim can actually produce (providers default to PNG; the shim
 *  doesn't transcode). Anything else is rejected rather than mislabeled. */
const SHIM_SUPPORTED_OUTPUT_FORMATS = new Set(['png'])

/**
 * The shim talks to the providers' single-image generation endpoints and does
 * not forward sizing/format options. Reject any option it can't honor BEFORE
 * the billed call so a future caller gets an immediate, precise error instead
 * of a silently-wrong (but charged) image.
 */
function assertShimCanHonor(request: DirectImageRequest): void {
  if (typeof request.count === 'number' && request.count > 1) {
    throw new Error(`direct-image shim cannot honor count > 1 (requested ${request.count})`)
  }
  if (request.aspectRatio) {
    throw new Error(`direct-image shim cannot honor aspectRatio (requested ${request.aspectRatio}); pass width/height instead`)
  }
  if (request.resolution) {
    throw new Error(`direct-image shim cannot honor resolution (requested ${request.resolution})`)
  }
  if (request.background) {
    throw new Error(`direct-image shim cannot honor background (requested ${request.background})`)
  }
  if (request.outputFormat && !SHIM_SUPPORTED_OUTPUT_FORMATS.has(request.outputFormat)) {
    throw new Error(`direct-image shim cannot honor outputFormat "${request.outputFormat}" (supported: png)`)
  }
  if (request.size) {
    throw new Error(`direct-image shim cannot honor size (requested ${request.size}); pass width/height instead`)
  }
  if (request.inputImages && request.inputImages.length > MAX_INPUT_IMAGES) {
    throw new Error(`direct-image shim cannot honor ${request.inputImages.length} input images (max ${MAX_INPUT_IMAGES})`)
  }
  // Missing files fail HERE, precisely, before any billed call.
  for (const path of request.inputImages ?? []) {
    if (!existsSync(path)) throw new Error(`direct-image shim input image not found: ${path}`)
  }
}

export interface DirectImageResult {
  filePath: string
  mimeType: string
  width: number
  height: number
  providerText?: string
}

export function isDirectImageProvider(id: string): id is DirectImageProviderId {
  return id === 'openai' || id === 'google'
}

/**
 * Resolve a provider key from Bakin-owned secrets. Phase 1: env vars only
 * (the images manifest declares these under `secrets`). Phase 2 will layer a
 * settings-backed store with env as the override. Never reads runtime config.
 */
export function resolveDirectImageKey(
  provider: DirectImageProviderId,
  env: Record<string, string | undefined> = process.env,
): string | null {
  for (const name of IMAGE_PROVIDER_ENV_VARS[provider]) {
    if (env[name]) return env[name] as string
  }
  return null
}

function writeTempImage(prefix: string, mimeType: string, bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'bakin-images-'))
  const filePath = join(dir, `${prefix}.${extensionForImageMime(mimeType)}`)
  writeFileSync(filePath, bytes)
  return filePath
}

async function fetchImageUrl(prefix: string, url: string): Promise<{ filePath: string; mimeType: string }> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Image download failed (${response.status})`)
  const mimeType = response.headers.get('content-type') || 'image/jpeg'
  const filePath = writeTempImage(prefix, mimeType, Buffer.from(await response.arrayBuffer()))
  return { filePath, mimeType }
}

/**
 * OpenAI's images API only accepts a fixed set of sizes — it rejects arbitrary
 * surface dimensions (e.g. 1080x1350) with HTTP 400. Snap the requested aspect
 * ratio onto the nearest supported size; the asset can be cropped/resized to
 * the exact surface dimensions later via the export tool.
 */
function openAISize(width: number, height: number): string {
  if (width === height) return '1024x1024'
  return width > height ? '1536x1024' : '1024x1536'
}

function qualityForOpenAI(quality: DirectImageRequest['quality']): string {
  if (quality === 'draft') return 'low'
  if (quality === 'premium') return 'high'
  return 'medium'
}

function extractOpenAIImage(data: unknown): { base64?: string; url?: string; mimeType?: string; text?: string } {
  const payload = data as {
    data?: Array<{ b64_json?: string; url?: string; mime_type?: string; revised_prompt?: string }>
    output?: Array<{ type?: string; result?: string; image?: { b64_json?: string; url?: string }; content?: Array<{ type?: string; image_url?: string }> }>
  }
  const direct = payload.data?.[0]
  if (direct?.b64_json || direct?.url) {
    return { base64: direct.b64_json, url: direct.url, mimeType: direct.mime_type, text: direct.revised_prompt }
  }
  for (const item of payload.output ?? []) {
    if (item.result) return { base64: item.result, mimeType: 'image/png' }
    if (item.image?.b64_json || item.image?.url) return { base64: item.image.b64_json, url: item.image.url, mimeType: 'image/png' }
    const contentImage = item.content?.find(part => part.type === 'output_image' || part.image_url)
    if (contentImage?.image_url) return { url: contentImage.image_url }
  }
  return {}
}

/**
 * OpenAI edit path: /v1/images/edits is multipart-only — image[] file parts
 * (base first, then references; gpt-image-1 accepts up to 16) + the same
 * prompt/size/quality fields the generation endpoint takes.
 */
async function editOpenAI(request: DirectImageRequest): Promise<DirectImageResult> {
  const form = new FormData()
  form.append('model', request.model)
  form.append('prompt', request.prompt)
  form.append('size', openAISize(request.width, request.height))
  form.append('quality', qualityForOpenAI(request.quality))
  for (const path of request.inputImages ?? []) {
    const mime = mimeTypeForImagePath(path)
    form.append('image[]', new Blob([new Uint8Array(readFileSync(path))], { type: mime }), basename(path))
  }

  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    // No Content-Type header — fetch sets the multipart boundary itself.
    headers: { Authorization: `Bearer ${request.apiKey}` },
    body: form,
  })
  if (!response.ok) throw new Error(`OpenAI image edit API error (${response.status}): ${await response.text()}`)

  const image = extractOpenAIImage(await response.json())
  if (image.base64) {
    const mimeType = image.mimeType || 'image/png'
    return {
      filePath: writeTempImage('openai', mimeType, Buffer.from(image.base64, 'base64')),
      mimeType,
      width: request.width,
      height: request.height,
      ...(image.text ? { providerText: image.text } : {}),
    }
  }
  if (image.url) {
    const downloaded = await fetchImageUrl('openai', image.url)
    return { ...downloaded, width: request.width, height: request.height, ...(image.text ? { providerText: image.text } : {}) }
  }
  throw new Error('No image data in OpenAI edit response')
}

async function generateOpenAI(request: DirectImageRequest): Promise<DirectImageResult> {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: request.model,
      prompt: request.prompt,
      size: openAISize(request.width, request.height),
      quality: qualityForOpenAI(request.quality),
    }),
  })
  if (!response.ok) throw new Error(`OpenAI image API error (${response.status}): ${await response.text()}`)

  const image = extractOpenAIImage(await response.json())
  if (image.base64) {
    const mimeType = image.mimeType || 'image/png'
    return {
      filePath: writeTempImage('openai', mimeType, Buffer.from(image.base64, 'base64')),
      mimeType,
      width: request.width,
      height: request.height,
      ...(image.text ? { providerText: image.text } : {}),
    }
  }
  if (image.url) {
    const downloaded = await fetchImageUrl('openai', image.url)
    return { ...downloaded, width: request.width, height: request.height, ...(image.text ? { providerText: image.text } : {}) }
  }
  throw new Error('No image data in OpenAI response')
}

async function generateGemini(request: DirectImageRequest): Promise<DirectImageResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${request.model}:generateContent?key=${encodeURIComponent(request.apiKey)}`
  const aspectHint = request.width === request.height
    ? ''
    : request.width > request.height
      ? ' (landscape orientation)'
      : ' (portrait orientation)'

  // Input images ride the SAME generateContent call as inline_data parts
  // (direct-vision-provider precedent) — base image first, then references,
  // then the instruction text.
  const requestParts: Array<Record<string, unknown>> = (request.inputImages ?? []).map((path) => ({
    inline_data: { mime_type: mimeTypeForImagePath(path), data: readFileSync(path).toString('base64') },
  }))
  requestParts.push({ text: request.prompt + aspectHint })

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: requestParts }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
  })
  if (!response.ok) throw new Error(`Gemini image API error (${response.status}): ${await response.text()}`)

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> } }>
    error?: { message?: string }
  }
  if (data.error?.message) throw new Error(`Gemini image API error: ${data.error.message}`)
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find(part => part.inlineData)
  if (!imagePart?.inlineData) throw new Error('No image data in Gemini response')

  const providerText = parts.find(part => typeof part.text === 'string')?.text
  return {
    filePath: writeTempImage('gemini', imagePart.inlineData.mimeType, Buffer.from(imagePart.inlineData.data, 'base64')),
    mimeType: imagePart.inlineData.mimeType,
    width: request.width,
    height: request.height,
    ...(providerText ? { providerText } : {}),
  }
}

/**
 * Generate an image directly against the provider's HTTP API.
 *
 * Deliberately does NOT retry: image generation is non-idempotent and billed
 * per call, so a transient-looking error after the provider already produced
 * (and charged for) an image would double-bill on retry. A failed generation
 * surfaces to the caller to re-trigger explicitly.
 */
export async function generateDirectImage(request: DirectImageRequest): Promise<DirectImageResult> {
  assertShimCanHonor(request)
  if (request.provider === 'openai') {
    return request.inputImages?.length ? editOpenAI(request) : generateOpenAI(request)
  }
  return generateGemini(request)
}
