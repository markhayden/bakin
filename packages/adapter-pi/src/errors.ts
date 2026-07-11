/**
 * THE one place Pi/SDK failures become typed RuntimeErrors. Core classifies
 * on `kind` only; all provider-string sniffing is confined to this module
 * (that is the adapter's job — same posture as adapter-openclaw/errors.ts).
 */
import {
  DEFAULT_OVERSIZED_OUTPUT_BYTES,
  RuntimeError,
  RuntimeTurnError,
  type RuntimeTurnDiagnosis,
} from '@bakin/core/adapters/runtime'

export interface PiErrorContext {
  /** The caller's AbortSignal fired (MessageArgs.signal). */
  aborted?: boolean
  sessionId?: string
  model?: string
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function statusOf(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>
    for (const key of ['status', 'statusCode']) {
      const value = rec[key]
      if (typeof value === 'number') return value
    }
  }
  return undefined
}

function codeOf(err: unknown): string | undefined {
  if (err && typeof err === 'object') {
    const code = (err as Record<string, unknown>).code
    if (typeof code === 'string') return code
    const cause = (err as Record<string, unknown>).cause
    if (cause && typeof cause === 'object') {
      const causeCode = (cause as Record<string, unknown>).code
      if (typeof causeCode === 'string') return causeCode
    }
  }
  return undefined
}

export function toRuntimeError(err: unknown, ctx: PiErrorContext = {}): RuntimeError {
  if (err instanceof RuntimeError) return err
  const message = describe(err)
  const status = statusOf(err)
  const code = codeOf(err)

  if (ctx.aborted || (err instanceof Error && err.name === 'AbortError') || /\baborted\b/i.test(message)) {
    return new RuntimeError(`Pi turn aborted${ctx.sessionId ? ` (session ${ctx.sessionId})` : ''}`, {
      kind: 'aborted',
      cause: err,
    })
  }

  if (status === 429 || /rate.?limit|overloaded|too many requests|quota exceeded/i.test(message)) {
    return new RuntimeError(`Pi provider cooldown: ${message}`, {
      kind: 'provider_cooldown',
      cause: err,
      providerInfo: { model: ctx.model, cooldownReason: 'rate_limit' },
    })
  }

  if (status === 401 || status === 403 || /unauthorized|forbidden|invalid api key|no api key|authentication|not logged in/i.test(message)) {
    return new RuntimeError(`Pi provider auth unavailable: ${message}`, {
      kind: 'provider_cooldown',
      cause: err,
      providerInfo: { model: ctx.model, authProfileUnavailable: true },
    })
  }

  if (status === 408 || code === 'ETIMEDOUT' || /\btimed?\s?out\b|ETIMEDOUT/i.test(message)) {
    return new RuntimeError(`Pi turn timeout: ${message}`, { kind: 'timeout', cause: err })
  }

  if (
    code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EPIPE'
    || /fetch failed|network|socket hang up|connection (?:refused|reset|closed)|ECONNREFUSED|ECONNRESET/i.test(message)
  ) {
    return new RuntimeError(`Pi transport failure: ${message}`, { kind: 'transport', cause: err })
  }

  return new RuntimeError(`Pi runtime failure: ${message}`, { kind: 'runtime_failed', cause: err })
}

const SALVAGE_CAP_BYTES = 16_384

/**
 * Mid-turn stream death (assistant stream ended in an error event with
 * partial output) → typed session-death with salvage evidence so the
 * recovery ladder can act without reading anything provider-side.
 * `oversizedOutput` compares the salvaged completion against the caller's
 * threshold (T29 — this was hardcoded `false`, so the ladder never saw
 * runaway-output deaths on Pi).
 */
export function buildStreamDeathError(input: {
  sessionId?: string
  partialText: string
  lastToolCall?: string
  cause?: unknown
  detail?: string
  oversizedOutputBytes?: number
}): RuntimeTurnError {
  const completionBytes = Buffer.byteLength(input.partialText, 'utf-8')
  const diagnosis: RuntimeTurnDiagnosis = {
    reason: 'session_interrupted',
    sessionId: input.sessionId,
    sessionStatus: 'stream_error',
    completionBytes,
    oversizedOutput: completionBytes > (input.oversizedOutputBytes ?? DEFAULT_OVERSIZED_OUTPUT_BYTES),
    lastToolCall: input.lastToolCall,
    salvagedText: input.partialText.slice(0, SALVAGE_CAP_BYTES) || undefined,
    detail: input.detail ?? 'Pi assistant stream errored before the turn completed',
  }
  return new RuntimeTurnError(diagnosis, { cause: input.cause })
}
