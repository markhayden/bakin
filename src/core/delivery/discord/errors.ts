/**
 * ONE classifier from Discord REST/gateway failures to DeliveryError kinds
 * (spec §4.3). Shared by the transport (connect), the channel cache
 * (per-guild enumeration), and the send surface. Classification reads the
 * HTTP status / close code — never message text.
 */
import { DeliveryError, type DeliveryErrorDetail, type DeliveryErrorKind } from '@bakin/core/delivery'

/** Gateway close codes that are fatal and never recover on their own. */
export const FATAL_CLOSE_KINDS: Record<number, DeliveryErrorKind> = {
  4004: 'auth_failed',   // AuthenticationFailed
  4013: 'intents',       // InvalidIntents
  4014: 'intents',       // DisallowedIntents
}

export function isFatalCloseCode(code: number | null | undefined): code is number {
  return typeof code === 'number' && code in FATAL_CLOSE_KINDS
}

function httpStatusOf(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  return typeof err === 'string' ? err : String(err)
}

/** Strip the bot token from any message that could carry it (URLs, headers). */
export function sanitizeDeliveryMessage(message: string, token: string | null | undefined): string {
  if (!token) return message
  return message.split(token).join('[redacted]')
}

export function kindForHttpStatus(status: number): DeliveryErrorKind {
  if (status === 401) return 'auth_failed'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'target_not_found'
  if (status >= 400 && status < 500 && status !== 429) return 'rejected'
  return 'transport'
}

/** Kinds the send paths may retry: anything else was refused deterministically. */
export function isRetryableKind(kind: DeliveryErrorKind): boolean {
  return kind === 'transport' || kind === 'timeout'
}

/**
 * Wrap a REST failure. A DeliveryError passes through untouched; a response
 * with an HTTP status classifies by status; everything else is transport.
 */
export function classifyRestError(err: unknown, detail: DeliveryErrorDetail = {}, token?: string | null): DeliveryError {
  if (err instanceof DeliveryError) return err
  const status = httpStatusOf(err)
  const message = sanitizeDeliveryMessage(messageOf(err), token)
  if (status !== null) return new DeliveryError(kindForHttpStatus(status), message, { ...detail, status })
  return new DeliveryError('transport', message, detail)
}

/**
 * Wrap a CONNECT failure: a fatal gateway close code seen during the attempt
 * beats the thrown error (the close carries the real cause), then the REST
 * status (a bogus token fails at GET /gateway/bot with 401 before any
 * socket opens), then abort/other → transport.
 */
export function classifyConnectFailure(err: unknown, lastCloseCode: number | null, token?: string | null): DeliveryError {
  if (err instanceof DeliveryError) return err
  if (isFatalCloseCode(lastCloseCode)) {
    return new DeliveryError(FATAL_CLOSE_KINDS[lastCloseCode], closeMessage(lastCloseCode), { status: lastCloseCode })
  }
  const status = httpStatusOf(err)
  const message = sanitizeDeliveryMessage(messageOf(err), token)
  if (status !== null) return new DeliveryError(kindForHttpStatus(status), message, { status })
  return new DeliveryError('transport', message)
}

export function closeMessage(code: number): string {
  switch (code) {
    case 4004: return 'Discord rejected the bot token (gateway close 4004)'
    case 4013: return 'Discord refused the gateway intents as invalid (close 4013)'
    case 4014: return 'Discord refused the gateway intents — enable Message Content Intent for the bot (close 4014)'
    default: return `Discord gateway closed (code ${code})`
  }
}
