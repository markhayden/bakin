/**
 * Boot gating (D11, reshaped by #908): the bridge reconciles to the current
 * configuration and the ACTIVE runtime's delivery mode. Native runtimes and
 * every configuration gap end in `idle` with ONE logged reason and no
 * transport module ever imported.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import fs from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-delivery-boot-${Date.now()}`)
const infoLines: Array<{ message: string; data?: Record<string, unknown> }> = []

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
mock.module('../../../src/core/audit', () => ({ appendAudit: () => {} }))
let transportsCreated = 0
mock.module('../../../src/core/delivery/discord/client', () => ({
  createDiscordTransport: () => { transportsCreated += 1; throw new Error('must not be reached') },
  sendApiFromTransport: () => ({}), approvalApiFromTransport: () => ({}),
  subscribeInteractions: () => {}, subscribeMessages: () => {}, downloadAttachment: async () => Buffer.alloc(0),
  registerGlobalCommands: async () => {},
}))

// Imported AFTER the mocks land: the bridge creates its logger at module
// evaluation, so a static import would capture the real one.
const { reconcileDeliveryBridge, shutdownDeliveryBridge, getBridgeIdleReason, resetDeliveryBridgeForTests, getDeliveryBridge } = await import('../../../src/core/delivery')
import { resetSettingsCache, updateSettings } from '../../../packages/core/src/settings'
import { setStoredSecret } from '../../../packages/core/src/media/secret-store'
import { DeliveryError } from '../../../packages/core/src/delivery'

const runtime = (mode: 'native' | 'shimmed' | 'unavailable') => ({ capabilities: async () => ({ delivery: { mode } }) })

describe('delivery bridge boot gating (D11)', () => {
  beforeEach(async () => {
    await shutdownDeliveryBridge()
    resetDeliveryBridgeForTests()
    fs.rmSync(testDir, { recursive: true, force: true })
    fs.mkdirSync(testDir, { recursive: true })
    delete process.env.DISCORD_BOT_TOKEN
    resetSettingsCache()
    infoLines.length = 0
    transportsCreated = 0
  })
  afterAll(async () => {
    await shutdownDeliveryBridge()
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it('unconfigured: idle with reason disabled, no transport, one log line', async () => {
    const status = await reconcileDeliveryBridge(runtime('unavailable'), 'boot')
    expect(status.state).toBe('idle')
    expect(getBridgeIdleReason()).toBe('disabled')
    expect(transportsCreated).toBe(0)
    const idle = infoLines.filter((line) => line.message === 'Delivery bridge idle')
    expect(idle).toHaveLength(1)
    expect(idle[0].data?.reason).toBe('disabled')
  })

  it('enabled without a token: idle with reason missing_token', async () => {
    updateSettings({ integrations: { discord: { enabled: true, guildIds: ['g1'] } } })
    await reconcileDeliveryBridge(runtime('unavailable'), 'boot')
    expect(getBridgeIdleReason()).toBe('missing_token')
    expect(transportsCreated).toBe(0)
  })

  it('enabled with a token but no guild: idle with reason missing_guild', async () => {
    updateSettings({ integrations: { discord: { enabled: true, guildIds: [] } } })
    setStoredSecret('discord', 'botToken', 'tok')
    await reconcileDeliveryBridge(runtime('unavailable'), 'boot')
    expect(getBridgeIdleReason()).toBe('missing_guild')
    expect(transportsCreated).toBe(0)
  })

  it('native runtime beats a fully configured bridge (D14) — idle, reason native', async () => {
    updateSettings({ integrations: { discord: { enabled: true, guildIds: ['g1'] } } })
    setStoredSecret('discord', 'botToken', 'tok')
    const status = await reconcileDeliveryBridge(runtime('native'), 'boot')
    expect(status.state).toBe('idle')
    expect(getBridgeIdleReason()).toBe('native')
    expect(transportsCreated).toBe(0)
    expect(getDeliveryBridge().isConfigured()).toBe(true)
  })

  it('delivering members throw a typed not_configured error carrying the readiness state', async () => {
    updateSettings({ integrations: { discord: { enabled: true, guildIds: ['g1'] } } })
    await reconcileDeliveryBridge(runtime('unavailable'), 'boot')
    const err = await getDeliveryBridge().channels.list().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DeliveryError)
    expect((err as DeliveryError).kind).toBe('not_configured')
    expect((err as DeliveryError).detail.state).toBe('missing_token')
  })

  it('reconcile before any boot is idle with reason runtime_unknown (never connects blind)', async () => {
    updateSettings({ integrations: { discord: { enabled: true, guildIds: ['g1'] } } })
    setStoredSecret('discord', 'botToken', 'tok')
    const status = await getDeliveryBridge().reconcile('settings')
    expect(status.state).toBe('idle')
    expect(getBridgeIdleReason()).toBe('runtime_unknown')
    expect(transportsCreated).toBe(0)
  })
})
