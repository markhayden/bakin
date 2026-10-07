/**
 * Pure readiness classifier + projector (spec §4.1). No I/O, no bridge —
 * every precedence row has a case, native beats every bridge-config fact,
 * and a projection never invents a connection outcome.
 */
import { describe, it, expect, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-readiness-classify-${Date.now()}`)
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

import {
  classifyChannelReadiness,
  projectChannelReadiness,
  readinessOwner,
  type BridgeStatus,
} from '../../../packages/core/src/delivery/readiness'

function bridge(over: Partial<BridgeStatus> = {}): BridgeStatus {
  return {
    state: 'idle',
    since: '2026-10-06T00:00:00.000Z',
    lastError: null,
    joinedGuildIds: [],
    guildResults: [],
    generation: 0,
    ...over,
  }
}

const configured = { deliveryMode: 'shimmed' as const, enabled: true, tokenPresent: true, guildCount: 1 }

describe('classifyChannelReadiness precedence', () => {
  it('native beats every bridge-config fact, even enabled + no token + no guilds', () => {
    expect(classifyChannelReadiness({ deliveryMode: 'native', enabled: true, tokenPresent: false, guildCount: 0, bridge: bridge({ state: 'failed' }) })).toBe('native')
  })

  it('disabled beats missing token', () => {
    expect(classifyChannelReadiness({ deliveryMode: 'unavailable', enabled: false, tokenPresent: false, guildCount: 0, bridge: bridge() })).toBe('disabled')
  })

  it('missing token beats missing guild', () => {
    expect(classifyChannelReadiness({ deliveryMode: 'unavailable', enabled: true, tokenPresent: false, guildCount: 0, bridge: bridge() })).toBe('missing_token')
  })

  it('missing guild when enabled with a token and no guilds', () => {
    expect(classifyChannelReadiness({ deliveryMode: 'unavailable', enabled: true, tokenPresent: true, guildCount: 0, bridge: bridge() })).toBe('missing_guild')
  })

  it('connecting while the bridge reports connecting', () => {
    expect(classifyChannelReadiness({ ...configured, bridge: bridge({ state: 'connecting' }) })).toBe('connecting')
  })

  it('connecting while an attempt is pending on any bridge state', () => {
    expect(classifyChannelReadiness({ ...configured, bridge: bridge({ state: 'failed', attempt: { generation: 2, startedAt: 'x' } }) })).toBe('connecting')
  })

  it('connected only when every configured guild is joined and enumerated', () => {
    const status = bridge({
      state: 'connected',
      joinedGuildIds: ['g1'],
      guildResults: [{ id: 'g1', joined: true, channelCount: 3 }],
    })
    expect(classifyChannelReadiness({ ...configured, bridge: status })).toBe('connected')
  })

  it('degraded when a configured guild is not joined', () => {
    const status = bridge({
      state: 'connected',
      joinedGuildIds: ['g1'],
      guildResults: [
        { id: 'g1', joined: true, channelCount: 3 },
        { id: 'g2', joined: false, channelCount: null },
      ],
    })
    expect(classifyChannelReadiness({ ...configured, guildCount: 2, bridge: status })).toBe('degraded')
  })

  it('degraded when a joined guild failed enumeration', () => {
    const status = bridge({
      state: 'connected',
      joinedGuildIds: ['g1'],
      guildResults: [{ id: 'g1', joined: true, channelCount: null, error: { kind: 'forbidden', message: 'x', at: 'x' } }],
    })
    expect(classifyChannelReadiness({ ...configured, bridge: status })).toBe('degraded')
  })

  it('degraded when the bridge itself says degraded', () => {
    expect(classifyChannelReadiness({ ...configured, bridge: bridge({ state: 'degraded' }) })).toBe('degraded')
  })

  it('disconnected when the gateway dropped', () => {
    expect(classifyChannelReadiness({ ...configured, bridge: bridge({ state: 'disconnected' }) })).toBe('disconnected')
  })

  it('failed when the bridge failed', () => {
    expect(classifyChannelReadiness({ ...configured, bridge: bridge({ state: 'failed' }) })).toBe('failed')
  })

  it('failed (never attempted) when configured but the bridge is idle with no attempt', () => {
    expect(classifyChannelReadiness({ ...configured, bridge: bridge({ state: 'idle' }) })).toBe('failed')
  })
})

describe('projectChannelReadiness (switch previews)', () => {
  it('native target projects native regardless of the bridge block', () => {
    expect(projectChannelReadiness({ deliveryMode: 'native', enabled: true, tokenPresent: false, guildCount: 0 })).toBe('native')
  })

  it('configured Pi target projects ready_to_connect, never a failure', () => {
    expect(projectChannelReadiness({ deliveryMode: 'unavailable', enabled: true, tokenPresent: true, guildCount: 1 })).toBe('ready_to_connect')
  })

  it('token-less target projects missing_token', () => {
    expect(projectChannelReadiness({ deliveryMode: 'unavailable', enabled: true, tokenPresent: false, guildCount: 1 })).toBe('missing_token')
  })

  it('disabled and missing guild follow the same precedence', () => {
    expect(projectChannelReadiness({ deliveryMode: 'unavailable', enabled: false, tokenPresent: false, guildCount: 0 })).toBe('disabled')
    expect(projectChannelReadiness({ deliveryMode: 'unavailable', enabled: true, tokenPresent: true, guildCount: 0 })).toBe('missing_guild')
  })
})

describe('readinessOwner', () => {
  it('is runtime for native, bridge when a bridge handle exists, none otherwise', () => {
    expect(readinessOwner('native', true)).toBe('runtime')
    expect(readinessOwner('unavailable', true)).toBe('bridge')
    expect(readinessOwner('shimmed', true)).toBe('bridge')
    expect(readinessOwner('unavailable', false)).toBe('none')
  })
})
