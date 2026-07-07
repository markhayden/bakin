/**
 * Image generation/editing through the ChatGPT Codex backend using the
 * EXISTING openai-codex OAuth login (~/.pi/agent/auth.json) — no API key.
 *
 * Wire (probed live 2026-07-07, and matching the pi-codex-image-gen
 * reference extension): POST https://chatgpt.com/backend-api/codex/responses
 * with the native `image_generation` tool; a carrier chat model (gpt-5.5)
 * invokes it and the backend maps it to gpt-image-2. Auth is the Pi OAuth
 * access token (Bearer) + `chatgpt-account-id` from its JWT claim; token
 * refresh is owned by Pi's ModelRegistry/AuthStorage (cross-process lock).
 * Edits ride the same call with `input_image` content parts (probed OK).
 *
 * Honesty notes: the hosted tool takes NO size parameters — width/height
 * from the caller are not forwarded; the images plugin probes the real
 * dimensions and exports own final geometry. This endpoint is
 * reverse-engineered (not a public API) — failures classify through
 * errors.ts and the direct-provider shim remains the keyed fallback.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import type {
  RuntimeImageGenerateInput,
  RuntimeImageGenerationResult,
} from '@bakin/core/adapters/runtime'
import { RuntimeError } from '@bakin/core/adapters/runtime'
import { toRuntimeError } from './errors'
import { getModelRegistry } from './models'

const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'
const JWT_CLAIM_PATH = 'https://api.openai.com/auth'
const DEFAULT_CARRIER_MODEL = 'gpt-5.5'
/** What the backend's image_generation tool actually runs (per OpenAI's announcement + reference impl). */
export const CODEX_IMAGE_MODEL = 'gpt-image-2'
export const CODEX_IMAGE_PROVIDER = 'openai-codex'

const OUTPUT_FORMATS = new Set(['png', 'jpeg', 'webp'])
const MIME_BY_FORMAT: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }

export type FetchLike = (url: string, init: Record<string, unknown>) => Promise<Response>

export interface CodexImageOptions {
  /** Test seam — defaults to global fetch. */
  fetchImpl?: FetchLike
  /** Carrier chat model override (settings.runtime.settings.images.carrierModel). */
  carrierModel?: string
}

export async function codexImageAuth(): Promise<{ token: string; accountId: string } | null> {
  const { registry } = getModelRegistry()
  const token = await registry.getApiKeyForProvider(CODEX_IMAGE_PROVIDER)
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
    const claims = payload[JWT_CLAIM_PATH] as Record<string, unknown> | undefined
    const accountId = claims?.chatgpt_account_id
    if (typeof accountId !== 'string' || !accountId) return null
    return { token, accountId }
  } catch {
    return null
  }
}

function normalizeFormat(format: string | undefined): string {
  const f = format === 'jpg' ? 'jpeg' : (format ?? 'png')
  return OUTPUT_FORMATS.has(f) ? f : 'png'
}

function buildBody(input: RuntimeImageGenerateInput, files: string[], carrierModel: string, outputFormat: string) {
  const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: input.prompt }]
  for (const file of files) {
    const mime = MIME_BY_FORMAT[normalizeFormat(file.split('.').pop())] ?? 'image/png'
    content.push({ type: 'input_image', image_url: `data:${mime};base64,${readFileSync(file).toString('base64')}` })
  }
  return {
    model: carrierModel,
    store: false,
    stream: true,
    prompt_cache_key: 'bakin-adapter-pi-images',
    instructions: files.length > 0
      ? 'You are editing bitmap image assets. Call the image_generation tool exactly once to produce the edited image based on the provided input image(s).'
      : 'You are generating bitmap image assets. For this request, call the image_generation tool exactly once. Do not answer with only text unless image generation is unavailable.',
    input: [{ role: 'user', content }],
    tools: [{ type: 'image_generation', output_format: outputFormat }],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    text: { verbosity: 'low' },
  }
}

async function readImageFromSse(response: Response): Promise<string | null> {
  if (!response.body) return null
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''
      for (const event of events) {
        const data = event.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('')
        if (!data || data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data) as {
            type?: string
            item?: { type?: string; result?: string }
            response?: { output?: Array<{ type?: string; result?: string }> }
          }
          const item = parsed.item ?? parsed.response?.output?.find((o) => o?.type === 'image_generation_call')
          if (item?.type === 'image_generation_call' && item.result) return item.result
        } catch {
          // non-JSON keepalive frames are expected in SSE
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
  return null
}

/**
 * One codex image call. `files` non-empty = edit semantics (input images).
 * Throws typed RuntimeErrors only.
 */
export async function generateViaCodex(
  input: RuntimeImageGenerateInput,
  files: string[],
  options: CodexImageOptions = {},
): Promise<RuntimeImageGenerationResult> {
  const auth = await codexImageAuth()
  if (!auth) {
    throw new RuntimeError(
      'adapter-pi: openai-codex login unavailable for image generation — run `pi` and /login with ChatGPT (Plus/Pro)',
      { kind: 'provider_cooldown', providerInfo: { provider: CODEX_IMAGE_PROVIDER, authProfileUnavailable: true } },
    )
  }
  const outputFormat = normalizeFormat(input.outputFormat)
  const carrierModel = options.carrierModel ?? DEFAULT_CARRIER_MODEL
  const doFetch: FetchLike = options.fetchImpl ?? (fetch as unknown as FetchLike)

  let response: Response
  try {
    response = await doFetch(CODEX_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.token}`,
        'chatgpt-account-id': auth.accountId,
        'OpenAI-Beta': 'responses=experimental',
        Accept: 'text/event-stream',
        originator: 'pi',
      },
      body: JSON.stringify(buildBody(input, files, carrierModel, outputFormat)),
    })
  } catch (err) {
    throw toRuntimeError(err, { model: CODEX_IMAGE_MODEL })
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    throw toRuntimeError(
      Object.assign(new Error(`codex image backend ${response.status}: ${detail}`), { status: response.status }),
      { model: CODEX_IMAGE_MODEL },
    )
  }

  const b64 = await readImageFromSse(response)
  if (!b64) {
    throw new RuntimeError(
      'adapter-pi: codex backend completed without returning an image (image_generation_call missing from stream)',
      { kind: 'runtime_failed' },
    )
  }

  const dir = mkdtempSync(join(tmpdir(), 'bakin-pi-image-'))
  const filePath = join(dir, `image.${outputFormat === 'jpeg' ? 'jpg' : outputFormat}`)
  writeFileSync(filePath, Buffer.from(b64, 'base64'))

  return {
    images: [{ filePath, mimeType: MIME_BY_FORMAT[outputFormat], provider: CODEX_IMAGE_PROVIDER, model: CODEX_IMAGE_MODEL }],
    provider: CODEX_IMAGE_PROVIDER,
    model: CODEX_IMAGE_MODEL,
    metadata: {
      source: 'adapter-pi.codex-images',
      servedBy: 'runtime',
      credentialSource: 'runtime',
      carrierModel,
      // The hosted tool takes no size params — real dimensions are probed
      // by the images plugin; exports own final geometry.
      sizingHonored: false,
    },
  }
}
