/**
 * Tests for schedule plugin routes and exec tools.
 * Covers all API routes (except /bridge, tested in bridge.test.ts)
 * and all bakin_exec_schedule_* tools.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { BakinJobMeta, MergedJob, RunEntry } from '@bakin/schedule/types'
import type { ActivatedPlugin } from '../test-helpers'

// ---------------------------------------------------------------------------
// Temp directory
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `bakin-test-schedule-routes-${Date.now()}`)
const sidecarDir = join(testDir, 'schedule')

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

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

vi.mock('../../../src/core/audit', () => ({
  appendAudit: vi.fn(),
}))

const mockCreateTask = vi.fn((_opts?: unknown) => Promise.resolve({ id: 'task-new', workflowId: undefined }))
vi.mock('../../../src/core/task-service', () => ({
  createTaskWithEffects: (opts: unknown) => mockCreateTask(opts),
}))

// Mock plugin-registry (hook registry used by bridge — not under test here but must be present)
vi.mock('../../../src/lib/plugin-registry', () => ({
  getHookRegistry: () => ({
    invoke: vi.fn(async () => undefined),
    register: vi.fn(() => () => {}),
    has: vi.fn(() => false),
  }),
}))

// Mock openclaw-cron
const mockCronAdd = vi.fn((..._args: unknown[]) => Promise.resolve('new-job-id'))
const mockCronEdit = vi.fn((..._args: unknown[]) => Promise.resolve())
const mockCronRemove = vi.fn((..._args: unknown[]) => Promise.resolve())
const mockCronRun = vi.fn((..._args: unknown[]) => Promise.resolve())

vi.mock('@bakin/schedule/lib/openclaw-cron', () => ({
  cronAdd: (...args: unknown[]) => mockCronAdd(...args),
  cronEdit: (...args: unknown[]) => mockCronEdit(...args),
  cronRemove: (...args: unknown[]) => mockCronRemove(...args),
  cronRun: (...args: unknown[]) => mockCronRun(...args),
  cronList: vi.fn(() => Promise.resolve([])),
}))

// Mock jobs-reader — we control what readMergedJobs returns
const mockMergedJobs: MergedJob[] = []
vi.mock('@bakin/schedule/lib/jobs-reader', () => ({
  readMergedJobs: () => mockMergedJobs,
}))

// Mock runs-reader
const mockRuns: RunEntry[] = []
const mockLastRun: RunEntry | null = null
let lastRunOverride: RunEntry | null = null

vi.mock('@bakin/schedule/lib/runs-reader', () => ({
  readRuns: (_jobId: string, _limit?: number) => mockRuns,
  getLastRun: (_jobId: string) => lastRunOverride,
}))

// Mock cron-parser — parseSchedule and cronToHuman
vi.mock('@bakin/schedule/lib/cron-parser', () => ({
  parseSchedule: (input: string) => {
    if (input === 'bad-expr') return null
    // Raw cron passes through
    if (/^[\d*,\-/]+\s/.test(input)) {
      return { cron: input, human: `Cron: ${input}`, confidence: 'high', source: 'raw', nextRuns: [] }
    }
    // NL → fake cron
    return { cron: '0 9 * * *', human: `Every day at 9am`, confidence: 'high', source: 'deterministic', nextRuns: [] }
  },
  cronToHuman: (cron: string) => `Human: ${cron}`,
}))

// We need real sidecar since routes mutate state on disk via upsertJob/getJob/removeJob.
// The sidecar module reads getContentDir() which returns testDir, so it uses our temp dir.
// Do NOT mock sidecar — let it hit the filesystem.

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { activatePlugin, findRoute, findTool, callRoute, callTool } from '../test-helpers'
import schedulePlugin from '@bakin/schedule/index'
import { upsertJob, getJob } from '@bakin/schedule/lib/sidecar'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeta(overrides: Partial<BakinJobMeta> = {}): BakinJobMeta {
  return {
    jobId: 'job-123',
    isBakinJob: true,
    displayName: 'Daily Report',
    agentId: 'chef',
    owner: 'main-operator',
    taskPrompt: 'Generate daily report',
    taskTitle: 'Report: {date}',
    allowOverlap: false,
    maxFailures: 3,
    consecutiveFailures: 0,
    createdAt: '2026-03-30T00:00:00Z',
    updatedAt: '2026-03-30T00:00:00Z',
    ...overrides,
  }
}

function makeMergedJob(overrides: Partial<MergedJob> = {}): MergedJob {
  return {
    id: 'job-123',
    name: 'Daily Report',
    schedule: { type: 'cron', value: '0 9 * * *' },
    enabled: true,
    isBakinJob: true,
    displayName: 'Daily Report',
    agentId: 'chef',
    owner: 'main-operator',
    requireTriage: false,
    paused: false,
    allowOverlap: false,
    maxFailures: 3,
    consecutiveFailures: 0,
    humanSchedule: 'Daily at 9am',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let plugin: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(sidecarDir, { recursive: true })
  plugin = await activatePlugin(schedulePlugin, testDir)
})

beforeEach(() => {
  vi.clearAllMocks()
  mockMergedJobs.length = 0
  mockRuns.length = 0
  lastRunOverride = null
  // Reset sidecar on disk
  writeFileSync(join(sidecarDir, 'sidecar.json'), JSON.stringify({ version: 1, jobs: {} }))
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ===========================================================================
// Routes
// ===========================================================================

describe('schedule search indexing', () => {
  it('indexes existing runtime jobs on activation with searchable schedule text', async () => {
    mockMergedJobs.push(makeMergedJob({
      id: 'job-search-1',
      displayName: 'Weekly planning',
      humanSchedule: 'Every Monday at 9am',
      taskPrompt: 'Create the weekly planning task',
      paused: false,
      enabled: true,
    }))

    const activated = await activatePlugin(schedulePlugin, testDir)

    expect(activated.ctx.search.index).toHaveBeenCalledWith('job-search-1', expect.objectContaining({
      name: 'Weekly planning',
      schedule: 'Every Monday at 9am',
      command: 'Create the weekly planning task',
      agent: 'chef',
      enabled: 'true',
    }))
  })
})

describe('schedule routes', () => {
  // -----------------------------------------------------------------------
  // GET / — list all jobs
  // -----------------------------------------------------------------------
  describe('GET /', () => {
    it('returns empty jobs array when no jobs exist', async () => {
      const route = findRoute(plugin.routes, 'GET', '/')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, plugin.ctx)
      expect(status).toBe(200)
      expect(body.jobs).toEqual([])
    })

    it('returns merged jobs with cron field for cron-type schedules', async () => {
      mockMergedJobs.push(
        makeMergedJob({ id: 'j1', schedule: { type: 'cron', value: '0 9 * * *' } }),
        makeMergedJob({ id: 'j2', schedule: { type: 'every', value: '60000' }, isBakinJob: false }),
      )

      const route = findRoute(plugin.routes, 'GET', '/')!
      const { status, body } = await callRoute(route, plugin.ctx)
      expect(status).toBe(200)

      const jobs = body.jobs as Array<Record<string, unknown>>
      expect(jobs).toHaveLength(2)
      expect(jobs[0].cron).toBe('0 9 * * *')
      expect(jobs[1].cron).toBeUndefined() // 'every' type has no cron field
    })
  })

  // -----------------------------------------------------------------------
  // POST / — create a job
  // -----------------------------------------------------------------------
  describe('POST /', () => {
    it('creates a job and returns jobId, cron, human, tz', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, plugin.ctx, {
        body: {
          name: 'Morning Tasks',
          schedule: 'every day at 9am',
          agentId: 'chef',
          taskPrompt: 'Do morning routine',
        },
      })

      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.jobId).toBe('new-job-id')
      expect(body.cron).toBe('0 9 * * *')
      expect(body.human).toBe('Every day at 9am')
      expect(body.tz).toBeDefined()

      // Verify cronAdd was called
      expect(mockCronAdd).toHaveBeenCalledOnce()
      const addArgs = (mockCronAdd.mock.calls[0] as unknown[])[0] as Record<string, unknown>
      expect(addArgs.name).toBe('Morning Tasks')
      expect(addArgs.cron).toBe('0 9 * * *')

      // Verify sidecar entry created
      const meta = getJob('new-job-id')
      expect(meta).not.toBeNull()
      expect(meta!.displayName).toBe('Morning Tasks')
      expect(meta!.agentId).toBe('chef')
      expect(meta!.isBakinJob).toBe(true)

      // Verify audit
      expect(plugin.ctx.activity.audit).toHaveBeenCalled()
      expect(plugin.ctx.activity.log).toHaveBeenCalled()
    })

    it('returns 400 when name is missing', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { schedule: '0 9 * * *' },
      })
      expect(status).toBe(400)
      expect(body.error).toContain('name and schedule are required')
    })

    it('returns 400 when schedule is missing', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { name: 'Test' },
      })
      expect(status).toBe(400)
      expect(body.error).toContain('name and schedule are required')
    })

    it('returns 400 for unparseable schedule expression', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { name: 'Test', schedule: 'bad-expr' },
      })
      expect(status).toBe(400)
      expect(body.error).toContain('Could not parse')
    })

    it('defaults owner to the main agent', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      await callRoute(route, plugin.ctx, {
        body: { name: 'No Owner', schedule: '0 9 * * *' },
      })
      const meta = getJob('new-job-id')
      expect(meta!.owner).toBe('main')
    })

    it('respects provided optional fields', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      await callRoute(route, plugin.ctx, {
        body: {
          name: 'Full Job',
          schedule: '0 9 * * *',
          agentId: 'pixel',
          workflowId: 'wf-abc',
          taskPrompt: 'Generate report for {date}',
          taskTitle: 'Report {date}',
          owner: 'mark',
          requireTriage: true,
          allowOverlap: true,
          maxFailures: 5,
        },
      })
      const meta = getJob('new-job-id')
      expect(meta!.agentId).toBe('pixel')
      expect(meta!.workflowId).toBe('wf-abc')
      expect(meta!.taskPrompt).toBe('Generate report for {date}')
      expect(meta!.taskTitle).toBe('Report {date}')
      expect(meta!.owner).toBe('mark')
      expect(meta!.requireTriage).toBe(true)
      expect(meta!.allowOverlap).toBe(true)
      expect(meta!.maxFailures).toBe(5)
    })
  })

  // -----------------------------------------------------------------------
  // PUT /:jobId — update a job
  // -----------------------------------------------------------------------
  describe('PUT /:jobId', () => {
    it('updates sidecar fields for an existing job', async () => {
      upsertJob(makeMeta({ jobId: 'job-123' }))

      const route = findRoute(plugin.routes, 'PUT', '/:jobId')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-123' },
        body: {
          displayName: 'Updated Report',
          agentId: 'pixel',
          taskPrompt: 'New prompt',
        },
      })

      expect(status).toBe(200)
      expect(body.ok).toBe(true)

      const meta = getJob('job-123')
      expect(meta!.displayName).toBe('Updated Report')
      expect(meta!.agentId).toBe('pixel')
      expect(meta!.taskPrompt).toBe('New prompt')
    })

    it('returns 400 when jobId is not provided', async () => {
      const route = findRoute(plugin.routes, 'PUT', '/:jobId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { displayName: 'Updated' },
      })
      expect(status).toBe(400)
      expect(body.error).toContain('jobId required')
    })

    it('returns 404 for non-existent job', async () => {
      const route = findRoute(plugin.routes, 'PUT', '/:jobId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'missing-job' },
        body: { displayName: 'Updated' },
      })
      expect(status).toBe(404)
      expect(body.error).toContain('not found')
    })

    it('calls cronEdit when schedule is changed', async () => {
      upsertJob(makeMeta({ jobId: 'job-123' }))

      const route = findRoute(plugin.routes, 'PUT', '/:jobId')!
      await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-123' },
        body: { schedule: '0 10 * * *' },
      })

      expect(mockCronEdit).toHaveBeenCalledWith('job-123', { cron: '0 10 * * *' })
    })

    it('calls cronEdit when name is changed', async () => {
      upsertJob(makeMeta({ jobId: 'job-123' }))

      const route = findRoute(plugin.routes, 'PUT', '/:jobId')!
      await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-123' },
        body: { name: 'Renamed Job' },
      })

      expect(mockCronEdit).toHaveBeenCalledWith('job-123', { name: 'Renamed Job' })
    })

    it('returns 400 for bad schedule expression on update', async () => {
      upsertJob(makeMeta({ jobId: 'job-123' }))

      const route = findRoute(plugin.routes, 'PUT', '/:jobId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-123' },
        body: { schedule: 'bad-expr' },
      })
      expect(status).toBe(400)
      expect(body.error).toContain('Could not parse')
    })

    it('reads jobId from body when not in searchParams', async () => {
      upsertJob(makeMeta({ jobId: 'job-123' }))

      const route = findRoute(plugin.routes, 'PUT', '/:jobId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { jobId: 'job-123', displayName: 'From Body' },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)

      const meta = getJob('job-123')
      expect(meta!.displayName).toBe('From Body')
    })

    it('audits and logs the update', async () => {
      upsertJob(makeMeta({ jobId: 'job-123' }))

      const route = findRoute(plugin.routes, 'PUT', '/:jobId')!
      await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-123' },
        body: { displayName: 'Audited' },
      })

      expect(plugin.ctx.activity.audit).toHaveBeenCalledWith('job.updated', 'system', expect.objectContaining({ jobId: 'job-123' }))
      expect(plugin.ctx.activity.log).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // DELETE /:jobId — delete a job
  // -----------------------------------------------------------------------
  describe('DELETE /:jobId', () => {
    it('deletes a job from openclaw and sidecar', async () => {
      upsertJob(makeMeta({ jobId: 'job-del' }))

      const route = findRoute(plugin.routes, 'DELETE', '/:jobId')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-del' },
        body: {},
      })

      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(mockCronRemove).toHaveBeenCalledWith('job-del')
      expect(getJob('job-del')).toBeNull()
    })

    it('returns 400 when jobId is not provided', async () => {
      const route = findRoute(plugin.routes, 'DELETE', '/:jobId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: {},
      })
      expect(status).toBe(400)
      expect(body.error).toContain('jobId required')
    })

    it('reads jobId from body when not in searchParams', async () => {
      upsertJob(makeMeta({ jobId: 'job-body-del' }))

      const route = findRoute(plugin.routes, 'DELETE', '/:jobId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { jobId: 'job-body-del' },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(mockCronRemove).toHaveBeenCalledWith('job-body-del')
    })

    it('audits and logs the deletion', async () => {
      upsertJob(makeMeta({ jobId: 'job-audit-del' }))

      const route = findRoute(plugin.routes, 'DELETE', '/:jobId')!
      await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-audit-del' },
        body: {},
      })

      expect(plugin.ctx.activity.audit).toHaveBeenCalledWith('job.deleted', 'system', expect.objectContaining({ jobId: 'job-audit-del' }))
      expect(plugin.ctx.activity.log).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // POST /:jobId/pause — pause/resume/skip
  // -----------------------------------------------------------------------
  describe('POST /:jobId/pause', () => {
    it('pauses a job', async () => {
      upsertJob(makeMeta({ jobId: 'job-pause' }))

      const route = findRoute(plugin.routes, 'POST', '/:jobId/pause')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-pause' },
        body: { action: 'pause' },
      })

      expect(status).toBe(200)
      expect(body.ok).toBe(true)

      const meta = getJob('job-pause')
      expect(meta!.paused).toBe(true)
      expect(meta!.pauseReason).toBe('manual')
    })

    it('pauses with pauseUntil date', async () => {
      upsertJob(makeMeta({ jobId: 'job-pause-until' }))

      const route = findRoute(plugin.routes, 'POST', '/:jobId/pause')!
      await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-pause-until' },
        body: { action: 'pause', pauseUntil: '2026-04-15T00:00:00Z' },
      })

      const meta = getJob('job-pause-until')
      expect(meta!.paused).toBe(true)
      expect(meta!.pauseUntil).toBe('2026-04-15T00:00:00Z')
    })

    it('resumes a paused job and clears all pause/skip/failure state', async () => {
      upsertJob(makeMeta({
        jobId: 'job-resume',
        paused: true,
        pauseReason: 'auto-failures',
        pauseUntil: '2026-04-15T00:00:00Z',
        skipNextN: 3,
        skippedCount: 1,
        consecutiveFailures: 2,
      }))

      const route = findRoute(plugin.routes, 'POST', '/:jobId/pause')!
      await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-resume' },
        body: { action: 'resume' },
      })

      const meta = getJob('job-resume')
      expect(meta!.paused).toBe(false)
      expect(meta!.pauseReason).toBeUndefined()
      expect(meta!.pauseUntil).toBeUndefined()
      expect(meta!.skipNextN).toBeUndefined()
      expect(meta!.skippedCount).toBeUndefined()
      expect(meta!.consecutiveFailures).toBe(0)
    })

    it('sets skip-next-N on a job', async () => {
      upsertJob(makeMeta({ jobId: 'job-skip' }))

      const route = findRoute(plugin.routes, 'POST', '/:jobId/pause')!
      await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-skip' },
        body: { action: 'skip', skipN: 5 },
      })

      const meta = getJob('job-skip')
      expect(meta!.skipNextN).toBe(5)
      expect(meta!.skippedCount).toBe(0)
    })

    it('defaults skip to 1 when skipN not provided', async () => {
      upsertJob(makeMeta({ jobId: 'job-skip-1' }))

      const route = findRoute(plugin.routes, 'POST', '/:jobId/pause')!
      await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-skip-1' },
        body: { action: 'skip' },
      })

      const meta = getJob('job-skip-1')
      expect(meta!.skipNextN).toBe(1)
    })

    it('returns 400 when jobId or action is missing', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:jobId/pause')!

      const { status: s1, body: b1 } = await callRoute(route, plugin.ctx, {
        body: { action: 'pause' },
      })
      expect(s1).toBe(400)
      expect(b1.error).toContain('jobId and action required')

      upsertJob(makeMeta({ jobId: 'job-no-action' }))
      const { status: s2, body: b2 } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-no-action' },
        body: {},
      })
      expect(s2).toBe(400)
      expect(b2.error).toContain('jobId and action required')
    })

    it('returns 404 for non-existent job', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:jobId/pause')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'ghost-job' },
        body: { action: 'pause' },
      })
      expect(status).toBe(404)
      expect(body.error).toContain('not found')
    })

    it('audits the pause action', async () => {
      upsertJob(makeMeta({ jobId: 'job-audit-pause' }))

      const route = findRoute(plugin.routes, 'POST', '/:jobId/pause')!
      await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-audit-pause' },
        body: { action: 'pause' },
      })

      expect(plugin.ctx.activity.audit).toHaveBeenCalledWith('job.pause', 'system', expect.objectContaining({ jobId: 'job-audit-pause' }))
    })
  })

  // -----------------------------------------------------------------------
  // POST /:jobId/run — trigger immediate run
  // -----------------------------------------------------------------------
  describe('POST /:jobId/run', () => {
    it('triggers an immediate run via cronRun', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:jobId/run')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-run' },
        body: {},
      })

      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(mockCronRun).toHaveBeenCalledWith('job-run', true)
    })

    it('returns 400 when jobId is missing', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:jobId/run')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: {},
      })
      expect(status).toBe(400)
      expect(body.error).toContain('jobId required')
    })

    it('reads jobId from body when not in searchParams', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:jobId/run')!
      const { status } = await callRoute(route, plugin.ctx, {
        body: { jobId: 'job-from-body' },
      })
      expect(status).toBe(200)
      expect(mockCronRun).toHaveBeenCalledWith('job-from-body', true)
    })

    it('audits and logs the run_now action', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:jobId/run')!
      await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-audit-run' },
        body: {},
      })

      expect(plugin.ctx.activity.audit).toHaveBeenCalledWith('job.run_now', 'system', expect.objectContaining({ jobId: 'job-audit-run' }))
      expect(plugin.ctx.activity.log).toHaveBeenCalled()
    })
  })

  // -----------------------------------------------------------------------
  // GET /:jobId/runs — run history
  // -----------------------------------------------------------------------
  describe('GET /:jobId/runs', () => {
    it('returns run history for a job', async () => {
      mockRuns.push(
        { runId: 'r1', jobId: 'job-123', timestamp: '2026-03-30T09:00:00Z', status: 'success', taskId: 'task-1' },
        { runId: 'r2', jobId: 'job-123', timestamp: '2026-03-31T09:00:00Z', status: 'failure', error: 'timeout' },
      )

      const route = findRoute(plugin.routes, 'GET', '/:jobId/runs')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-123' },
      })

      expect(status).toBe(200)
      const runs = body.runs as RunEntry[]
      expect(runs).toHaveLength(2)
      expect(runs[0].runId).toBe('r1')
    })

    it('returns 400 when jobId is missing', async () => {
      const route = findRoute(plugin.routes, 'GET', '/:jobId/runs')!
      const { status, body } = await callRoute(route, plugin.ctx)
      expect(status).toBe(400)
      expect(body.error).toContain('jobId query param required')
    })

    it('returns empty array when no runs exist', async () => {
      const route = findRoute(plugin.routes, 'GET', '/:jobId/runs')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-no-runs' },
      })
      expect(status).toBe(200)
      expect(body.runs).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // POST /parse — parse schedule expression
  // -----------------------------------------------------------------------
  describe('POST /parse', () => {
    it('parses a natural language schedule expression', async () => {
      const route = findRoute(plugin.routes, 'POST', '/parse')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { input: 'every day at 9am' },
      })

      expect(status).toBe(200)
      expect(body.cron).toBe('0 9 * * *')
      expect(body.human).toBe('Every day at 9am')
    })

    it('parses a raw cron expression', async () => {
      const route = findRoute(plugin.routes, 'POST', '/parse')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { input: '*/15 * * * *' },
      })

      expect(status).toBe(200)
      expect(body.cron).toBe('*/15 * * * *')
    })

    it('returns 400 when input is missing', async () => {
      const route = findRoute(plugin.routes, 'POST', '/parse')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: {},
      })
      expect(status).toBe(400)
      expect(body.error).toContain('input required')
    })

    it('returns 400 for unparseable expression', async () => {
      const route = findRoute(plugin.routes, 'POST', '/parse')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { input: 'bad-expr' },
      })
      expect(status).toBe(400)
      expect(body.error).toContain('Could not parse')
    })
  })

  // -----------------------------------------------------------------------
  // Bridge route is skipped (tested in bridge.test.ts)
  // -----------------------------------------------------------------------
  it('registers a /bridge route', () => {
    const route = findRoute(plugin.routes, 'POST', '/bridge')
    expect(route).toBeDefined()
  })
})

