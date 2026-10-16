/**
 * Transport status model (channel-readiness spec §4.2): shard listeners are
 * attached at construction, a fatal close rejects the READY gate immediately
 * with the real cause, a REST 401 classifies as auth_failed, the timer as
 * timeout, and our own teardown never echoes. @discordjs is replaced by a
 * fake manager — no sockets, no live Discord.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { EventEmitter } from 'events'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-delivery-status-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

// ── fake @discordjs stack ─────────────────────────────────────────────────

class FakeManager extends EventEmitter {
  static instances: FakeManager[] = []
  static connectImpl: (manager: FakeManager) => Promise<void> = async () => {}
  destroyed = 0
  constructor(public readonly options: { token: string; intents: number }) {
    super()
    FakeManager.instances.push(this)
  }
  connect(): Promise<void> {
    return FakeManager.connectImpl(this)
  }
  async destroy(): Promise<void> {
    this.destroyed += 1
  }
}

mock.module('@discordjs/ws', () => ({
  WebSocketManager: FakeManager,
  WebSocketShardEvents: { Closed: 'closed', Error: 'error', Ready: 'ready', Resumed: 'resumed', Dispatch: 'dispatch' },
}))
mock.module('@discordjs/core', () => ({
  Client: class { api = {}; on() {} ; once() {} },
  GatewayDispatchEvents: { Ready: 'READY', InteractionCreate: 'INTERACTION_CREATE', MessageCreate: 'MESSAGE_CREATE' },
  GatewayIntentBits: { Guilds: 1, GuildMessages: 2, DirectMessages: 4, MessageContent: 8 },
}))
mock.module('@discordjs/rest', () => ({
  REST: class { setToken() { return this } },
}))

const { createDiscordTransport } = await import('../../../src/core/delivery/discord/client')
const { DeliveryError } = await import('../../../packages/core/src/delivery')

const ready = (manager: FakeManager, guildIds = ['g1']) =>
  manager.emit('ready', { user: { id: 'bot', username: 'Margo' }, application: { id: 'app' }, guilds: guildIds.map((id) => ({ id })) }, 0)

describe('Discord transport status', () => {
  beforeEach(() => {
    FakeManager.instances.length = 0
    FakeManager.connectImpl = async () => {}
  })

  it('resolves on READY and reports phase, bot user, and guild ids', async () => {
    const transport = createDiscordTransport('tok-A')
    const manager = FakeManager.instances[0]
    const pending = transport.connect()
    ready(manager, ['g1', 'g2'])
    await pending
    expect(transport.status()).toMatchObject({ phase: 'ready', botUser: { id: 'bot', name: 'Margo' }, readyGuildIds: ['g1', 'g2'], lastCloseCode: null, lastError: null })
    expect(transport.applicationId()).toBe('app')
    expect(manager.options.token).toBe('tok-A')
  })

  it('a 4004 close before READY rejects immediately as auth_failed and destroys the manager', async () => {
    FakeManager.connectImpl = (manager) => new Promise<void>(() => { queueMicrotask(() => { manager.emit('closed', 4004, 0); manager.emit('error', new Error('Authentication failed'), 0) }) })
    const transport = createDiscordTransport('tok-A')
    const err = await transport.connect().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DeliveryError)
    expect((err as InstanceType<typeof DeliveryError>).kind).toBe('auth_failed')
    expect(transport.status()).toMatchObject({ phase: 'closed', lastCloseCode: 4004 })
    expect(transport.status().lastError?.kind).toBe('auth_failed')
    expect(FakeManager.instances[0].destroyed).toBe(1)
  })

  it('a 4014 close classifies as intents', async () => {
    FakeManager.connectImpl = (manager) => new Promise<void>(() => { queueMicrotask(() => manager.emit('closed', 4014, 0)) })
    const transport = createDiscordTransport('tok-A')
    const err = await transport.connect().catch((e: unknown) => e)
    expect((err as InstanceType<typeof DeliveryError>).kind).toBe('intents')
  })

  it('a REST 401 from gateway.connect() (bogus token) classifies as auth_failed and never carries the token', async () => {
    FakeManager.connectImpl = async () => { const e = new Error('Unauthorized: https://discord.com/api/v10/gateway/bot tok-A') as Error & { status: number }; e.status = 401; throw e }
    const transport = createDiscordTransport('tok-A')
    const err = await transport.connect().catch((e: unknown) => e)
    expect((err as InstanceType<typeof DeliveryError>).kind).toBe('auth_failed')
    expect((err as Error).message).not.toContain('tok-A')
    expect(FakeManager.instances[0].destroyed).toBe(1)
  })

  it('no READY within the deadline classifies as timeout', async () => {
    const transport = createDiscordTransport('tok-A', { readyTimeoutMs: 15 })
    const err = await transport.connect().catch((e: unknown) => e)
    expect((err as InstanceType<typeof DeliveryError>).kind).toBe('timeout')
    expect(FakeManager.instances[0].destroyed).toBe(1)
  })

  it('an abort signal rejects as transport and destroys the manager', async () => {
    const controller = new AbortController()
    const transport = createDiscordTransport('tok-A')
    const pending = transport.connect({ signal: controller.signal })
    controller.abort()
    const err = await pending.catch((e: unknown) => e)
    expect((err as InstanceType<typeof DeliveryError>).kind).toBe('transport')
    expect(FakeManager.instances[0].destroyed).toBe(1)
  })

  it('after READY: a non-fatal close emits closed{fatal:false} and resumed restores ready', async () => {
    const transport = createDiscordTransport('tok-A')
    const manager = FakeManager.instances[0]
    const events: string[] = []
    transport.subscribe((event) => { events.push(event.type === 'closed' ? `closed:${event.code}:${event.fatal}` : event.type) })
    const pending = transport.connect()
    ready(manager)
    await pending
    manager.emit('closed', 1006, 0)
    expect(transport.status().phase).toBe('disconnected')
    manager.emit('resumed', 0)
    expect(transport.status().phase).toBe('ready')
    expect(events).toEqual(['ready', 'closed:1006:false', 'resumed'])
  })

  it('after READY: a fatal close emits error with the typed cause', async () => {
    const transport = createDiscordTransport('tok-A')
    const manager = FakeManager.instances[0]
    const errors: string[] = []
    transport.subscribe((event) => { if (event.type === 'error') errors.push(event.error.kind) })
    const pending = transport.connect()
    ready(manager)
    await pending
    manager.emit('closed', 4004, 0)
    manager.emit('error', new Error('Authentication failed'), 0)
    expect(errors).toEqual(['auth_failed'])
    expect(transport.status().phase).toBe('closed')
  })

  it('our own destroy() is idempotent and suppresses the closed echo', async () => {
    const transport = createDiscordTransport('tok-A')
    const manager = FakeManager.instances[0]
    const events: string[] = []
    transport.subscribe((event) => { events.push(event.type) })
    const pending = transport.connect()
    ready(manager)
    await pending
    await transport.destroy()
    await transport.destroy()
    expect(manager.destroyed).toBe(1)
    manager.emit('closed', 1000, 0)
    expect(events).toEqual(['ready'])
    expect(transport.status().phase).toBe('closed')
  })

  it('a manager error with a non-fatal code never throws (the listener is attached at construction)', () => {
    createDiscordTransport('tok-A')
    const manager = FakeManager.instances[0]
    expect(() => manager.emit('error', new Error('socket hiccup'), 0)).not.toThrow()
  })
})
