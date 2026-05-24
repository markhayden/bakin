/**
 * Device identity for the OpenClaw gateway handshake.
 *
 * The gateway strips elevated scopes (operator.write) from connections that
 * lack a paired device identity. To dispatch agents, our gateway client must
 * present the home's device identity (identity/device.json) and sign the
 * connect challenge. Payload + signing mirror OpenClaw's own gateway-client
 * (packages/gateway-client/src/device-auth.ts — v3 format).
 */
import { createPrivateKey, createPublicKey, sign as cryptoSign } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { getOpenClawPath } from './home'

export interface DeviceAuthInfo {
  deviceId: string
  publicKeyPem: string
  privateKeyPem: string
  /** Operator token from a prior pairing, if any. */
  deviceToken: string | null
}

export interface DeviceConnectParams {
  clientId: string
  clientMode: string
  role: string
  scopes: string[]
  nonce: string
  platform: string
  deviceFamily?: string
  /** The gateway shared token — this (NOT the device token) is what the v3 signature covers. */
  gatewayToken?: string | null
}

export interface DeviceConnectFields {
  device: { id: string; publicKey: string; signature: string; signedAt: number; nonce: string }
  deviceToken: string | null
}

function base64url(bytes: Buffer | Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Lowercase metadata exactly as the gateway does before byte-comparing signatures. */
function normalizeMeta(value?: string | null): string {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32))
}

/** v3 device-auth payload (must match the connect frame's values byte-for-byte). */
export function buildDeviceAuthPayloadV3(params: {
  deviceId: string
  clientId: string
  clientMode: string
  role: string
  scopes: string[]
  signedAtMs: number
  token?: string | null
  nonce: string
  platform?: string | null
  deviceFamily?: string | null
}): string {
  return [
    'v3',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(','),
    String(params.signedAtMs),
    params.token ?? '',
    params.nonce,
    normalizeMeta(params.platform),
    normalizeMeta(params.deviceFamily),
  ].join('|')
}

/** Raw 32-byte ed25519 public key (base64url) extracted from a SPKI PEM. */
export function publicKeyRawBase64UrlFromPem(pem: string): string {
  const der = createPublicKey(pem).export({ format: 'der', type: 'spki' }) as Buffer
  return base64url(der.subarray(der.length - 32))
}

export function signDevicePayload(privateKeyPem: string, payload: string): string {
  const signature = cryptoSign(null, Buffer.from(payload, 'utf8'), createPrivateKey(privateKeyPem))
  return base64url(signature)
}

/** Load the home device identity + any stored operator token, or null if absent. */
export function loadDeviceAuth(): DeviceAuthInfo | null {
  try {
    const identity = JSON.parse(readFileSync(getOpenClawPath('identity', 'device.json'), 'utf8')) as {
      deviceId?: string; publicKeyPem?: string; privateKeyPem?: string
    }
    if (!identity.deviceId || !identity.publicKeyPem || !identity.privateKeyPem) return null
    let deviceToken: string | null = null
    try {
      const auth = JSON.parse(readFileSync(getOpenClawPath('identity', 'device-auth.json'), 'utf8')) as {
        tokens?: { operator?: { token?: string } }
      }
      deviceToken = auth.tokens?.operator?.token ?? null
    } catch {
      // no stored token yet — first connect will pair
    }
    return { deviceId: identity.deviceId, publicKeyPem: identity.publicKeyPem, privateKeyPem: identity.privateKeyPem, deviceToken }
  } catch {
    return null
  }
}

/** Build the connect `device` fields (signed v3) for a given challenge nonce. */
export function buildDeviceConnectFields(info: DeviceAuthInfo, params: DeviceConnectParams): DeviceConnectFields {
  const signedAt = Date.now()
  const payload = buildDeviceAuthPayloadV3({
    deviceId: info.deviceId,
    clientId: params.clientId,
    clientMode: params.clientMode,
    role: params.role,
    scopes: params.scopes,
    signedAtMs: signedAt,
    // The signature covers the gateway shared token, not the device token
    // (mirrors OpenClaw's gateway-client: signatureToken = authToken).
    token: params.gatewayToken ?? null,
    nonce: params.nonce,
    platform: params.platform,
    deviceFamily: params.deviceFamily,
  })
  return {
    device: {
      id: info.deviceId,
      publicKey: publicKeyRawBase64UrlFromPem(info.publicKeyPem),
      signature: signDevicePayload(info.privateKeyPem, payload),
      signedAt,
      nonce: params.nonce,
    },
    deviceToken: info.deviceToken,
  }
}
