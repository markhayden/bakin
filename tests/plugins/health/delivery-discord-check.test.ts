import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import fs from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-delivery-check-${Date.now()}`)

let connected = false

mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../src/core/delivery', () => ({
  isDeliveryBridgeConnected: () => connected,
}))

import { checkDeliveryDiscord } from '@bakin/health/lib/system-checks/delivery-discord'
import { resetSettingsCache } from '../../../packages/core/src/settings'
import { setStoredSecret } from '../../../packages/core/src/media/secret-store'

type Disposition = string
interface ObservedLike {
  observations?: Array<{ status: string; key: string; incident?: { key: string; disposition: Disposition; class?: string } }>
  reason?: string
}

function writeSettings(discord: Record<string, unknown>): void {
  fs.writeFileSync(join(testDir, 'settings.json'), JSON.stringify({ integrations: { discord } }))
  resetSettingsCache()
}

function runtimeWith(mode: 'native' | 'shimmed' | 'unavailable') {
  return { capabilities: async () => ({ delivery: { mode } }) as never }
}

describe('delivery.discord doctor check', () => {
  beforeEach(() => {
    connected = false
    fs.rmSync(testDir, { recursive: true, force: true })
    fs.mkdirSync(testDir, { recursive: true })
    resetSettingsCache()
  })
  afterAll(() => fs.rmSync(testDir, { recursive: true, force: true }))

  it('is not-applicable when disabled', async () => {
    const result = await checkDeliveryDiscord(runtimeWith('unavailable')) as ObservedLike
    expect(JSON.stringify(result)).toContain('not enabled')
  })

  it('flags a missing token as action_required', async () => {
    writeSettings({ enabled: true, guildIds: ['g1'] })
    const result = await checkDeliveryDiscord(runtimeWith('unavailable')) as ObservedLike
    const incident = result.observations?.[0]?.incident
    expect(incident?.key).toBe('missing-token')
    expect(incident?.disposition).toBe('action_required')
  })

  it('flags missing guilds', async () => {
    writeSettings({ enabled: true, guildIds: [] })
    setStoredSecret('discord', 'botToken', 'tok')
    const result = await checkDeliveryDiscord(runtimeWith('unavailable')) as ObservedLike
    expect(result.observations?.[0]?.incident?.key).toBe('missing-guilds')
  })

  it('reports idle-healthy on a natively-delivering runtime', async () => {
    writeSettings({ enabled: true, guildIds: ['g1'] })
    setStoredSecret('discord', 'botToken', 'tok')
    const result = await checkDeliveryDiscord(runtimeWith('native')) as ObservedLike
    expect(result.observations?.[0]?.status).toBe('healthy')
    expect(JSON.stringify(result)).toContain('idle')
  })

  it('flags a configured-but-disconnected bridge as down', async () => {
    writeSettings({ enabled: true, guildIds: ['g1'], approvers: ['u1'] })
    setStoredSecret('discord', 'botToken', 'tok')
    const result = await checkDeliveryDiscord(runtimeWith('unavailable')) as ObservedLike
    expect(result.observations?.[0]?.incident?.key).toBe('bridge-down')
  })

  it('warns fail-closed when connected with empty allowlists', async () => {
    writeSettings({ enabled: true, guildIds: ['g1'], approvers: [], inbound: { enabled: true, allowFrom: [] } })
    setStoredSecret('discord', 'botToken', 'tok')
    connected = true
    const result = await checkDeliveryDiscord(runtimeWith('shimmed')) as ObservedLike
    const keys = result.observations?.map(r => r.incident?.key)
    expect(keys).toContain('empty-approvers')
    expect(keys).toContain('empty-inbound-allowlist')
    expect(result.observations?.every(r => r.incident?.class === 'policy_denial')).toBe(true)
  })

  it('skips the inbound notice when inbound chat is off', async () => {
    writeSettings({ enabled: true, guildIds: ['g1'], approvers: ['u1'], inbound: { enabled: false, allowFrom: [] } })
    setStoredSecret('discord', 'botToken', 'tok')
    connected = true
    const result = await checkDeliveryDiscord(runtimeWith('shimmed')) as ObservedLike
    expect(result.observations?.map(r => r.incident?.key)).not.toContain('empty-inbound-allowlist')
  })

  it('is healthy when connected with populated allowlists', async () => {
    writeSettings({ enabled: true, guildIds: ['g1'], approvers: ['u1'], inbound: { enabled: true, allowFrom: ['u1'] } })
    setStoredSecret('discord', 'botToken', 'tok')
    connected = true
    const result = await checkDeliveryDiscord(runtimeWith('shimmed')) as ObservedLike
    expect(result.observations?.[0]?.status).toBe('healthy')
  })
})
