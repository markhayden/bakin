/**
 * Blocked-task fire routing (SPEC: blocked tasks must not suppress real fires).
 *
 * FR1: the overlap guard must NOT treat a `blocked` last-task as "still running"
 *      — a blocked task is awaiting human triage, not in flight, so the next
 *      occurrence must fire instead of being skipped as `overlap`.
 * FR2: a catch-up triage block (`MISSED_WINDOW_REASON`) must not count toward the
 *      failure / auto-pause counter; a real dispatch-failure block must.
 * FR3: a catch-up task is labeled by its OCCURRENCE date, not creation time.
 * FR4: end-to-end — a blocked last-task no longer eats the next real fire.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { BakinJobMeta } from '@bakin/schedule/types'

const testDir = join(tmpdir(), `bakin-test-blocked-fire-${Date.now()}-${randomUUID()}`)
const sidecarDir = join(testDir, 'schedule')

process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...segments: string[]) => join(testDir, 'openclaw', ...segments),
  resetOpenClawHome: () => {},
}))

const contentDirMock = () => ({
  getContentDir: () => testDir,
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

mock.module('../../../src/core/audit', () => ({
  appendAudit: mock(),
}))

let createdTasks: string[] = []
let createdTaskOpts: Array<Record<string, unknown>> = []
const mockCreateTask = mock(async (opts?: unknown) => {
  const o = (opts ?? {}) as Record<string, unknown>
  const id = (o.id as string | undefined) ?? `task-${createdTasks.length + 1}`
  createdTasks.push(id)
  createdTaskOpts.push(o)
  return { id, workflowId: undefined }
})
mock.module('../../../src/core/task-service', () => ({
  createTaskWithEffects: (opts: unknown) => mockCreateTask(opts),
}))

interface BoardTask { id: string; blockedReason?: string }
const emptyBoard = {
  columns: {
    todo: [] as BoardTask[], inProgress: [] as BoardTask[], review: [] as BoardTask[],
    blocked: [] as BoardTask[], done: [] as BoardTask[], archived: [] as BoardTask[], backlog: [] as BoardTask[],
  },
}
mock.module('@/core/task-store', () => ({ readTaskboard: mock(() => emptyBoard) }))
mock.module('../../../src/core/task-store', () => ({ readTaskboard: mock(() => emptyBoard) }))

const mockHookRegistry = {
  invoke: mock(async () => undefined),
  register: mock(),
  has: mock(() => false),
}
mock.module('../../../src/lib/plugin-registry', () => ({
  getHookRegistry: () => mockHookRegistry,
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => mockHookRegistry,
}))

import { upsertJob, getJob } from '@bakin/schedule/lib/sidecar'
import { __scheduleTestInternals, MISSED_WINDOW_REASON } from '@bakin/schedule/index'
import { closeDb } from '../../../packages/core/src/storage/db'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'

const { fireScheduledRunFromPayload, setPluginCtxForTests } = __scheduleTestInternals

function makeCtx() {
  return {
    pluginId: 'schedule',
    runtime: createMockRuntimeAdapter(),
    activity: { log: mock(), audit: mock() },
    hooks: { register: mock(), has: mockHookRegistry.has, invoke: mockHookRegistry.invoke },
    getSettings: mock(() => ({})),
    updateSettings: mock(),
  }
}

function makeMeta(overrides: Partial<BakinJobMeta> = {}): BakinJobMeta {
  return {
    jobId: 'release-notes',
    isBakinJob: true,
    displayName: 'Morning Release Notes',
    agentId: 'chef',
    owner: 'main',
    taskPrompt: 'Curate release notes',
    taskTitle: 'Release notes {date}',
    allowOverlap: false,
    maxFailures: 3,
    consecutiveFailures: 0,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

function resetBoard() {
  for (const col of Object.values(emptyBoard.columns)) (col as BoardTask[]).length = 0
}

beforeEach(() => {
  mkdirSync(sidecarDir, { recursive: true })
  createdTasks = []
  createdTaskOpts = []
  resetBoard()
  mockCreateTask.mockClear()
  setPluginCtxForTests(makeCtx())
})

afterEach(() => {
  setPluginCtxForTests(null)
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// FR1 — overlap guard excludes `blocked`
// ---------------------------------------------------------------------------
describe('FR1: overlap guard excludes blocked', () => {
  it('AC1.1: a blocked last-task does NOT suppress the next fire', async () => {
    upsertJob(makeMeta({ lastTaskId: 'task-blocked' }))
    emptyBoard.columns.blocked.push({ id: 'task-blocked', blockedReason: MISSED_WINDOW_REASON })

    const result = await fireScheduledRunFromPayload({
      jobId: 'release-notes', runId: 'run-after-block', timestamp: '2026-06-08T07:00:00Z',
    })

    expect(result.body.skipped).toBeUndefined()
    expect(result.body.taskId).toBe(createdTasks[0])
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
  })

  it('AC1.2: an inProgress last-task still suppresses the next fire as overlap', async () => {
    upsertJob(makeMeta({ lastTaskId: 'task-running' }))
    emptyBoard.columns.inProgress.push({ id: 'task-running' })

    const result = await fireScheduledRunFromPayload({
      jobId: 'release-notes', runId: 'run-overlap-ip', timestamp: '2026-06-08T07:00:00Z',
    })

    expect(result.body.skipped).toBe('overlap')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('AC1.2: a review last-task still suppresses the next fire as overlap', async () => {
    upsertJob(makeMeta({ lastTaskId: 'task-review' }))
    emptyBoard.columns.review.push({ id: 'task-review' })

    const result = await fireScheduledRunFromPayload({
      jobId: 'release-notes', runId: 'run-overlap-rv', timestamp: '2026-06-08T07:00:00Z',
    })

    expect(result.body.skipped).toBe('overlap')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('AC1.2: a todo last-task still suppresses the next fire as overlap', async () => {
    upsertJob(makeMeta({ lastTaskId: 'task-queued' }))
    emptyBoard.columns.todo.push({ id: 'task-queued' })

    const result = await fireScheduledRunFromPayload({
      jobId: 'release-notes', runId: 'run-overlap-td', timestamp: '2026-06-08T07:00:00Z',
    })

    expect(result.body.skipped).toBe('overlap')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('AC1.3: allowOverlap bypasses the guard entirely (blocked or otherwise)', async () => {
    upsertJob(makeMeta({ allowOverlap: true, lastTaskId: 'task-running' }))
    emptyBoard.columns.inProgress.push({ id: 'task-running' })

    const result = await fireScheduledRunFromPayload({
      jobId: 'release-notes', runId: 'run-allow-overlap', timestamp: '2026-06-08T07:00:00Z',
    })

    expect(result.body.taskId).toBe(createdTasks[0])
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// FR2 — triage blocks are not failures
// ---------------------------------------------------------------------------
describe('FR2: triage blocks do not count toward auto-pause', () => {
  const DISPATCH_FAILURE_REASON = 'Agent run ended before reporting completion. session died.'

  it('AC2.1: a "missed schedule window" triage block does NOT record a failure', async () => {
    upsertJob(makeMeta({ lastTaskId: 'task-triage', consecutiveFailures: 0 }))
    emptyBoard.columns.blocked.push({ id: 'task-triage', blockedReason: MISSED_WINDOW_REASON })

    await fireScheduledRunFromPayload({
      jobId: 'release-notes', runId: 'run-after-triage', timestamp: '2026-06-08T07:00:00Z',
    })

    expect(getJob('release-notes')!.consecutiveFailures).toBe(0)
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
  })

  it('AC2.2: a dispatch-failure block DOES record a failure', async () => {
    upsertJob(makeMeta({ lastTaskId: 'task-failed', consecutiveFailures: 0 }))
    emptyBoard.columns.blocked.push({ id: 'task-failed', blockedReason: DISPATCH_FAILURE_REASON })

    await fireScheduledRunFromPayload({
      jobId: 'release-notes', runId: 'run-after-fail', timestamp: '2026-06-08T07:00:00Z',
    })

    expect(getJob('release-notes')!.consecutiveFailures).toBe(1)
  })

  it('AC2.2: repeated dispatch-failure blocks auto-pause at maxFailures', async () => {
    upsertJob(makeMeta({ lastTaskId: 'task-failed', consecutiveFailures: 2, maxFailures: 3 }))
    emptyBoard.columns.blocked.push({ id: 'task-failed', blockedReason: DISPATCH_FAILURE_REASON })

    const result = await fireScheduledRunFromPayload({
      jobId: 'release-notes', runId: 'run-auto-pause', timestamp: '2026-06-08T07:00:00Z',
    })

    expect(result.body.skipped).toBe('auto-paused')
    expect(getJob('release-notes')!.paused).toBe(true)
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('AC2.1: a triage block never auto-pauses even at the failure threshold', async () => {
    upsertJob(makeMeta({ lastTaskId: 'task-triage', consecutiveFailures: 2, maxFailures: 3 }))
    emptyBoard.columns.blocked.push({ id: 'task-triage', blockedReason: MISSED_WINDOW_REASON })

    const result = await fireScheduledRunFromPayload({
      jobId: 'release-notes', runId: 'run-triage-threshold', timestamp: '2026-06-08T07:00:00Z',
    })

    expect(result.body.skipped).toBeUndefined()
    expect(getJob('release-notes')!.paused).toBeFalsy()
    expect(getJob('release-notes')!.consecutiveFailures).toBe(2)
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
  })

  it('AC2.3: a done last-task records success (resets failures)', async () => {
    upsertJob(makeMeta({ lastTaskId: 'task-done', consecutiveFailures: 2 }))
    emptyBoard.columns.done.push({ id: 'task-done' })

    await fireScheduledRunFromPayload({
      jobId: 'release-notes', runId: 'run-after-done', timestamp: '2026-06-08T07:00:00Z',
    })

    expect(getJob('release-notes')!.consecutiveFailures).toBe(0)
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// FR3 — catch-up tasks labeled by occurrence date
// ---------------------------------------------------------------------------
describe('FR3: task labeled by occurrence/fired date, not creation time', () => {
  it('AC3.1: a catch-up fire for a past occurrence is titled with that occurrence date', async () => {
    upsertJob(makeMeta()) // taskTitle: 'Release notes {date}'

    await fireScheduledRunFromPayload({
      jobId: 'release-notes', runId: 'run-catchup', timestamp: '2026-06-07T15:00:00Z',
    })

    expect(createdTaskOpts[0]?.title).toBe('Release notes 2026-06-07')
  })

  it('AC3.2: an on-time fire is titled with that fire date', async () => {
    upsertJob(makeMeta())

    await fireScheduledRunFromPayload({
      jobId: 'release-notes', runId: 'run-ontime', timestamp: '2026-06-08T15:00:00Z',
    })

    expect(createdTaskOpts[0]?.title).toBe('Release notes 2026-06-08')
  })

  it('AC3.3: the date is rendered in the JOB timezone, not UTC (crosses UTC midnight)', async () => {
    // 2026-06-08T01:00Z is 2026-06-07 18:00 in Los Angeles — the label must read
    // the LOCAL day (06-07), not the UTC day (06-08).
    upsertJob(makeMeta({ tz: 'America/Los_Angeles' }))

    await fireScheduledRunFromPayload({
      jobId: 'release-notes', runId: 'run-tz', timestamp: '2026-06-08T01:00:00Z',
    })

    expect(createdTaskOpts[0]?.title).toBe('Release notes 2026-06-07')
  })
})

// ---------------------------------------------------------------------------
// FR4 — end-to-end cascade: a stale blocked triage task no longer eats the
// next real fire, and the new run is correctly labeled + not penalized.
// ---------------------------------------------------------------------------
describe('FR4: blocked triage task does not suppress the next real fire', () => {
  it('AC4.1: next occurrence fires, is dispatched, correctly dated, and not counted as a failure', async () => {
    upsertJob(makeMeta({ lastTaskId: 'task-stale-triage', consecutiveFailures: 0 }))
    // Yesterday's catch-up triage block, still sitting in blocked.
    emptyBoard.columns.blocked.push({ id: 'task-stale-triage', blockedReason: MISSED_WINDOW_REASON })

    // Today's real fire.
    const result = await fireScheduledRunFromPayload({
      jobId: 'release-notes', runId: 'run-today', timestamp: '2026-06-08T15:00:00Z',
    })

    expect(result.body.skipped).toBeUndefined()
    expect(result.body.taskId).toBe(createdTasks[0])
    expect(createdTaskOpts[0]?.title).toBe('Release notes 2026-06-08')
    expect(getJob('release-notes')!.consecutiveFailures).toBe(0)
    expect(getJob('release-notes')!.paused).toBeFalsy()
  })
})