// ===========================================================================
// Exec Tools
// ===========================================================================

describe('schedule exec tools', () => {
  // -----------------------------------------------------------------------
  // bakin_exec_schedule_list
  // -----------------------------------------------------------------------
  describe('bakin_exec_schedule_list', () => {
    it('returns all merged jobs', async () => {
      mockMergedJobs.push(
        makeMergedJob({ id: 'j1', displayName: 'Job One', agentId: 'chef' }),
        makeMergedJob({ id: 'j2', displayName: 'Job Two', isBakinJob: false }),
      )

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_list')!
      expect(tool).toBeDefined()

      const result = await callTool(tool, {})
      expect(result.ok).toBe(true)

      const jobs = result.jobs as Array<Record<string, unknown>>
      expect(jobs).toHaveLength(2)
      expect(jobs[0].id).toBe('j1')
      expect(jobs[0].name).toBe('Job One')
    })

    it('filters by bakin jobs only', async () => {
      mockMergedJobs.push(
        makeMergedJob({ id: 'j1', isBakinJob: true }),
        makeMergedJob({ id: 'j2', isBakinJob: false }),
      )

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_list')!
      const result = await callTool(tool, { filter: 'bakin' })

      const jobs = result.jobs as Array<Record<string, unknown>>
      expect(jobs).toHaveLength(1)
      expect(jobs[0].id).toBe('j1')
    })

    it('filters by agentId', async () => {
      mockMergedJobs.push(
        makeMergedJob({ id: 'j1', agentId: 'chef' }),
        makeMergedJob({ id: 'j2', agentId: 'pixel' }),
        makeMergedJob({ id: 'j3', agentId: 'chef' }),
      )

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_list')!
      const result = await callTool(tool, { agentId: 'chef' })

      const jobs = result.jobs as Array<Record<string, unknown>>
      expect(jobs).toHaveLength(2)
      expect(jobs.every(j => j.agent === 'chef')).toBe(true)
    })

    it('returns correct shape per job', async () => {
      mockMergedJobs.push(makeMergedJob({
        id: 'j1',
        displayName: 'Test',
        agentId: 'chef',
        humanSchedule: 'Daily at 9am',
        paused: true,
        isBakinJob: true,
        lastTaskId: 'task-99',
      }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_list')!
      const result = await callTool(tool, {})

      const jobs = result.jobs as Array<Record<string, unknown>>
      const job = jobs[0]
      expect(job).toEqual({
        id: 'j1',
        name: 'Test',
        agent: 'chef',
        schedule: 'Daily at 9am',
        paused: true,
        isBakinJob: true,
        lastTaskId: 'task-99',
      })
    })
  })

  // -----------------------------------------------------------------------
  // bakin_exec_schedule_create
  // -----------------------------------------------------------------------
  describe('bakin_exec_schedule_create', () => {
    it('creates a job and returns jobId + cron info', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_create')!
      expect(tool).toBeDefined()

      const result = await callTool(tool, {
        name: 'Nightly Digest',
        schedule: 'every day at 10pm',
        agentId: 'pixel',
        taskPrompt: 'Compile digest',
      })

      expect(result.ok).toBe(true)
      expect(result.jobId).toBe('new-job-id')
      expect(result.cron).toBe('0 9 * * *')
      expect(result.tz).toBeDefined()

      expect(mockCronAdd).toHaveBeenCalledOnce()

      // Verify sidecar
      const meta = getJob('new-job-id')
      expect(meta!.displayName).toBe('Nightly Digest')
      expect(meta!.agentId).toBe('pixel')
      expect(meta!.isBakinJob).toBe(true)
      expect(meta!.owner).toBe('main')
      expect(meta!.allowOverlap).toBe(false)
      expect(meta!.maxFailures).toBe(3)
      expect(meta!.consecutiveFailures).toBe(0)
    })

    it('returns error when name is missing', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_create')!
      const result = await callTool(tool, { schedule: '0 9 * * *' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('name and schedule are required')
    })

    it('returns error when schedule is missing', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_create')!
      const result = await callTool(tool, { name: 'Test' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('name and schedule are required')
    })

    it('returns error for unparseable schedule', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_create')!
      const result = await callTool(tool, { name: 'Test', schedule: 'bad-expr' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Could not parse')
    })
  })

  // -----------------------------------------------------------------------
  // bakin_exec_schedule_update
  // -----------------------------------------------------------------------
  describe('bakin_exec_schedule_update', () => {
    it('updates sidecar and openclaw fields', async () => {
      upsertJob(makeMeta({ jobId: 'job-upd' }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_update')!
      expect(tool).toBeDefined()

      const result = await callTool(tool, {
        jobId: 'job-upd',
        name: 'Renamed',
        agentId: 'pixel',
        taskPrompt: 'Updated prompt',
      })

      expect(result.ok).toBe(true)

      // cronEdit called for name change
      expect(mockCronEdit).toHaveBeenCalledWith('job-upd', { name: 'Renamed' })

      const meta = getJob('job-upd')
      expect(meta!.displayName).toBe('Renamed')
      expect(meta!.agentId).toBe('pixel')
      expect(meta!.taskPrompt).toBe('Updated prompt')
    })

    it('calls cronEdit when schedule is changed', async () => {
      upsertJob(makeMeta({ jobId: 'job-upd-sched' }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_update')!
      await callTool(tool, {
        jobId: 'job-upd-sched',
        schedule: '0 10 * * *',
      })

      expect(mockCronEdit).toHaveBeenCalledWith('job-upd-sched', { cron: '0 10 * * *' })
    })

    it('returns error when jobId is missing', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_update')!
      const result = await callTool(tool, { name: 'Test' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('jobId required')
    })

    it('returns error for non-existent job', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_update')!
      const result = await callTool(tool, { jobId: 'ghost', name: 'Test' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('returns error for bad schedule expression', async () => {
      upsertJob(makeMeta({ jobId: 'job-bad-sched' }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_update')!
      const result = await callTool(tool, { jobId: 'job-bad-sched', schedule: 'bad-expr' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Could not parse')
    })
  })

  // -----------------------------------------------------------------------
  // bakin_exec_schedule_pause
  // -----------------------------------------------------------------------
  describe('bakin_exec_schedule_pause', () => {
    it('pauses a job', async () => {
      upsertJob(makeMeta({ jobId: 'job-p' }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_pause')!
      expect(tool).toBeDefined()

      const result = await callTool(tool, { jobId: 'job-p', action: 'pause' })
      expect(result.ok).toBe(true)

      const meta = getJob('job-p')
      expect(meta!.paused).toBe(true)
      expect(meta!.pauseReason).toBe('manual')
    })

    it('pauses with pauseUntil', async () => {
      upsertJob(makeMeta({ jobId: 'job-pu' }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_pause')!
      await callTool(tool, { jobId: 'job-pu', action: 'pause', pauseUntil: '2026-05-01T00:00:00Z' })

      const meta = getJob('job-pu')
      expect(meta!.pauseUntil).toBe('2026-05-01T00:00:00Z')
    })

    it('resumes a job and clears all state', async () => {
      upsertJob(makeMeta({
        jobId: 'job-r',
        paused: true,
        pauseReason: 'auto-failures',
        pauseUntil: '2026-05-01T00:00:00Z',
        skipNextN: 2,
        skippedCount: 1,
        consecutiveFailures: 3,
      }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_pause')!
      await callTool(tool, { jobId: 'job-r', action: 'resume' })

      const meta = getJob('job-r')
      expect(meta!.paused).toBe(false)
      expect(meta!.pauseReason).toBeUndefined()
      expect(meta!.pauseUntil).toBeUndefined()
      expect(meta!.skipNextN).toBeUndefined()
      expect(meta!.skippedCount).toBeUndefined()
      expect(meta!.consecutiveFailures).toBe(0)
    })

    it('sets skip-next-N', async () => {
      upsertJob(makeMeta({ jobId: 'job-s' }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_pause')!
      await callTool(tool, { jobId: 'job-s', action: 'skip', skipN: 3 })

      const meta = getJob('job-s')
      expect(meta!.skipNextN).toBe(3)
      expect(meta!.skippedCount).toBe(0)
    })

    it('defaults skip to 1', async () => {
      upsertJob(makeMeta({ jobId: 'job-s1' }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_pause')!
      await callTool(tool, { jobId: 'job-s1', action: 'skip' })

      const meta = getJob('job-s1')
      expect(meta!.skipNextN).toBe(1)
    })

    it('returns error when jobId is missing', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_pause')!
      const result = await callTool(tool, { action: 'pause' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('jobId and action required')
    })

    it('returns error when action is missing', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_pause')!
      const result = await callTool(tool, { jobId: 'job-p' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('jobId and action required')
    })

    it('returns error for non-existent job', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_pause')!
      const result = await callTool(tool, { jobId: 'ghost', action: 'pause' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  // -----------------------------------------------------------------------
  // bakin_exec_schedule_delete
  // -----------------------------------------------------------------------
  describe('bakin_exec_schedule_delete', () => {
    it('deletes from openclaw and sidecar', async () => {
      upsertJob(makeMeta({ jobId: 'job-del-tool' }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_delete')!
      expect(tool).toBeDefined()

      const result = await callTool(tool, { jobId: 'job-del-tool' })
      expect(result.ok).toBe(true)

      expect(mockCronRemove).toHaveBeenCalledWith('job-del-tool')
      expect(getJob('job-del-tool')).toBeNull()
    })

    it('returns error when jobId is missing', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_delete')!
      const result = await callTool(tool, {})
      expect(result.ok).toBe(false)
      expect(result.error).toContain('jobId required')
    })
  })

  // -----------------------------------------------------------------------
  // bakin_exec_schedule_get
  // -----------------------------------------------------------------------
  describe('bakin_exec_schedule_get', () => {
    it('returns detailed job info with defaults applied', async () => {
      upsertJob(makeMeta({
        jobId: 'job-get',
        displayName: 'Get Test',
        agentId: 'chef',
        workflowId: 'wf-1',
        taskPrompt: 'Do stuff',
        taskTitle: 'Title {date}',
        tz: 'America/Denver',
      }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_get')!
      expect(tool).toBeDefined()

      const result = await callTool(tool, { jobId: 'job-get' })
      expect(result.ok).toBe(true)

      const job = result.job as Record<string, unknown>
      expect(job.id).toBe('job-get')
      expect(job.name).toBe('Get Test')
      expect(job.agent).toBe('chef')
      expect(job.owner).toBe('main-operator')
      expect(job.paused).toBe(false)
      expect(job.workflowId).toBe('wf-1')
      expect(job.taskPrompt).toBe('Do stuff')
      expect(job.taskTitle).toBe('Title {date}')
      expect(job.allowOverlap).toBe(false)
      expect(job.maxFailures).toBe(3)
      expect(job.consecutiveFailures).toBe(0)
      expect(job.tz).toBe('America/Denver')
      expect(job.createdAt).toBeDefined()
      expect(job.lastRun).toBeNull()
    })

    it('includes lastRun when available', async () => {
      upsertJob(makeMeta({ jobId: 'job-get-run' }))
      lastRunOverride = { runId: 'r99', jobId: 'job-get-run', timestamp: '2026-03-31T09:00:00Z', status: 'success' }

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_get')!
      const result = await callTool(tool, { jobId: 'job-get-run' })

      const job = result.job as Record<string, unknown>
      const lastRun = job.lastRun as RunEntry
      expect(lastRun.runId).toBe('r99')
    })

    it('returns error when jobId is missing', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_get')!
      const result = await callTool(tool, {})
      expect(result.ok).toBe(false)
      expect(result.error).toContain('jobId required')
    })

    it('returns error for non-existent job', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_get')!
      const result = await callTool(tool, { jobId: 'ghost' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  // -----------------------------------------------------------------------
  // bakin_exec_schedule_run_now
  // -----------------------------------------------------------------------
  describe('bakin_exec_schedule_run_now', () => {
    it('triggers cronRun with force=true', async () => {
      upsertJob(makeMeta({ jobId: 'job-rn' }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_run_now')!
      expect(tool).toBeDefined()

      const result = await callTool(tool, { jobId: 'job-rn' })
      expect(result.ok).toBe(true)
      expect(result.jobId).toBe('job-rn')

      expect(mockCronRun).toHaveBeenCalledWith('job-rn', true)
    })

    it('audits and logs the run', async () => {
      upsertJob(makeMeta({ jobId: 'job-rn-audit', displayName: 'Audit Run' }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_run_now')!
      await callTool(tool, { jobId: 'job-rn-audit' })

      expect(plugin.ctx.activity.audit).toHaveBeenCalledWith('job.run_now', 'system', expect.objectContaining({ jobId: 'job-rn-audit' }))
    })

    it('returns error when jobId is missing', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_run_now')!
      const result = await callTool(tool, {})
      expect(result.ok).toBe(false)
      expect(result.error).toContain('jobId required')
    })

    it('returns error for non-existent job', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_run_now')!
      const result = await callTool(tool, { jobId: 'ghost' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  // -----------------------------------------------------------------------
  // bakin_exec_schedule_briefing
  // -----------------------------------------------------------------------
  describe('bakin_exec_schedule_briefing', () => {
    it('returns a complete briefing summary', async () => {
      mockMergedJobs.push(
        makeMergedJob({ id: 'j1', isBakinJob: true, displayName: 'Active Job', paused: false, consecutiveFailures: 0 }),
        makeMergedJob({ id: 'j2', isBakinJob: true, displayName: 'Paused Job', paused: true, pauseReason: 'manual', consecutiveFailures: 0 }),
        makeMergedJob({ id: 'j3', isBakinJob: true, displayName: 'Failing Job', paused: false, consecutiveFailures: 2 }),
        makeMergedJob({ id: 'j4', isBakinJob: false, displayName: 'External Job' }),
      )

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_briefing')!
      expect(tool).toBeDefined()

      const result = await callTool(tool, {})
      expect(result.ok).toBe(true)
      expect(result.totalJobs).toBe(4)
      expect(result.bakinJobs).toBe(3)
      expect(result.active).toBe(2) // j1 + j3
      expect(result.paused).toBe(1) // j2
    })

    it('includes alerts for paused and failing jobs', async () => {
      mockMergedJobs.push(
        makeMergedJob({ id: 'j1', isBakinJob: true, paused: true, pauseReason: 'auto-failures', consecutiveFailures: 0, displayName: 'Paused' }),
        makeMergedJob({ id: 'j2', isBakinJob: true, paused: false, consecutiveFailures: 2, displayName: 'Failing' }),
        makeMergedJob({ id: 'j3', isBakinJob: true, paused: false, consecutiveFailures: 0, displayName: 'Healthy' }),
      )

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_briefing')!
      const result = await callTool(tool, {})

      const alerts = result.alerts as Array<Record<string, unknown>>
      expect(alerts).toHaveLength(2)
      expect(alerts[0].id).toBe('j1')
      expect(alerts[0].issue).toContain('Paused')
      expect(alerts[1].id).toBe('j2')
      expect(alerts[1].issue).toContain('consecutive failures')
    })

    it('uses provided date or defaults to today', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_briefing')!

      const withDate = await callTool(tool, { date: '2026-04-15' })
      expect(withDate.date).toBe('2026-04-15')

      const withoutDate = await callTool(tool, {})
      // Should be today's date in YYYY-MM-DD format
      expect(withoutDate.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('returns per-job details in the jobs array', async () => {
      mockMergedJobs.push(
        makeMergedJob({
          id: 'j1',
          isBakinJob: true,
          displayName: 'Test Job',
          agentId: 'chef',
          humanSchedule: 'Daily at 9am',
          paused: false,
          pauseReason: undefined,
          consecutiveFailures: 0,
          lastTaskId: 'task-42',
        }),
      )

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_briefing')!
      const result = await callTool(tool, {})

      const jobs = result.jobs as Array<Record<string, unknown>>
      expect(jobs).toHaveLength(1)
      expect(jobs[0]).toEqual({
        id: 'j1',
        name: 'Test Job',
        agent: 'chef',
        schedule: 'Daily at 9am',
        paused: false,
        pauseReason: undefined,
        failures: 0,
        lastTaskId: 'task-42',
      })
    })

    it('returns zeros when no bakin jobs exist', async () => {
      mockMergedJobs.push(
        makeMergedJob({ id: 'ext', isBakinJob: false }),
      )

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_briefing')!
      const result = await callTool(tool, {})

      expect(result.totalJobs).toBe(1)
      expect(result.bakinJobs).toBe(0)
      expect(result.active).toBe(0)
      expect(result.paused).toBe(0)
      expect((result.jobs as unknown[]).length).toBe(0)
      expect((result.alerts as unknown[]).length).toBe(0)
    })
  })
})

// ===========================================================================
// Plugin lifecycle
// ===========================================================================

describe('schedule plugin activation', () => {
  it('registers all expected routes', () => {
    const expectedRoutes = [
      { method: 'GET', path: '/' },
      { method: 'POST', path: '/' },
      { method: 'PUT', path: '/:jobId' },
      { method: 'DELETE', path: '/:jobId' },
      { method: 'POST', path: '/:jobId/pause' },
      { method: 'POST', path: '/:jobId/run' },
      { method: 'GET', path: '/:jobId/runs' },
      { method: 'POST', path: '/parse' },
      { method: 'POST', path: '/bridge' },
    ]

    for (const expected of expectedRoutes) {
      const route = findRoute(plugin.routes, expected.method, expected.path)
      expect(route, `Missing route: ${expected.method} ${expected.path}`).toBeDefined()
    }
  })

  it('registers all expected exec tools', () => {
    const expectedTools = [
      'bakin_exec_schedule_list',
      'bakin_exec_schedule_create',
      'bakin_exec_schedule_update',
      'bakin_exec_schedule_pause',
      'bakin_exec_schedule_delete',
      'bakin_exec_schedule_get',
      'bakin_exec_schedule_run_now',
      'bakin_exec_schedule_briefing',
    ]

    for (const name of expectedTools) {
      const tool = findTool(plugin.execTools, name)
      expect(tool, `Missing exec tool: ${name}`).toBeDefined()
    }
  })

  it('sets pluginId to schedule', () => {
    expect(schedulePlugin.id).toBe('schedule')
  })
})
