/**
 * Daily cron_fires retention sweep — the scheduler loop calls pruneCronFires
 * at most once per 24h with the fixed policy (30d max age, keep 20/job,
 * minAge = max(catch-up window, 7d floor)), and audits sweeps that actually
 * pruned rows so history deletion is never silent.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-retention-sweep-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + '-openclaw'

import { describe, it, expect, afterAll, mock } from 'bun:test'
import { rmSync } from 'fs'

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: pathJoin(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
}))

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => testDir + '-openclaw',
  getOpenClawPath: (...parts: string[]) => pathJoin(testDir + '-openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

const pruneCalls: Array<Record<string, unknown>> = []
let pruneResult = { pruned: 0 }
mock.module('../../../src/core/execution-ledger', () => ({
  pruneCronFires: (opts: Record<string, unknown>) => {
    pruneCalls.push(opts)
    return pruneResult
  },
  getCronFire: () => null,
  claimCronFire: () => ({ claimed: true }),
}))

import { maybeRunRetentionSweep } from '../../../plugins/schedule/lib/scheduler-loop'
import { setPluginCtx } from '../../../plugins/schedule/lib/plugin-context'

const auditEvents: Array<{ event: string; data: Record<string, unknown> }> = []
setPluginCtx({
  getSettings: () => ({ catchUpWindowMinutes: 60 }),
  activity: {
    log: () => {},
    audit: (event: string, _actor: string, data: Record<string, unknown>) => {
      auditEvents.push({ event, data })
    },
  },
} as never)

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-07-14T12:00:00Z')

describe('maybeRunRetentionSweep', () => {
  afterAll(() => rmSync(testDir, { recursive: true, force: true }))

  it('sweeps with the fixed policy and audits when rows were pruned', () => {
    pruneResult = { pruned: 3 }
    maybeRunRetentionSweep(NOW)
    expect(pruneCalls).toHaveLength(1)
    expect(pruneCalls[0]).toMatchObject({
      maxAgeMs: 30 * DAY,
      keepPerJob: 20,
      minAgeMs: 7 * DAY, // 60m catch-up window loses to the 7d floor
      now: NOW,
    })
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0].event).toBe('retention_swept')
    expect(auditEvents[0].data.pruned).toBe(3)
  })

  it('skips inside the 24h cadence window', () => {
    maybeRunRetentionSweep(NOW + 60 * 60 * 1000)
    expect(pruneCalls).toHaveLength(1)
  })

  it('sweeps again after 24h and stays silent when nothing was pruned', () => {
    pruneResult = { pruned: 0 }
    maybeRunRetentionSweep(NOW + 25 * 60 * 60 * 1000)
    expect(pruneCalls).toHaveLength(2)
    expect(auditEvents).toHaveLength(1) // no new audit for a 0-row sweep
  })
})
