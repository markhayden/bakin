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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OPERATOR_SCOPES = ['operator.read', 'operator.write']

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
 * Build the pre-approved device state files. Pure given a keypair + token +
 * platform — `platform` must match what Bakin's gateway client reports
 * (process.platform of the Bakin process) or the gateway flags a metadata change.
 */
export function buildApprovedDeviceState(kp: DeviceKeypair, token: string, platform: string, nowMs: number) {
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
      platform,
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

/**
 * Ensure the openclaw home has a pre-approved Bakin device. No-op if an
 * identity already exists (don't clobber a working pairing).
 */
export function ensureApprovedDevice(openclawHome: string, platform: string, nowMs: number, token: string): boolean {
  const identityDir = join(openclawHome, 'identity')
  const devicesDir = join(openclawHome, 'devices')
  if (existsSync(join(identityDir, 'device.json'))) return false

  mkdirSync(identityDir, { recursive: true })
  mkdirSync(devicesDir, { recursive: true })
  const kp = generateDeviceKeypair()
  const { identity, deviceAuth, paired } = buildApprovedDeviceState(kp, token, platform, nowMs)
  writeFileSync(join(identityDir, 'device.json'), JSON.stringify(identity, null, 2))
  writeFileSync(join(identityDir, 'device-auth.json'), JSON.stringify(deviceAuth, null, 2))
  writeFileSync(join(devicesDir, 'paired.json'), JSON.stringify(paired, null, 2))
  writeFileSync(join(devicesDir, 'pending.json'), '{}')
  return true
}
