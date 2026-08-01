import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure modules under test — content-dir mocks are the standing isolation
// guard so an accidental future import can never reach ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-delivery-cache-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { channelInfoFromApiChannel } from '../../../src/core/delivery/discord/channel-info'
import { createChannelCache } from '../../../src/core/delivery/discord/channel-cache'

const text = (id: string, name: string) => ({ id, name, type: 0 })
const voice = (id: string, name: string) => ({ id, name, type: 2 })
const announcement = (id: string, name: string) => ({ id, name, type: 5 })

describe('channelInfoFromApiChannel', () => {
  it('maps a guild text channel to a fully-capable ChannelInfo', () => {
    const info = channelInfoFromApiChannel(text('123', 'general'))
    expect(info).not.toBeNull()
    expect(info!.id).toBe('discord:channel:123')
    expect(info!.platform).toBe('discord')
    expect(info!.label).toBe('#general')
    const expected = ['message', 'rich-content', 'interactive-approval', 'modal-input', 'threaded-replies', 'edit-after-send', 'cancel-rendered'] as const
    for (const cap of expected) {
      expect(info!.capabilities).toContain(cap)
    }
    expect(info!.metadata?.approvalResponses).toBe('interactive')
  })

  it('maps announcement channels and skips non-text channels', () => {
    expect(channelInfoFromApiChannel(announcement('5', 'news'))).not.toBeNull()
    expect(channelInfoFromApiChannel(voice('9', 'lounge'))).toBeNull()
  })
})

describe('channel cache', () => {
  it('fetches once, serves cached, aggregates guilds', async () => {
    let calls = 0
    const cache = createChannelCache({
      guildIds: ['g1', 'g2'],
      fetchGuildChannels: async (guildId) => {
        calls += 1
        return guildId === 'g1' ? [text('1', 'a'), voice('2', 'v')] : [text('3', 'b')]
      },
    })
    const first = await cache.list()
    expect(first.map(c => c.id)).toEqual(['discord:channel:1', 'discord:channel:3'])
    expect(calls).toBe(2)
    await cache.list()
    expect(calls).toBe(2) // cached
    await cache.refresh()
    expect(calls).toBe(4)
  })

  it('serves stale cache when a refresh fails, throws when never populated', async () => {
    let fail = false
    const cache = createChannelCache({
      guildIds: ['g1'],
      fetchGuildChannels: async () => {
        if (fail) throw new Error('api down')
        return [text('1', 'a')]
      },
    })
    await cache.list()
    fail = true
    const stale = await cache.refresh()
    expect(stale.map(c => c.id)).toEqual(['discord:channel:1'])

    const empty = createChannelCache({ guildIds: ['g1'], fetchGuildChannels: async () => { throw new Error('down') } })
    await expect(empty.list()).rejects.toThrow('down')
  })
})
