import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'

(() => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  process.env.BAKIN_HOME = mkdtempSync(join(tmpdir(), 'bakin-test-home-'))
  process.env.OPENCLAW_HOME = mkdtempSync(join(tmpdir(), 'bakin-test-openclaw-'))
})()

import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { OpenClawJobsFile, BakinJobMeta, ScheduleSidecar } from '@bakin/schedule/types'

const testDir = join(tmpdir(), `bakin-test-jobs-${Date.now()}`)
const sidecarDir = join(testDir, 'schedule')
const sidecarPath = join(sidecarDir, 'sidecar.json')
const jobsPath = join(testDir, 'jobs.json')

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

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

// Dynamic require — jobs-reader.ts calls getOpenClawHome at module init.
// ES imports are hoisted above the IIFE that sets OPENCLAW_HOME, so using
// require() defers the load until after env is configured.
const { readOpenClawJobs, mergeJob, readMergedJobs } = require('@bakin/schedule/lib/jobs-reader') as typeof import('@bakin/schedule/lib/jobs-reader')

function writeJobs(jobs: OpenClawJobsFile) {
  writeFileSync(jobsPath, JSON.stringify(jobs))
}

function writeSidecarFile(sidecar: ScheduleSidecar) {
  writeFileSync(sidecarPath, JSON.stringify(sidecar))
}

function makeMeta(overrides: Partial<BakinJobMeta> = {}): BakinJobMeta {
  return {
    jobId: 'job-1',
    isBakinJob: true,
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
      expect(merged.isBakinJob).toBe(false)
      expect(merged.displayName).toBe('Raw Job')
      expect(merged.owner).toBe('main')
      expect(merged.paused).toBe(false)
      expect(merged.humanSchedule).toBe('Daily at 9am')
    })

    it('merges OpenClaw job with sidecar entry', () => {
      const job = { id: 'j1', name: 'My Job', schedule: { type: 'cron' as const, value: '0 9 * * *' }, enabled: true }
      const sidecar = makeMeta({
        jobId: 'j1',
        isBakinJob: true,
        displayName: 'Morning Report',
        agentId: 'chef',
        owner: 'main',
      })
      const merged = mergeJob(job, sidecar)

      expect(merged.isBakinJob).toBe(true)
      expect(merged.displayName).toBe('Morning Report')
      expect(merged.agentId).toBe('chef')
      expect(merged.owner).toBe('main')
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

    it('extracts prompt from orphan payload.message', () => {
      const job = {
        id: 'j1', name: 'Orphan', schedule: { type: 'cron' as const, value: '0 9 * * *' }, enabled: true,
        payload: { message: 'Post a daily recipe' },
      }
      const merged = mergeJob(job, undefined)
      expect(merged.taskPrompt).toBe('Post a daily recipe')
      expect(merged.requireTriage).toBe(true)
      expect(merged.agentId).toBeUndefined()
    })

    it('extracts prompt from bakin:schedule: prefixed message', () => {
      const job = {
        id: 'j1', name: 'Lost Bakin Job', schedule: { type: 'cron' as const, value: '0 9 * * *' }, enabled: true,
        payload: { message: 'bakin:schedule:daily-recipe' },
      }
      const merged = mergeJob(job, undefined)
      expect(merged.taskPrompt).toBe('daily-recipe')
    })

    it('does not override sidecar prompt with payload', () => {
      const job = {
        id: 'j1', name: 'Job', schedule: { type: 'cron' as const, value: '0 9 * * *' }, enabled: true,
        payload: { message: 'raw message' },
      }
      const sidecar = makeMeta({ jobId: 'j1', taskPrompt: 'Bakin prompt' })
      const merged = mergeJob(job, sidecar)
      expect(merged.taskPrompt).toBe('Bakin prompt')
      expect(merged.requireTriage).toBe(false) // has sidecar, not an orphan
    })

    it('normalises OpenClaw kind/expr to type/value', () => {
      const job = { id: 'j1', name: 'OC Job', schedule: { kind: 'cron' as const, expr: '30 8 * * 1-5' }, enabled: true }
      const merged = mergeJob(job, undefined)
      expect(merged.schedule.type).toBe('cron')
      expect(merged.schedule.value).toBe('30 8 * * 1-5')
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
          'j1': makeMeta({ jobId: 'j1', displayName: 'Morning', agentId: 'chef' }),
        },
      })

      const jobs = readMergedJobs(jobsPath)
      expect(jobs).toHaveLength(2)

      const j1 = jobs.find(j => j.id === 'j1')!
      expect(j1.isBakinJob).toBe(true)
      expect(j1.displayName).toBe('Morning')
      expect(j1.agentId).toBe('chef')

      const j2 = jobs.find(j => j.id === 'j2')!
      expect(j2.isBakinJob).toBe(false)
      expect(j2.displayName).toBe('Job 2')
    })
  })
})
