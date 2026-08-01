/**
 * Cron fire dedup — a (job, run) fires exactly once (SPEC §8 test #1 + #8a).
 *
 * Prove-It: before the ledger claim, two concurrent processScheduledRun calls
 * for the same runId both passed the sidecar dedup check (state was persisted
 * AFTER slow task creation) and created two tasks — the release-notes
 * double-post. The claim-before-create flow makes the second fire fail the
 * INSERT instead.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { BakinJobMeta } from '@bakin/schedule/types'

const testDir = join(tmpdir(), `bakin-test-cron-dedup-${Date.now()}-${randomUUID()}`)
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

// Controllable slow task creation — the double-fire window IS the create latency.
let createDelayMs = 0
let createdTasks: string[] = []
const mockCreateTask = mock(async (opts?: unknown) => {
  // Simulated create latency — the delay IS the condition under test (fire dedup).
  if (createDelayMs > 0) await new Promise((r) => setTimeout(r, createDelayMs))
  // Honor the caller-minted id (runClaimedFire now pre-mints task ids).
  const id = (opts as { id?: string })?.id ?? `task-${createdTasks.length + 1}`
  createdTasks.push(id)
  return { id, workflowId: undefined }
})
mock.module('../../../src/core/task-service', () => ({
  createTaskWithEffects: (opts: unknown) => mockCreateTask(opts),
  validateTeamRef: async () => undefined,
  validateTeamAssignment: async () => undefined,
  TaskValidationError: class extends Error {},
}))

const emptyBoard = {
  columns: { todo: [], inProgress: [], review: [], blocked: [], done: [], archived: [], backlog: [] },
}
mock.module('@/core/task-store', () => ({ readTaskboard: mock(() => emptyBoard), addTaskLog: mock(async () => undefined) }))
mock.module('../../../src/core/task-store', () => ({ readTaskboard: mock(() => emptyBoard), addTaskLog: mock(async () => undefined) }))

const mockHookRegistry = {
  invoke: mock(async () => undefined),
  register: mock(),
  has: mock(() => false),
}
mock.module('../../../src/core/plugin-registry', () => ({
  getHookRegistry: () => mockHookRegistry,
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => mockHookRegistry,
}))

import { upsertJob } from '@bakin/schedule/lib/sidecar'
import { __scheduleTestInternals } from '@bakin/schedule/index'
import { claimCronFire, getCronFire } from '../../../src/core/execution-ledger'
import { closeDb } from '../../../packages/core/src/storage/db'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'

const { fireScheduledRunFromPayload, healPendingCronClaims, setPluginCtxForTests } = __scheduleTestInternals

let auditEvents: Array<{ event: string; data: Record<string, unknown> }> = []

function makeCtx() {
  const runtime = createMockRuntimeAdapter()
  return {
    pluginId: 'schedule',
    runtime,
    activity: {
      log: mock(),
      audit: mock((event: string, _agent: string, data?: Record<string, unknown>) => {
        auditEvents.push({ event, data: data ?? {} })
      }),
    },
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
    allowOverlap: true,
    maxFailures: 3,
    consecutiveFailures: 0,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  mkdirSync(sidecarDir, { recursive: true })
  createdTasks = []
  createDelayMs = 0
  auditEvents = []
  for (const col of Object.values(emptyBoard.columns)) (col as unknown[]).length = 0
  mockCreateTask.mockClear()
  setPluginCtxForTests(makeCtx())
})

afterEach(() => {
  setPluginCtxForTests(null)
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('cron fire dedup (claim before create)', () => {
  it('Prove-It: two CONCURRENT fires for one runId create exactly one task', async () => {
    upsertJob(makeMeta())
    createDelayMs = 50 // the TOCTOU window that double-posted release notes

    const payload = { jobId: 'release-notes', runId: 'run-morning', timestamp: '2026-06-06T07:00:00Z' }
    const [a, b] = await Promise.all([fireScheduledRunFromPayload(payload), fireScheduledRunFromPayload(payload)])

    expect(mockCreateTask).toHaveBeenCalledTimes(1)
    expect(createdTasks).toHaveLength(1)
    const bodies = [a.body, b.body]
    expect(bodies.some((r) => r.taskId === createdTasks[0])).toBe(true)
    expect(bodies.some((r) => r.skipped === 'already-processed')).toBe(true)
    expect(auditEvents.filter((e) => e.event === 'fire_suppressed')).toHaveLength(1)
    expect(getCronFire('release-notes', 'run-morning')?.disposition).toBe('created')
    expect(getCronFire('release-notes', 'run-morning')?.taskId).toBe(createdTasks[0])
  })

  it('a sequential replay of the same runId is suppressed', async () => {
    upsertJob(makeMeta())
    const payload = { jobId: 'release-notes', runId: 'run-x', timestamp: '2026-06-06T07:00:00Z' }

    const first = await fireScheduledRunFromPayload(payload)
    expect(first.body.taskId).toBe(createdTasks[0])

    const replay = await fireScheduledRunFromPayload(payload)
    expect(replay.body).toEqual({ ok: true, skipped: 'already-processed' })
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
    expect(auditEvents.filter((e) => e.event === 'fire_suppressed')).toHaveLength(1)
  })

  it('skipped fires (paused job) consume the claim and are not healed later', async () => {
    upsertJob(makeMeta({ paused: true, pauseReason: 'manual' }))
    const payload = { jobId: 'release-notes', runId: 'run-paused', timestamp: '2026-06-06T07:00:00Z' }

    const result = await fireScheduledRunFromPayload(payload)
    expect(result.body.skipped).toBe('paused')
    expect(getCronFire('release-notes', 'run-paused')?.disposition).toBe('skipped')

    await healPendingCronClaims()
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('crash window heals: a stale pending claim creates exactly one task under the same claim', async () => {
    upsertJob(makeMeta())
    // Simulate: claim landed, process died before task creation (>5min ago)
    const old = Date.now() - 10 * 60_000
    claimCronFire('release-notes', 'run-crashed', old, 'pending', old)

    await healPendingCronClaims()

    expect(mockCreateTask).toHaveBeenCalledTimes(1)
    const fire = getCronFire('release-notes', 'run-crashed')
    expect(fire?.disposition).toBe('created')
    expect(fire?.taskId).toBe(createdTasks[0])
    expect(auditEvents.filter((e) => e.event === 'fire_healed')).toHaveLength(1)

    // Healing is idempotent — a second pass finds nothing pending
    await healPendingCronClaims()
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
  })

  it('a FRESH pending claim is not healed (the live fire is still in flight)', async () => {
    upsertJob(makeMeta())
    claimCronFire('release-notes', 'run-in-flight', Date.now())
    await healPendingCronClaims()
    expect(mockCreateTask).not.toHaveBeenCalled()
    expect(getCronFire('release-notes', 'run-in-flight')?.disposition).toBe('pending')
  })

  it('healing a claim for a paused job marks it skipped instead of creating', async () => {
    upsertJob(makeMeta({ paused: true }))
    const staleAt = Date.now() - 10 * 60_000
    claimCronFire('release-notes', 'run-paused-heal', staleAt, 'pending', staleAt)
    await healPendingCronClaims()
    expect(mockCreateTask).not.toHaveBeenCalled()
    expect(getCronFire('release-notes', 'run-paused-heal')?.disposition).toBe('skipped')
  })

  it('runId-less payloads mint a manual id — intentional fires are never blocked', async () => {
    upsertJob(makeMeta())
    const a = await fireScheduledRunFromPayload({ jobId: 'release-notes', timestamp: '2026-06-06T08:00:00Z' })
    const b = await fireScheduledRunFromPayload({ jobId: 'release-notes', timestamp: '2026-06-06T08:05:00Z' })
    expect(a.body.taskId).toBe(createdTasks[0])
    expect(b.body.taskId).toBe(createdTasks[1])
    expect(a.body.taskId).not.toBe(b.body.taskId)
    expect(mockCreateTask).toHaveBeenCalledTimes(2)
  })

  it('emits schedule.fire_skipped with the reason when a paused job fires', async () => {
    upsertJob(makeMeta({ paused: true, pauseReason: 'manual' }))
    const payload = { jobId: 'release-notes', runId: 'run-paused-audit', timestamp: '2026-06-06T07:00:00Z' }
    const result = await fireScheduledRunFromPayload(payload)

    expect(result.body.skipped).toBe('paused')
    const ev = auditEvents.filter((e) => e.event === 'fire_skipped')
    expect(ev).toHaveLength(1)
    expect(ev[0].data.reason).toBe('paused')
    expect(ev[0].data.runId).toBe('run-paused-audit')
    expect(getCronFire('release-notes', 'run-paused-audit')?.skipReason).toBe('paused')
  })

  it('emits schedule.fire_skipped with reason "overlap" when the prior task is still active', async () => {
    upsertJob(makeMeta({ allowOverlap: false, lastTaskId: 'task-active' }))
    emptyBoard.columns.todo.push({ id: 'task-active' } as never)
    const payload = { jobId: 'release-notes', runId: 'run-overlap-audit', timestamp: '2026-06-06T07:00:00Z' }
    const result = await fireScheduledRunFromPayload(payload)

    expect(result.body.skipped).toBe('overlap')
    const ev = auditEvents.filter((e) => e.event === 'fire_skipped')
    expect(ev).toHaveLength(1)
    expect(ev[0].data.reason).toBe('overlap')
    expect(getCronFire('release-notes', 'run-overlap-audit')?.skipReason).toBe('overlap')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('Prove-It (#472): a post-create effect failure does not duplicate the task on heal', async () => {
    upsertJob(makeMeta())
    // Simulate createTaskWithEffects writing the row, then a post-create effect
    // (e.g. workflow-start) throwing — the task EXISTS but the call rejects.
    mockCreateTask.mockImplementationOnce(async (opts: unknown) => {
      const id = (opts as { id?: string }).id!
      emptyBoard.columns.todo.push({ id } as never)
      throw new Error('Failed to start workflow "x"')
    })
    const payload = { jobId: 'release-notes', runId: 'run-partial', timestamp: '2026-06-06T07:00:00Z' }
    const result = await fireScheduledRunFromPayload(payload)

    // The existing task is attached to the claim (disposition created), not left pending.
    const fire = getCronFire('release-notes', 'run-partial')
    expect(fire?.disposition).toBe('created')
    expect(fire?.taskId).toBe(result.body.taskId)

    // Heal must NOT mint a second task for the same occurrence.
    mockCreateTask.mockClear()
    await healPendingCronClaims()
    expect(mockCreateTask).not.toHaveBeenCalled()
  })
})

