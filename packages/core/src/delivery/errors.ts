/**
 * Typed delivery errors (channel-readiness spec §4.3).
 *
 * Every failure the delivery bridge raises is a DeliveryError whose `kind`
 * is the ONLY thing consumers classify on — never the message text
 * (architecture rule R28 scans for `.message.includes(...)`).
 */
import type { ChannelReadinessState } from './readiness'

export type DeliveryErrorKind =
  /** Disabled, no token, or no guild — the readiness state says which (`detail.state`). */
  | 'not_configured'
  /** Configured but the transport is not up (connecting/disconnected/failed — `detail.state`). */
  | 'not_connected'
  /** Discord rejected the bot token (REST 401 or gateway close 4004). */
  | 'auth_failed'
  /** Discord refused the gateway intents (close 4013/4014 — portal toggle missing). */
  | 'intents'
  /** The target channel/guild is unknown to a connected bridge (REST 404 or unjoined guild). */
  | 'target_not_found'
  /** The bot lacks permission on the target (REST 403). */
  | 'forbidden'
  /** Discord refused the request deterministically (other 4xx); no retry was attempted. */
  | 'rejected'
  /** READY or HTTP deadline elapsed. */
  | 'timeout'
  /** Network / 5xx / everything else, after retries where retries apply. */
  | 'transport'

export interface DeliveryErrorDetail {
  /** Readiness state at the time of the failure (for not_configured / not_connected). */
  state?: ChannelReadinessState
  /** The channel/user ref the failure was about. */
  target?: string
  /** Guild involved (unjoined guild, per-guild enumeration failure). */
  guildId?: string
  /** HTTP status or gateway close code, when one exists. */
  status?: number
}

/** Wire-safe summary (never carries the token or a stack). */
export interface DeliveryErrorSummary {
  kind: DeliveryErrorKind
  message: string
  at: string
}

export class DeliveryError extends Error {
  readonly kind: DeliveryErrorKind
  readonly detail: DeliveryErrorDetail

  constructor(kind: DeliveryErrorKind, message: string, detail: DeliveryErrorDetail = {}) {
    super(message)
    this.name = 'DeliveryError'
    this.kind = kind
    this.detail = detail
  }
}

export function isDeliveryError(err: unknown): err is DeliveryError {
  return err instanceof DeliveryError
}

export function summarizeDeliveryError(err: DeliveryError, at: string = new Date().toISOString()): DeliveryErrorSummary {
  return { kind: err.kind, message: err.message, at }
}
