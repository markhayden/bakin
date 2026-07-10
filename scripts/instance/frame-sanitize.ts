/**
 * Shared fixture-sanitize pass for gateway frame recordings.
 *
 * One owner for the redaction rules used by record-gateway-frames.ts and the
 * abort probes: secret-bearing keys are replaced by placeholders, registered
 * secret values (gateway token, device token, device id) are scrubbed wherever
 * they appear, and RFC1918 LAN addresses are masked so committed fixtures
 * carry no network topology. Structure and field names are always preserved.
 *
 * Boundary: dev-rig module (scripts/instance/*), exempt from provider-boundary rules.
 */

const REDACT_KEYS: Record<string, string> = {
  token: '<redacted-token>',
  deviceToken: '<redacted-device-token>',
  signature: '<redacted-signature>',
  publicKey: '<redacted-public-key>',
  privateKeyPem: '<redacted-private-key>',
  publicKeyPem: '<redacted-public-key>',
  nonce: '<redacted-nonce>',
}

const RFC1918_RE = /\b(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g

const secretValues: string[] = []

/** Register a value (token, device id, …) to scrub wherever it appears. */
export function registerSecretValue(...values: Array<string | null | undefined>): void {
  for (const value of values) {
    if (value) secretValues.push(value)
  }
}

/** Scrub registered secret values + LAN addresses from an already-serialized string. */
export function redactString(value: string): string {
  let out = value
  for (const secret of secretValues) {
    if (secret && out.includes(secret)) out = out.split(secret).join('<redacted-secret>')
  }
  return out.replace(RFC1918_RE, '<redacted-lan-ip>')
}

/** deviceId (sha256 hex) and any registered secret value are scrubbed wherever they appear. */
export function sanitizeFrameValue(value: unknown, keyHint?: string): unknown {
  if (typeof value === 'string') {
    if (keyHint && REDACT_KEYS[keyHint]) return REDACT_KEYS[keyHint]
    if (keyHint === 'deviceId' || keyHint === 'id' && /^[0-9a-f]{64}$/.test(value)) return '<redacted-device-id>'
    if (/^[0-9a-f]{64}$/.test(value) && secretValues.includes(value)) return '<redacted-device-id>'
    return redactString(value)
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeFrameValue(v))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sanitizeFrameValue(v, k)
    return out
  }
  return value
}
