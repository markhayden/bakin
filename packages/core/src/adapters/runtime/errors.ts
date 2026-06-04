/**
 * Typed runtime-failure contracts crossing the adapter boundary.
 *
 * Adapters map every provider failure to a `RuntimeError` with a structural
 * `kind` before it leaves the adapter package. Core (dispatch) classifies on
 * `kind` exclusively — never on error-message text. The original provider
 * error is always preserved on `cause` so transport-level codes
 * (ECONNRESET, AbortError, …) survive the boundary for logging/diagnostics.
 */

export type RuntimeErrorKind =
  /** Socket drop, disconnect, not-connected, fetch failure — transient. */
  | 'transport'
  /** An RPC/transport timer fired without a final response. */
  | 'timeout'
  /** The provider session died mid-turn; carries a RuntimeTurnDiagnosis. */
  | 'session_death'
  /** Provider/auth cooldown — model provider unavailable, retry later. */
  | 'provider_cooldown'
  /** Structured runtime failure (HTTP-status class, CLI exit, protocol). */
  | 'runtime_failed'

export interface RuntimeErrorOptions {
  kind: RuntimeErrorKind
  cause?: unknown
}

export class RuntimeError extends Error {
  readonly kind: RuntimeErrorKind

  constructor(message: string, options: RuntimeErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'RuntimeError'
    this.kind = options.kind
  }
}

export type RuntimeTurnFailureReason =
  /** session.ended with a non-success status that was not a runtime timeout. */
  | 'session_interrupted'
  /** The session/turn genuinely timed out server-side. */
  | 'runtime_timeout'

/**
 * Post-mortem of a dead provider turn, assembled entirely inside the runtime
 * adapter (Bakin core never reads provider files). Every field is optional
 * evidence — a partial diagnosis is still more useful than a generic timeout.
 */
export interface RuntimeTurnDiagnosis {
  reason: RuntimeTurnFailureReason
  /** Provider session id the turn ran in. */
  sessionId?: string
  /** Raw provider session end status, e.g. 'interrupted'. */
  sessionStatus?: string
  /** Provider-reported timeout flag from the session end event. */
  timedOut?: boolean
  /** Total bytes of the final assistant output that killed the turn. */
  completionBytes?: number
  /** Provider truncated the recorded completion (trajectory size limit). */
  outputTruncated?: boolean
  /** completionBytes exceeded the configured oversized-output threshold. */
  oversizedOutput?: boolean
  /** Last tool the agent invoked before the turn died. */
  lastToolCall?: string
  /** Truncated completion text preserved for salvage (capped by the adapter). */
  salvagedText?: string
  /** Token usage recorded for the fatal completion, when available. */
  usage?: { input?: number; output?: number; total?: number }
  /** One-line human-readable diagnosis. */
  detail?: string
}

export class RuntimeTurnError extends RuntimeError {
  readonly diagnosis: RuntimeTurnDiagnosis

  constructor(diagnosis: RuntimeTurnDiagnosis, options?: { cause?: unknown }) {
    super(
      diagnosis.detail
        ?? (diagnosis.reason === 'runtime_timeout'
          ? 'Runtime session timed out before reporting completion'
          : 'Runtime session died before reporting completion'),
      { kind: 'session_death', cause: options?.cause },
    )
    this.name = 'RuntimeTurnError'
    this.diagnosis = diagnosis
  }
}
