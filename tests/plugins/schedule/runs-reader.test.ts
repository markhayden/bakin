import { describe, it, expect, mock } from 'bun:test'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { CronRun } from '@bakin/core/adapters/runtime'

process.env.BAKIN_HOME = mkdtempSync(join(tmpdir(), 'bakin-test-home-'))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

const {
  readRuns,
  getLastRun,
  runtimeRunToEntry,
} = await import('@bakin/schedule/lib/runs-reader')

function makeRun(overrides: Partial<CronRun> = {}): CronRun {
  return {
    id: 'r1',
    jobId: 'j1',
    status: 'succeeded',
    startedAt: '2026-03-27T09:00:00Z',
    ...overrides,
  }
}

function cronReader(runs: CronRun[], shouldThrow = false) {
  return {
    listRuns: async () => {
      if (shouldThrow) throw new Error('adapter unavailable')
      return runs
    },
  }
}

describe('schedule/runs-reader', () => {
  it('returns empty array when the runtime adapter fails', async () => {
    const runs = await readRuns(cronReader([], true), 'j1')
    expect(runs).toEqual([])
  })

  it('maps valid runtime runs', async () => {
    const runs = await readRuns(cronReader([
      makeRun({ id: 'r1', status: 'succeeded', startedAt: '2026-03-27T09:00:00Z' }),
      makeRun({ id: 'r2', status: 'failed', startedAt: '2026-03-26T09:00:00Z', error: 'timeout' }),
    ]), 'j1')

    expect(runs).toHaveLength(2)
    expect(runs[0].runId).toBe('r1')
    expect(runs[0].status).toBe('success')
    expect(runs[1].runId).toBe('r2')
    expect(runs[1].status).toBe('failure')
    expect(runs[1].error).toBe('timeout')
  })

  it('respects limit parameter', async () => {
    const runs = Array.from({ length: 10 }, (_, i) =>
      makeRun({ id: `r${i}`, startedAt: `2026-03-${(20 + i).toString().padStart(2, '0')}T09:00:00Z` })
    )

    const limited = await readRuns(cronReader(runs), 'j1', 3)
    expect(limited).toHaveLength(3)
  })

  it('maps cancelled runtime runs to skipped schedule runs', () => {
    const run = runtimeRunToEntry(makeRun({ status: 'cancelled' }))
    expect(run.status).toBe('skipped')
  })

  it('includes duration when runtime run has start and end timestamps', () => {
    const run = runtimeRunToEntry(makeRun({
      startedAt: '2026-03-27T09:00:00Z',
      endedAt: '2026-03-27T09:02:00Z',
    }))
    expect(run.duration).toBe(120000)
  })

  describe('getLastRun', () => {
    it('returns null when no runs exist', async () => {
      expect(await getLastRun(cronReader([]), 'j1')).toBeNull()
    })

    it('returns the first runtime run', async () => {
      const last = await getLastRun(cronReader([
        makeRun({ id: 'new', startedAt: '2026-03-27T09:00:00Z' }),
        makeRun({ id: 'old', startedAt: '2026-03-25T09:00:00Z', status: 'failed' }),
      ]), 'j1')
      expect(last).not.toBeNull()
      expect(last!.runId).toBe('new')
      expect(last!.status).toBe('success')
    })
  })
})
