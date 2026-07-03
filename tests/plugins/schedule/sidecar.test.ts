import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock content-dir to return our test directory
const testDir = join(tmpdir(), `bakin-test-schedule-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

import {
  readSidecar,
  writeSidecar,
  getJob,
  upsertJob,
  removeJob,
  withDefaults,
  isPaused,
  shouldSkip,
  recordFailure,
  recordSuccess,
  newScheduleId,
  resumeDuePauses,
} from '@bakin/schedule/lib/sidecar'
import type { BakinJobMeta, ScheduleSidecar } from '@bakin/schedule/types'

function makeMeta(overrides: Partial<BakinJobMeta> = {}): BakinJobMeta {
  return {
    jobId: 'test-job-1',
    isBakinJob: true,
    createdAt: '2026-03-27T00:00:00Z',
    updatedAt: '2026-03-27T00:00:00Z',
    ...overrides,
  }
}

describe('schedule/sidecar', () => {
  beforeEach(() => {
    mkdirSync(join(testDir, 'schedule'), { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('readSidecar / writeSidecar', () => {
    it('returns empty sidecar when file does not exist', () => {
      const sidecar = readSidecar()
      expect(sidecar.version).toBe(1)
      expect(Object.keys(sidecar.jobs)).toHaveLength(0)
    })

    it('writes and reads sidecar round-trip', () => {
      const sidecar: ScheduleSidecar = {
        version: 1,
        jobs: {
          'job-1': makeMeta({ jobId: 'job-1', displayName: 'Test Job' }),
        },
      }
      writeSidecar(sidecar)

      const read = readSidecar()
      expect(read.version).toBe(1)
      expect(read.jobs['job-1']).toBeDefined()
      expect(read.jobs['job-1'].displayName).toBe('Test Job')
    })

    it('auto-creates schedule directory', () => {
      rmSync(join(testDir, 'schedule'), { recursive: true, force: true })
      const sidecar: ScheduleSidecar = { version: 1, jobs: { 'j1': makeMeta() } }
      writeSidecar(sidecar)
      expect(existsSync(join(testDir, 'schedule', 'sidecar.json'))).toBe(true)
    })

    it('handles corrupt JSON gracefully', () => {
      const path = join(testDir, 'schedule', 'sidecar.json')
      writeFileSync(path, 'not json at all')
      const sidecar = readSidecar()
      expect(sidecar.version).toBe(1)
      expect(Object.keys(sidecar.jobs)).toHaveLength(0)
    })

    it('handles invalid version gracefully', () => {
      const path = join(testDir, 'schedule', 'sidecar.json')
      writeFileSync(path, JSON.stringify({ version: 99, jobs: {} }))
      const sidecar = readSidecar()
      expect(sidecar.version).toBe(1)
      expect(Object.keys(sidecar.jobs)).toHaveLength(0)
    })
  })

  describe('Bakin-owned schedule fields', () => {
    it('round-trips the schedule definition and enabled flag', () => {
      upsertJob(makeMeta({
        jobId: 'j1',
        schedule: { kind: 'cron', expr: '0 9 * * *' },
        enabled: true,
      }))
      const job = getJob('j1')
      expect(job!.schedule).toEqual({ kind: 'cron', expr: '0 9 * * *' })
      expect(job!.enabled).toBe(true)
    })

    it('skips a structurally-invalid job but keeps the valid ones', () => {
      const path = join(testDir, 'schedule', 'sidecar.json')
      writeFileSync(path, JSON.stringify({
        version: 1,
        jobs: {
          good: makeMeta({ jobId: 'good', displayName: 'Keep me' }),
          bad: { jobId: 'bad', isBakinJob: 'not-a-boolean' }, // wrong type → dropped
        },
      }))
      const sidecar = readSidecar()
      expect(sidecar.jobs.good).toBeDefined()
      expect(sidecar.jobs.good.displayName).toBe('Keep me')
      expect(sidecar.jobs.bad).toBeUndefined()
    })
  })

  describe('newScheduleId', () => {
    it('mints a Bakin-owned id with the sch_ prefix', () => {
      expect(newScheduleId()).toMatch(/^sch_[0-9a-f-]{36}$/)
    })
    it('mints unique ids', () => {
      expect(newScheduleId()).not.toBe(newScheduleId())
    })
  })

  describe('getJob / upsertJob / removeJob', () => {
    it('returns null for nonexistent job', () => {
      expect(getJob('nonexistent')).toBeNull()
    })

    it('upserts and retrieves a job', () => {
      upsertJob(makeMeta({ jobId: 'j1', displayName: 'My Job' }))
      const job = getJob('j1')
      expect(job).not.toBeNull()
      expect(job!.displayName).toBe('My Job')
    })

    it('upsert updates the updatedAt timestamp', () => {
      const meta = makeMeta({ jobId: 'j1', updatedAt: '2020-01-01T00:00:00Z' })
      upsertJob(meta)
      const job = getJob('j1')
      expect(job!.updatedAt).not.toBe('2020-01-01T00:00:00Z')
    })

    it('removes a job and returns true', () => {
      upsertJob(makeMeta({ jobId: 'j1' }))
      const removed = removeJob('j1')
      expect(removed).toBe(true)
      expect(getJob('j1')).toBeNull()
    })

    it('returns false when removing nonexistent job', () => {
      expect(removeJob('nonexistent')).toBe(false)
    })
  })

  describe('withDefaults', () => {
    it('applies default owner, maxFailures, allowOverlap, requireTriage', () => {
      const meta = makeMeta()
      const d = withDefaults(meta, 'boss')
      expect(d.owner).toBe('boss')
      expect(d.maxFailures).toBe(3)
      expect(d.allowOverlap).toBe(false)
      expect(d.requireTriage).toBe(false)
    })

    it('respects explicit values', () => {
      const meta = makeMeta({
        owner: 'chef',
        maxFailures: 5,
        allowOverlap: true,
        requireTriage: true,
      })
      const d = withDefaults(meta, 'boss')
      expect(d.owner).toBe('chef')
      expect(d.maxFailures).toBe(5)
      expect(d.allowOverlap).toBe(true)
      expect(d.requireTriage).toBe(true)
    })
  })

  describe('isPaused', () => {
    it('returns false when not paused', () => {
      const meta = makeMeta()
      expect(isPaused(meta).paused).toBe(false)
    })

    it('returns true when paused', () => {
      const meta = makeMeta({ paused: true, pauseReason: 'manual' })
      const result = isPaused(meta)
      expect(result.paused).toBe(true)
      expect(result.reason).toBe('manual')
    })

    it('auto-resumes when pauseUntil has passed, restoring enabled', () => {
      const meta = makeMeta({
        paused: true,
        enabled: false, // pause sets enabled=false
        pauseUntil: '2020-01-01T00:00:00Z', // in the past
        pauseReason: 'manual',
      })
      const result = isPaused(meta)
      expect(result.paused).toBe(false)
      expect(meta.paused).toBe(false)
      expect(meta.pauseUntil).toBeUndefined()
      expect(meta.enabled).toBe(true) // must re-enable or the scheduler gate keeps it dormant
    })

    it('stays paused when pauseUntil is in the future', () => {
      const meta = makeMeta({
        paused: true,
        pauseUntil: '2099-01-01T00:00:00Z',
        pauseReason: 'manual',
      })
      expect(isPaused(meta).paused).toBe(true)
    })
  })

  describe('resumeDuePauses', () => {
    it('re-enables and clears a job whose pauseUntil has elapsed', () => {
      upsertJob(makeMeta({ jobId: 'due', paused: true, enabled: false, pauseUntil: '2020-01-01T00:00:00Z', pauseReason: 'manual' }))
      const resumed = resumeDuePauses()
      expect(resumed).toBe(1)
      const job = getJob('due')!
      expect(job.paused).toBe(false)
      expect(job.enabled).toBe(true)
      expect(job.pauseUntil).toBeUndefined()
    })

    it('leaves a future timed pause and a manual (no-pauseUntil) pause untouched', () => {
      upsertJob(makeMeta({ jobId: 'future', paused: true, enabled: false, pauseUntil: '2099-01-01T00:00:00Z' }))
      upsertJob(makeMeta({ jobId: 'manual', paused: true, enabled: false })) // no pauseUntil
      const resumed = resumeDuePauses()
      expect(resumed).toBe(0)
      expect(getJob('future')!.enabled).toBe(false)
      expect(getJob('manual')!.paused).toBe(true)
    })
  })

  describe('shouldSkip', () => {
    it('returns false when no skip configured', () => {
      const meta = makeMeta()
      expect(shouldSkip(meta)).toBe(false)
    })

    it('skips and increments counter', () => {
      const meta = makeMeta({ skipNextN: 3, skippedCount: 0 })
      expect(shouldSkip(meta)).toBe(true)
      expect(meta.skippedCount).toBe(1)
    })

    it('skips until threshold reached', () => {
      const meta = makeMeta({ skipNextN: 2, skippedCount: 1 })
      expect(shouldSkip(meta)).toBe(true)
      expect(meta.skippedCount).toBe(2)
    })

    it('clears skip state at threshold', () => {
      const meta = makeMeta({ skipNextN: 2, skippedCount: 2 })
      expect(shouldSkip(meta)).toBe(false)
      expect(meta.skipNextN).toBeUndefined()
      expect(meta.skippedCount).toBeUndefined()
    })
  })

  describe('recordFailure / recordSuccess', () => {
    it('increments failure counter', () => {
      const meta = makeMeta({ consecutiveFailures: 0 })
      recordFailure(meta)
      expect(meta.consecutiveFailures).toBe(1)
    })

    it('auto-pauses after maxFailures', () => {
      const meta = makeMeta({ consecutiveFailures: 2, maxFailures: 3 })
      const autoPaused = recordFailure(meta)
      expect(autoPaused).toBe(true)
      expect(meta.paused).toBe(true)
      expect(meta.pauseReason).toBe('auto-failures')
    })

    it('does not auto-pause below threshold', () => {
      const meta = makeMeta({ consecutiveFailures: 0, maxFailures: 3 })
      const autoPaused = recordFailure(meta)
      expect(autoPaused).toBe(false)
      expect(meta.paused).toBeUndefined()
    })

    it('resets failures on success', () => {
      const meta = makeMeta({ consecutiveFailures: 2 })
      recordSuccess(meta)
      expect(meta.consecutiveFailures).toBe(0)
    })
  })
})
