/**
 * Reconciliation loop (channel-readiness spec §4.2): the bridge converges on
 * the LATEST configuration, one attempt at a time, with a controllable fake
 * transport. The six race scenarios from the spec plus the transport-event
 * folds. No live Discord anywhere.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import fs from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { waitUntil } from '../../helpers/wait'

const testDir = join(tmpdir(), `bakin-test-delivery-reconcile-${Date.now()}`)
const infoLines: Array<{ message: string; data?: Record<string, unknown> }> = []
const audits: Array<{ event: string; data: Record<string, unknown> }> = []

mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: (message: string, data?: Record<string, unknown>) => { infoLines.push({ message, data }) },
    warn: () => {}, error: () => {}, debug: () => {},
  }),
}))
mock.module('../../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../src/core/audit', () => ({
  appendAudit: (_dir: string, event: string, _agent: string, data: Record<string, unknown>) => { audits.push({ event, data }) },
}))
mock.module('../../../src/core/execution-ledger', () => ({
  getIdempotent: () => null, putIdempotent: () => {},
}))

import { DeliveryError } from '../../../packages/core/src/delivery'
import type { DiscordTransport, TransportEvent } from '../../../src/core/delivery/discord/client'

// ── controllable fake transport ───────────────────────────────────────────

interface FakeTransport extends DiscordTransport {
  token: string
  destroyed: boolean
  ready(opts?: { guildIds?: string[] }): void
  failConnect(err: DeliveryError): void
  emit(event: TransportEvent): void
  guildChannels: Record<string, Array<{ id: string; name: string; type: number }> | Error>
}

const fakes: FakeTransport[] = []

function createFakeTransport(token: string): FakeTransport {
  let phase: 'idle' | 'connecting' | 'ready' | 'disconnected' | 'closed' = 'idle'
  let readyGuildIds: string[] = []
  let gate: { resolve(): void; reject(err: DeliveryError): void } | null = null
  const listeners = new Set<(event: TransportEvent) => void>()
  const fake: FakeTransport = {
    token,
    destroyed: false,
    guildChannels: { g1: [{ id: '11', name: 'general', type: 0 }], g2: [{ id: '22', name: 'ops', type: 0 }] },
    api: {} as never,
    client: {} as never,
    botUserId: () => 'bot',
    applicationId: () => 'app',
    async connect(opts) {
      phase = 'connecting'
      await new Promise<void>((resolve, reject) => {
        gate = { resolve, reject }
        opts?.signal?.addEventListener('abort', () => reject(new DeliveryError('transport', 'Discord connect aborted')), { once: true })
      })
    },
    async destroy() { fake.destroyed = true; phase = 'closed' },
    status: () => ({ phase, botUser: { id: 'bot', name: 'Margo' }, readyGuildIds, lastCloseCode: null, lastError: null }),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async fetchGuildChannels(guildId) {
      const entry = fake.guildChannels[guildId]
      if (entry instanceof Error) throw entry
      if (!entry) { const err = new Error('Unknown Guild') as Error & { status: number }; err.status = 404; throw err }
      return entry
    },
    ready(opts = {}) {
      readyGuildIds = opts.guildIds ?? ['g1']
      phase = 'ready'
      gate?.resolve()
      for (const l of listeners) l({ type: 'ready', guildIds: readyGuildIds, botUser: { id: 'bot', name: 'Margo' } })
    },
    failConnect(err) { phase = 'closed'; gate?.reject(err) },
    emit(event) { for (const l of listeners) l(event) },
  }
  return fake
}

const registerGlobalCommands = mock(async () => {})

mock.module('../../../src/core/delivery/discord/client', () => ({
  createDiscordTransport: (token: string) => { const fake = createFakeTransport(token); fakes.push(fake); return fake },
  sendApiFromTransport: () => ({
    createMessage: async () => ({ id: 'm1' }), editMessage: async () => {}, startThread: async () => ({ id: 't1' }),
    createDM: async () => ({ id: 'dm' }), showTyping: async () => {},
  }),
  approvalApiFromTransport: () => ({
    replyEphemeral: async () => {}, updateComponentMessage: async () => {}, openModal: async () => {}, editMessage: async () => {},
  }),
  subscribeInteractions: () => {},
  subscribeMessages: () => {},
  downloadAttachment: async () => Buffer.alloc(0),
  registerGlobalCommands,
}))

// Imported AFTER the mocks land: the bridge creates its logger at module
// evaluation, so a static import would capture the real one.
const {
  getDeliveryBridge,
  getBridgeIdleReason,
  reconcileDeliveryBridge,
  resetDeliveryBridgeForTests,
  shutdownDeliveryBridge,
} = await import('../../../src/core/delivery')
import { resetSettingsCache, updateSettings } from '../../../packages/core/src/settings'
import { setStoredSecret, unsetStoredSecret } from '../../../packages/core/src/media/secret-store'
import type { BridgeStatus } from '../../../packages/core/src/delivery'

const runtime = (mode: 'native' | 'shimmed' | 'unavailable') => ({ capabilities: async () => ({ delivery: { mode } }) })
const bridge = () => getDeliveryBridge()

function configure(guildIds: string[] = ['g1'], token = 't1'): void {
  updateSettings({ integrations: { discord: { enabled: true, guildIds } } })
  setStoredSecret('discord', 'botToken', token)
}

async function boot(mode: 'native' | 'unavailable' = 'unavailable'): Promise<BridgeStatus> {
  return reconcileDeliveryBridge(runtime(mode), 'boot')
}

describe('delivery bridge reconciliation', () => {
  let published: BridgeStatus[] = []
  let unsubscribe = () => {}

  beforeEach(async () => {
    await shutdownDeliveryBridge()
    resetDeliveryBridgeForTests()
    fs.rmSync(testDir, { recursive: true, force: true })
    fs.mkdirSync(testDir, { recursive: true })
    delete process.env.DISCORD_BOT_TOKEN
    resetSettingsCache()
    fakes.length = 0
    audits.length = 0
    infoLines.length = 0
    published = []
    registerGlobalCommands.mockClear()
    unsubscribe = bridge().subscribe((status) => { published.push(status) })
  })
  afterAll(async () => {
    unsubscribe()
    await shutdownDeliveryBridge()
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it('connects, enumerates every guild, publishes connected, audits once', async () => {
    configure(['g1', 'g2'])
    const pending = boot()
    await waitUntil(() => fakes.length === 1, { label: 'transport created' })
    fakes[0].ready({ guildIds: ['g1', 'g2'] })
    const status = await pending
    expect(status.state).toBe('connected')
    expect(status.joinedGuildIds).toEqual(['g1', 'g2'])
    expect(status.guildResults.map((g) => [g.id, g.joined, g.channelCount])).toEqual([['g1', true, 1], ['g2', true, 1]])
    expect(status.botUser).toEqual({ id: 'bot', name: 'Margo' })
    expect(published.map((s) => s.state)).toEqual(['connecting', 'connected'])
    expect(audits.filter((a) => a.event === 'delivery.reconciling')).toHaveLength(1)
    expect(audits.filter((a) => a.event === 'delivery.connected')).toHaveLength(1)
    expect((await bridge().channels.list()).map((c) => c.id)).toEqual(['discord:channel:11', 'discord:channel:22'])
    await waitUntil(() => registerGlobalCommands.mock.calls.length === 1, { label: 'commands registered post-apply' })
  })

  it('A→B rapid saves while A connects: B wins, A is destroyed and never applied', async () => {
    configure(['g1'], 'tA')
    const p1 = boot()
    await waitUntil(() => fakes.length === 1, { label: 'first transport' })
    setStoredSecret('discord', 'botToken', 'tB')              // armed subscription → reconcile('secret')
    await waitUntil(() => fakes.length === 2, { label: 'second transport after token change' })
    expect(fakes[1].token).toBe('tB')
    fakes[0].ready()                                            // the stale attempt finishes late
    expect(fakes[0].destroyed).toBe(true)
    fakes[1].ready()
    const status = await p1
    expect(status.state).toBe('connected')
    expect(status.generation).toBe(2)
    expect(published.filter((s) => s.state === 'connected')).toHaveLength(1)
    expect(published.filter((s) => s.state === 'connected')[0].generation).toBe(2)
    // connecting → connecting keeps `since` (same state, new attempt)
    const connecting = published.filter((s) => s.state === 'connecting')
    expect(connecting.length).toBeGreaterThanOrEqual(2)
    expect(connecting[0].since).toBe(connecting[1].since)
  })

  it('disable during connect tears the attempt down to idle (disabled); members throw not_configured', async () => {
    configure()
    const p1 = boot()
    await waitUntil(() => fakes.length === 1, { label: 'transport' })
    updateSettings({ integrations: { discord: { enabled: false } } })   // armed → reconcile('settings')
    const status = await p1
    expect(status.state).toBe('idle')
    expect(getBridgeIdleReason()).toBe('disabled')
    expect(fakes[0].destroyed).toBe(true)
    expect(published.map((s) => s.state)).toEqual(['connecting', 'idle'])
    expect(infoLines.filter((l) => l.message === 'Delivery bridge idle').at(-1)?.data?.reason).toBe('disabled')
    const err = await bridge().channels.list().catch((e: unknown) => e)
    expect((err as DeliveryError).kind).toBe('not_configured')
    expect((err as DeliveryError).detail.state).toBe('disabled')
    expect(audits.some((a) => a.event === 'delivery.connect_failed')).toBe(false)
  })

  it('token cleared during connect tears down to idle (missing_token) with no connect_failed audit', async () => {
    configure()
    const p1 = boot()
    await waitUntil(() => fakes.length === 1, { label: 'transport' })
    unsetStoredSecret('discord', 'botToken')
    const status = await p1
    expect(status.state).toBe('idle')
    expect(getBridgeIdleReason()).toBe('missing_token')
    expect(fakes[0].destroyed).toBe(true)
    expect(audits.some((a) => a.event === 'delivery.connect_failed')).toBe(false)
  })

  it('shutdown during reconcile drains, destroys, and refuses to reconnect until the next boot', async () => {
    configure()
    const p1 = boot()
    await waitUntil(() => fakes.length === 1, { label: 'transport' })
    await shutdownDeliveryBridge()
    expect(fakes[0].destroyed).toBe(true)
    expect((await p1).state).toBe('idle')
    expect(bridge().status().state).toBe('idle')
    expect(audits.filter((a) => a.event === 'delivery.disconnected' && a.data.reason === 'shutdown')).toHaveLength(1)

    const afterStop = await bridge().reconcile('settings')
    expect(afterStop.state).toBe('idle')
    expect(fakes).toHaveLength(1)

    const pending = boot()                                       // re-arms and connects
    await waitUntil(() => fakes.length === 2, { label: 'transport after re-boot' })
    fakes[1].ready()
    expect((await pending).state).toBe('connected')
  })

  it('native runtime with a configured bridge stays idle; a runtime reconcile to Pi connects without a restart', async () => {
    configure()
    const native = await boot('native')
    expect(native.state).toBe('idle')
    expect(getBridgeIdleReason()).toBe('native')
    expect(fakes).toHaveLength(0)
    expect(bridge().isConfigured()).toBe(true)

    const pending = reconcileDeliveryBridge(runtime('unavailable'), 'runtime')
    await waitUntil(() => fakes.length === 1, { label: 'transport after runtime switch' })
    fakes[0].ready()
    expect((await pending).state).toBe('connected')

    // And back: switching to a native runtime tears it down immediately.
    const back = await reconcileDeliveryBridge(runtime('native'), 'runtime')
    expect(back.state).toBe('idle')
    expect(fakes[0].destroyed).toBe(true)
  })

  it('operator reconcile joins an in-flight automatic attempt (no abort, no second transport)', async () => {
    configure()
    const p1 = boot()
    await waitUntil(() => fakes.length === 1, { label: 'transport' })
    const p2 = bridge().reconcile('operator')
    expect(fakes).toHaveLength(1)
    fakes[0].ready()
    const [s1, s2] = await Promise.all([p1, p2])
    expect(s1.state).toBe('connected')
    expect(s2.generation).toBe(s1.generation)
    expect(audits.filter((a) => a.event === 'delivery.reconciling')).toHaveLength(1)
  })

  it('operator reconcile on a healthy identical config forces a fresh attempt with no send gap', async () => {
    configure()
    const p1 = boot()
    await waitUntil(() => fakes.length === 1, { label: 'transport' })
    fakes[0].ready()
    await p1
    const p2 = bridge().reconcile('operator')
    await waitUntil(() => fakes.length === 2, { label: 'second transport' })
    // Until the new transport is applied, the OLD one still serves sends.
    expect(fakes[0].destroyed).toBe(false)
    expect((await bridge().channels.list()).length).toBe(1)
    fakes[1].ready()
    expect((await p2).state).toBe('connected')
    expect(fakes[0].destroyed).toBe(true)
  })

  it('an unrelated settings write with an identical Discord block neither reconnects nor audits', async () => {
    configure()
    const p1 = boot()
    await waitUntil(() => fakes.length === 1, { label: 'transport' })
    fakes[0].ready()
    await p1
    audits.length = 0
    updateSettings({ notifications: { channel: 'somewhere' } })
    await bridge().reconcile('settings')
    expect(fakes).toHaveLength(1)
    expect(fakes[0].destroyed).toBe(false)
    expect(audits).toHaveLength(0)
  })

  it('connect failure publishes failed with the typed cause, audits connect_failed, members throw not_connected', async () => {
    configure()
    const p1 = boot()
    await waitUntil(() => fakes.length === 1, { label: 'transport' })
    fakes[0].failConnect(new DeliveryError('auth_failed', 'Discord rejected the bot token (401)', { status: 401 }))
    const status = await p1
    expect(status.state).toBe('failed')
    expect(status.lastError?.kind).toBe('auth_failed')
    expect(status.guildResults).toEqual([{ id: 'g1', joined: null, channelCount: null }])
    expect(fakes[0].destroyed).toBe(true)
    const failed = audits.find((a) => a.event === 'delivery.connect_failed')
    expect(failed?.data.kind).toBe('auth_failed')
    expect(JSON.stringify(audits)).not.toContain('t1')
    const err = await bridge().channels.sendMessage({ channels: ['discord:channel:11'], message: { body: 'x' } }).catch((e: unknown) => e)
    expect((err as DeliveryError).kind).toBe('not_connected')
    expect((err as DeliveryError).detail.state).toBe('failed')
  })

  it('one guild failing enumeration (403) yields degraded with the per-guild error; the other guild still lists', async () => {
    configure(['g1', 'g2'])
    const p1 = boot()
    await waitUntil(() => fakes.length === 1, { label: 'transport' })
    const forbidden = new Error('Missing Access') as Error & { status: number }
    forbidden.status = 403
    fakes[0].guildChannels.g2 = forbidden
    fakes[0].ready({ guildIds: ['g1', 'g2'] })
    const status = await p1
    expect(status.state).toBe('degraded')
    expect(status.guildResults[1]).toMatchObject({ id: 'g2', joined: true, channelCount: null, error: { kind: 'forbidden' } })
    expect((await bridge().channels.list()).map((c) => c.id)).toEqual(['discord:channel:11'])
  })

  it('a configured guild the bot never joined yields degraded', async () => {
    configure(['g1', 'g2'])
    const p1 = boot()
    await waitUntil(() => fakes.length === 1, { label: 'transport' })
    fakes[0].ready({ guildIds: ['g1'] })
    const status = await p1
    expect(status.state).toBe('degraded')
    expect(status.guildResults[1]).toMatchObject({ id: 'g2', joined: false })
  })

  it('post-apply gateway events fold: non-fatal close → disconnected, resumed → connected, fatal error → failed + destroyed', async () => {
    configure()
    const p1 = boot()
    await waitUntil(() => fakes.length === 1, { label: 'transport' })
    fakes[0].ready()
    await p1
    fakes[0].emit({ type: 'closed', code: 1006, fatal: false })
    expect(bridge().status().state).toBe('disconnected')
    expect(bridge().status().lastError?.kind).toBe('transport')
    expect(bridge().status().guildResults).toHaveLength(1)
    fakes[0].emit({ type: 'resumed' })
    expect(bridge().status().state).toBe('connected')
    const err = new DeliveryError('intents', 'Discord refused the gateway intents (close 4014)', { status: 4014 })
    fakes[0].emit({ type: 'error', error: err })
    expect(bridge().status().state).toBe('failed')
    expect(bridge().status().lastError?.kind).toBe('intents')
    expect(fakes[0].destroyed).toBe(true)
    expect(audits.filter((a) => a.event === 'delivery.connect_failed')).toHaveLength(1)
  })

  it('events from a replaced (stale) transport never move the status', async () => {
    configure()
    const p1 = boot()
    await waitUntil(() => fakes.length === 1, { label: 'transport' })
    fakes[0].ready()
    await p1
    const p2 = bridge().reconcile('operator')
    await waitUntil(() => fakes.length === 2, { label: 'second transport' })
    fakes[1].ready()
    await p2
    fakes[0].emit({ type: 'closed', code: 1006, fatal: false })
    expect(bridge().status().state).toBe('connected')
  })
})
