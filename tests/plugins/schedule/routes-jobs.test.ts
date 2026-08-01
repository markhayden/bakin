/**
 * Tests for schedule plugin job routes (lib/routes/jobs.ts, backed by the
 * job-service verbs createScheduleJob/updateScheduleJob/applyPauseAction).
 * Split from routes.test.ts (FW7); shared runtime-cron scaffold lives in
 * helpers/schedule-harness.ts. /bridge is tested in bridge.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { RunEntry } from '@bakin/schedule/types'
import type { ActivatedPlugin } from '../test-helpers'
import { createScheduleCronHarness, makeBakinPaths, makeMeta, makeMergedJob } from './helpers/schedule-harness'

// ---------------------------------------------------------------------------
// Temp directory
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), `bakin-test-schedule-routes-jobs-${Date.now()}`)
const sidecarDir = join(testDir, 'schedule')

// ES imports are hoisted above mock.module — set env so the guards don't trip
// when plugin modules call getContentDir/getOpenClawHome at init.
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = testDir + '-openclaw'

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// (mock.module stays per-file; only pure builders/fakes live in the helper)
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

// Dual content-dir mock (CLAUDE.md testing rules): both the app facade and the
// packages/core resolver. getBakinPaths must be full-shape — these tests hit
// the REAL execution ledger, which resolves its SQLite path via .db.
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => makeBakinPaths(testDir),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => makeBakinPaths(testDir),
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
class MockTaskValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'TaskValidationError' }
}
mock.module('../../../src/core/task-service', () => ({
  createTaskWithEffects: (opts: unknown) => mockCreateTask(opts),
  TaskValidationError: MockTaskValidationError,
  validateTeamRef: async (teamId: string) => {
    if (teamId !== 'development') throw new MockTaskValidationError(`Unknown team: "${teamId}"`)
  },
  validateTeamAssignment: async (opts: { assignee?: string; team?: string }) => {
    if (opts.assignee && opts.team) throw new MockTaskValidationError('Cannot set both an agent and a team')
    if (opts.team && opts.team !== 'development') throw new MockTaskValidationError(`Unknown team: "${opts.team}"`)
  },
}))

// Mock plugin-registry (hook registry used by bridge — not under test here but must be present)
// Fixture scheduled-events providers for the occurrences fan-in tests.
const hookProviders: Record<string, (data: unknown) => Promise<unknown>> = {}
const fixtureHookRegistry = () => ({
  invoke: mock(async (name: string, data: unknown) => hookProviders[name]?.(data)),
  register: mock(() => () => {}),
  has: mock((name: string) => name in hookProviders),
  getRegisteredHooks: () => Object.keys(hookProviders),
})
mock.module('../../../src/core/plugin-registry', () => ({
  getHookRegistry: fixtureHookRegistry,
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: fixtureHookRegistry,
}))

// Mock runtime cron and jobs-reader — routes exercise adapter calls while
// keeping merged schedule data deterministic for route assertions.
const harness = createScheduleCronHarness()
const {
  mockMergedJobs,
  mockRuntimeCronJobs,
  mockRuns,
  mockCronCreate,
  mockCronUpdate,
  mockCronRemove,
  mockCronRunNow,
  mockCronGetRaw,
  mockCronRestoreRaw,
} = harness

mock.module('@bakin/core/adapters/runtime/testing', () => ({
  createMockRuntimeAdapter: () => harness.createMockRuntimeAdapter(),
}))

mock.module('@bakin/schedule/lib/jobs-reader', () => harness.jobsReaderModule())

// Mock cron-parser — parseSchedule and cronToHuman
mock.module('@bakin/schedule/lib/cron-parser', () => harness.cronParserModule())

// We need real sidecar since routes mutate state on disk via upsertJob/getJob/removeJob.
// The sidecar module reads getContentDir() which returns testDir, so it uses our temp dir.
// Do NOT mock sidecar — let it hit the filesystem.

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { activatePlugin, findRoute, callRoute } from '../test-helpers'
const schedulePlugin = (await import('@bakin/schedule/index')).default
import { upsertJob, getJob } from '@bakin/schedule/lib/sidecar'
import { claimCronFire, attachCronTask, markCronFireSkipped } from '../../../src/core/execution-ledger'
import { closeDb } from '../../../packages/core/src/storage/db'

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
  harness.reset()
  // Reset sidecar on disk
  writeFileSync(join(sidecarDir, 'sidecar.json'), JSON.stringify({ version: 1, jobs: {} }))
})

afterAll(() => {
  closeDb() // release the ledger handle before deleting its inode (SQLITE_IOERR_VNODE)
  rmSync(testDir, { recursive: true, force: true })
})

// ===========================================================================
// Routes
// ===========================================================================

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
      expect(body.kind).toBe('cron')
      expect(body.expr).toBe('0 9 * * *')
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

    it('creates a one-shot job from an ISO instant (kind at)', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const future = '2099-01-15T16:00:00.000Z'
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { name: 'One-shot reminder', schedule: future, agentId: 'chef', taskPrompt: 'Remind me' },
      })
      expect(status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.kind).toBe('at')
      expect(body.expr).toBe(future)
      const meta = getJob(body.jobId as string)
      expect(meta!.schedule).toEqual({ kind: 'at', expr: future })
    })

    it('rejects a one-shot whose instant is in the past', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { name: 'Too late', schedule: '2020-01-01T00:00:00.000Z', agentId: 'chef', taskPrompt: 'Nope' },
      })
      expect(status).toBe(400)
      expect(String(body.error)).toMatch(/in the past/i)
    })

    it('creates a team-assigned job (#189)', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { name: 'Team Sweep', schedule: '0 9 * * *', teamId: 'development', taskPrompt: 'Sweep it' },
      })
      expect(status).toBe(200)
      const meta = getJob(body.jobId as string)
      expect(meta!.teamId).toBe('development')
      expect(meta!.agentId).toBeUndefined()
    })

    it('rejects agentId + teamId together with 400 (#189)', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { name: 'Bad', schedule: '0 9 * * *', agentId: 'chef', teamId: 'development' },
      })
      expect(status).toBe(400)
      expect(String(body.error)).toContain('both')
    })

    it('rejects an unknown teamId with 400 (#189)', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { name: 'Bad', schedule: '0 9 * * *', teamId: 'ghost-team' },
      })
      expect(status).toBe(400)
      expect(String(body.error)).toContain('Unknown team')
    })

    it('returns a transport danger-zone warning for a no-split prompt', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const { body } = await callRoute(route, plugin.ctx, {
        body: { name: 'Daily', schedule: '0 9 * * *', taskPrompt: 'Keep under 1900 chars and do not split.' },
      })
      expect(body.ok).toBe(true)
      const warnings = body.warnings as Array<{ code: string }> | undefined
      expect(warnings?.[0]?.code).toBe('transport-danger-zone')
    })

    it('returns no warnings for the safe chunking prompt', async () => {
      const route = findRoute(plugin.routes, 'POST', '/')!
      const { body } = await callRoute(route, plugin.ctx, {
        body: { name: 'Daily', schedule: '0 9 * * *', taskPrompt: 'Chunk under 900 chars and split deliberately.' },
      })
      expect(body.warnings).toBeUndefined()
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

    it('re-assigning to a team clears agentId (#189)', async () => {
      upsertJob(makeMeta({ jobId: 'job-mx1', agentId: 'chef' }))

      const route = findRoute(plugin.routes, 'PUT', '/:jobId')!
      const { status } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-mx1' },
        body: { teamId: 'development' },
      })

      expect(status).toBe(200)
      const meta = getJob('job-mx1')
      expect(meta!.teamId).toBe('development')
      expect(meta!.agentId).toBeUndefined()
    })

    it('re-assigning to an agent clears teamId (#189)', async () => {
      upsertJob(makeMeta({ jobId: 'job-mx2', agentId: undefined, teamId: 'development' }))

      const route = findRoute(plugin.routes, 'PUT', '/:jobId')!
      const { status } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-mx2' },
        body: { agentId: 'chef' },
      })

      expect(status).toBe(200)
      const meta = getJob('job-mx2')
      expect(meta!.agentId).toBe('chef')
      expect(meta!.teamId).toBeUndefined()
    })

    it('rejects agentId + teamId together on update with 400 (#189)', async () => {
      upsertJob(makeMeta({ jobId: 'job-mx3' }))

      const route = findRoute(plugin.routes, 'PUT', '/:jobId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'job-mx3' },
        body: { agentId: 'chef', teamId: 'development' },
      })

      expect(status).toBe(400)
      expect(String(body.error)).toContain('both')
    })

    // Legacy hand-validation: pre-T8 the handler returned 400 when neither
    // url.searchParams.get('jobId') nor body.jobId was set. T8+ routing
    // requires :jobId in the path, so this case never reaches the handler.

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
  describe('POST /:jobId/adopt — team assignment (round-3 review)', () => {
    it('adopting with a teamId persists it (and no agent)', async () => {
      mockRuntimeCronJobs.push({ id: 'native-team', name: 'Native', schedule: '0 9 * * *', command: 'do it', enabled: true })
      const route = findRoute(plugin.routes, 'POST', '/:jobId/adopt')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'native-team' },
        body: { teamId: 'development' },
      })
      expect(status).toBe(200)
      void body
      const meta = getJob('native-team')
      expect(meta!.teamId).toBe('development')
      expect(meta!.agentId).toBeUndefined()
    })

    it("adopting with agentId '' explicitly clears the existing agent (round-4)", async () => {
      upsertJob(makeMeta({ jobId: 'native-clear', isBakinJob: false, agentId: 'chef' }))
      mockRuntimeCronJobs.push({ id: 'native-clear', name: 'Native', schedule: '0 9 * * *', command: 'do it', enabled: true })
      const route = findRoute(plugin.routes, 'POST', '/:jobId/adopt')!
      const { status } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'native-clear' },
        body: { agentId: '' },
      })
      expect(status).toBe(200)
      expect(getJob('native-clear')!.agentId).toBeUndefined()
    })

    it('adopting with agentId + teamId is rejected with 400', async () => {
      mockRuntimeCronJobs.push({ id: 'native-both', name: 'Native', schedule: '0 9 * * *', command: 'do it', enabled: true })
      const route = findRoute(plugin.routes, 'POST', '/:jobId/adopt')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'native-both' },
        body: { agentId: 'chef', teamId: 'development' },
      })
      expect(status).toBe(400)
      expect(String(body.error)).toContain('both')
    })
  })

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

    it('refuses to delete a native (non-Bakin) runtime cron — read-only', async () => {
      // A native OpenClaw cron surfaced read-only has no Bakin sidecar entry.
      mockRuntimeCronJobs.push({ id: 'native-del', name: 'Native', schedule: '0 9 * * *', command: 'run', enabled: true })
      const route = findRoute(plugin.routes, 'DELETE', '/:jobId')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'native-del' },
        body: {},
      })
      expect(status).toBe(403)
      expect(body.error).toContain('read-only')
      expect(mockCronRemove).not.toHaveBeenCalled()
    })

    it('cleans up Bakin records when the runtime cron job is already gone', async () => {
      upsertJob(makeMeta({ jobId: 'job-stale-del' }))
      harness.setCronRemoveError(new Error('Cron job not found: job-stale-del'))

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

    it('returns 404 for an unknown job', async () => {
      const route = findRoute(plugin.routes, 'POST', '/:jobId/pause')!
      const { status } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'ghost-job' },
        body: { action: 'pause' },
      })
      expect(status).toBe(404)
    })

    it('rejects pausing a native (non-Bakin) runtime cron with 403 read-only', async () => {
      mockRuntimeCronJobs.push({ id: 'native-pause', name: 'Native', schedule: '0 9 * * *', command: 'run', enabled: true })
      const route = findRoute(plugin.routes, 'POST', '/:jobId/pause')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { jobId: 'native-pause' },
        body: { action: 'pause' },
      })
      expect(status).toBe(403)
      expect(body.error).toContain('read-only')
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

    it('reads a Bakin job\'s fire history from the ledger (fires + skips), newest-first', async () => {
      // Bakin schedules have no runtime cron runs post-cutover — history is in the ledger.
      upsertJob(makeMeta({ jobId: 'job-ledger', isBakinJob: true }))
      const base = Date.parse('2026-03-30T09:00:00Z')
      claimCronFire('job-ledger', 'run-a', base)
      attachCronTask('job-ledger', 'run-a', 'task-aaaaaaaa')
      claimCronFire('job-ledger', 'run-b', base + 60_000)
      markCronFireSkipped('job-ledger', 'run-b', 'overlap')

      const route = findRoute(plugin.routes, 'GET', '/:jobId/runs')!
      const { status, body } = await callRoute(route, plugin.ctx, { searchParams: { jobId: 'job-ledger' } })

      expect(status).toBe(200)
      const runs = body.runs as RunEntry[]
      expect(runs.map(r => r.runId)).toEqual(['run-b', 'run-a']) // newest fired_at first
      expect(runs.find(r => r.runId === 'run-a')).toMatchObject({ status: 'success', taskId: 'task-aaaaaaaa' })
      expect(runs.find(r => r.runId === 'run-b')).toMatchObject({ status: 'skipped', skippedReason: 'overlap' })
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
  // GET /occurrences — server-computed calendar feed
  // -----------------------------------------------------------------------
  describe('GET /occurrences', () => {
    it('returns kind-aware, tz-correct occurrences for the range', async () => {
      harness.mockMergedJobs.push(makeMergedJob({
        id: 'occ-daily',
        schedule: { type: 'cron', value: '0 9 * * *', tz: 'America/Denver' },
        createdAt: '2026-01-01T00:00:00Z',
      }))
      const route = findRoute(plugin.routes, 'GET', '/occurrences')!
      expect(route).toBeDefined()
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { from: '2026-06-08T00:00:00Z', to: '2026-06-10T00:00:00Z' },
      })
      expect(status).toBe(200)
      const items = body.occurrences as Array<{ jobId: string; at: string; past: boolean }>
      expect(items.map(i => i.at)).toEqual(['2026-06-08T15:00:00.000Z', '2026-06-09T15:00:00.000Z'])
      expect(items.every(i => i.jobId === 'occ-daily')).toBe(true)
      expect(items.every(i => i.past)).toBe(true) // range is in the past relative to real now
      expect(body.unevaluated).toEqual([])
    })

    it('rejects a missing/invalid range', async () => {
      const route = findRoute(plugin.routes, 'GET', '/occurrences')!
      const bad = await callRoute(route, plugin.ctx, { searchParams: { from: 'nope', to: '2026-06-10T00:00:00Z' } })
      expect(bad.status).toBe(400)
      const inverted = await callRoute(route, plugin.ctx, {
        searchParams: { from: '2026-06-10T00:00:00Z', to: '2026-06-08T00:00:00Z' },
      })
      expect(inverted.status).toBe(400)
    })

    it('fans in plugin-contributed domain events with per-provider fault isolation', async () => {
      hookProviders['tasks.scheduledEvents'] = async () => [{
        id: 'evt-1', pluginId: 'tasks', title: 'Waiting task', kind: 'task-scheduled',
        startsAt: '2026-06-09T15:00:00.000Z', url: '/tasks?taskId=t1', reschedulable: true,
      }]
      hookProviders['broken.scheduledEvents'] = async () => { throw new Error('boom') }
      try {
        const route = findRoute(plugin.routes, 'GET', '/occurrences')!
        const { status, body } = await callRoute(route, plugin.ctx, {
          searchParams: { from: '2026-06-08T00:00:00Z', to: '2026-06-10T00:00:00Z' },
        })
        expect(status).toBe(200)
        const events = body.events as Array<{ id: string; pluginId: string }>
        expect(events.map(e => e.id)).toEqual(['evt-1'])
        expect(body.droppedProviders).toEqual(['broken'])
      } finally {
        delete hookProviders['tasks.scheduledEvents']
        delete hookProviders['broken.scheduledEvents']
      }
    })

    it('reschedules a domain event through the owner hook and surfaces rejections', async () => {
      const calls: unknown[] = []
      hookProviders['tasks.rescheduleEvent'] = async (data) => { calls.push(data); return { ok: true } }
      hookProviders['grumpy.rescheduleEvent'] = async () => ({ ok: false, error: 'not movable' })
      try {
        const route = findRoute(plugin.routes, 'POST', '/events/reschedule')!
        expect(route).toBeDefined()

        const ok = await callRoute(route, plugin.ctx, {
          body: { pluginId: 'tasks', eventId: 't-1:scheduled', to: '2026-07-04T15:00:00.000Z' },
        })
        expect(ok.status).toBe(200)
        expect(calls).toEqual([{ eventId: 't-1:scheduled', to: '2026-07-04T15:00:00.000Z' }])

        const rejected = await callRoute(route, plugin.ctx, {
          body: { pluginId: 'grumpy', eventId: 'e1', to: '2026-07-04T15:00:00.000Z' },
        })
        expect(rejected.status).toBe(400)
        expect(String(rejected.body.error)).toContain('not movable')

        const unsupported = await callRoute(route, plugin.ctx, {
          body: { pluginId: 'ghost', eventId: 'e1', to: '2026-07-04T15:00:00.000Z' },
        })
        expect(unsupported.status).toBe(404)

        const badDate = await callRoute(route, plugin.ctx, {
          body: { pluginId: 'tasks', eventId: 'e1', to: 'someday' },
        })
        expect(badDate.status).toBe(400)
      } finally {
        delete hookProviders['tasks.rescheduleEvent']
        delete hookProviders['grumpy.rescheduleEvent']
      }
    })

    it('rejects a range beyond the 62-day cap', async () => {
      const route = findRoute(plugin.routes, 'GET', '/occurrences')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        searchParams: { from: '2026-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' },
      })
      expect(status).toBe(400)
      expect(String(body.error)).toMatch(/range too large/i)
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
      expect(body.kind).toBe('cron')
      expect(body.expr).toBe('0 9 * * *')
      expect(body.human).toBe('Every day at 9am')
    })

    it('parses a raw cron expression', async () => {
      const route = findRoute(plugin.routes, 'POST', '/parse')!
      const { status, body } = await callRoute(route, plugin.ctx, {
        body: { input: '*/15 * * * *' },
      })

      expect(status).toBe(200)
      expect(body.expr).toBe('*/15 * * * *')
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
