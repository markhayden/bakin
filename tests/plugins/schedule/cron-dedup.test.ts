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
  void opts
  if (createDelayMs > 0) await new Promise((r) => setTimeout(r, createDelayMs))
  const id = `task-${createdTasks.length + 1}`
  createdTasks.push(id)
  return { id, workflowId: undefined }
})
mock.module('../../../src/core/task-service', () => ({
  createTaskWithEffects: (opts: unknown) => mockCreateTask(opts),
}))

const emptyBoard = {
  columns: { todo: [], inProgress: [], review: [], blocked: [], done: [], archived: [], backlog: [] },
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
    const bodies = [a.body, b.body].sort((x, y) => String(x.taskId ?? '').localeCompare(String(y.taskId ?? '')))
    expect(bodies.some((r) => r.taskId === 'task-1')).toBe(true)
    expect(bodies.some((r) => r.skipped === 'already-processed')).toBe(true)
    expect(auditEvents.filter((e) => e.event === 'fire_suppressed')).toHaveLength(1)
    expect(getCronFire('release-notes', 'run-morning')?.disposition).toBe('created')
    expect(getCronFire('release-notes', 'run-morning')?.taskId).toBe('task-1')
  })

  it('a sequential replay of the same runId is suppressed', async () => {
    upsertJob(makeMeta())
    const payload = { jobId: 'release-notes', runId: 'run-x', timestamp: '2026-06-06T07:00:00Z' }

    const first = await fireScheduledRunFromPayload(payload)
    expect(first.body.taskId).toBe('task-1')

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
    expect(fire?.taskId).toBe('task-1')
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
    expect(a.body.taskId).toBe('task-1')
    expect(b.body.taskId).toBe('task-2')
    expect(mockCreateTask).toHaveBeenCalledTimes(2)
  })
})

