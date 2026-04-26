/**
 * HMAC-signed consent tokens for the two-phase install / upgrade flow.
 *
 * Problem: preflight returns awaitingConsent + the permission diff. The CLI
 * prompts the user, then re-POSTs with `accepted: true`. Without a binding,
 * the second call could swap the source string, the manifest could change
 * between calls, or a third party could short-circuit the prompt entirely.
 *
 * Solution: preflight returns a token that captures
 *   { source, manifestSha, permissions, expiresAt }
 * signed with a process-lifetime HMAC key. Commit re-validates: token
 * signature, expiry, source match against the request body, and — after
 * re-cloning — manifestSha match against the freshly cloned manifest. If
 * any of those don't match, commit fails the second-call install.
 *
 * The HMAC key lives in memory only (random 32 bytes generated on first
 * use, globalThis-pinned across HMR). Tokens don't survive a server
 * restart — that's fine; preflight + commit are seconds apart.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { createLogger } from '@/core/logger'

const log = createLogger('plugin-consent-token')

const _g = globalThis as typeof globalThis & { __bakinPreflightHmacKey?: Buffer }
function key(): Buffer {
  if (!_g.__bakinPreflightHmacKey) _g.__bakinPreflightHmacKey = randomBytes(32)
  return _g.__bakinPreflightHmacKey
}

const DEFAULT_TTL_MS = 5 * 60 * 1000  // 5 minutes — long enough for a real prompt

export interface ConsentTokenPayload {
  /** What the user typed at preflight — must match the commit body. */
  source: string
  /** sha256 of the manifest as observed at preflight time. */
  manifestSha: string
  /** The exact permissions list the user consented to. */
  permissions: string[]
  /** Epoch millis when this token stops verifying. */
  expiresAt: number
}

/** Encode + sign a payload. Returns `<base64-payload>.<hex-sig>`. */
export function signConsentToken(payload: Omit<ConsentTokenPayload, 'expiresAt'>, ttlMs = DEFAULT_TTL_MS): string {
  const full: ConsentTokenPayload = { ...payload, expiresAt: Date.now() + ttlMs }
  const json = JSON.stringify(full)
  const b64 = Buffer.from(json, 'utf-8').toString('base64')
  const sig = createHmac('sha256', key()).update(b64).digest('hex')
  return `${b64}.${sig}`
}

/**
 * Verify a token: signature, expiry. Returns the payload on success or
 * null on any failure mode (invalid format, bad sig, expired). Constant-
 * time signature compare to avoid leaking forgery progress via timing.
 */
export function verifyConsentToken(token: string): ConsentTokenPayload | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 8192) return null
  const dot = token.lastIndexOf('.')
  if (dot < 0) return null
  const b64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (sig.length !== 64) return null
  const expected = createHmac('sha256', key()).update(b64).digest('hex')
  let sigBuf: Buffer
  let expectedBuf: Buffer
  try {
    sigBuf = Buffer.from(sig, 'hex')
    expectedBuf = Buffer.from(expected, 'hex')
  } catch {
    return null
  }
  if (sigBuf.length !== expectedBuf.length) return null
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null

  let payload: ConsentTokenPayload
  try {
    payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8')) as ConsentTokenPayload
  } catch (err) {
    log.warn('consent token payload not parseable', { err: String(err) })
    return null
  }
  if (typeof payload.expiresAt !== 'number' || Date.now() > payload.expiresAt) return null
  if (typeof payload.source !== 'string' || typeof payload.manifestSha !== 'string') return null
  if (!Array.isArray(payload.permissions)) return null
  return payload
}
