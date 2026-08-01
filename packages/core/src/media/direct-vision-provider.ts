/**
 * Shared, runtime-agnostic direct VISION provider transport — the
 * enrichment sibling of direct-image-provider.ts (see the media-generation
 * adapter architecture doc). Sends an asset's bytes to a multimodal chat
 * model and returns STRUCTURED derived metadata (caption / OCR text /
 * suggested tags / summary / transcript).
 *
 * Contract rules:
 *   - Output is Zod-validated strict JSON. A response that can't be parsed
 *     and validated is an ERROR — derived metadata is never fabricated and
 *     never guessed from a lossy parse (spec D8).
 *   - Credentials are Bakin-owned (env → secret store), resolved by the
 *     caller through `resolveProviderKeySource` (@bakin/core/llm) and passed in.
 *   - The transport is stateless and fetch-injectable for tests. Billed
 *     calls are the CALLER's idempotency problem (@bakin/core/media
 *     idempotency + the asset manifest's durable record).
 */
import { readFileSync, statSync } from 'node:fs'
import { z } from 'zod'
import type { DirectProviderId } from '../llm/provider-keys'

/** ~20MB media cap — larger files are skipped, not truncated (lossy = lies). */
const MAX_MEDIA_BYTES = 20 * 1024 * 1024

export const VisionEnrichmentResultSchema = z.object({
  caption: z.string().min(1).optional(),
  ocrText: z.string().optional(),
  suggestedTags: z.array(z.string().min(1)).max(12).optional(),
  summary: z.string().optional(),
  transcript: z.string().optional(),
}).refine(
  (r) => r.caption !== undefined || r.summary !== undefined || r.transcript !== undefined,
  { message: 'enrichment must include at least a caption, summary, or transcript' },
)

export type VisionEnrichmentResult = z.infer<typeof VisionEnrichmentResultSchema>

/** Provider-reported token usage — surfaced verbatim for spend recording
 * (#747); absent when the provider response carries none. Never estimated. */
export interface DirectVisionUsage {
  inputTokens?: number
  outputTokens?: number
}

const usageFrom = (input: unknown, output: unknown): DirectVisionUsage | undefined =>
  typeof input === 'number' || typeof output === 'number'
    ? {
        ...(typeof input === 'number' ? { inputTokens: input } : {}),
        ...(typeof output === 'number' ? { outputTokens: output } : {}),
      }
    : undefined

export interface DirectVisionRequest {
  provider: DirectProviderId
  /** Provider-native model id (catalog prefix stripped by the caller). */
  model: string
  apiKey: string
  kind: 'image' | 'audio' | 'document'
  /** Media bytes on disk (image/audio). Omitted for document summaries. */
  mediaPath?: string
  mediaMime?: string
  /** Extracted text for document summaries (no media bytes sent). */
  extractedText?: string
  /** Existing human description — context only, never echoed as output. */
  existingDescription?: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function enrichmentPrompt(request: DirectVisionRequest): string {
  const wants = request.kind === 'image'
    ? '"caption" (one factual sentence, <=200 chars), "ocrText" (ALL text visible in the image, verbatim; omit the key when there is none), "suggestedTags" (3-8 short kebab-case topic tags)'
    : request.kind === 'audio'
      ? '"transcript" (verbatim speech transcript; if no speech, a one-line description as "caption" instead), "caption" (one-sentence description of the audio), "suggestedTags" (3-8 short kebab-case topic tags)'
      : '"summary" (3-5 sentence factual summary), "suggestedTags" (3-8 short kebab-case topic tags)'
  const context = request.existingDescription
    ? `\nExisting human-written description (context only, do not repeat it back): ${request.existingDescription.slice(0, 300)}`
    : ''
  const doc = request.kind === 'document' && request.extractedText
    ? `\nDocument text:\n---\n${request.extractedText.slice(0, 24_000)}\n---`
    : ''
  return `You are generating search metadata for an asset library. Analyze the provided ${request.kind} and respond with ONLY a JSON object (no markdown fences, no commentary) containing: ${wants}. Describe only what is actually present — never invent details.${context}${doc}`
}

function readMedia(request: DirectVisionRequest): { base64: string; mime: string } {
  if (!request.mediaPath || !request.mediaMime) {
    throw new Error(`direct-vision: ${request.kind} enrichment requires mediaPath + mediaMime`)
  }
  const size = statSync(request.mediaPath).size
  if (size > MAX_MEDIA_BYTES) {
    throw new Error(`direct-vision: media exceeds ${MAX_MEDIA_BYTES} bytes (${size}) — skipping, not truncating`)
  }
  return { base64: readFileSync(request.mediaPath).toString('base64'), mime: request.mediaMime }
}

/** Strip accidental code fences; the models are told not to add them. */
function parseStrictJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(trimmed)
}

