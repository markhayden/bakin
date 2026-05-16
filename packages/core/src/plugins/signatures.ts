import { createHash, createPublicKey, verify as verifyBytes } from 'crypto'
import type { PluginManifestSignature } from '@makinbakin/sdk/types'

export interface PluginSignaturePolicy {
  requireSignatures?: boolean
  trustedSigners?: string[]
}

export interface PluginSignatureVerification {
  required: boolean
  verified: boolean
  signer?: string
  fingerprint?: string
}

export class PluginSignatureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginSignatureError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeForCanonicalJson(value: unknown, topLevel = false): unknown {
  if (Array.isArray(value)) {
    return value.map(item => normalizeForCanonicalJson(item))
  }

  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      if (topLevel && key === 'signature') continue
      const normalized = normalizeForCanonicalJson(value[key])
      if (normalized !== undefined) out[key] = normalized
    }
    return out
  }

  return value
}

/**
 * Canonical JSON body signed by plugin manifests. The top-level signature
 * block is omitted, object keys are sorted recursively, and arrays keep
 * their declared order.
 */
export function canonicalizePluginManifestForSignature(manifest: unknown): string {
  if (!isRecord(manifest)) {
    throw new PluginSignatureError('bakin-plugin.json must contain an object before signature verification')
  }
  return JSON.stringify(normalizeForCanonicalJson(manifest, true))
}

function decodeBase64Field(value: string, field: string): Buffer {
  if (value.trim().length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new PluginSignatureError(`plugin signature ${field} must be base64`)
  }
  const normalized = value.replace(/=+$/, '')
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length === 0 || decoded.toString('base64').replace(/=+$/, '') !== normalized) {
    throw new PluginSignatureError(`plugin signature ${field} must be valid base64`)
  }
  return decoded
}

export function pluginSignatureFingerprint(publicKeyBase64: string): string {
  const publicKey = decodeBase64Field(publicKeyBase64, 'publicKey')
  return `sha256:${createHash('sha256').update(publicKey).digest('hex')}`
}

function readSignature(manifest: unknown): PluginManifestSignature | null {
  if (!isRecord(manifest)) {
    throw new PluginSignatureError('bakin-plugin.json must contain an object before signature verification')
  }
  const raw = manifest.signature
  if (raw === undefined || raw === null) return null
  if (!isRecord(raw)) {
    throw new PluginSignatureError('plugin signature must be an object')
  }
  if (raw.algorithm !== 'ed25519') {
    throw new PluginSignatureError('plugin signature algorithm must be "ed25519"')
  }
  for (const key of ['signer', 'publicKey', 'signature'] as const) {
    if (typeof raw[key] !== 'string' || raw[key].trim().length === 0) {
      throw new PluginSignatureError(`plugin signature ${key} must be a non-empty string`)
    }
  }
  const signer = raw.signer
  const publicKey = raw.publicKey
  const signature = raw.signature
  if (typeof signer !== 'string' || typeof publicKey !== 'string' || typeof signature !== 'string') {
    throw new PluginSignatureError('plugin signature fields must be strings')
  }
  return {
    algorithm: 'ed25519',
    signer,
    publicKey,
    signature,
  }
}

function trustedRoots(policy: PluginSignaturePolicy): Set<string> {
  return new Set(
    (Array.isArray(policy.trustedSigners) ? policy.trustedSigners : [])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(value => {
        const trimmed = value.trim()
        return trimmed.startsWith('sha256:')
          ? `sha256:${trimmed.slice('sha256:'.length).toLowerCase()}`
          : trimmed
      }),
  )
}

function isTrustedPublicKey(publicKeyBase64: string, fingerprint: string, trust: Set<string>): boolean {
  return (
    trust.has(fingerprint) ||
    trust.has(publicKeyBase64) ||
    trust.has(`ed25519:${publicKeyBase64}`)
  )
}

export function verifyPluginManifestSignature(
  manifest: unknown,
  policy: PluginSignaturePolicy,
): PluginSignatureVerification {
  const required = policy.requireSignatures === true
  if (!required) {
    return { required: false, verified: false }
  }

  const signature = readSignature(manifest)
  if (!signature) {
    throw new PluginSignatureError('settings.plugins.requireSignatures requires a signed plugin manifest')
  }

  const fingerprint = pluginSignatureFingerprint(signature.publicKey)
  const trust = trustedRoots(policy)
  if (!isTrustedPublicKey(signature.publicKey, fingerprint, trust)) {
    throw new PluginSignatureError(
      `plugin signature signer key is not trusted (${fingerprint})`,
    )
  }

  const publicKeyBytes = decodeBase64Field(signature.publicKey, 'publicKey')
  const signatureBytes = decodeBase64Field(signature.signature, 'signature')
  let publicKey: ReturnType<typeof createPublicKey>
  try {
    publicKey = createPublicKey({ key: publicKeyBytes, format: 'der', type: 'spki' })
  } catch {
    throw new PluginSignatureError('plugin signature publicKey is not a valid Ed25519 SPKI key')
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new PluginSignatureError('plugin signature publicKey must be an Ed25519 key')
  }
  const body = Buffer.from(canonicalizePluginManifestForSignature(manifest), 'utf-8')
  let valid = false
  try {
    valid = verifyBytes(null, body, publicKey, signatureBytes)
  } catch {
    valid = false
  }
  if (!valid) {
    throw new PluginSignatureError('plugin signature is invalid')
  }

  return {
    required: true,
    verified: true,
    signer: signature.signer,
    fingerprint,
  }
}
