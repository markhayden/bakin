/**
 * Pure dispatch error classification over the adapter's typed RuntimeError /
 * RuntimeTurnError. Zero dispatch state — extracted from dispatch.ts so the
 * classification can be reasoned about (and tested) in isolation. Classification
 * is on `err.kind` only; the structural-signal fallbacks never inspect message text.
 */
import { RuntimeError, RuntimeTurnError } from '@bakin/core/adapters/runtime'

const MAX_ERR_LEN = 500

/** Truncate a raw error string so a runaway provider response can't balloon the audit/log. */
export function formatDispatchError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw.length > MAX_ERR_LEN ? `${raw.slice(0, MAX_ERR_LEN)}… (truncated)` : raw
}

export type DispatchFailureKind = 'transient' | 'structural'

export type DispatchFailureReasonCode =
  | 'provider_cooldown'
  | 'auth_profile_unavailable'
  | 'dispatch_timeout'
  | 'transport_failure'
  | 'runtime_adapter_failure'
  | 'runtime_turn_died'
  | 'runtime_dispatch_failed'

export interface DispatchFailureDetail {
  category: 'model_provider_unavailable' | 'runtime_unavailable'
  reasonCode: DispatchFailureReasonCode
  summary: string
  specificReason: string
  retryable: boolean
  provider?: string
  model?: string
  cooldownReason?: string
  rawError: string
}

const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'EPIPE',
])

// Split dispatch failures into:
//   - transient: transport failures (socket drop, disconnect, fetch error)
//     that should clear within a cycle. Use the short cooldown.
//   - structural: the runtime answered and said no, or timed out outright.
//     Use the long cooldown.
//
// Adapters throw typed RuntimeErrors — classification is on `kind` only.
// The structural-signal fallback below (TypeError / AbortError / cause.code)
// exists for non-RuntimeError errors from mock adapters or unexpected paths;
// it never inspects error message text. Default to 'structural' on unknown
// errors: treating an unknown failure as a real outage is the safer side.
// Note: ANY TypeError classifies transient (broader than fetch failures) —
// a code-bug TypeError retries on the short cooldown but is bounded by
// maxRetries, which actually blocks it for review faster than structural.
export function classifyDispatchError(err: unknown): DispatchFailureKind {
  if (err instanceof RuntimeError) {
    return err.kind === 'transport' ? 'transient' : 'structural'
  }
  if (err instanceof TypeError) return 'transient'
  const cause = (err as { cause?: { code?: string } })?.cause
  if (cause?.code && TRANSIENT_CODES.has(cause.code)) return 'transient'
  if (err instanceof Error && err.name === 'AbortError') return 'transient'
  return 'structural'
}

export function classifyDispatchFailureDetail(err: unknown): DispatchFailureDetail {
  const rawError = formatDispatchError(err)

  if (err instanceof RuntimeError) {
    switch (err.kind) {
      case 'provider_cooldown': {
        const info = err.providerInfo ?? {}
        return {
          category: 'model_provider_unavailable',
          reasonCode: info.authProfileUnavailable ? 'auth_profile_unavailable' : 'provider_cooldown',
          summary: 'Dispatch failed: model provider unavailable',
          specificReason: info.authProfileUnavailable
            ? 'Auth profile unavailable'
            : 'Provider in cooldown after timeout',
          retryable: true,
          ...(info.provider ? { provider: info.provider } : {}),
          ...(info.model ? { model: info.model } : {}),
          ...(info.cooldownReason ? { cooldownReason: info.cooldownReason } : {}),
          rawError,
        }
      }
      case 'timeout':
        return {
          category: 'runtime_unavailable',
          reasonCode: 'dispatch_timeout',
          summary: 'Dispatch failed: runtime dispatch timed out',
          specificReason: 'Runtime dispatch timed out',
          retryable: true,
          rawError,
        }
      case 'transport':
        return {
          category: 'runtime_unavailable',
          reasonCode: 'transport_failure',
          summary: 'Dispatch failed: runtime transport unavailable',
          specificReason: 'Runtime transport failure',
          retryable: true,
          rawError,
        }
      case 'session_death':
        return {
          category: 'runtime_unavailable',
          reasonCode: 'runtime_turn_died',
          summary: 'Dispatch failed: runtime session died before completion',
          specificReason: err instanceof RuntimeTurnError
            ? (err.diagnosis.detail ?? err.message)
            : err.message,
          retryable: false,
          rawError,
        }
      case 'runtime_failed':
        return {
          category: 'runtime_unavailable',
          reasonCode: 'runtime_adapter_failure',
          summary: 'Dispatch failed: runtime adapter failure',
          specificReason: 'Runtime adapter failure',
          retryable: true,
          rawError,
        }
    }
  }

  if (err instanceof TypeError || (err instanceof Error && err.name === 'AbortError')) {
    return {
      category: 'runtime_unavailable',
      reasonCode: 'transport_failure',
      summary: 'Dispatch failed: runtime transport unavailable',
      specificReason: 'Runtime transport failure',
      retryable: true,
      rawError,
    }
  }

  return {
    category: 'runtime_unavailable',
    reasonCode: 'runtime_dispatch_failed',
    summary: 'Dispatch failed: runtime dispatch failed before task completion',
    specificReason: 'Runtime dispatch failed before task completion',
    retryable: true,
    rawError,
  }
}

export function formatSanitizedRuntimeFailure(err: unknown): string {
  if (err instanceof RuntimeTurnError) {
    return err.diagnosis.detail ?? err.message
  }
  if (err instanceof RuntimeError) {
    switch (err.kind) {
      case 'timeout': return 'runtime gateway request timed out'
      case 'transport': return 'runtime transport failure'
      case 'provider_cooldown': return 'model provider unavailable'
      case 'session_death': return err.message
      case 'runtime_failed': return 'runtime adapter failure'
    }
  }
  if (err instanceof Error && err.name === 'AbortError') return 'runtime transport request aborted'
  return 'runtime dispatch failed before task completion'
}
