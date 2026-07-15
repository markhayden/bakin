/**
 * cron_fires retention sweep — pruneCronFires bounds fire history without ever
 * weakening the exactly-once guarantees: `pending` rows are untouchable, the
 * newest N per job always survive, and nothing newer than the safety margin
 * (catch-up window / 7d floor) is deleted, so re-claims inside the dedup
 * horizon still collide with their original row.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-ledger-retention-${Date.now()}-${randomUUID()}`)
const dbPath = join(testDir, 'bakin.db')

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: dbPath,
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import {
  claimCronFire,
  attachCronTask,
  markCronFireSkipped,
  getCronFire,
  listCronFires,
  pruneCronFires,
} from '../../src/core/execution-ledger'
import { closeDb } from '../../packages/core/src/storage/db'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-07-14T12:00:00Z')

/** Seed one settled fire row aged `ageDays` before NOW. */
function seed(jobId: string, n: number, ageDays: number, disposition: 'created' | 'skipped' | 'pending' = 'created'): string {
  const firedAt = NOW - ageDays * DAY
  const runId = `${jobId}:${new Date(firedAt).toISOString()}#${n}`
  const claim = claimCronFire(jobId, runId, firedAt, 'pending', firedAt)
  expect(claim.claimed).toBe(true)
  if (disposition === 'created') attachCronTask(jobId, runId, `task-${runId}`)
  if (disposition === 'skipped') markCronFireSkipped(jobId, runId, 'overlap')
  return runId
}

const POLICY = { maxAgeMs: 30 * DAY, keepPerJob: 20, minAgeMs: 7 * DAY, now: NOW }

describe('pruneCronFires', () => {
  afterAll(() => {
    closeDb()
    rmSync(testDir, { recursive: true, force: true })
  })

  let jobSeq = 0
  let jobId = ''
  beforeEach(() => {
    jobId = `sch_job_${jobSeq++}`
  })

  it('prunes settled rows older than maxAge beyond the newest keepPerJob', () => {
    // 25 settled rows, all far older than maxAge: the newest 20 must survive.
    const runIds = Array.from({ length: 25 }, (_, i) => seed(jobId, i, 100 - i)) // ages 100..76d
    const { pruned } = pruneCronFires(POLICY)
    expect(pruned).toBe(5)
    const remaining = listCronFires(jobId, 100)
    expect(remaining).toHaveLength(20)
    // Survivors are the 20 newest (ages 76..95d); the 5 oldest are gone.
    for (const runId of runIds.slice(-20)) expect(getCronFire(jobId, runId)).not.toBeNull()
    for (const runId of runIds.slice(0, 5)) expect(getCronFire(jobId, runId)).toBeNull()
  })

  it('never touches rows younger than maxAge', () => {
    seed(jobId, 0, 5)
    seed(jobId, 1, 29)
    const { pruned } = pruneCronFires(POLICY)
    expect(pruned).toBe(0)
    expect(listCronFires(jobId, 100)).toHaveLength(2)
  })

  it('never prunes pending rows regardless of age', () => {
    const pendingRun = seed(jobId, 0, 200, 'pending')
    // 21 settled rows newer than the pending one push it past keepPerJob.
    for (let i = 0; i < 21; i++) seed(jobId, i + 1, 40 + i)
    pruneCronFires(POLICY)
    expect(getCronFire(jobId, pendingRun)).not.toBeNull()
    expect(getCronFire(jobId, pendingRun)!.disposition).toBe('pending')
  })

  it('minAge floor wins over a misconfigured tiny maxAge', () => {
    const recent = seed(jobId, 0, 1) // 1 day old, settled
    for (let i = 0; i < 25; i++) seed(jobId, i + 1, 2 + i) // ages 2..26d
    const { pruned } = pruneCronFires({ ...POLICY, maxAgeMs: 60 * 60 * 1000, keepPerJob: 1 })
    expect(getCronFire(jobId, recent)).not.toBeNull()
    // Cutoff is the 7d floor (strict <): ages 1..7d survive, 8..26d are pruned
    // (the sole keepPerJob slot is already held by the newest, age-1d row).
    // `pruned` is global across jobs (other tests' rows share the DB), so
    // assert at least this job's 19 and pin the survivor set per job.
    expect(pruned).toBeGreaterThanOrEqual(19)
    const survivorAges = listCronFires(jobId, 100).map(row => Math.round((NOW - row.firedAt) / DAY)).sort((a, b) => a - b)
    expect(survivorAges).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('exactly-once dedup survives a sweep: a re-claim inside the safety margin still collides', () => {
    const firedAt = NOW - 60 * 60 * 1000 // 1h ago — inside catch-up horizon
    const runId = `${jobId}:${new Date(firedAt).toISOString()}`
    expect(claimCronFire(jobId, runId, firedAt, 'pending', firedAt).claimed).toBe(true)
    attachCronTask(jobId, runId, 'task-x')
    pruneCronFires(POLICY)
    const reclaim = claimCronFire(jobId, runId, firedAt, 'pending', NOW)
    expect(reclaim.claimed).toBe(false)
    if (!reclaim.claimed) expect(reclaim.existing?.taskId).toBe('task-x')
  })

  it('keepPerJob is per job, not global', () => {
    const jobA = `${jobId}-a`
    const jobB = `${jobId}-b`
    for (let i = 0; i < 30; i++) seed(jobA, i, 100 - i)
    for (let i = 0; i < 3; i++) seed(jobB, i, 100 - i)
    const { pruned } = pruneCronFires(POLICY)
    expect(pruned).toBe(10)
    expect(listCronFires(jobA, 100)).toHaveLength(20)
    expect(listCronFires(jobB, 100)).toHaveLength(3)
  })
})
