/**
 * Token management for the loopback-only internal file server.
 *
 * The token is a 32-byte random secret that Antfly passes back to Bakin
 * when fetching asset files for multimodal indexing. The listener is bound
 * to 127.0.0.1, so the token is a defense-in-depth layer against other
 * local processes — not a replacement for the loopback bind.
 */
import { randomBytes, timingSafeEqual } from 'crypto'
import { getSettings, updateSettings } from './settings'
import { createLogger } from './logger'

const log = createLogger('antfly-internal-token')

const TOKEN_BYTES = 32

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex')
}

/**
 * Read the internal token from settings, generating and persisting one
 * if absent. Safe to call multiple times; returns the same token across
 * calls until settings are cleared.
 */
export function getOrCreateToken(): string {
  const settings = getSettings()
  const existing = settings.antfly.internal?.token
  if (existing && existing.length > 0) return existing

  const token = generateToken()
  const currentPort = settings.antfly.internal?.port ?? 3738
  updateSettings({
    antfly: {
      internal: { token, port: currentPort },
    },
  })
  log.info('Generated new internal file server token')
  return token
}

/**
 * Constant-time comparison of a provided token against the expected token.
 * Returns false on any mismatch including length differences and empty inputs.
 */
export function verifyToken(provided: string | null | undefined, expected: string): boolean {
  if (!provided || !expected) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
