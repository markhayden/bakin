import { describe, expect, it } from 'bun:test'
import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto'

import {
  buildDeviceAuthPayloadV3,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from '../../packages/adapter-openclaw/src/device-auth'

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

describe('buildDeviceAuthPayloadV3', () => {
  it('produces the exact v3 pipe-delimited format with lowercased metadata', () => {
    const payload = buildDeviceAuthPayloadV3({
      deviceId: 'dev1',
      clientId: 'gateway-client',
      clientMode: 'backend',
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      signedAtMs: 123,
      token: 'shared-tok',
      nonce: 'n1',
      platform: 'Darwin',
      deviceFamily: null,
    })
    expect(payload).toBe('v3|dev1|gateway-client|backend|operator|operator.read,operator.write|123|shared-tok|n1|darwin|')
  })

  it('signs the gateway token slot empty when null', () => {
    const payload = buildDeviceAuthPayloadV3({
      deviceId: 'd', clientId: 'c', clientMode: 'm', role: 'operator', scopes: [], signedAtMs: 1, nonce: 'n', token: null,
    })
    expect(payload.split('|')[7]).toBe('')
  })
})

describe('signDevicePayload + publicKeyRawBase64UrlFromPem', () => {
  it('signs a payload that verifies against the raw ed25519 public key, raw key is 32 bytes', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' }) as string
    const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

    const payload = 'v3|dev|c|backend|operator|operator.write|9|tok|nonce|darwin|'
    const sig = signDevicePayload(privPem, payload)
    expect(cryptoVerify(null, Buffer.from(payload, 'utf8'), publicKey, b64urlToBuf(sig))).toBe(true)

    expect(b64urlToBuf(publicKeyRawBase64UrlFromPem(pubPem)).length).toBe(32)
  })
})
