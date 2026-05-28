import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NativeImageProviderId } from '../types'

export interface ImageAdapterRequest {
  provider: NativeImageProviderId
  model: string
  prompt: string
  width: number
  height: number
  quality: 'draft' | 'standard' | 'premium'
  apiKey: string
}

export interface ImageAdapterResult {
  filePath: string
  mimeType: string
  width: number
  height: number
  providerText?: string
}

export interface ImageProviderAdapter {
  provider: NativeImageProviderId
  generate(request: ImageAdapterRequest): Promise<ImageAdapterResult>
}

function tempImageFile(prefix: string, mimeType: string, base64Data: string): string {
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg'
  const dir = mkdtempSync(join(tmpdir(), 'bakin-images-'))
  const filePath = join(dir, `${prefix}.${ext}`)
  writeFileSync(filePath, Buffer.from(base64Data, 'base64'))
  return filePath
}

async function fetchImageUrl(prefix: string, url: string): Promise<{ filePath: string; mimeType: string }> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Image download failed (${response.status})`)
  const mimeType = response.headers.get('content-type') || 'image/jpeg'
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg'
  const dir = mkdtempSync(join(tmpdir(), 'bakin-images-'))
  const filePath = join(dir, `${prefix}.${ext}`)
  writeFileSync(filePath, Buffer.from(await response.arrayBuffer()))
  return { filePath, mimeType }
}

function sizeString(width: number, height: number): string {
  return `${Math.round(width)}x${Math.round(height)}`
}

function qualityForOpenAI(quality: ImageAdapterRequest['quality']): string {
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

export class OpenAIImageAdapter implements ImageProviderAdapter {
  provider: NativeImageProviderId = 'openai'

  async generate(request: ImageAdapterRequest): Promise<ImageAdapterResult> {
    const url = 'https://api.openai.com/v1/images/generations'
    const body = {
      model: request.model,
      prompt: request.prompt,
      size: sizeString(request.width, request.height),
      quality: qualityForOpenAI(request.quality),
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`OpenAI image API error (${response.status}): ${await response.text()}`)

    const image = extractOpenAIImage(await response.json())
    if (image.base64) {
      const mimeType = image.mimeType || 'image/png'
      return {
        filePath: tempImageFile('openai', mimeType, image.base64),
        mimeType,
        width: request.width,
        height: request.height,
        providerText: image.text,
      }
    }
    if (image.url) {
      const downloaded = await fetchImageUrl('openai', image.url)
      return { ...downloaded, width: request.width, height: request.height, providerText: image.text }
    }
    throw new Error('No image data in OpenAI response')
  }
}

export class GeminiImageAdapter implements ImageProviderAdapter {
  provider: NativeImageProviderId = 'google'

  async generate(request: ImageAdapterRequest): Promise<ImageAdapterResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${request.model}:generateContent?key=${encodeURIComponent(request.apiKey)}`
    const aspectHint = request.width === request.height
      ? ''
      : request.width > request.height
        ? ' (landscape orientation)'
        : ' (portrait orientation)'

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: request.prompt + aspectHint }] }],
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

    return {
      filePath: tempImageFile('gemini', imagePart.inlineData.mimeType, imagePart.inlineData.data),
      mimeType: imagePart.inlineData.mimeType,
      width: request.width,
      height: request.height,
      providerText: parts.find(part => typeof part.text === 'string')?.text,
    }
  }
}

export function getImageAdapter(provider: NativeImageProviderId): ImageProviderAdapter {
  if (provider === 'openai') return new OpenAIImageAdapter()
  return new GeminiImageAdapter()
}
