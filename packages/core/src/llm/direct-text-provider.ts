/**
 * Shared, runtime-agnostic direct TEXT provider transport — the text sibling
 * of media/direct-vision-provider.ts. One cheap chat call in, zod-validated
 * structured JSON out. First consumer: the team assignment resolver (#189).
 *
 * Contract rules:
 *   - Output is Zod-validated strict JSON. A malformed response gets exactly
 *     ONE retry (fresh call), then fails — structured output is never guessed
 *     from a lossy parse.
 *   - Errors are typed by `kind` ('transient' | 'structural') because
 *     dispatch classifies failures by kind, never by message text
 *     (architecture-test-enforced house rule).
 *   - Credentials are Bakin-owned (env → secret store), resolved by the
 *     caller through `resolveProviderKeySource` and passed in.
 *   - Stateless and fetch-injectable for tests; no live calls in the suite.
 */
import type { z } from 'zod'
import type { DirectProviderId } from './provider-keys'

export type DirectTextErrorKind = 'transient' | 'structural'

export class DirectTextError extends Error {
  readonly kind: DirectTextErrorKind
  constructor(kind: DirectTextErrorKind, message: string) {
    super(message)
    this.name = 'DirectTextError'
    this.kind = kind
  }
}

export interface DirectTextRequest<T> {
  provider: DirectProviderId
  /** Provider-native model id. */
  model: string
  apiKey: string
  system?: string
  prompt: string
  /** The structured output contract — the call returns the parsed value. */
  schema: z.ZodType<T>
  maxTokens?: number
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** Strip accidental code fences; the models are told not to add them. */
function parseStrictJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(trimmed)
}

/** 4xx auth/request errors are structural (retrying can't fix them); rate
 * limits, timeouts, 5xx, and network failures are transient. */
function classifyHttpStatus(status: number): DirectTextErrorKind {
  if (status === 408 || status === 429) return 'transient'
  if (status >= 400 && status < 500) return 'structural'
  return 'transient'
}

async function callProvider<T>(request: DirectTextRequest<T>): Promise<string> {
  const fetchImpl = request.fetchImpl ?? fetch
  const signal = AbortSignal.timeout(request.timeoutMs ?? 60_000)
  const maxTokens = request.maxTokens ?? 1024

  let response: Response
  try {
    if (request.provider === 'anthropic') {
      response = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': request.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: request.model,
          max_tokens: maxTokens,
          ...(request.system ? { system: request.system } : {}),
          messages: [{ role: 'user', content: request.prompt }],
        }),
        signal,
      })
    } else if (request.provider === 'openai') {
      response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${request.apiKey}` },
        body: JSON.stringify({
          model: request.model,
          // NOT max_tokens: reasoning/GPT-5-family chat models 400 on it,
          // which we'd classify structural and block every caller (R4).
          max_completion_tokens: maxTokens,
          messages: [
            ...(request.system ? [{ role: 'system', content: request.system }] : []),
            { role: 'user', content: request.prompt },
          ],
        }),
        signal,
      })
    } else {
      response = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(request.apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...(request.system ? { system_instruction: { parts: [{ text: request.system }] } } : {}),
            contents: [{ parts: [{ text: request.prompt }] }],
            generationConfig: { maxOutputTokens: maxTokens },
          }),
          signal,
        },
      )
    }
  } catch (err) {
    throw new DirectTextError('transient', `direct-text ${request.provider}: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300)
    throw new DirectTextError(
      classifyHttpStatus(response.status),
      `direct-text ${request.provider} ${response.status}: ${detail}`,
    )
  }

  if (request.provider === 'anthropic') {
    const json = await response.json() as { content?: Array<{ type: string; text?: string }> }
    const text = json.content?.find((b) => b.type === 'text')?.text
    if (!text) throw new DirectTextError('transient', 'direct-text anthropic: no text block in response')
    return text
  }
  if (request.provider === 'openai') {
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const text = json.choices?.[0]?.message?.content
    if (!text) throw new DirectTextError('transient', 'direct-text openai: no message content in response')
    return text
  }
  const json = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('')
  if (!text) throw new DirectTextError('transient', 'direct-text google: no candidate text in response')
  return text
}

function parseAndValidate<T>(raw: string, schema: z.ZodType<T>): T {
  let parsed: unknown
  try {
    parsed = parseStrictJson(raw)
  } catch (err) {
    throw new DirectTextError('transient', `direct-text: model returned non-JSON output (${err instanceof Error ? err.message : String(err)})`)
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new DirectTextError('transient', `direct-text: model output failed validation: ${result.error.issues.map((i) => i.message).join('; ')}`)
  }
  return result.data
}

/**
 * One billed text call → validated structured output. Malformed model output
 * (non-JSON or schema-invalid) gets exactly one fresh retry; every other
 * failure propagates immediately with its kind.
 */
export async function callDirectTextProvider<T>(request: DirectTextRequest<T>): Promise<T> {
  const first = await callProvider(request)
  try {
    return parseAndValidate(first, request.schema)
  } catch (err) {
    if (!(err instanceof DirectTextError)) throw err
    // Only malformed OUTPUT earns the retry — HTTP/network errors already
    // threw inside callProvider and never reach here.
    const second = await callProvider(request)
    return parseAndValidate(second, request.schema)
  }
}
