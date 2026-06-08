/**
 * Tests for schedule plugin routes and exec tools.
 * Covers all API routes (except /bridge, tested in bridge.test.ts)
 * and all bakin_exec_schedule_* tools.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { BakinJobMeta, MergedJob, RunEntry } from '@bakin/schedule/types'
import type { CreateCronJobInput, CronJob, CronRun, UpdateCronJobInput } from '@bakin/core/adapters/runtime'
import type { ActivatedPlugin } from '../test-helpers'

// ---------------------------------------------------------------------------
// Temp directory
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `bakin-test-schedule-routes-${Date.now()}`)
const sidecarDir = join(testDir, 'schedule')

// ES imports are hoisted above mock.module — set env so the guards don't trip
// when plugin modules call getContentDir/getOpenClawHome at init.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + '-openclaw'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => testDir + '-openclaw',
  getOpenClawPath: (...parts: string[]) => join(testDir + '-openclaw', ...parts),
  resetOpenClawHome: () => {},
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

mock.module('../../../src/core/audit', () => ({
  appendAudit: mock(),
}))

const mockCreateTask = mock((opts?: unknown) => {
  void opts
  return Promise.resolve({ id: 'task-new', workflowId: undefined })
})
mock.module('../../../src/core/task-service', () => ({
  createTaskWithEffects: (opts: unknown) => mockCreateTask(opts),
}))

// Mock plugin-registry (hook registry used by bridge — not under test here but must be present)
mock.module('../../../src/lib/plugin-registry', () => ({
  getHookRegistry: () => ({
    invoke: mock(async () => undefined),
    register: mock(() => () => {}),
    has: mock(() => false),
  }),
}))

// Mock runtime cron and jobs-reader — routes exercise adapter calls while
// keeping merged schedule data deterministic for route assertions.
const mockMergedJobs: MergedJob[] = []
const mockRuntimeCronJobs: CronJob[] = []
const mockRuns: RunEntry[] = []
let lastRunOverride: RunEntry | null = null
let mockCronRemoveError: Error | null = null

function mergedJobToCronJob(job: MergedJob): CronJob {
  return {
    id: job.id,
    name: job.displayName || job.name || job.id,
    schedule: job.schedule.value,
    command: job.taskPrompt || job.taskTitle || `bakin:schedule:${job.displayName || job.name || job.id}`,
    enabled: job.enabled,
    toolsAllow: job.toolsAllow,
    metadata: { tz: job.tz, createdAt: job.createdAt },
  }
}

function fallbackMergeJob(job: { id: string; name: string; schedule: { value?: string; expr?: string }; enabled: boolean; payload?: Record<string, unknown> }, sidecar?: BakinJobMeta): MergedJob {
  return {
    id: job.id,
    name: job.name,
    schedule: { type: 'cron', value: job.schedule.value ?? job.schedule.expr ?? '* * * * *' },
    enabled: job.enabled,
    source: sidecar?.source ?? (sidecar?.isBakinJob ? 'bakin' : 'runtime'),
    canAdopt: !sidecar?.isBakinJob,
    canRestoreNative: Boolean(sidecar?.isBakinJob && sidecar.originalRuntimeCron),
    isBakinJob: sidecar?.isBakinJob ?? false,
    displayName: sidecar?.displayName ?? job.name,
    description: sidecar?.description,
    agentId: sidecar?.agentId,
    owner: sidecar?.owner ?? 'main',
    requireTriage: sidecar?.requireTriage ?? !sidecar,
    workflowId: sidecar?.workflowId,
    taskPrompt: sidecar?.taskPrompt ?? (typeof job.payload?.message === 'string' ? job.payload.message : undefined),
    taskTitle: sidecar?.taskTitle,
    paused: sidecar?.paused ?? false,
    pauseUntil: sidecar?.pauseUntil,
    pauseReason: sidecar?.pauseReason,
    skipNextN: sidecar?.skipNextN,
    skippedCount: sidecar?.skippedCount,
    allowOverlap: sidecar?.allowOverlap ?? false,
    maxFailures: sidecar?.maxFailures ?? 3,
    consecutiveFailures: sidecar?.consecutiveFailures ?? 0,
    lastTaskId: sidecar?.lastTaskId,
    tz: sidecar?.tz,
    createdAt: sidecar?.createdAt,
    humanSchedule: `Human: ${job.schedule.value ?? job.schedule.expr ?? '* * * * *'}`,
  }
}

function runEntryToCronRun(run: RunEntry): CronRun {
  return {
    id: run.runId,
    jobId: run.jobId,
    startedAt: run.timestamp,
    status: run.status === 'failure' ? 'failed' : run.status === 'skipped' ? 'cancelled' : 'succeeded',
    error: run.error,
  }
}

const mockCronCreate = mock(async (input: CreateCronJobInput): Promise<CronJob> => {
  const job = {
    id: input.id === 'plugin-nightly-sync' ? 'runtime-plugin-nightly-sync' : input.id ?? 'new-job-id',
    name: input.name,
    schedule: input.schedule,
    command: input.command,
    enabled: input.enabled ?? true,
    metadata: input.metadata,
  }
  mockRuntimeCronJobs.push(job)
  return job
})
const mockCronUpdate = mock(async (id: string, patch: UpdateCronJobInput): Promise<CronJob> => {
  const index = mockRuntimeCronJobs.findIndex(job => job.id === id)
  const current = index === -1
    ? { id, name: id, schedule: '* * * * *', command: '', enabled: true }
    : mockRuntimeCronJobs[index]
  const next = {
    ...current,
    ...patch,
    toolsAllow: patch.toolsAllow === null ? undefined : patch.toolsAllow ?? current.toolsAllow,
  }
  if (index === -1) mockRuntimeCronJobs.push(next)
  else mockRuntimeCronJobs[index] = next
  return next
})
const mockCronRemove = mock(async (id: string) => {
  if (mockCronRemoveError) throw mockCronRemoveError
  const index = mockRuntimeCronJobs.findIndex(job => job.id === id)
  if (index !== -1) mockRuntimeCronJobs.splice(index, 1)
})
const mockCronRunNow = mock(async (jobId: string): Promise<CronRun> => ({
  id: 'run-now',
  jobId,
  status: 'succeeded',
  startedAt: '2026-03-31T09:00:00Z',
}))
const mockCronListRuns = mock(async (jobId: string): Promise<CronRun[]> => {
  if (lastRunOverride && lastRunOverride.jobId === jobId) return [runEntryToCronRun(lastRunOverride)]
  return mockRuns.filter(run => run.jobId === jobId).map(runEntryToCronRun)
})
const mockCronGetRaw = mock(async (id: string): Promise<unknown | null> => {
  return mockRuntimeCronJobs.find(job => job.id === id) ?? null
})
const mockCronRestoreRaw = mock(async (id: string, snapshot: unknown): Promise<CronJob> => {
  const raw = snapshot as Partial<CronJob>
  const restored: CronJob = {
    id,
    name: raw.name ?? id,
    schedule: raw.schedule ?? '* * * * *',
    command: raw.command ?? '',
    enabled: raw.enabled ?? true,
    toolsAllow: raw.toolsAllow,
    metadata: raw.metadata,
  }
  const index = mockRuntimeCronJobs.findIndex(job => job.id === id)
  if (index === -1) mockRuntimeCronJobs.push(restored)
  else mockRuntimeCronJobs[index] = restored
  return restored
})
const mockCronList = mock(async (): Promise<CronJob[]> => {
  const jobs = new Map<string, CronJob>()
  for (const job of mockMergedJobs.map(mergedJobToCronJob)) jobs.set(job.id, job)
  for (const job of mockRuntimeCronJobs) jobs.set(job.id, job)
  return Array.from(jobs.values())
})

mock.module('@bakin/core/adapters/runtime/testing', () => ({
  createMockRuntimeAdapter: () => ({
    agents: {
      list: async () => [{ id: 'main', name: 'Main', role: 'Orchestrator' }],
    },
    cron: {
      list: mockCronList,
      get: async (id: string) => (await mockCronList()).find(job => job.id === id) ?? null,
      create: mockCronCreate,
      update: mockCronUpdate,
      remove: mockCronRemove,
      runNow: mockCronRunNow,
      listRuns: mockCronListRuns,
      getRaw: mockCronGetRaw,
      restoreRaw: mockCronRestoreRaw,
    },
  }),
}))

mock.module('@bakin/schedule/lib/jobs-reader', () => ({
  readMergedJobs: () => mockMergedJobs,
  mergeJob: (job: { id: string; name: string; schedule: { value?: string; expr?: string }; enabled: boolean; payload?: Record<string, unknown> }, sidecar?: BakinJobMeta) => (
    mockMergedJobs.find(merged => merged.id === job.id) ?? fallbackMergeJob(job, sidecar)
  ),
}))

// Mock cron-parser — parseSchedule and cronToHuman
mock.module('@bakin/schedule/lib/cron-parser', () => ({
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

import { activatePlugin, findRoute, findTool, callRoute, callTool, callSearchRoute } from '../test-helpers'
const schedulePlugin = (await import('@bakin/schedule/index')).default
import { upsertJob, getJob } from '@bakin/schedule/lib/sidecar'
import { getCronFire } from '../../../src/core/execution-ledger'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeta(overrides: Partial<BakinJobMeta> = {}): BakinJobMeta {
  return {
    jobId: 'job-123',
    isBakinJob: true,
    source: 'bakin',
    displayName: 'Daily Report',
    agentId: 'chef',
    owner: 'main',
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
    source: 'bakin',
    canAdopt: false,
    canRestoreNative: false,
    isBakinJob: true,
    displayName: 'Daily Report',
    agentId: 'chef',
    owner: 'main',
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
  mock.clearAllMocks()
  mockMergedJobs.length = 0
  mockRuntimeCronJobs.length = 0
  mockRuns.length = 0
  lastRunOverride = null
  mockCronRemoveError = null
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

    it('returns cron tool allowlist audit fields for runtime jobs', async () => {
      mockMergedJobs.push(makeMergedJob({
        id: 'native-tools',
        isBakinJob: false,
        source: 'runtime',
        toolsAllow: ['message'],
        toolsAllowMissing: false,
      }), makeMergedJob({
        id: 'native-missing-tools',
        isBakinJob: false,
        source: 'runtime',
        toolsAllowMissing: true,
      }))

      const route = findRoute(plugin.routes, 'GET', '/')!
      const { status, body } = await callRoute(route, plugin.ctx)

      expect(status).toBe(200)
      const jobs = body.jobs as Array<Record<string, unknown>>
      expect(jobs.find(job => job.id === 'native-tools')?.toolsAllow).toEqual(['message'])
      expect(jobs.find(job => job.id === 'native-tools')?.toolsAllowMissing).toBe(false)
      expect(jobs.find(job => job.id === 'native-missing-tools')?.toolsAllowMissing).toBe(true)
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
      expect(body.jobId).toMatch(/^sch_/)
      expect(body.cron).toBe('0 9 * * *')
      expect(body.human).toBe('Every day at 9am')
      expect(body.tz).toBeDefined()

      // Bakin owns the schedule — no OpenClaw cron job is created.
      expect(mockCronCreate).not.toHaveBeenCalled()

      // Verify store entry created with the Bakin-owned schedule definition.
      const meta = getJob(body.jobId as string)
      expect(meta).not.toBeNull()
      expect(meta!.displayName).toBe('Morning Tasks')
      expect(meta!.agentId).toBe('chef')
      expect(meta!.isBakinJob).toBe(true)
      expect(meta!.schedule).toEqual({ kind: 'cron', expr: '0 9 * * *' })
      expect(meta!.enabled).toBe(true)

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
      expect(body.error).toBe('invalid input')
    })

    it('returns 400 when schedule is missing', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { name: 'Test' },
      })
      expect(status).toBe(400)
      expect(body.error).toBe('invalid input')
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
      const { body } = await callRoute(route, plugin.ctx, {
        body: { name: 'No Owner', schedule: '0 9 * * *' },
      })
      const meta = getJob(body.jobId as string)
      expect(meta!.owner).toBe('main')
    })

    it('respects provided optional fields', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const { body } = await callRoute(route, plugin.ctx, {
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
      const meta = getJob(body.jobId as string)
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

    // Legacy hand-validation: pre-T8 the handler returned 400 when neither
    // url.searchParams.get('jobId') nor body.jobId was set. T8+ routing
    // requires :jobId in the path, so this case never reaches the handler.
    it.skip('returns 400 when jobId is not provided — legacy', () => {})

    it('returns 404 for non-existent job', async () => {
      const route = findRoute(plugin.routes, 'PUT', '/:jobId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'missing-job' },
        body: { displayName: 'Updated' },
      })
      expect(status).toBe(404)
      expect(body.error).toContain('not found')
    })

    it('updates the stored schedule definition when the schedule is changed', async () => {
      upsertJob(makeMeta({ jobId: 'job-123', schedule: { kind: 'cron', expr: '0 9 * * *' } }))

      const route = findRoute(plugin.routes, 'PUT', '/:jobId')!
      await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-123' },
        body: { schedule: '0 10 * * *' },
      })

      // Bakin owns the schedule — no OpenClaw cron update.
      expect(mockCronUpdate).not.toHaveBeenCalled()
      expect(getJob('job-123')!.schedule).toEqual({ kind: 'cron', expr: '0 10 * * *' })
    })

    it('preserves the schedule timezone when the cron expression changes', async () => {
      upsertJob(makeMeta({ jobId: 'job-tz', tz: 'America/Denver', schedule: { kind: 'cron', expr: '0 9 * * *' } }))

      const route = findRoute(plugin.routes, 'PUT', '/:jobId')!
      await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-tz' },
        body: { schedule: '0 10 * * *' },
      })

      const meta = getJob('job-tz')!
      expect(meta.schedule).toEqual({ kind: 'cron', expr: '0 10 * * *' })
      expect(meta.tz).toBe('America/Denver')
    })

    it('updates the stored display name when the name is changed', async () => {
      upsertJob(makeMeta({ jobId: 'job-123' }))

      const route = findRoute(plugin.routes, 'PUT', '/:jobId')!
      await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-123' },
        body: { name: 'Renamed Job' },
      })

      expect(mockCronUpdate).not.toHaveBeenCalled()
      expect(getJob('job-123')!.displayName).toBe('Renamed Job')
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

    it.skip('reads jobId from body when not in searchParams — legacy fallback; routing requires :jobId in path', () => {})

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
  // POST /:jobId/adopt and /:jobId/restore-native
  // -----------------------------------------------------------------------
  describe('POST /:jobId/adopt', () => {
    it('adopts a native runtime cron into a Bakin schedule while preserving the raw snapshot', async () => {
      mockRuntimeCronJobs.push({
        id: 'native-1',
        name: 'Native Cron',
        schedule: '0 8 * * *',
        command: 'Do the native thing',
        enabled: true,
        metadata: { existing: true },
      })

      const route = findRoute(plugin.routes, 'POST', '/:jobId/adopt')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'native-1' },
        body: {
          name: 'Adopted Cron',
          schedule: '0 10 * * *',
          agentId: 'pixel',
          taskPrompt: 'Create the Bakin task',
        },
      })

      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(mockCronGetRaw).toHaveBeenCalledWith('native-1', expect.stringContaining('schedule adopt'))
      // Bakin owns the schedule now: the native cron is removed, not rewritten.
      expect(mockCronRemove).toHaveBeenCalledWith('native-1')

      const meta = getJob('native-1')
      expect(meta!.isBakinJob).toBe(true)
      expect(meta!.source).toBe('adopted')
      expect(meta!.schedule).toEqual({ kind: 'cron', expr: '0 10 * * *' })
      expect(meta!.enabled).toBe(true)
      expect(meta!.agentId).toBe('pixel')
      expect(meta!.taskPrompt).toBe('Create the Bakin task')
      expect(meta!.originalRuntimeCron?.snapshot).toEqual(expect.objectContaining({ id: 'native-1', command: 'Do the native thing' }))
    })

    it('rejects adopting a job that is already managed by Bakin', async () => {
      upsertJob(makeMeta({ jobId: 'already-bakin' }))
      mockRuntimeCronJobs.push({ id: 'already-bakin', name: 'Bakin', schedule: '0 9 * * *', command: 'run', enabled: true })

      const route = findRoute(plugin.routes, 'POST', '/:jobId/adopt')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'already-bakin' },
        body: {},
      })

      expect(status).toBe(409)
      expect(body.error).toContain('already managed')
    })
  })

  describe('POST /:jobId/restore-native', () => {
    it('restores an adopted job back to its original runtime cron snapshot', async () => {
      upsertJob(makeMeta({
        jobId: 'native-restore',
        source: 'adopted',
        originalRuntimeCron: {
          provider: 'openclaw',
          capturedAt: '2026-03-30T00:00:00Z',
          snapshot: {
            id: 'native-restore',
            name: 'Original Cron',
            schedule: '0 7 * * *',
            command: 'Original command',
            enabled: true,
          },
        },
      }))

      const route = findRoute(plugin.routes, 'POST', '/:jobId/restore-native')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'native-restore' },
        body: {},
      })

      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(mockCronRestoreRaw).toHaveBeenCalledWith('native-restore', expect.objectContaining({ command: 'Original command' }), expect.stringContaining('schedule restore'))

      const meta = getJob('native-restore')
      expect(meta!.isBakinJob).toBe(false)
      expect(meta!.source).toBe('runtime')
      expect(meta!.displayName).toBe('Original Cron')
      expect(meta!.originalRuntimeCron).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // DELETE /:jobId — delete a job
  // -----------------------------------------------------------------------
  describe('DELETE /:jobId', () => {
    it('deletes a job from runtime cron and sidecar', async () => {
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
      expect(plugin.ctx.search.remove).toHaveBeenCalledWith('job-del')
    })

    it('cleans up Bakin records when the runtime cron job is already gone', async () => {
      upsertJob(makeMeta({ jobId: 'job-stale-del' }))
      mockCronRemoveError = new Error('Cron job not found: job-stale-del')

      const route = findRoute(plugin.routes, 'DELETE', '/:jobId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-stale-del' },
        body: {},
      })

      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(getJob('job-stale-del')).toBeNull()
      expect(plugin.ctx.search.remove).toHaveBeenCalledWith('job-stale-del')
    })

    it('deletes a job when clients send no DELETE body', async () => {
      upsertJob(makeMeta({ jobId: 'job-del-empty-body' }))

      const route = findRoute(plugin.routes, 'DELETE', '/:jobId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-del-empty-body' },
      })

      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(mockCronRemove).toHaveBeenCalledWith('job-del-empty-body')
      expect(getJob('job-del-empty-body')).toBeNull()
    })

    it.skip('returns 400 when jobId is not provided — legacy: routing requires :jobId in path', () => {})

    it.skip('reads jobId from body when not in searchParams — legacy fallback; routing requires :jobId in path', () => {})

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

    it('returns 400 when action is missing from body', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:jobId/pause')!
      upsertJob(makeMeta({ jobId: 'job-no-action' }))
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-no-action' },
        body: {},
      })
      expect(status).toBe(400)
      expect(body.error).toBe('invalid input')
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
    it('fires a Bakin schedule immediately without any runtime cron', async () => {
      upsertJob(makeMeta({ jobId: 'job-run', schedule: { kind: 'cron', expr: '0 9 * * *' }, taskPrompt: 'Do it' }))
      const route = findRoute(plugin.routes, 'POST', '/:jobId/run')!
      expect(route).toBeDefined()

      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-run' },
        body: {},
      })

      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(mockCronRunNow).not.toHaveBeenCalled()
      expect(mockCreateTask).toHaveBeenCalledTimes(1)
    })

    it('returns 404 for a non-Bakin / unknown job', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:jobId/run')!
      const { status } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'ghost' },
        body: {},
      })
      expect(status).toBe(404)
    })

    it('each manual run is an intentional fire (not deduped)', async () => {
      upsertJob(makeMeta({ jobId: 'job-run-bakin', displayName: 'Run Bakin', schedule: { kind: 'cron', expr: '0 9 * * *' }, taskPrompt: 'Do it' }))
      const route = findRoute(plugin.routes, 'POST', '/:jobId/run')!

      await callRoute(route, plugin.ctx, { searchParams: { jobId: 'job-run-bakin' }, body: {} })
      await callRoute(route, plugin.ctx, { searchParams: { jobId: 'job-run-bakin' }, body: {} })

      // Manual triggers mint a unique run id each time → each one fires.
      expect(mockCreateTask).toHaveBeenCalledTimes(2)
    })

    it.skip('returns 400 when jobId is missing — legacy: routing requires :jobId in path', () => {})

    it('audits and logs the run_now action', async () => {
      upsertJob(makeMeta({ jobId: 'job-audit-run', schedule: { kind: 'cron', expr: '0 9 * * *' } }))
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

    it.skip('returns 400 when jobId is missing — legacy: routing requires :jobId in path', () => {})

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
      expect(body.error).toBe('invalid input')
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

  it('no longer registers the removed /bridge route', () => {
    // The cron→task bridge webhook was removed when Bakin took ownership of
    // scheduling; nothing should POST to /bridge anymore.
    expect(findRoute(plugin.routes, 'POST', '/bridge')).toBeUndefined()
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

    it('includes cron tool allowlist audit fields when present', async () => {
      mockMergedJobs.push(makeMergedJob({
        id: 'native-tools',
        displayName: 'Native Tools',
        isBakinJob: false,
        toolsAllow: ['message'],
      }), makeMergedJob({
        id: 'native-missing-tools',
        displayName: 'Native Missing Tools',
        isBakinJob: false,
        toolsAllowMissing: true,
      }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_list')!
      const result = await callTool(tool, {})

      const jobs = result.jobs as Array<Record<string, unknown>>
      expect(jobs.find(job => job.id === 'native-tools')?.toolsAllow).toEqual(['message'])
      expect(jobs.find(job => job.id === 'native-missing-tools')?.toolsAllowMissing).toBe(true)
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
      expect(result.jobId).toMatch(/^sch_/)
      expect(result.cron).toBe('0 9 * * *')
      expect(result.tz).toBeDefined()

      // Bakin owns the schedule — no OpenClaw cron job is created.
      expect(mockCronCreate).not.toHaveBeenCalled()

      // Verify store
      const meta = getJob(result.jobId as string)
      expect(meta!.displayName).toBe('Nightly Digest')
      expect(meta!.schedule).toEqual({ kind: 'cron', expr: '0 9 * * *' })
      expect(meta!.enabled).toBe(true)
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
    it('updates stored fields', async () => {
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
      expect(mockCronUpdate).not.toHaveBeenCalled()

      const meta = getJob('job-upd')
      expect(meta!.displayName).toBe('Renamed')
      expect(meta!.agentId).toBe('pixel')
      expect(meta!.taskPrompt).toBe('Updated prompt')
    })

    it('updates the stored schedule definition when changed', async () => {
      upsertJob(makeMeta({ jobId: 'job-upd-sched', schedule: { kind: 'cron', expr: '0 9 * * *' } }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_update')!
      await callTool(tool, {
        jobId: 'job-upd-sched',
        schedule: '0 10 * * *',
      })

      expect(mockCronUpdate).not.toHaveBeenCalled()
      expect(getJob('job-upd-sched')!.schedule).toEqual({ kind: 'cron', expr: '0 10 * * *' })
    })

    it('preserves timezone when the exec tool changes a schedule', async () => {
      upsertJob(makeMeta({ jobId: 'job-upd-tz', tz: 'America/Denver', schedule: { kind: 'cron', expr: '0 9 * * *' } }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_update')!
      await callTool(tool, {
        jobId: 'job-upd-tz',
        schedule: '0 10 * * *',
      })

      const meta = getJob('job-upd-tz')!
      expect(meta.schedule).toEqual({ kind: 'cron', expr: '0 10 * * *' })
      expect(meta.tz).toBe('America/Denver')
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
    it('deletes from runtime cron and sidecar', async () => {
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
      expect(job.owner).toBe('main')
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
    it('fires a manual run that creates a task (no runtime cron involved)', async () => {
      upsertJob(makeMeta({ jobId: 'job-rn', schedule: { kind: 'cron', expr: '0 9 * * *' } }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_run_now')!
      expect(tool).toBeDefined()

      const result = await callTool(tool, { jobId: 'job-rn' })
      expect(result.ok).toBe(true)
      expect(result.jobId).toBe('job-rn')

      // Bakin fires directly into the task path — OpenClaw runNow is never used.
      expect(mockCronRunNow).not.toHaveBeenCalled()
      expect(mockCreateTask).toHaveBeenCalled()
    })

    it('audits and logs the run', async () => {
      upsertJob(makeMeta({ jobId: 'job-rn-audit', displayName: 'Audit Run' }))
      mockRuntimeCronJobs.push({ id: 'job-rn-audit', name: 'Audit Run', schedule: '0 9 * * *', command: 'run', enabled: true })

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
// /search route (auto-registered via ctx.search.registerContentType)
// ===========================================================================

describe('GET /search', () => {
  it('returns seeded job results for a happy-path query', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    activated.seedResults([
      {
        id: 'job-search-a',
        table: 'bakin_schedule',
        score: 1.5,
        fields: {
          name: 'Weekly planning',
          schedule: 'Every Monday at 9am',
          command: 'Plan the week',
          agent: 'chef',
          enabled: 'true',
        },
      },
      {
        id: 'job-search-b',
        table: 'bakin_schedule',
        score: 0.9,
        fields: {
          name: 'Daily report',
          schedule: 'Every day at 9am',
          command: 'Generate report',
          agent: 'pixel',
          enabled: 'true',
        },
      },
    ])

    const { status, body } = await callSearchRoute(activated, 'planning')
    expect(status).toBe(200)
    expect(Array.isArray(body.results)).toBe(true)
    const results = body.results as Array<Record<string, unknown>>
    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('job-search-a')
    expect(body.meta).toMatchObject({ query: 'planning', total: 2 })
  })

  it('returns 400 when ?q= is missing', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    const route = findRoute(activated.routes, 'GET', '/search')!
    expect(route).toBeDefined()
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(400)
    expect(body.error).toBe('invalid input')
  })

  it('passes ?facets=agent,enabled through to ctx.search.query', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    activated.seedResults([])

    await callSearchRoute(activated, 'anything', { facets: 'agent,enabled' })

    expect(activated.ctx.search.query).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'anything',
        facets: ['agent', 'enabled'],
      }),
    )
  })

  it('returns 200 with empty results when no jobs match', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    activated.seedResults([])

    const { status, body } = await callSearchRoute(activated, 'nothing-matches')
    expect(status).toBe(200)
    expect(body.results).toEqual([])
    expect(body.meta).toMatchObject({ query: 'nothing-matches', total: 0 })
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

  it('provisions a Bakin schedule in the store keyed by logical id (no OpenClaw cron)', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    const registerMock = activated.ctx.hooks.register as unknown as {
      mock: { calls: Array<[string, (data: Record<string, unknown>) => Promise<Record<string, unknown>>, Record<string, unknown>]> }
    }
    const call = registerMock.mock.calls.find(([name]) => name === 'schedule.ensureBakinJob')

    expect(call).toBeDefined()
    const handler = call![1]
    const result = await handler({
      jobId: 'plugin-nightly-sync',
      name: 'Plugin nightly sync',
      schedule: '*/5 * * * *',
      command: 'bakin:reports:refresh',
      metadata: { pluginId: 'reports' },
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      jobId: 'plugin-nightly-sync',
      cron: '*/5 * * * *',
    }))
    expect(mockCronCreate).not.toHaveBeenCalled()
    expect(getJob('plugin-nightly-sync')).toEqual(expect.objectContaining({
      isBakinJob: true,
      source: 'bakin',
      displayName: 'Plugin nightly sync',
      logicalJobId: 'plugin-nightly-sync',
      schedule: { kind: 'cron', expr: '*/5 * * * *' },
    }))
  })

  it('updates an existing Bakin schedule by logical id after a rename', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    const registerMock = activated.ctx.hooks.register as unknown as {
      mock: { calls: Array<[string, (data: Record<string, unknown>) => Promise<Record<string, unknown>>, Record<string, unknown>]> }
    }
    const call = registerMock.mock.calls.find(([name]) => name === 'schedule.ensureBakinJob')
    expect(call).toBeDefined()
    const handler = call![1]

    const first = await handler({
      jobId: 'plugin-nightly-sync',
      name: 'Plugin nightly sync',
      schedule: '*/5 * * * *',
      command: 'bakin:reports:refresh',
      metadata: { pluginId: 'reports' },
    })
    expect(first.jobId).toBe('plugin-nightly-sync')

    mockCronCreate.mockClear()
    mockCronUpdate.mockClear()

    const second = await handler({
      jobId: 'plugin-nightly-sync',
      name: 'Plugin nightly sync renamed',
      schedule: '0 2 * * *',
      command: 'bakin:reports:refresh',
      metadata: { pluginId: 'reports' },
    })

    expect(second).toEqual(expect.objectContaining({
      ok: true,
      jobId: 'plugin-nightly-sync',
      cron: '0 2 * * *',
    }))
    expect(mockCronCreate).not.toHaveBeenCalled()
    expect(mockCronUpdate).not.toHaveBeenCalled()
    expect(getJob('plugin-nightly-sync')).toEqual(expect.objectContaining({
      displayName: 'Plugin nightly sync renamed',
      logicalJobId: 'plugin-nightly-sync',
      schedule: { kind: 'cron', expr: '0 2 * * *' },
    }))
  })

  it('ignores runtime crons entirely (store-only provisioning)', async () => {
    const activated = await activatePlugin(schedulePlugin, testDir)
    const registerMock = activated.ctx.hooks.register as unknown as {
      mock: { calls: Array<[string, (data: Record<string, unknown>) => Promise<Record<string, unknown>>, Record<string, unknown>]> }
    }
    const call = registerMock.mock.calls.find(([name]) => name === 'schedule.ensureBakinJob')
    expect(call).toBeDefined()

    // A runtime cron with a matching command must NOT influence provisioning.
    mockRuntimeCronJobs.push({
      id: 'runtime-existing-reports-refresh',
      name: 'Existing reports refresh',
      schedule: '0 1 * * *',
      command: 'bakin:reports:refresh',
      enabled: true,
    })

    const result = await call![1]({
      jobId: 'plugin-nightly-sync',
      name: 'Plugin nightly sync',
      schedule: '*/5 * * * *',
      command: 'bakin:reports:refresh',
      metadata: { pluginId: 'reports' },
    })

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      jobId: 'plugin-nightly-sync',
    }))
    expect(mockCronUpdate).not.toHaveBeenCalled()
    expect(mockCronCreate).not.toHaveBeenCalled()
    expect(getJob('plugin-nightly-sync')!.logicalJobId).toBe('plugin-nightly-sync')
  })

  it('sets pluginId to schedule', () => {
    expect(schedulePlugin.id).toBe('schedule')
  })
})
