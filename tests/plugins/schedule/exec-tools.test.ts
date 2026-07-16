/**
 * Tests for the schedule plugin exec tools (lib/exec-tools.ts — all
 * bakin_exec_schedule_* tools, backed by the job-service verbs).
 * Split from routes.test.ts (FW7); shared runtime-cron scaffold lives in
 * helpers/schedule-harness.ts.
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

const testDir = join(tmpdir(), `bakin-test-schedule-exec-tools-${Date.now()}`)
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
  validateTeamRef: async () => undefined,
  validateTeamAssignment: async (opts: { assignee?: string; team?: string }) => {
    if (opts.assignee && opts.team) throw new MockTaskValidationError('Cannot set both an agent and a team')
    if (opts.team && opts.team !== 'development') throw new MockTaskValidationError(`Unknown team: "${opts.team}"`)
  },
  TaskValidationError: MockTaskValidationError,
}))

// Mock plugin-registry (hook registry used by bridge — not under test here but must be present)
mock.module('../../../src/core/plugin-registry', () => ({
  getHookRegistry: () => ({
    invoke: mock(async () => undefined),
    register: mock(() => () => {}),
    has: mock(() => false),
  }),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: mock(async () => undefined),
    register: mock(() => () => {}),
    has: mock(() => false),
  }),
}))

// Mock runtime cron and jobs-reader — exec tools exercise adapter calls while
// keeping merged schedule data deterministic for tool assertions.
const harness = createScheduleCronHarness()
const {
  mockMergedJobs,
  mockRuntimeCronJobs,
  mockCronCreate,
  mockCronUpdate,
  mockCronRemove,
  mockCronRunNow,
} = harness

mock.module('@bakin/core/adapters/runtime/testing', () => ({
  createMockRuntimeAdapter: () => harness.createMockRuntimeAdapter(),
}))

mock.module('@bakin/schedule/lib/jobs-reader', () => harness.jobsReaderModule())

// Mock cron-parser — parseSchedule and cronToHuman
mock.module('@bakin/schedule/lib/cron-parser', () => harness.cronParserModule())

// We need real sidecar since exec tools mutate state on disk via upsertJob/getJob/removeJob.
// The sidecar module reads getContentDir() which returns testDir, so it uses our temp dir.
// Do NOT mock sidecar — let it hit the filesystem.

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { activatePlugin, findTool, callTool } from '../test-helpers'
const schedulePlugin = (await import('@bakin/schedule/index')).default
import { upsertJob, getJob } from '@bakin/schedule/lib/sidecar'
import { claimCronFire, attachCronTask } from '../../../src/core/execution-ledger'
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
    it('creates a one-shot job from an ISO instant (agents self-schedule reminders)', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_create')!
      const future = '2099-03-01T17:30:00.000Z'
      const result = await callTool(tool, {
        name: 'One-shot reminder', schedule: future, agentId: 'pixel', taskPrompt: 'Remind me once',
      })
      expect(result.ok).toBe(true)
      expect(result.kind).toBe('at')
      expect(result.expr).toBe(future)
      expect(getJob(result.jobId as string)!.schedule).toEqual({ kind: 'at', expr: future })
    })

    it('rejects a past one-shot instant with a clear error', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_create')!
      const result = await callTool(tool, {
        name: 'Too late', schedule: '2020-01-01T00:00:00.000Z', agentId: 'pixel', taskPrompt: 'Nope',
      })
      expect(result.ok).toBe(false)
      expect(String(result.error)).toMatch(/in the past/i)
    })

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
      expect(result.expr).toBe('0 9 * * *')
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
      expect(result.error).toContain('invalid parameters')
    })

    it('returns error when schedule is missing', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_create')!
      const result = await callTool(tool, { name: 'Test' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('invalid parameters')
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

    it('re-assigns a job to a team, clearing the agent (round-3 review)', async () => {
      upsertJob(makeMeta({ jobId: 'job-team-upd', agentId: 'chef' }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_update')!
      const result = await callTool(tool, { jobId: 'job-team-upd', teamId: 'development' })
      expect(result.ok).toBe(true)

      const meta = getJob('job-team-upd')
      expect(meta!.teamId).toBe('development')
      expect(meta!.agentId).toBeUndefined()
    })

    it('rejects agentId + teamId together (round-3 review)', async () => {
      upsertJob(makeMeta({ jobId: 'job-team-both' }))
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_update')!
      const result = await callTool(tool, { jobId: 'job-team-both', agentId: 'chef', teamId: 'development' })
      expect(result.ok).toBe(false)
      expect(String(result.error)).toContain('both')
    })

    it('rejects an unknown teamId (round-3 review)', async () => {
      upsertJob(makeMeta({ jobId: 'job-team-ghost' }))
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_update')!
      const result = await callTool(tool, { jobId: 'job-team-ghost', teamId: 'ghost-team' })
      expect(result.ok).toBe(false)
      expect(String(result.error)).toContain('Unknown team')
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
      expect(result.error).toContain('invalid parameters')
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

    it('clears a stale pauseUntil when re-paused without a date (parity with the REST route)', async () => {
      upsertJob(makeMeta({ jobId: 'job-stale', paused: true, pauseUntil: '2026-05-01T00:00:00Z' }))

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_pause')!
      await callTool(tool, { jobId: 'job-stale', action: 'pause' })

      const meta = getJob('job-stale')
      expect(meta!.paused).toBe(true)
      expect(meta!.pauseUntil).toBeUndefined()
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
      expect(result.error).toContain('invalid parameters')
    })

    it('returns error when action is missing', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_pause')!
      const result = await callTool(tool, { jobId: 'job-p' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('invalid parameters')
    })

    it('returns not-found for an unknown job', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_pause')!
      const result = await callTool(tool, { jobId: 'ghost', action: 'pause' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('rejects pausing a native (non-Bakin) runtime cron (read-only)', async () => {
      mockRuntimeCronJobs.push({ id: 'native-exec-pause', name: 'Native', schedule: '0 9 * * *', command: 'run', enabled: true })
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_pause')!
      const result = await callTool(tool, { jobId: 'native-exec-pause', action: 'pause' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('read-only')
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
      expect(result.error).toContain('invalid parameters')
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

    it('includes lastRun from the ledger for a Bakin job', async () => {
      upsertJob(makeMeta({ jobId: 'job-get-run' }))
      claimCronFire('job-get-run', 'r99', Date.parse('2026-03-31T09:00:00Z'))
      attachCronTask('job-get-run', 'r99', 'task-r99')

      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_get')!
      const result = await callTool(tool, { jobId: 'job-get-run' })

      const job = result.job as Record<string, unknown>
      const lastRun = job.lastRun as RunEntry
      expect(lastRun.runId).toBe('r99')
      expect(lastRun.status).toBe('success')
      expect(lastRun.taskId).toBe('task-r99')
    })

    it('returns error when jobId is missing', async () => {
      const tool = findTool(plugin.execTools, 'bakin_exec_schedule_get')!
      const result = await callTool(tool, {})
      expect(result.ok).toBe(false)
      expect(result.error).toContain('invalid parameters')
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
      expect(result.error).toContain('invalid parameters')
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
