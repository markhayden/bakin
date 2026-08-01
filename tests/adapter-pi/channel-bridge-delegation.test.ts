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

import type { ChannelBridge } from '../../packages/core/src/delivery'
import { createPiRuntimeAdapter } from '../../packages/adapter-pi/src/index'

function fakeBridge(configured: boolean): ChannelBridge {
  return {
    isConfigured: () => configured,
    boot: async () => {},
    shutdown: async () => {},
    channels: {
      list: async () => [{ id: 'discord:channel:1', platform: 'discord', label: '#general', capabilities: ['message'] }],
      sendNotification: async () => ({ deliveries: [] }),
      sendMessage: async () => ({ deliveries: [] }),
      deliverContent: async () => ({ deliveries: [] }),
      createApproval: async () => ({ deliveries: [] }),
      editApproval: async () => ({ deliveries: [] }),
      cancelApproval: async () => {},
      resolveApproval: async () => {},
      subscribeApprovalResponses: () => () => {},
    },
  }
}

describe('adapter-pi channel bridge delegation (#669)', () => {
  it('exposes channels + delivery shimmed when the bridge is configured', async () => {
    const adapter = createPiRuntimeAdapter()
    await adapter.initialize({ contentDir: testDir, channelBridge: fakeBridge(true) })
    expect(adapter.channels).toBeDefined()
    const listed = await adapter.channels!.list()
    expect(listed[0].id).toBe('discord:channel:1')
    const caps = await adapter.capabilities()
    expect(caps.delivery.mode).toBe('shimmed')
  })

  it('omits channels + delivery unavailable when the bridge is unconfigured', async () => {
    const adapter = createPiRuntimeAdapter()
    await adapter.initialize({ contentDir: testDir, channelBridge: fakeBridge(false) })
    expect(adapter.channels).toBeUndefined()
    expect((await adapter.capabilities()).delivery.mode).toBe('unavailable')
  })

  it('omits channels when no bridge is threaded at all', async () => {
    const adapter = createPiRuntimeAdapter()
    await adapter.initialize({ contentDir: testDir })
    expect(adapter.channels).toBeUndefined()
    expect((await adapter.capabilities()).delivery.mode).toBe('unavailable')
  })
})
