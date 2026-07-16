import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { CronJob } from '@bakin/core/adapters/runtime'
import type { BakinJobMeta, RuntimeCronJobSnapshot, ScheduleSidecar } from '@bakin/schedule/types'

process.env.BAKIN_HOME = mkdtempSync(join(tmpdir(), 'bakin-test-home-'))

const testDir = join(tmpdir(), `bakin-test-jobs-${Date.now()}`)
const sidecarDir = join(testDir, 'schedule')
const sidecarPath = join(sidecarDir, 'sidecar.json')

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

const {
  runtimeCronToScheduleJob,
  mergeJob,
  readMergedJobs,
} = await import('@bakin/schedule/lib/jobs-reader')

function writeSidecarFile(sidecar: ScheduleSidecar) {
  writeFileSync(sidecarPath, JSON.stringify(sidecar))
}

function makeCronJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: 'j1',
    name: 'Job',
    schedule: '0 9 * * *',
    command: 'Post a daily recipe',
    enabled: true,
    ...overrides,
  }
}

function makeRuntimeJob(overrides: Partial<RuntimeCronJobSnapshot> = {}): RuntimeCronJobSnapshot {
  return {
    id: 'j1',
    name: 'Job',
    schedule: { type: 'cron', value: '0 9 * * *' },
    enabled: true,
    ...overrides,
  }
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

function cronReader(jobs: CronJob[]) {
  return {
    list: async () => jobs,
  }
}

describe('schedule/jobs-reader', () => {
  const defaultOwner = 'main'

  beforeEach(() => {
    mkdirSync(sidecarDir, { recursive: true })
    writeSidecarFile({ version: 1, jobs: {} })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('runtimeCronToScheduleJob', () => {
    it('normalizes runtime cron jobs for schedule merging', () => {
      const job = runtimeCronToScheduleJob(makeCronJob({
        toolsAllow: ['message'],
        metadata: {
          tz: 'America/Denver',
          webhookUrl: 'http://localhost:3737/api/plugins/schedule/bridge',
          createdAt: '2026-03-27T00:00:00Z',
          updatedAt: '2026-03-28T00:00:00Z',
        },
      }))

      expect(job.id).toBe('j1')
      expect(job.schedule.type).toBe('cron')
      expect(job.schedule.value).toBe('0 9 * * *')
      expect(job.schedule.tz).toBe('America/Denver')
      expect(job.payload?.message).toBe('Post a daily recipe')
      expect(job.delivery?.mode).toBe('webhook')
      expect(job.createdAt).toBe('2026-03-27T00:00:00Z')
      expect(job.toolsAllow).toEqual(['message'])
      expect(job.toolsAllowMissing).toBe(false)
    })

    it('flags non-Bakin runtime cron jobs that are missing a toolsAllow policy', () => {
      const job = runtimeCronToScheduleJob(makeCronJob())

      expect(job.toolsAllow).toBeUndefined()
      expect(job.toolsAllowMissing).toBe(true)
    })

    it('does not flag Bakin schedule timer cron jobs without toolsAllow', () => {
      const job = runtimeCronToScheduleJob(makeCronJob({
        command: 'bakin:schedule:j1',
        metadata: { bakinSchedule: true },
      }))

      expect(job.toolsAllowMissing).toBe(false)
    })
  })

  describe('mergeJob', () => {
    it('merges runtime job without sidecar entry', () => {
      const job = makeRuntimeJob({ id: 'j1', name: 'Raw Job', toolsAllowMissing: true })
      const merged = mergeJob(job, undefined, 'boss')

      expect(merged.id).toBe('j1')
      expect(merged.name).toBe('Raw Job')
      expect(merged.isBakinJob).toBe(false)
      expect(merged.displayName).toBe('Raw Job')
      expect(merged.owner).toBe('boss')
      expect(merged.paused).toBe(false)
      expect(merged.humanSchedule).toBe('Daily at 9am')
      expect(merged.toolsAllowMissing).toBe(true)
    })

    it('carries runtime cron toolsAllow into the merged job', () => {
      const job = makeRuntimeJob({
        id: 'j1',
        name: 'Raw Job',
        toolsAllow: ['message', 'exec'],
        toolsAllowMissing: false,
      })
      const merged = mergeJob(job, undefined, defaultOwner)

      expect(merged.toolsAllow).toEqual(['message', 'exec'])
      expect(merged.toolsAllowMissing).toBe(false)
    })

    it('merges runtime job with sidecar entry', () => {
      const job = makeRuntimeJob({ id: 'j1', name: 'My Job' })
      const sidecar = makeMeta({
        jobId: 'j1',
        isBakinJob: true,
        displayName: 'Morning Report',
        agentId: 'chef',
        owner: 'main',
      })
      const merged = mergeJob(job, sidecar, defaultOwner)

      expect(merged.isBakinJob).toBe(true)
      expect(merged.displayName).toBe('Morning Report')
      expect(merged.agentId).toBe('chef')
      expect(merged.owner).toBe('main')
    })

    it('carries teamId from the sidecar into the merged view (round-3 review)', () => {
      const job = makeRuntimeJob({ id: 'j-team', name: 'Team Job' })
      const sidecar = makeMeta({ jobId: 'j-team', isBakinJob: true, agentId: undefined, teamId: 'development' })
      const merged = mergeJob(job, sidecar, defaultOwner)
      expect(merged.teamId).toBe('development')
      expect(merged.agentId).toBeUndefined()
    })

    it('does not flag Bakin sidecar jobs missing runtime cron toolsAllow', () => {
      const job = makeRuntimeJob({ id: 'j1', toolsAllowMissing: true })
      const sidecar = makeMeta({ jobId: 'j1', isBakinJob: true })
      const merged = mergeJob(job, sidecar, defaultOwner)

      expect(merged.toolsAllowMissing).toBe(false)
    })

    it('uses sidecar defaults for missing fields', () => {
      const job = makeRuntimeJob({ id: 'j1', schedule: { type: 'cron', value: '0 * * * *' } })
      const sidecar = makeMeta({ jobId: 'j1' })
      const merged = mergeJob(job, sidecar, defaultOwner)

      expect(merged.maxFailures).toBe(3)
      expect(merged.allowOverlap).toBe(false)
      expect(merged.requireTriage).toBe(false)
      expect(merged.consecutiveFailures).toBe(0)
    })

    it('generates human schedule for interval type', () => {
      const job = makeRuntimeJob({ schedule: { type: 'every', value: '60000' } })
      const merged = mergeJob(job, undefined, defaultOwner)
      expect(merged.humanSchedule).toBe('Every 60s')
    })

    it('generates human schedule for one-shot type', () => {
      const job = makeRuntimeJob({ schedule: { type: 'at', value: '2026-04-01T09:00:00Z' } })
      const merged = mergeJob(job, undefined, defaultOwner)
      expect(merged.humanSchedule).toContain('Once at')
    })

    it('extracts prompt from orphan payload.message', () => {
      const job = makeRuntimeJob({
        id: 'j1',
        name: 'Orphan',
        payload: { message: 'Post a daily recipe' },
      })
      const merged = mergeJob(job, undefined, defaultOwner)
      expect(merged.taskPrompt).toBe('Post a daily recipe')
      expect(merged.requireTriage).toBe(true)
      expect(merged.agentId).toBeUndefined()
    })

    it('extracts prompt from bakin:schedule: prefixed message', () => {
      const job = makeRuntimeJob({
        id: 'j1',
        name: 'Lost Bakin Job',
        payload: { message: 'bakin:schedule:daily-recipe' },
      })
      const merged = mergeJob(job, undefined, defaultOwner)
      expect(merged.taskPrompt).toBe('daily-recipe')
    })

    it('does not override sidecar prompt with payload', () => {
      const job = makeRuntimeJob({
        id: 'j1',
        name: 'Job',
        payload: { message: 'raw message' },
      })
      const sidecar = makeMeta({ jobId: 'j1', taskPrompt: 'Bakin prompt' })
      const merged = mergeJob(job, sidecar, defaultOwner)
      expect(merged.taskPrompt).toBe('Bakin prompt')
      expect(merged.requireTriage).toBe(false)
    })

    it('normalizes kind/expr to type/value', () => {
      const job = makeRuntimeJob({ schedule: { kind: 'cron', expr: '30 8 * * 1-5' } })
      const merged = mergeJob(job, undefined, defaultOwner)
      expect(merged.schedule.type).toBe('cron')
      expect(merged.schedule.value).toBe('30 8 * * 1-5')
    })
  })

  describe('readMergedJobs', () => {
    it('returns empty array when no runtime jobs exist', async () => {
      const jobs = await readMergedJobs(cronReader([]), defaultOwner)
      expect(jobs).toEqual([])
    })

    it('merges runtime jobs with sidecar data', async () => {
      writeSidecarFile({
        version: 1,
        jobs: {
          'j1': makeMeta({ jobId: 'j1', displayName: 'Morning', agentId: 'chef' }),
        },
      })

      const jobs = await readMergedJobs(cronReader([
        makeCronJob({ id: 'j1', name: 'Job 1', schedule: '0 9 * * *' }),
        makeCronJob({ id: 'j2', name: 'Job 2', schedule: '0 17 * * *' }),
      ]), defaultOwner)
      expect(jobs).toHaveLength(2)

      const j1 = jobs.find(j => j.id === 'j1')!
      expect(j1.isBakinJob).toBe(true)
      expect(j1.displayName).toBe('Morning')
      expect(j1.agentId).toBe('chef')

      const j2 = jobs.find(j => j.id === 'j2')!
      expect(j2.isBakinJob).toBe(false)
      expect(j2.displayName).toBe('Job 2')
    })

    it('sweeps stale NON-Bakin sidecar orphans but keeps Bakin schedules', async () => {
      writeSidecarFile({
        version: 1,
        jobs: {
          active: makeMeta({ jobId: 'active' }),
          // A native cron deleted out-of-band — should be swept.
          nativeOrphan: makeMeta({ jobId: 'nativeOrphan', isBakinJob: false }),
          // A store-owned Bakin schedule with no runtime cron — must be KEPT.
          bakinOwned: makeMeta({ jobId: 'bakinOwned', schedule: { kind: 'cron', expr: '0 9 * * *' } }),
        },
      })

      await readMergedJobs(cronReader([
        makeCronJob({ id: 'active', name: 'Active' }),
      ]), defaultOwner)

      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as ScheduleSidecar
      expect(sidecar.jobs.active).toBeDefined()
      expect(sidecar.jobs.nativeOrphan).toBeUndefined()
      expect(sidecar.jobs.bakinOwned).toBeDefined()
    })

    it('degrades to Bakin-owned schedules when the runtime cron read fails', async () => {
      writeSidecarFile({
        version: 1,
        jobs: {
          bakinOwned: makeMeta({ jobId: 'bakinOwned', displayName: 'Survivor', schedule: { kind: 'cron', expr: '0 9 * * *' } }),
          // Non-Bakin sidecar entry: looks orphaned when the runtime read
          // fails, but must NOT be swept on a failed read.
          nativeEntry: makeMeta({ jobId: 'nativeEntry', isBakinJob: false }),
        },
      })

      const failingReader = { list: async () => { throw new Error('OpenClaw command failed (ENOENT): openclaw cron list') } }
      const jobs = await readMergedJobs(failingReader as Parameters<typeof readMergedJobs>[0], defaultOwner)
      expect(jobs).toHaveLength(1)
      expect(jobs[0].id).toBe('bakinOwned')

      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as ScheduleSidecar
      expect(sidecar.jobs.nativeEntry).toBeDefined()
    })

    it('degrades to Bakin-owned schedules on a runtime WITHOUT native cron (P2.1) — and never sweeps', async () => {
      writeSidecarFile({
        version: 1,
        jobs: {
          bakinOwned: makeMeta({ jobId: 'bakinOwned', displayName: 'Survivor', schedule: { kind: 'cron', expr: '0 9 * * *' } }),
          // Dormant native metadata (from a channel/cron-bearing runtime) must
          // survive the switch and be intact on switch-back.
          nativeEntry: makeMeta({ jobId: 'nativeEntry', isBakinJob: false }),
        },
      })

      const jobs = await readMergedJobs(undefined, defaultOwner)
      expect(jobs).toHaveLength(1)
      expect(jobs[0].id).toBe('bakinOwned')

      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as ScheduleSidecar
      expect(sidecar.jobs.nativeEntry).toBeDefined()
    })

    it('surfaces store-owned Bakin schedules that have no runtime cron', async () => {
      writeSidecarFile({
        version: 1,
        jobs: {
          owned: makeMeta({
            jobId: 'owned',
            displayName: 'Daily Scramble',
            schedule: { kind: 'cron', expr: '0 9 * * *' },
            enabled: true,
          }),
        },
      })

      const jobs = await readMergedJobs(cronReader([]), defaultOwner)
      expect(jobs).toHaveLength(1)
      const owned = jobs[0]
      expect(owned.id).toBe('owned')
      expect(owned.isBakinJob).toBe(true)
      expect(owned.canAdopt).toBe(false)
      expect(owned.schedule.value).toBe('0 9 * * *')
      expect(owned.humanSchedule).toBe('Daily at 9am')
      expect(owned.enabled).toBe(true)
    })

    it('computes a future next-run for a store-owned cron schedule', async () => {
      writeSidecarFile({
        version: 1,
        jobs: {
          owned: makeMeta({ jobId: 'owned', schedule: { kind: 'cron', expr: '0 9 * * *' }, tz: 'America/Denver' }),
        },
      })
      const jobs = await readMergedJobs(cronReader([]), defaultOwner)
      expect(jobs[0].nextRun).toBeDefined()
      expect(Date.parse(jobs[0].nextRun!)).toBeGreaterThan(Date.now())
    })

    it('reflects the store enabled=false flag on a store-owned schedule', async () => {
      writeSidecarFile({
        version: 1,
        jobs: {
          owned: makeMeta({ jobId: 'owned', schedule: { kind: 'cron', expr: '0 9 * * *' }, enabled: false }),
        },
      })
      const jobs = await readMergedJobs(cronReader([]), defaultOwner)
      expect(jobs[0].enabled).toBe(false)
    })
  })
  describe('one-shot merged view', () => {
    it('an unfired future one-shot: not completed, nextRun is its instant', async () => {
      const AT = '2030-01-15T16:00:00.000Z'
      writeSidecarFile({
        version: 1,
        jobs: { once: makeMeta({ jobId: 'once', schedule: { kind: 'at', expr: AT } }) },
      })
      const jobs = await readMergedJobs(cronReader([]), defaultOwner)
      expect(jobs[0].schedule.type).toBe('at')
      expect(jobs[0].completed).toBe(false)
      expect(jobs[0].nextRun).toBe(AT)
      expect(jobs[0].humanSchedule).toContain('Once')
    })

    it('a fired one-shot reads completed: disabled, completedAt set, no nextRun', async () => {
      const AT = '2026-06-07T15:00:00.000Z'
      writeSidecarFile({
        version: 1,
        jobs: {
          once: makeMeta({ jobId: 'once', schedule: { kind: 'at', expr: AT }, enabled: false, completedAt: AT }),
        },
      })
      const jobs = await readMergedJobs(cronReader([]), defaultOwner)
      expect(jobs[0].completed).toBe(true)
      expect(jobs[0].completedAt).toBe(AT)
      expect(jobs[0].enabled).toBe(false)
      expect(jobs[0].nextRun).toBeUndefined()
    })

    it('a cron job is never completed', async () => {
      writeSidecarFile({
        version: 1,
        jobs: { daily: makeMeta({ jobId: 'daily', schedule: { kind: 'cron', expr: '0 9 * * *' } }) },
      })
      const jobs = await readMergedJobs(cronReader([]), defaultOwner)
      expect(jobs[0].completed).toBe(false)
      expect(jobs[0].nextRun).toBeDefined()
    })
  })
})
