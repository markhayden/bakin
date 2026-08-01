import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure module under test — content-dir mocks are the standing isolation
// guard so an accidental future import can never reach ~/.bakin.
const testDir = join(tmpdir(), `bakin-test-delivery-refs-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))

import { parseDiscordRef, discordChannelRef } from '../../../src/core/delivery/discord/refs'

describe('discord ref parsing', () => {
  it('parses fully-qualified channel refs', () => {
    expect(parseDiscordRef('discord:channel:123')).toEqual({ kind: 'channel', id: '123' })
  })

  it('parses provider-less channel refs (post-alias resolution)', () => {
    expect(parseDiscordRef('channel:123')).toEqual({ kind: 'channel', id: '123' })
  })

  it('parses user (DM) refs with and without provider prefix', () => {
    expect(parseDiscordRef('discord:user:42')).toEqual({ kind: 'user', id: '42' })
    expect(parseDiscordRef('user:42')).toEqual({ kind: 'user', id: '42' })
  })

  it('rejects a bare provider ref with a config hint', () => {
    expect(() => parseDiscordRef('discord')).toThrow(/discord:channel:<id>/)
  })

  it('rejects unknown target kinds', () => {
    expect(() => parseDiscordRef('discord:group:1')).toThrow(/discord:channel:<id>/)
  })

  it('rejects empty ids', () => {
    expect(() => parseDiscordRef('discord:channel:')).toThrow()
  })

  it('builds canonical channel refs', () => {
    expect(discordChannelRef('55')).toBe('discord:channel:55')
  })
})
