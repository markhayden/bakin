/**
 * adapter-pi ↔ delivery bridge delegation (#669, reshaped by #908 D5): the
 * channels surface is PERMANENT whenever a bridge handle is threaded —
 * configured or not — so consumers that feature-detect at activation keep
 * working when the token arrives later. `delivery.mode` still tells the
 * truth about configuration; credentialStatus().channels reports the
 * bridge's enumerated channels only once it is applied.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join as pathJoin } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// Env BEFORE imports: the pi adapter reads PI_HOME at module-load time.
const testDir = pathJoin(tmpdir(), `bakin-test-pi-bridge-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = pathJoin(testDir, 'pi')
process.env.BAKIN_HOME = testDir

mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import type { BridgeStatus, ChannelBridge } from '../../packages/core/src/delivery'
import { DeliveryError } from '../../packages/core/src/delivery'
import { createPiRuntimeAdapter } from '../../packages/adapter-pi/src/index'

function fakeBridge(configured: boolean, state: BridgeStatus['state'] = 'idle'): ChannelBridge {
  const status: BridgeStatus = {
    state,
    since: '2026-10-06T00:00:00.000Z',
    lastError: null,
    joinedGuildIds: state === 'connected' ? ['g1'] : [],
    guildResults: [],
    generation: 0,
  }
  const applied = state === 'connected' || state === 'degraded'
  const gate = <T>(value: T) => async () => {
    if (!applied) throw new DeliveryError(configured ? 'not_connected' : 'not_configured', 'bridge not applied', { state: configured ? 'failed' : 'missing_token' })
    return value
  }
  return {
    isConfigured: () => configured,
    status: () => status,
    reconcile: async () => status,
    subscribe: () => () => {},
    shutdown: async () => {},
    channels: {
      list: gate([{ id: 'discord:channel:1', platform: 'discord', label: '#general', capabilities: ['message'] }]),
      sendNotification: gate({ deliveries: [] }),
      sendMessage: gate({ deliveries: [] }),
      deliverContent: gate({ deliveries: [] }),
      createApproval: gate({ deliveries: [] }),
      editApproval: gate({ deliveries: [] }),
      cancelApproval: gate(undefined),
      resolveApproval: gate(undefined),
      subscribeApprovalResponses: () => () => {},
    },
  }
}

describe('adapter-pi channel bridge delegation (#669 / #908)', () => {
  it('configured + connected: channels present, delivery shimmed, credentialStatus lists the enumerated channels', async () => {
    const adapter = createPiRuntimeAdapter()
    await adapter.initialize({ contentDir: testDir, channelBridge: fakeBridge(true, 'connected') })
    expect(adapter.channels).toBeDefined()
    expect((await adapter.channels!.list())[0].id).toBe('discord:channel:1')
    expect((await adapter.capabilities()).delivery.mode).toBe('shimmed')
    expect((await adapter.credentialStatus()).channels).toEqual(['#general'])
  })

  it('UNCONFIGURED: the surface is still present (permanent), delivery is unavailable, members throw a typed not_configured, credentials list no channels', async () => {
    const adapter = createPiRuntimeAdapter()
    await adapter.initialize({ contentDir: testDir, channelBridge: fakeBridge(false) })
    expect(adapter.channels).toBeDefined()
    expect((await adapter.capabilities()).delivery.mode).toBe('unavailable')
    const err = await adapter.channels!.list().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DeliveryError)
    expect((err as DeliveryError).kind).toBe('not_configured')
    expect((await adapter.credentialStatus()).channels).toEqual([])
    // Subscribe members never throw — consumers wire them at activation.
    expect(typeof adapter.channels!.subscribeApprovalResponses(() => {})).toBe('function')
  })

  it('configured but not yet applied: shimmed claim, surface present, members throw not_connected, no credential channels', async () => {
    const adapter = createPiRuntimeAdapter()
    await adapter.initialize({ contentDir: testDir, channelBridge: fakeBridge(true, 'failed') })
    expect(adapter.channels).toBeDefined()
    expect((await adapter.capabilities()).delivery.mode).toBe('shimmed')
    const err = await adapter.channels!.sendMessage({ channels: ['discord:channel:1'], message: { body: 'x' } }).catch((e: unknown) => e)
    expect((err as DeliveryError).kind).toBe('not_connected')
    expect((await adapter.credentialStatus()).channels).toEqual([])
  })

  it('omits channels + delivery unavailable when no bridge is threaded at all', async () => {
    const adapter = createPiRuntimeAdapter()
    await adapter.initialize({ contentDir: testDir })
    expect(adapter.channels).toBeUndefined()
    expect((await adapter.capabilities()).delivery.mode).toBe('unavailable')
    expect((await adapter.credentialStatus()).channels).toEqual([])
  })
})
