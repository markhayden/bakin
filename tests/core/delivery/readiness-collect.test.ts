/**
 * Readiness collector (spec §4.1 collector): the snapshot follows the real
 * bridge (over the FAKE transport, D15), keeps `since` stable across
 * refreshes, resolves routing against the known channel list, collects a
 * native runtime's list under a budget with stale-beats-broken, coalesces
 * refreshes, and pushes `channels.readiness` over SSE.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import fs from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { waitUntil } from '../../helpers/wait'

const testDir = join(tmpdir(), `bakin-test-readiness-collect-${Date.now()}`)
process.env.BAKIN_DELIVERY_TRANSPORT = 'fake'
delete process.env.BAKIN_DELIVERY_FAKE

const broadcasts: Array<Record<string, unknown>> = []
let fakeRuntime: { name: string; channels?: { list(): Promise<Array<{ id: string; platform: string; label: string; capabilities: string[] }>> } } | undefined

mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../src/core/audit', () => ({ appendAudit: () => {} }))
mock.module('../../../src/core/execution-ledger', () => ({ getIdempotent: () => null, putIdempotent: () => {} }))
mock.module('../../../src/core/sse', () => ({ broadcast: (data: Record<string, unknown>) => { broadcasts.push(data) } }))
mock.module('../../../src/core/app-services-store', () => ({
  maybeGetAppServices: () => (fakeRuntime ? { runtime: fakeRuntime } : undefined),
  getAppServices: () => { throw new Error('no services') },
  setAppServices: () => {},
}))

const { reconcileDeliveryBridge, shutdownDeliveryBridge, resetDeliveryBridgeForTests } = await import('../../../src/core/delivery')
const {
  getChannelReadiness,
  refreshChannelReadiness,
  rebuildChannelReadiness,
  startChannelReadiness,
  resetChannelReadinessForTests,
  subscribeChannelReadiness,
  NATIVE_LIST_BUDGET_MS,
} = await import('../../../src/core/delivery/readiness')
const { resetSettingsCache, updateSettings, replaceSettingsValue } = await import('../../../packages/core/src/settings')
const { setStoredSecret } = await import('../../../packages/core/src/media/secret-store')

const runtime = (mode: 'native' | 'unavailable') => ({ capabilities: async () => ({ delivery: { mode } }) })

describe('channel readiness collector', () => {
  beforeEach(async () => {
    resetChannelReadinessForTests()
    await shutdownDeliveryBridge()
    resetDeliveryBridgeForTests()
    fs.rmSync(testDir, { recursive: true, force: true })
    fs.mkdirSync(testDir, { recursive: true })
    delete process.env.DISCORD_BOT_TOKEN
    delete process.env.BAKIN_DELIVERY_FAKE
    resetSettingsCache()
    broadcasts.length = 0
    fakeRuntime = { name: 'pi' }
  })
  afterAll(async () => {
    resetChannelReadinessForTests()
    await shutdownDeliveryBridge()
    delete process.env.BAKIN_DELIVERY_TRANSPORT
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it('reports missing_token with the copy-table remediation, token presence without the value, and owner bridge', async () => {
    updateSettings({ integrations: { discord: { enabled: true, guildIds: ['g1'] } } })
    await reconcileDeliveryBridge(runtime('unavailable'), 'boot')
    await startChannelReadiness()
    const readiness = getChannelReadiness()
    expect(readiness.connection.state).toBe('missing_token')
    expect(readiness.owner).toBe('bridge')
    expect(readiness.enabled).toBe(true)
    expect(readiness.token).toEqual({ present: false, source: null })
    expect(readiness.guilds).toEqual([{ id: 'g1', joined: null, channelCount: null }])
    expect(readiness.remediation).toMatchObject({ action: 'add_token', href: '/settings?tab=channels' })
    expect(readiness.channels.source).toBe('none')
    expect(readiness.routing.alertChannel.resolved).toBe('unset')
  })

  it('follows the bridge to connected: channels from the cache, routing resolved, SSE plugin-event per publish', async () => {
    updateSettings({
      integrations: { discord: { enabled: true, guildIds: ['g1'] } },
      notifications: { channel: 'discord:channel:g101', channelAliases: { alerts: 'discord:channel:g102', bogus: 'discord:channel:999' } },
      approvals: { channelAlerts: true, channel: 'alerts' },
    })
    setStoredSecret('discord', 'botToken', 'tok-1')
    await startChannelReadiness()
    await reconcileDeliveryBridge(runtime('unavailable'), 'boot')
    await waitUntil(() => getChannelReadiness().connection.state === 'connected', { label: 'connected snapshot' })
    const readiness = getChannelReadiness()
    expect(readiness.channels.source).toBe('bridge')
    expect(readiness.channels.items.map((c) => c.id)).toEqual(['discord:channel:g101', 'discord:channel:g102'])
    expect(readiness.connection.botUser).toEqual({ id: 'fake-bot', name: 'Fake Bot' })
    expect(readiness.routing.alertChannel).toMatchObject({ resolved: 'ok', channelId: 'discord:channel:g101' })
    expect(readiness.routing.approvalsChannel).toMatchObject({ value: 'alerts', resolved: 'ok', channelId: 'discord:channel:g102' })
    expect(readiness.routing.aliases.find((a) => a.setting.endsWith('.bogus'))).toMatchObject({ resolved: 'unknown_channel' })
    expect(readiness.remediation).toBeNull()
    expect(JSON.stringify(readiness)).not.toContain('tok-1')
    const events = broadcasts.filter((b) => b.type === 'plugin-event' && b.event === 'channels.readiness')
    expect(events.length).toBeGreaterThan(0)
    expect((events.at(-1)!.readiness as { connection: { state: string } }).connection.state).toBe('connected')
  })

  it('keeps `since` across refreshes while the state is unchanged and resets it on a transition', async () => {
    updateSettings({ integrations: { discord: { enabled: true, guildIds: ['g1'] } } })
    await reconcileDeliveryBridge(runtime('unavailable'), 'boot')
    await startChannelReadiness()
    const first = await refreshChannelReadiness('test')
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await refreshChannelReadiness('test')
    expect(second.connection.since).toBe(first.connection.since)
    expect(second.generatedAt).not.toBe(first.generatedAt)
    setStoredSecret('discord', 'botToken', 'tok-1')
    await waitUntil(() => getChannelReadiness().connection.state === 'connected', { label: 'connected after token' })
    expect(getChannelReadiness().connection.since).not.toBe(first.connection.since)
  })

  it('native runtime: owner runtime, the runtime list is collected, stale beats broken, budget enforced', async () => {
    let fail = false
    let slow = false
    fakeRuntime = {
      name: 'openclaw',
      channels: {
        list: async () => {
          if (slow) await new Promise((resolve) => setTimeout(resolve, NATIVE_LIST_BUDGET_MS + 200))
          if (fail) throw new Error('gateway down')
          return [{ id: 'discord', platform: 'discord', label: 'Discord', capabilities: ['message'] }]
        },
      },
    }
    updateSettings({ integrations: { discord: { enabled: true, guildIds: ['g1'] } }, notifications: { channel: 'discord:channel:1' } })
    await reconcileDeliveryBridge(runtime('native'), 'boot')
    const readiness = await refreshChannelReadiness('test')
    expect(readiness.owner).toBe('runtime')
    expect(readiness.connection.state).toBe('native')
    expect(readiness.channels.source).toBe('runtime')
    expect(readiness.channels.items.map((c) => c.id)).toEqual(['discord'])
    expect(readiness.routing.alertChannel).toMatchObject({ resolved: 'ok' })   // provider prefix match
    const collectedAt = readiness.channels.collectedAt

    fail = true
    const stale = await refreshChannelReadiness('test')
    expect(stale.channels.items.map((c) => c.id)).toEqual(['discord'])
    expect(stale.channels.collectedAt).toBe(collectedAt)
    expect(stale.channels.error?.kind).toBe('transport')

    fail = false
    slow = true
    const budgeted = await refreshChannelReadiness('test')
    expect(budgeted.channels.error?.kind).toBe('timeout')
  }, 10_000)

  it('coalesces concurrent refreshes into one in flight plus one queued', async () => {
    let calls = 0
    fakeRuntime = { name: 'openclaw', channels: { list: async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return [] } } }
    await reconcileDeliveryBridge(runtime('native'), 'boot')
    const a = refreshChannelReadiness('a')
    const b = refreshChannelReadiness('b')
    const c = refreshChannelReadiness('c')
    expect(b).toBe(a)
    expect(c).toBe(a)
    await a
    expect(calls).toBe(2)
  })

  it('notifies subscribers with stateChanged / routingChanged and a settings write refreshes routing', async () => {
    updateSettings({ integrations: { discord: { enabled: false } } })
    await reconcileDeliveryBridge(runtime('unavailable'), 'boot')
    await startChannelReadiness()
    await refreshChannelReadiness('test')
    const changes: Array<{ stateChanged: boolean; routingChanged: boolean }> = []
    const off = subscribeChannelReadiness((change) => { changes.push({ stateChanged: change.stateChanged, routingChanged: change.routingChanged }) })
    replaceSettingsValue('notifications.channelAliases', { daily: 'discord:channel:5' })
    await waitUntil(() => changes.some((c) => c.routingChanged), { label: 'routing change published' })
    expect(changes.at(-1)).toEqual({ stateChanged: false, routingChanged: true })
    expect(getChannelReadiness().routing.aliases.map((a) => a.setting)).toEqual(['notifications.channelAliases.daily'])
    const before = changes.length
    rebuildChannelReadiness()
    expect(changes.length).toBe(before + 1)
    expect(changes.at(-1)).toEqual({ stateChanged: false, routingChanged: false })
    off()
  })
})
