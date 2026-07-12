/**
 * Can't-carry report builder — capability-diff line semantics: emit only
 * when something actually stays behind, honest count-unknown degradation,
 * and the always-true sessions/provider-config lines.
 */
import { join } from 'path'
import { tmpdir } from 'os'
import { describe, it, expect, mock } from 'bun:test'

const testDir = join(tmpdir(), `bakin-test-switch-report-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { buildCantCarryReport, snapshotSourceCapabilities } from '../../src/core/switch-report'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

const NO_SURFACES = {} as Pick<AgentRuntimeAdapter, 'channels' | 'cron'>

function concerns(lines: Array<{ concern: string }>): string[] {
  return lines.map((l) => l.concern)
}

describe('buildCantCarryReport', () => {
  it('sessions + provider-config lines emit on every switch', () => {
    const lines = buildCantCarryReport({ hasChannels: false, hasCron: false }, NO_SURFACES)
    expect(concerns(lines)).toEqual(['sessions', 'provider-config'])
  })

  it('channels/cron stay-behind lines carry counts and name the target gap', () => {
    const lines = buildCantCarryReport(
      { hasChannels: true, channelCount: 2, hasCron: true, cronJobCount: 3 },
      NO_SURFACES,
    )
    expect(lines.find((l) => l.concern === 'channels')).toEqual({
      concern: 'channels',
      detail: 'channel config stays behind — the target runtime has no channels surface',
      count: 2,
    })
    expect(lines.find((l) => l.concern === 'cron')?.count).toBe(3)
  })

  it('verifiably-empty surfaces (count 0) emit NO line — nothing stays behind', () => {
    const lines = buildCantCarryReport(
      { hasChannels: true, channelCount: 0, hasCron: true, cronJobCount: 0 },
      NO_SURFACES,
    )
    expect(concerns(lines)).toEqual(['sessions', 'provider-config'])
  })

  it('an unknown count still emits the line, honestly countless', () => {
    const lines = buildCantCarryReport({ hasChannels: true, hasCron: false }, NO_SURFACES)
    const channels = lines.find((l) => l.concern === 'channels')!
    expect(channels.count).toBeUndefined()
    expect(channels.detail).toContain('stays behind')
  })

  it('a target WITH the surface still gets a line — config never crosses, wording says reconfigure', () => {
    const target = { channels: {}, cron: {} } as unknown as Pick<AgentRuntimeAdapter, 'channels' | 'cron'>
    const lines = buildCantCarryReport({ hasChannels: true, channelCount: 1, hasCron: true, cronJobCount: 1 }, target)
    expect(lines.find((l) => l.concern === 'channels')?.detail).toContain('reconfigure channels on the target')
    expect(lines.find((l) => l.concern === 'cron')?.detail).toContain('recreate them on the target')
  })
})

describe('snapshotSourceCapabilities', () => {
  it('captures presence + counts from the optional surfaces', async () => {
    const source = {
      channels: { list: async () => [{ id: 'discord' }] },
      cron: { list: async () => [] },
    } as unknown as AgentRuntimeAdapter
    expect(await snapshotSourceCapabilities(source)).toEqual({
      hasChannels: true,
      channelCount: 1,
      hasCron: true,
      cronJobCount: 0,
    })
  })

  it('a failing count fetch degrades to present-without-count, never throws', async () => {
    const source = {
      channels: { list: async () => { throw new Error('gateway down') } },
    } as unknown as AgentRuntimeAdapter
    expect(await snapshotSourceCapabilities(source)).toEqual({
      hasChannels: true,
      hasCron: false,
    })
  })
})