async function callProvider(
  request: DirectVisionRequest,
  prompt: string,
): Promise<{ text: string; usage?: DirectVisionUsage }> {
  const fetchImpl = request.fetchImpl ?? fetch
  const signal = AbortSignal.timeout(request.timeoutMs ?? 60_000)
  const needsMedia = request.kind !== 'document'
  const media = needsMedia ? readMedia(request) : null

  if (request.provider === 'anthropic') {
    if (request.kind === 'audio') throw new Error('direct-vision: anthropic transport does not accept audio input')
    const content: unknown[] = []
    if (media) content.push({ type: 'image', source: { type: 'base64', media_type: media.mime, data: media.base64 } })
    content.push({ type: 'text', text: prompt })
    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': request.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: request.model, max_tokens: 1024, messages: [{ role: 'user', content }] }),
      signal,
    })
    if (!response.ok) throw new Error(`anthropic vision ${response.status}: ${(await response.text()).slice(0, 300)}`)
    const json = await response.json() as {
      content?: Array<{ type: string; text?: string }>
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    const text = json.content?.find((b) => b.type === 'text')?.text
    if (!text) throw new Error('anthropic vision: no text block in response')
    return { text, usage: usageFrom(json.usage?.input_tokens, json.usage?.output_tokens) }
  }

  if (request.provider === 'openai') {
    if (request.kind === 'audio') throw new Error('direct-vision: openai transport does not accept audio input')
    const content: unknown[] = []
    if (media) content.push({ type: 'image_url', image_url: { url: `data:${media.mime};base64,${media.base64}` } })
    content.push({ type: 'text', text: prompt })
    const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${request.apiKey}` },
      body: JSON.stringify({ model: request.model, max_tokens: 1024, messages: [{ role: 'user', content }] }),
      signal,
    })
    if (!response.ok) throw new Error(`openai vision ${response.status}: ${(await response.text()).slice(0, 300)}`)
    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const text = json.choices?.[0]?.message?.content
    if (!text) throw new Error('openai vision: no message content in response')
    return { text, usage: usageFrom(json.usage?.prompt_tokens, json.usage?.completion_tokens) }
  }

  // google — the one transport that also accepts audio inline_data.
  const parts: unknown[] = []
  if (media) parts.push({ inline_data: { mime_type: media.mime, data: media.base64 } })
  parts.push({ text: prompt })
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(request.apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
      signal,
    },
  )
  if (!response.ok) throw new Error(`google vision ${response.status}: ${(await response.text()).slice(0, 300)}`)
  const json = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  }
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
  if (!text) throw new Error('google vision: no candidate text in response')
  return { text, usage: usageFrom(json.usageMetadata?.promptTokenCount, json.usageMetadata?.candidatesTokenCount) }
}

/**
 * One billed multimodal call → validated enrichment fields. Throws on any
 * transport, parse, or validation failure — callers record `failed`, never
 * a guess.
 */
export async function callDirectVisionProvider(
  request: DirectVisionRequest,
): Promise<VisionEnrichmentResult & { usage?: DirectVisionUsage }> {
  const { text: raw, usage } = await callProvider(request, enrichmentPrompt(request))
  let parsed: unknown
  try {
    parsed = parseStrictJson(raw)
  } catch (err) {
    throw new Error(`direct-vision: model returned non-JSON output (${err instanceof Error ? err.message : String(err)})`)
  }
  const result = VisionEnrichmentResultSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`direct-vision: model output failed validation: ${result.error.issues.map((i) => i.message).join('; ')}`)
  }
  return { ...result.data, ...(usage ? { usage } : {}) }
}
