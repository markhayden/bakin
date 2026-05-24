import { describe, expect, it } from 'bun:test'

import { buildApprovedDeviceState, generateDeviceKeypair } from '../../../scripts/instance/device-approve'

describe('generateDeviceKeypair', () => {
  it('produces an ed25519 keypair with a sha256-hex deviceId and 32-byte raw pubkey', () => {
    const kp = generateDeviceKeypair()
    expect(kp.deviceId).toMatch(/^[0-9a-f]{64}$/) // sha256 hex
    expect(kp.publicKeyPem).toContain('BEGIN PUBLIC KEY')
    expect(kp.privateKeyPem).toContain('BEGIN PRIVATE KEY')
    expect(Buffer.from(kp.publicKeyRawBase64Url.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length).toBe(32)
  })
})

describe('buildApprovedDeviceState', () => {
  const kp = {
    deviceId: 'dev123',
    publicKeyPem: 'PUB',
    privateKeyPem: 'PRIV',
    publicKeyRawBase64Url: 'rawpub',
  }

  it('pre-approves the device with operator.write + Bakin metadata', () => {
    const { identity, deviceAuth, paired } = buildApprovedDeviceState(kp, 'tok-1', 1000)
    expect(identity.deviceId).toBe('dev123')
    expect(deviceAuth.tokens.operator.token).toBe('tok-1')
    expect(deviceAuth.tokens.operator.scopes).toContain('operator.write')

    const dev = paired.dev123
    expect(dev.clientId).toBe('gateway-client')
    expect(dev.clientMode).toBe('backend')
    expect(dev.publicKey).toBe('rawpub')
    expect(dev.approvedScopes).toEqual(['operator.read', 'operator.write'])
    expect(dev.tokens.operator.token).toBe('tok-1')
  })

  it('does NOT pin platform/deviceFamily (the identity is shared by host + container clients)', () => {
    const dev = buildApprovedDeviceState(kp, 't', 1).paired.dev123 as Record<string, unknown>
    expect('platform' in dev).toBe(false)
    expect('deviceFamily' in dev).toBe(false)
  })
})
