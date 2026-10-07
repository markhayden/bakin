/**
 * /api/channels (spec §4.5) over the real bridge + the FAKE transport (D15):
 * snapshot, reconnect (409 on native, 202, join, ?wait=1), verify (409 while
 * connecting, per-state item matrix, NEVER sends), routing PUT with replace
 * semantics (add / rename / delete survive a reload).
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import fs from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { waitUntil } from '../helpers/wait'

const testDir = join(tmpdir(), `bakin-test-channels-api-${Date.now()}`)
process.env.BAKIN_DELIVERY_TRANSPORT = 'fake'
delete process.env.BAKIN_DELIVERY_FAKE

let fakeRuntime: { name: string; channels?: { list(): Promise<Array<{ id: string; platform: string; label: string; capabilities: string[] }>> } } | undefined
const targetedRuns: string[][] = []

mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../src/core/audit', () => ({ appendAudit: () => {} }))
mock.module('../../src/core/execution-ledger', () => ({ getIdempotent: () => null, putIdempotent: () => {} }))
mock.module('../../src/core/sse', () => ({ broadcast: () => {} }))
mock.module('../../src/core/app-services-store', () => ({
  maybeGetAppServices: () => (fakeRuntime ? { runtime: fakeRuntime } : undefined),
  getAppServices: () => { throw new Error('no services') },
  setAppServices: () => {},
}))
mock.module('../../src/core/doctor-execution', () => ({
  runTargetedDiagnostics: async (ids: readonly string[]) => {
    targetedRuns.push([...ids])
    return { checks: [{ checkId: 'health.delivery-discord', latestValidSnapshot: { observations: [{ status: 'healthy', summary: 'Discord bridge is connected (1 guild).' }] } }] }
  },
}))

const { reconcileDeliveryBridge, shutdownDeliveryBridge, resetDeliveryBridgeForTests, getDeliveryBridge } = await import('../../src/core/delivery')
const { startChannelReadiness, resetChannelReadinessForTests, getChannelReadiness } = await import('../../src/core/delivery/readiness')
const { fakeSentMessages } = await import('../../src/core/delivery/discord/fake-transport')
const { handler } = await import('../../packages/host/src/api/channels')
const { resetSettingsCache, updateSettings, getSettings } = await import('../../packages/core/src/settings')
const { setStoredSecret } = await import('../../packages/core/src/media/secret-store')

const runtime = (mode: 'native' | 'unavailable') => ({ capabilities: async () => ({ delivery: { mode } }) })
const call = (method: string, path: string, body?: unknown) => {
  const url = new URL(`http://bakin.test${path}`)
  return handler(new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) }), url)
}

describe('/api/channels', () => {
  beforeEach(async () => {
    resetChannelReadinessForTests()
    await shutdownDeliveryBridge()
    resetDeliveryBridgeForTests()
    fs.rmSync(testDir, { recursive: true, force: true })
    fs.mkdirSync(testDir, { recursive: true })
    delete process.env.DISCORD_BOT_TOKEN
    delete process.env.BAKIN_DELIVERY_FAKE
    resetSettingsCache()
    fakeRuntime = { name: 'pi' }
    targetedRuns.length = 0
    fakeSentMessages.length = 0
  })
  afterAll(async () => {
    resetChannelReadinessForTests()
    await shutdownDeliveryBridge()
    delete process.env.BAKIN_DELIVERY_TRANSPORT
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  async function bootConfigured(mode: 'native' | 'unavailable' = 'unavailable', guildIds = ['g1']) {
    updateSettings({ integrations: { discord: { enabled: true, guildIds } } })
    setStoredSecret('discord', 'botToken', 'tok-1')
    await reconcileDeliveryBridge(runtime(mode), 'boot')
    await startChannelReadiness()
    if (mode === 'unavailable') await waitUntil(() => getChannelReadiness().connection.state === 'connected', { label: 'connected' })
  }

  it('GET returns the snapshot; ?refresh=1 collects first', async () => {
    updateSettings({ integrations: { discord: { enabled: true, guildIds: ['g1'] } } })
    await reconcileDeliveryBridge(runtime('unavailable'), 'boot')
    await startChannelReadiness()
    const res = await call('GET', '/api/channels')
    expect(res.status).toBe(200)
    expect((await res.json()).connection.state).toBe('missing_token')
    const refreshed = await call('GET', '/api/channels?refresh=1')
    expect((await refreshed.json()).connection.state).toBe('missing_token')
    expect((await call('GET', '/api/channels/nope')).status).toBe(404)
  })

  it('reconnect: 409 owner_is_runtime on a native runtime', async () => {
    fakeRuntime = { name: 'openclaw', channels: { list: async () => [] } }
    await bootConfigured('native')
    const res = await call('POST', '/api/channels/reconnect')
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('owner_is_runtime')
  })

  it('reconnect: 202 with the connecting snapshot; ?wait=1 returns the settled snapshot', async () => {
    await bootConfigured()
    process.env.BAKIN_DELIVERY_FAKE = 'hang'
    const res = await call('POST', '/api/channels/reconnect')
    expect(res.status).toBe(202)
    expect((await res.json()).readiness.connection.state).toBe('connecting')
    // A second request JOINS the running loop (no 409, no new attempt — D7).
    expect((await call('POST', '/api/channels/reconnect')).status).toBe(202)
    delete process.env.BAKIN_DELIVERY_FAKE
    // A configuration change supersedes the hung attempt (abort → fresh attempt that READYs);
    // ?wait=1 then returns the settled snapshot.
    updateSettings({ integrations: { discord: { guildIds: ['g1', 'g2'] } } })
    const waited = await call('POST', '/api/channels/reconnect?wait=1')
    expect(waited.status).toBe(200)
    expect((await waited.json()).readiness.connection.state).toBe('connected')
  })

  it('verify: 409 while connecting', async () => {
    await bootConfigured()
    process.env.BAKIN_DELIVERY_FAKE = 'hang'
    await call('POST', '/api/channels/reconnect')
    const res = await call('POST', '/api/channels/verify')
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('connecting')
    delete process.env.BAKIN_DELIVERY_FAKE
    updateSettings({ integrations: { discord: { guildIds: ['g1', 'g2'] } } })   // supersedes the hung attempt
    await getDeliveryBridge().reconcile('operator')
    expect(getChannelReadiness().connection.state).toBe('connected')
  })

  it('verify on a connected bridge: gateway/guild/channels/routing/health items, nothing sent, health reran', async () => {
    updateSettings({
      notifications: { channel: 'discord:channel:g101', channelAliases: { alerts: 'discord:channel:g102', bad: 'discord:channel:1' } },
      approvals: { channelAlerts: false, channel: 'alerts' },
    })
    await bootConfigured('unavailable', ['g1', 'g2'])
    const res = await call('POST', '/api/channels/verify')
    expect(res.status).toBe(200)
    const { items, readiness } = await res.json()
    const byKey = Object.fromEntries(items.map((i: { key: string; status: string; summary: string }) => [i.key, i]))
    expect(byKey.gateway.status).toBe('pass')
    expect(byKey['guild:g1'].status).toBe('pass')
    expect(byKey['guild:g1'].detail).toMatch(/Guild-level permissions only/)
    expect(byKey['channels:g1'].status).toBe('pass')
    expect(byKey['routing:notifications.channel'].status).toBe('pass')
    expect(byKey['routing:approvals.channel']).toMatchObject({ status: 'skipped', summary: 'Approval alerts are disabled.' })
    expect(byKey['routing:notifications.channelAliases.alerts'].status).toBe('pass')
    expect(byKey['routing:notifications.channelAliases.bad'].status).toBe('fail')
    expect(byKey.health.status).toBe('pass')
    expect(targetedRuns).toEqual([['health.delivery-discord', 'health.channel-aliases', 'health.channel-approvals']])
    expect(fakeSentMessages).toHaveLength(0)
    expect(readiness.connection.state).toBe('connected')
  })

  it('verify in a configuration gap: every item skipped with the remediation, nothing sent', async () => {
    updateSettings({ integrations: { discord: { enabled: true, guildIds: ['g1'] } }, notifications: { channel: 'discord:channel:g101' } })
    await reconcileDeliveryBridge(runtime('unavailable'), 'boot')
    await startChannelReadiness()
    const { items } = await (await call('POST', '/api/channels/verify')).json()
    const nonHealth = items.filter((i: { key: string }) => i.key !== 'health')
    expect(nonHealth.every((i: { status: string }) => i.status === 'skipped')).toBe(true)
    expect(nonHealth[0].summary).toMatch(/bot token is missing/)
    expect(fakeSentMessages).toHaveLength(0)
  })

  it('verify on a native runtime uses the runtime list and needs no Bakin token', async () => {
    fakeRuntime = { name: 'openclaw', channels: { list: async () => [{ id: 'discord', platform: 'discord', label: 'Discord', capabilities: ['message'] }] } }
    updateSettings({ integrations: { discord: { enabled: false } }, notifications: { channel: 'discord:channel:1' } })
    await reconcileDeliveryBridge(runtime('native'), 'boot')
    await startChannelReadiness()
    const { items } = await (await call('POST', '/api/channels/verify')).json()
    const byKey = Object.fromEntries(items.map((i: { key: string; status: string }) => [i.key, i]))
    expect(byKey.gateway.status).toBe('skipped')
    expect(byKey['channels:runtime'].status).toBe('pass')
    expect(byKey['routing:notifications.channel'].status).toBe('pass')
    expect(fakeSentMessages).toHaveLength(0)
  })

  it('routing PUT: validates, replaces the alias map wholesale (add / rename / delete survive a reload)', async () => {
    await bootConfigured()
    const bad = await call('PUT', '/api/channels/routing', { alertChannel: null, approvalsEnabled: true, approvalsChannel: null, aliases: { 'Bad Name': 'x' } })
    expect(bad.status).toBe(400)

    const add = await call('PUT', '/api/channels/routing', { alertChannel: 'discord:channel:g101', approvalsEnabled: true, approvalsChannel: 'alerts', aliases: { alerts: 'discord:channel:g102', daily: 'discord:channel:g101' } })
    expect(add.status).toBe(200)
    expect(getSettings().notifications.channelAliases).toEqual({ alerts: 'discord:channel:g102', daily: 'discord:channel:g101' })
    expect(getSettings().approvals).toMatchObject({ channelAlerts: true, channel: 'alerts' })

    const renamed = await call('PUT', '/api/channels/routing', { alertChannel: 'discord:channel:g101', approvalsEnabled: true, approvalsChannel: 'alerts', aliases: { alerts: 'discord:channel:g102', 'daily-digest': 'discord:channel:g101' } })
    expect((await renamed.json()).readiness.routing.aliases.map((a: { setting: string }) => a.setting)).toEqual([
      'notifications.channelAliases.alerts', 'notifications.channelAliases.daily-digest',
    ])

    await call('PUT', '/api/channels/routing', { alertChannel: null, approvalsEnabled: false, approvalsChannel: null, aliases: {} })
    resetSettingsCache()   // simulate a reload from disk
    expect(getSettings().notifications.channelAliases).toEqual({})
    expect(getSettings().notifications.channel).toBe('')
    const after = await (await call('GET', '/api/channels')).json()
    expect(after.routing.aliases).toEqual([])
    expect(after.routing.alertChannel.resolved).toBe('unset')
  })
})
