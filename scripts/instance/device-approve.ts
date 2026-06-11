/**
 * Pre-approve Bakin's gateway device on a fresh instance.
 *
 * The gateway only grants operator.write to a paired device, and approving a
 * device normally needs operator.pairing (a bootstrap chicken-and-egg). As the
 * owner with filesystem access to the disposable home, the rig generates the
 * device identity and writes the pairing record directly — so Bakin's gateway
 * client (which presents this identity, see adapter-openclaw/device-auth.ts)
 * connects with operator.write already granted.
 *
 * Boundary: dev-rig module, exempt from provider-boundary rules.
 */
import { createHash, generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// OpenClaw 2026.5.28's cron CLI requests operator.admin + operator.pairing on
// top of read/write — without them every `cron add/list` dies on "scope
// upgrade pending approval" (the documented pairing chicken-and-egg, #467).
const OPERATOR_SCOPES = ['operator.read', 'operator.write', 'operator.admin', 'operator.pairing']

function base64url(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface DeviceKeypair {
  deviceId: string
  publicKeyPem: string
  privateKeyPem: string
  publicKeyRawBase64Url: string
}

/** Generate an ed25519 device keypair (deviceId = sha256(raw pubkey) hex). */
export function generateDeviceKeypair(): DeviceKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
  const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  const rawPub = der.subarray(der.length - 32)
  return {
    deviceId: createHash('sha256').update(rawPub).digest('hex'),
    publicKeyPem,
    privateKeyPem,
    publicKeyRawBase64Url: base64url(rawPub),
  }
}

/**
 * Build the pre-approved device state files. Pure given a keypair + token.
 *
 * Deliberately does NOT pin `platform`/`deviceFamily`: this one identity file
 * (identity/device.json) is shared by every client of the mounted home — Bakin
 * on the host (claims darwin) AND the OpenClaw CLI + agent runtime inside the
 * container (claim linux). The gateway pins platform only when the paired record
 * carries one, and a mismatch parks the device as a "metadata change pending
 * approval" — which broke `cron list` and made Discord re-prompt to pair. Leaving
 * it unpinned accepts any claimed platform; each client's signature still verifies
 * against its own claimed value.
 */
export function buildApprovedDeviceState(kp: DeviceKeypair, token: string, nowMs: number) {
  const identity = {
    version: 1,
    deviceId: kp.deviceId,
    publicKeyPem: kp.publicKeyPem,
    privateKeyPem: kp.privateKeyPem,
    createdAtMs: nowMs,
  }
  const operatorToken = { token, role: 'operator', scopes: [...OPERATOR_SCOPES] }
  const deviceAuth = {
    version: 1,
    deviceId: kp.deviceId,
    tokens: { operator: { ...operatorToken, updatedAtMs: nowMs } },
  }
  const paired = {
    [kp.deviceId]: {
      deviceId: kp.deviceId,
      publicKey: kp.publicKeyRawBase64Url,
      clientId: 'gateway-client',
      clientMode: 'backend',
      role: 'operator',
      roles: ['operator'],
      scopes: [...OPERATOR_SCOPES],
      approvedScopes: [...OPERATOR_SCOPES],
      tokens: { operator: { ...operatorToken, createdAtMs: nowMs } },
      createdAtMs: nowMs,
      approvedAtMs: nowMs,
    },
  }
  return { identity, deviceAuth, paired }
}

type ScopedRecord = Record<string, unknown>

function unionScopes(target: unknown, scopes: readonly string[]): { value: string[]; changed: boolean } {
  const existing = Array.isArray(target) ? target.filter((s): s is string => typeof s === 'string') : []
  const value = [...existing]
  let changed = false
  for (const scope of scopes) {
    if (!value.includes(scope)) {
      value.push(scope)
      changed = true
    }
  }
  return { value, changed }
}

/**
 * Union the required operator scopes into existing device state. Pure —
 * keypair and token are untouched. Reused rig state predates the wider
 * scope list, and an `instance reset` to regenerate it would lose Codex
 * auth; widening in place avoids both.
 */
export function widenDeviceScopes(
  paired: Record<string, ScopedRecord>,
  deviceAuth: ScopedRecord,
  scopes: readonly string[] = OPERATOR_SCOPES,
): { paired: Record<string, ScopedRecord>; deviceAuth: ScopedRecord; changed: boolean } {
  let changed = false
  const nextPaired = structuredClone(paired)
  for (const record of Object.values(nextPaired)) {
    for (const key of ['scopes', 'approvedScopes'] as const) {
      const result = unionScopes(record[key], scopes)
      if (result.changed) {
        record[key] = result.value
        changed = true
      }
    }
    const operatorToken = (record.tokens as Record<string, ScopedRecord> | undefined)?.operator
    if (operatorToken) {
      const result = unionScopes(operatorToken.scopes, scopes)
      if (result.changed) {
        operatorToken.scopes = result.value
        changed = true
      }
    }
  }
  const nextAuth = structuredClone(deviceAuth)
  const authToken = (nextAuth.tokens as Record<string, ScopedRecord> | undefined)?.operator
  if (authToken) {
    const result = unionScopes(authToken.scopes, scopes)
    if (result.changed) {
      authToken.scopes = result.value
      changed = true
    }
  }
  return { paired: nextPaired, deviceAuth: nextAuth, changed }
}

/**
 * Ensure the openclaw home has a pre-approved Bakin device. When an identity
 * already exists, the pairing is kept (never clobbered) but its scopes are
 * reconciled against OPERATOR_SCOPES — `up` runs this before the gateway
 * starts, so widened scopes are read on the next gateway boot.
 */
export function ensureApprovedDevice(openclawHome: string, nowMs: number, token: string): boolean {
  const identityDir = join(openclawHome, 'identity')
  const devicesDir = join(openclawHome, 'devices')
  if (existsSync(join(identityDir, 'device.json'))) {
    try {
      const pairedPath = join(devicesDir, 'paired.json')
      const authPath = join(identityDir, 'device-auth.json')
      if (existsSync(pairedPath) && existsSync(authPath)) {
        const paired = JSON.parse(readFileSync(pairedPath, 'utf-8')) as Record<string, ScopedRecord>
        const deviceAuth = JSON.parse(readFileSync(authPath, 'utf-8')) as ScopedRecord
        const widened = widenDeviceScopes(paired, deviceAuth)
        if (widened.changed) {
          writeFileSync(pairedPath, JSON.stringify(widened.paired, null, 2))
          writeFileSync(authPath, JSON.stringify(widened.deviceAuth, null, 2))
          console.log('[device-approve] widened operator scopes on existing rig state')
        }
      }
    } catch (err) {
      console.warn(`[device-approve] scope reconcile skipped: ${err instanceof Error ? err.message : String(err)}`)
    }
    return false
  }

  mkdirSync(identityDir, { recursive: true })
  mkdirSync(devicesDir, { recursive: true })
  const kp = generateDeviceKeypair()
  const { identity, deviceAuth, paired } = buildApprovedDeviceState(kp, token, nowMs)
  writeFileSync(join(identityDir, 'device.json'), JSON.stringify(identity, null, 2))
  writeFileSync(join(identityDir, 'device-auth.json'), JSON.stringify(deviceAuth, null, 2))
  writeFileSync(join(devicesDir, 'paired.json'), JSON.stringify(paired, null, 2))
  writeFileSync(join(devicesDir, 'pending.json'), '{}')
  return true
}
