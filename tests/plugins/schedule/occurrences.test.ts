/**
 * Server-side occurrence computation (PR3 of #191) — ONE engine places jobs
 * on the calendar: kind-aware (cron + one-shot), timezone/DST-correct,
 * creation-date-guarded, past/future annotated, past Bakin fires enriched
 * with their ledger disposition. Pure DI module — fake clock, fake ledger.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-occurrences-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { describe, it, expect, mock } from 'bun:test'

// The module under test is pure DI (no filesystem), but isolation rules are
// blanket: nothing in a test run may resolve the real ~/.bakin or ~/.openclaw.
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
  isUsingBakinHome: () => true,
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { computeOccurrences, type OccurrenceQueryDeps } from '@bakin/schedule/lib/occurrences'
import type { MergedJob } from '@bakin/schedule/types'

const DENVER = 'America/Denver'

function job(overrides: Partial<MergedJob> = {}): MergedJob {
  return {
    id: 'sch_daily',
    name: 'Daily',
    schedule: { type: 'cron', value: '0 9 * * *', tz: DENVER },
    enabled: true,
    completed: false,
    source: 'bakin',
    canAdopt: false,
    canRestoreNative: false,
    isBakinJob: true,
    displayName: 'Daily',
    owner: 'main',
    requireTriage: false,
    paused: false,
    allowOverlap: false,
    maxFailures: 3,
    consecutiveFailures: 0,
    tz: DENVER,
    createdAt: '2026-01-01T00:00:00Z',
    humanSchedule: 'Every day at 9am',
    ...overrides,
  }
}

// Tue 2026-06-09, 12:00 UTC (6am Denver)
const NOW = Date.parse('2026-06-09T12:00:00Z')

function deps(overrides: Partial<OccurrenceQueryDeps> = {}): OccurrenceQueryDeps {
  return {
    nowMs: NOW,
    getFire: () => null,
    ...overrides,
  }
}

describe('computeOccurrences', () => {
  it('places a daily cron across the range, annotated past/future', () => {
    const from = Date.parse('2026-06-08T00:00:00Z')
    const to = Date.parse('2026-06-11T00:00:00Z')
    const { items } = computeOccurrences([job()], from, to, deps())
    expect(items.map(i => i.at)).toEqual([
      '2026-06-08T15:00:00.000Z', // 9am Denver (MDT)
      '2026-06-09T15:00:00.000Z',
      '2026-06-10T15:00:00.000Z',
    ])
    expect(items.map(i => i.past)).toEqual([true, false, false])
    expect(items.every(i => i.jobId === 'sch_daily')).toBe(true)
  })

  it('is DST-correct: an evening Denver cron shifts its UTC instant across fall-back', () => {
    // US fall-back 2026-11-01: 9:30pm Denver is 03:30Z (MDT) before, 04:30Z (MST) after.
    const from = Date.parse('2026-10-31T00:00:00Z')
    const to = Date.parse('2026-11-03T00:00:00Z')
    const { items } = computeOccurrences(
      [job({ schedule: { type: 'cron', value: '30 21 * * *', tz: DENVER } })],
      from, to,
      deps({ nowMs: Date.parse('2026-10-30T00:00:00Z') }),
    )
    expect(items.map(i => i.at)).toEqual([
      '2026-10-31T03:30:00.000Z', // Oct 30 9:30pm MDT
      '2026-11-01T03:30:00.000Z', // Oct 31 9:30pm MDT
      '2026-11-02T04:30:00.000Z', // Nov 1 9:30pm MST — the UTC instant shifted 1h
    ])
  })

  it('skips occurrences that predate the job creation (no phantom history)', () => {
    const from = Date.parse('2026-06-01T00:00:00Z')
    const to = Date.parse('2026-06-11T00:00:00Z')
    const { items } = computeOccurrences([job({ createdAt: '2026-06-08T00:00:00Z' })], from, to, deps())
    expect(items.map(i => i.at)).toEqual([
      '2026-06-08T15:00:00.000Z',
      '2026-06-09T15:00:00.000Z',
      '2026-06-10T15:00:00.000Z',
    ])
  })

  it('one-shots appear exactly once; a completed one-shot keeps its past instant but no future', () => {
    const from = Date.parse('2026-06-08T00:00:00Z')
    const to = Date.parse('2026-06-12T00:00:00Z')
    const fired = job({
      id: 'sch_once_done',
      schedule: { type: 'at', value: '2026-06-08T18:00:00.000Z', tz: DENVER },
      enabled: false,
      completed: true,
      completedAt: '2026-06-08T18:00:00.000Z',
    })
    const pending = job({
      id: 'sch_once_pending',
      schedule: { type: 'at', value: '2026-06-10T18:00:00.000Z', tz: DENVER },
    })
    const { items } = computeOccurrences([fired, pending], from, to, deps())
    expect(items.map(i => `${i.jobId}@${i.at}`)).toEqual([
      'sch_once_done@2026-06-08T18:00:00.000Z',
      'sch_once_pending@2026-06-10T18:00:00.000Z',
    ])
  })

  it('disabled/paused jobs contribute no future occurrences but keep their past', () => {
    const from = Date.parse('2026-06-08T00:00:00Z')
    const to = Date.parse('2026-06-11T00:00:00Z')
    const disabled = computeOccurrences([job({ enabled: false })], from, to, deps())
    expect(disabled.items.map(i => i.at)).toEqual(['2026-06-08T15:00:00.000Z'])
    const paused = computeOccurrences([job({ paused: true })], from, to, deps())
    expect(paused.items.map(i => i.at)).toEqual(['2026-06-08T15:00:00.000Z'])
  })

  it('enriches past Bakin occurrences with the ledger disposition', () => {
    const from = Date.parse('2026-06-08T00:00:00Z')
    const to = Date.parse('2026-06-10T00:00:00Z')
    const { items } = computeOccurrences([job()], from, to, deps({
      getFire: (jobId, runId) => runId === `sch_daily:2026-06-08T15:00:00.000Z`
        ? { jobId, runId, disposition: 'created', taskId: 'task-1', skipReason: null }
        : null,
    }))
    const past = items.find(i => i.past)!
    expect(past.disposition).toBe('created')
    expect(past.taskId).toBe('task-1')
    const future = items.find(i => !i.past)!
    expect(future.disposition).toBeUndefined()
  })

  it('never consults the ledger for native runtime crons', () => {
    const calls: string[] = []
    const from = Date.parse('2026-06-08T00:00:00Z')
    const to = Date.parse('2026-06-10T00:00:00Z')
    computeOccurrences(
      [job({ id: 'native-1', isBakinJob: false, source: 'runtime' })],
      from, to,
      deps({ getFire: (jobId) => { calls.push(jobId); return null } }),
    )
    expect(calls).toEqual([])
  })

  it("reports native 'every' jobs as unevaluated instead of silently dropping them", () => {
    const from = Date.parse('2026-06-08T00:00:00Z')
    const to = Date.parse('2026-06-10T00:00:00Z')
    const { items, unevaluated } = computeOccurrences(
      [job({ id: 'native-every', isBakinJob: false, source: 'runtime', schedule: { type: 'every', value: '300000' } })],
      from, to, deps(),
    )
    expect(items).toEqual([])
    expect(unevaluated).toEqual(['native-every'])
  })

  it('sorts the merged feed ascending across jobs', () => {
    const from = Date.parse('2026-06-08T00:00:00Z')
    const to = Date.parse('2026-06-09T00:00:00Z')
    const { items } = computeOccurrences([
      job({ id: 'b', schedule: { type: 'cron', value: '0 10 * * *', tz: DENVER } }),
      job({ id: 'a', schedule: { type: 'cron', value: '0 8 * * *', tz: DENVER } }),
    ], from, to, deps())
    expect(items.map(i => i.jobId)).toEqual(['a', 'b'])
  })
})
