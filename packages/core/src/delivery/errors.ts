/**
 * Typed delivery errors (channel-readiness spec §4.3).
 *
 * Every failure the delivery bridge raises is a DeliveryError whose `kind`
 * is the ONLY thing consumers classify on — never the message text
 * (architecture rule R28 scans for `.message.includes(...)`). The kind and
 * summary types are wire types and live in ./readiness; this module only
 * owns the class.
 */
import type { ChannelReadinessState, DeliveryErrorKind, DeliveryErrorSummary } from './readiness'

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
