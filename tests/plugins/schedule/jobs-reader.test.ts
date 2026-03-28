import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { OpenClawJobsFile, BeaconJobMeta, ScheduleSidecar } from '@mc/schedule/types'

const testDir = join(tmpdir(), `beacon-test-jobs-${Date.now()}`)
const sidecarDir = join(testDir, 'schedule')
const sidecarPath = join(sidecarDir, 'sidecar.json')
const jobsPath = join(testDir, 'jobs.json')

vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

import { readOpenClawJobs, mergeJob, readMergedJobs } from '@mc/schedule/lib/jobs-reader'

function writeJobs(jobs: OpenClawJobsFile) {
  writeFileSync(jobsPath, JSON.stringify(jobs))
}

function writeSidecarFile(sidecar: ScheduleSidecar) {
  writeFileSync(sidecarPath, JSON.stringify(sidecar))
}

function makeMeta(overrides: Partial<BeaconJobMeta> = {}): BeaconJobMeta {
  return {
    jobId: 'job-1',
    isBeaconJob: true,
    createdAt: '2026-03-27T00:00:00Z',
    updatedAt: '2026-03-27T00:00:00Z',
    ...overrides,
  }
}

describe('schedule/jobs-reader', () => {
  beforeEach(() => {
    mkdirSync(sidecarDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('readOpenClawJobs', () => {
    it('returns empty array when file does not exist', () => {
      const jobs = readOpenClawJobs('/nonexistent/path.json')
      expect(jobs).toEqual([])
    })

    it('reads valid jobs file', () => {
      writeJobs({
        version: 1,
        jobs: [
          { id: 'j1', name: 'Test', schedule: { type: 'cron', value: '0 9 * * *' }, enabled: true },
        ],
      })
      const jobs = readOpenClawJobs(jobsPath)
      expect(jobs).toHaveLength(1)
      expect(jobs[0].id).toBe('j1')
    })

    it('handles corrupt JSON gracefully', () => {
      writeFileSync(jobsPath, 'not json')
      const jobs = readOpenClawJobs(jobsPath)
      expect(jobs).toEqual([])
    })
  })

  describe('mergeJob', () => {
    it('merges OpenClaw job without sidecar entry', () => {
      const job = { id: 'j1', name: 'Raw Job', schedule: { type: 'cron' as const, value: '0 9 * * *' }, enabled: true }
      const merged = mergeJob(job, undefined)

      expect(merged.id).toBe('j1')
      expect(merged.name).toBe('Raw Job')
      expect(merged.isBeaconJob).toBe(false)
      expect(merged.displayName).toBe('Raw Job')
      expect(merged.owner).toBe('roscoe')
      expect(merged.paused).toBe(false)
      expect(merged.humanSchedule).toBe('Daily at 9am')
    })

    it('merges OpenClaw job with sidecar entry', () => {
      const job = { id: 'j1', name: 'My Job', schedule: { type: 'cron' as const, value: '0 9 * * *' }, enabled: true }
      const sidecar = makeMeta({
        jobId: 'j1',
        isBeaconJob: true,
        displayName: 'Morning Report',
        agentId: 'basil',
        owner: 'roscoe',
      })
      const merged = mergeJob(job, sidecar)

      expect(merged.isBeaconJob).toBe(true)
      expect(merged.displayName).toBe('Morning Report')
      expect(merged.agentId).toBe('basil')
      expect(merged.owner).toBe('roscoe')
    })

    it('uses sidecar defaults for missing fields', () => {
      const job = { id: 'j1', name: 'Job', schedule: { type: 'cron' as const, value: '0 * * * *' }, enabled: true }
      const sidecar = makeMeta({ jobId: 'j1' })
      const merged = mergeJob(job, sidecar)

      expect(merged.maxFailures).toBe(3)
      expect(merged.allowOverlap).toBe(false)
      expect(merged.requireTriage).toBe(false)
      expect(merged.consecutiveFailures).toBe(0)
    })

    it('generates human schedule for interval type', () => {
      const job = { id: 'j1', name: 'Job', schedule: { type: 'every' as const, value: '60000' }, enabled: true }
      const merged = mergeJob(job, undefined)
      expect(merged.humanSchedule).toBe('Every 60s')
    })

    it('generates human schedule for one-shot type', () => {
      const job = { id: 'j1', name: 'Job', schedule: { type: 'at' as const, value: '2026-04-01T09:00:00Z' }, enabled: true }
      const merged = mergeJob(job, undefined)
      expect(merged.humanSchedule).toContain('Once at')
    })
  })

  describe('readMergedJobs', () => {
    it('returns empty array when no jobs exist', () => {
      const jobs = readMergedJobs('/nonexistent/path.json')
      expect(jobs).toEqual([])
    })

    it('merges jobs with sidecar data', () => {
      writeJobs({
        version: 1,
        jobs: [
          { id: 'j1', name: 'Job 1', schedule: { type: 'cron', value: '0 9 * * *' }, enabled: true },
          { id: 'j2', name: 'Job 2', schedule: { type: 'cron', value: '0 17 * * *' }, enabled: true },
        ],
      })
      writeSidecarFile({
        version: 1,
        jobs: {
          'j1': makeMeta({ jobId: 'j1', displayName: 'Morning', agentId: 'basil' }),
        },
      })

      const jobs = readMergedJobs(jobsPath)
      expect(jobs).toHaveLength(2)

      const j1 = jobs.find(j => j.id === 'j1')!
      expect(j1.isBeaconJob).toBe(true)
      expect(j1.displayName).toBe('Morning')
      expect(j1.agentId).toBe('basil')

      const j2 = jobs.find(j => j.id === 'j2')!
      expect(j2.isBeaconJob).toBe(false)
      expect(j2.displayName).toBe('Job 2')
    })
  })
})
