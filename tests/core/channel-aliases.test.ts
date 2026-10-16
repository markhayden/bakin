/**
 * resolveRuntimeChannelRef (#908): a typed DeliveryError from the channel
 * list is the real cause and propagates; an untyped list failure still
 * degrades to an empty known set (aliases resolve, bare names fail with the
 * config hint).
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

const testDir = join(tmpdir(), `bakin-test-channel-aliases-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
const settingsMock = {
  resetSettingsCache: () => {},
  getSettings: () => ({ notifications: { channel: '', target: '', channelAliases: { general: 'discord:channel:1' } } }),
}
mock.module('../../src/core/settings', () => settingsMock)
mock.module('@/core/settings', () => settingsMock)

import { resolveRuntimeChannelRef } from '../../src/core/channel-aliases'
import { DeliveryError } from '../../packages/core/src/delivery'

const runtimeWith = (list: () => Promise<Array<{ id: string }>>) =>
  ({ channels: { list } }) as unknown as Pick<AgentRuntimeAdapter, 'channels'>

describe('resolveRuntimeChannelRef', () => {
  it('propagates a typed DeliveryError from the channel list', async () => {
    const runtime = runtimeWith(async () => { throw new DeliveryError('not_connected', 'bridge is failed', { state: 'failed' }) })
    const err = await resolveRuntimeChannelRef(runtime, 'general').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DeliveryError)
    expect((err as DeliveryError).kind).toBe('not_connected')
  })

  it('degrades an untyped list failure to an empty known set: aliases resolve, bare names fail with the hint', async () => {
    const runtime = runtimeWith(async () => { throw new Error('registry hiccup') })
    expect((await resolveRuntimeChannelRef(runtime, 'general')).resolved).toBe('discord:channel:1')
    await expect(resolveRuntimeChannelRef(runtime, 'daily')).rejects.toThrow(/No channel alias configured for #daily/)
  })

  it('resolves a bare name that the runtime lists', async () => {
    const runtime = runtimeWith(async () => [{ id: 'discord' }])
    expect((await resolveRuntimeChannelRef(runtime, 'discord')).resolved).toBe('discord')
  })

  it('resolves on a runtime without a channel surface', async () => {
    expect((await resolveRuntimeChannelRef({} as Pick<AgentRuntimeAdapter, 'channels'>, 'general')).resolved).toBe('discord:channel:1')
  })
})
