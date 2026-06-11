import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { buildApprovedDeviceState, ensureApprovedDevice, generateDeviceKeypair, widenDeviceScopes } from '../../../scripts/instance/device-approve'

// OpenClaw 2026.5.28's cron CLI requests admin + pairing on top of read/write.
const ALL_SCOPES = ['operator.admin', 'operator.pairing', 'operator.read', 'operator.write']
const NARROW_SCOPES = ['operator.read', 'operator.write']

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

  it('pre-approves the device with the full operator scope set + Bakin metadata', () => {
    const { identity, deviceAuth, paired } = buildApprovedDeviceState(kp, 'tok-1', 1000)
    expect(identity.deviceId).toBe('dev123')
    expect(deviceAuth.tokens.operator.token).toBe('tok-1')
    expect([...deviceAuth.tokens.operator.scopes].sort()).toEqual(ALL_SCOPES)

    const dev = paired.dev123
    expect(dev.clientId).toBe('gateway-client')
    expect(dev.clientMode).toBe('backend')
    expect(dev.publicKey).toBe('rawpub')
    expect([...dev.scopes].sort()).toEqual(ALL_SCOPES)
    expect([...dev.approvedScopes].sort()).toEqual(ALL_SCOPES)
    expect([...dev.tokens.operator.scopes].sort()).toEqual(ALL_SCOPES)
    expect(dev.tokens.operator.token).toBe('tok-1')
  })

  it('does NOT pin platform/deviceFamily (the identity is shared by host + container clients)', () => {
    const dev = buildApprovedDeviceState(kp, 't', 1).paired.dev123 as Record<string, unknown>
    expect('platform' in dev).toBe(false)
    expect('deviceFamily' in dev).toBe(false)
  })
})

describe('widenDeviceScopes', () => {
  function narrowState() {
    const { deviceAuth, paired } = buildApprovedDeviceState(
      { deviceId: 'dev123', publicKeyPem: 'PUB', privateKeyPem: 'PRIV', publicKeyRawBase64Url: 'rawpub' },
      'tok-1', 1000,
    )
    const p = JSON.parse(JSON.stringify(paired)) as Record<string, Record<string, unknown>>
    const a = JSON.parse(JSON.stringify(deviceAuth)) as Record<string, unknown>
    p.dev123.scopes = [...NARROW_SCOPES]
    p.dev123.approvedScopes = [...NARROW_SCOPES]
    ;(p.dev123.tokens as Record<string, Record<string, unknown>>).operator.scopes = [...NARROW_SCOPES]
    ;(a.tokens as Record<string, Record<string, unknown>>).operator.scopes = [...NARROW_SCOPES]
    return { paired: p, deviceAuth: a }
  }

  it('unions the required scopes into all three encodings, preserving token', () => {
    const { paired, deviceAuth } = narrowState()
    const result = widenDeviceScopes(paired, deviceAuth)
    expect(result.changed).toBe(true)

    const dev = result.paired.dev123 as Record<string, unknown>
    expect([...(dev.scopes as string[])].sort()).toEqual(ALL_SCOPES)
    expect([...(dev.approvedScopes as string[])].sort()).toEqual(ALL_SCOPES)
    const devTok = (dev.tokens as Record<string, Record<string, unknown>>).operator
    expect([...(devTok.scopes as string[])].sort()).toEqual(ALL_SCOPES)
    expect(devTok.token).toBe('tok-1')
    const authTok = (result.deviceAuth.tokens as Record<string, Record<string, unknown>>).operator
    expect([...(authTok.scopes as string[])].sort()).toEqual(ALL_SCOPES)
    expect(authTok.token).toBe('tok-1')
  })

  it('reports changed=false when scopes are already a superset', () => {
    const { paired, deviceAuth } = narrowState()
    const once = widenDeviceScopes(paired, deviceAuth)
    const twice = widenDeviceScopes(
      once.paired as Record<string, Record<string, unknown>>,
      once.deviceAuth,
    )
    expect(twice.changed).toBe(false)
  })
})

describe('ensureApprovedDevice scope reconcile', () => {
  it('widens narrow scopes in reused rig state without touching keypair or token', () => {
    const home = mkdtempSync(join(tmpdir(), 'bakin-rig-device-test-'))
    try {
      expect(ensureApprovedDevice(home, 1000, 'tok-1')).toBe(true)

      // Simulate pre-#467 state: narrow the persisted scopes by hand
      const pairedPath = join(home, 'devices', 'paired.json')
      const authPath = join(home, 'identity', 'device-auth.json')
      const paired = JSON.parse(readFileSync(pairedPath, 'utf-8'))
      const id = Object.keys(paired)[0]!
      paired[id].scopes = [...NARROW_SCOPES]
      paired[id].approvedScopes = [...NARROW_SCOPES]
      paired[id].tokens.operator.scopes = [...NARROW_SCOPES]
      writeFileSync(pairedPath, JSON.stringify(paired, null, 2))
      const auth = JSON.parse(readFileSync(authPath, 'utf-8'))
      auth.tokens.operator.scopes = [...NARROW_SCOPES]
      writeFileSync(authPath, JSON.stringify(auth, null, 2))
      const identityBefore = readFileSync(join(home, 'identity', 'device.json'), 'utf-8')

      // Reused state: returns false (not created) but reconciles scopes
      expect(ensureApprovedDevice(home, 2000, 'tok-ignored')).toBe(false)

      const widened = JSON.parse(readFileSync(pairedPath, 'utf-8'))
      expect([...widened[id].approvedScopes].sort()).toEqual(ALL_SCOPES)
      expect([...widened[id].scopes].sort()).toEqual(ALL_SCOPES)
      expect([...widened[id].tokens.operator.scopes].sort()).toEqual(ALL_SCOPES)
      expect(widened[id].tokens.operator.token).toBe('tok-1') // original token kept
      const authWidened = JSON.parse(readFileSync(authPath, 'utf-8'))
      expect([...authWidened.tokens.operator.scopes].sort()).toEqual(ALL_SCOPES)
      // identity (keypair) untouched
      expect(readFileSync(join(home, 'identity', 'device.json'), 'utf-8')).toBe(identityBefore)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
