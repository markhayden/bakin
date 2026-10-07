/**
 * The FAKE transport (D15): scenarios parse strictly, each behaves as
 * documented, and the gate only engages under BAKIN_DELIVERY_TRANSPORT=fake.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-fake-transport-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../packages/core/src/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

const { parseFakeScenario, createDiscordTransport, sendApiFromTransport, fakeSentMessages, FAKE_SCENARIO_ENV } = await import('../../../src/core/delivery/discord/fake-transport')
const { FAKE_TRANSPORT_ENV } = await import('../../../src/core/delivery')
const { DeliveryError } = await import('../../../packages/core/src/delivery')

describe('fake transport', () => {
  it('parses the documented scenarios and refuses anything else', () => {
    expect(parseFakeScenario(undefined)).toEqual({ kind: 'ready', guildIds: null })
    expect(parseFakeScenario('ready')).toEqual({ kind: 'ready', guildIds: null })
    expect(parseFakeScenario('ready:g1, g2')).toEqual({ kind: 'ready', guildIds: ['g1', 'g2'] })
    expect(parseFakeScenario('reject-401')).toEqual({ kind: 'reject-401' })
    expect(parseFakeScenario('hang')).toEqual({ kind: 'hang' })
    expect(() => parseFakeScenario('explode')).toThrow(/Unknown/)
    expect(FAKE_TRANSPORT_ENV).toBe('BAKIN_DELIVERY_TRANSPORT')
    expect(FAKE_SCENARIO_ENV).toBe('BAKIN_DELIVERY_FAKE')
  })

  it('ready: READY with the listed guilds, two text channels each, guild-level permissions present', async () => {
    process.env[FAKE_SCENARIO_ENV] = 'ready:g1,g2'
    const transport = createDiscordTransport('tok')
    const events: string[] = []
    transport.subscribe((event) => { events.push(event.type) })
    await transport.connect()
    expect(events).toEqual(['ready'])
    expect(transport.status()).toMatchObject({ phase: 'ready', readyGuildIds: ['g1', 'g2'] })
    expect((await transport.fetchGuildChannels('g1')).map((c) => c.name)).toEqual(['general', 'alerts'])
    await expect(transport.fetchGuildChannels('g9')).rejects.toMatchObject({ status: 403 })
    const guilds = await (transport.api as unknown as { users: { getGuilds(): Promise<Array<{ id: string; permissions: string }>> } }).users.getGuilds()
    expect(guilds.map((g) => g.id)).toEqual(['g1', 'g2'])
    expect(BigInt(guilds[0].permissions) & (BigInt(1) << BigInt(11))).not.toBe(BigInt(0))
  })

  it('reject-401: connect fails as auth_failed', async () => {
    process.env[FAKE_SCENARIO_ENV] = 'reject-401'
    const transport = createDiscordTransport('tok')
    const err = await transport.connect().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DeliveryError)
    expect((err as InstanceType<typeof DeliveryError>).kind).toBe('auth_failed')
    expect(transport.status().lastError?.kind).toBe('auth_failed')
  })

  it('hang: never READY until aborted', async () => {
    process.env[FAKE_SCENARIO_ENV] = 'hang'
    const transport = createDiscordTransport('tok')
    const controller = new AbortController()
    const pending = transport.connect({ signal: controller.signal })
    let settled = false
    void pending.then(() => { settled = true }, () => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)
    controller.abort()
    const err = await pending.catch((e: unknown) => e)
    expect((err as InstanceType<typeof DeliveryError>).kind).toBe('transport')
  })

  it('sends are recorded in memory and never leave the process', async () => {
    process.env[FAKE_SCENARIO_ENV] = 'ready'
    fakeSentMessages.length = 0
    const api = sendApiFromTransport(createDiscordTransport('tok'))
    const sent = await api.createMessage('g101', { content: 'hello' })
    expect(sent.id).toBe('fake-1')
    expect(fakeSentMessages).toEqual([{ channelId: 'g101', content: 'hello', at: expect.any(String) }])
  })
})
