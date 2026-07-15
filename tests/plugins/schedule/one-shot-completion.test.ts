/**
 * One-shot ('at') completion — after its single occurrence fires into a task,
 * the job auto-disables and records completedAt (the "completed" display
 * state), with run history preserved. Cron jobs are untouched by this path.
 * Scaffolding mirrors blocked-fire-routing.test.ts (same fire-engine seams).
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import type { BakinJobMeta } from '@bakin/schedule/types'

const testDir = join(tmpdir(), `bakin-test-one-shot-${Date.now()}-${randomUUID()}`)
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

mock.module('../../../src/core/audit', () => ({ appendAudit: mock() }))

let createdTasks: string[] = []
const mockCreateTask = mock(async (opts?: unknown) => {
  const o = (opts ?? {}) as Record<string, unknown>
  const id = (o.id as string | undefined) ?? `task-${createdTasks.length + 1}`
  createdTasks.push(id)
  return { id, workflowId: undefined }
})
mock.module('../../../src/core/task-service', () => ({
  createTaskWithEffects: async (opts: unknown) => mockCreateTask(opts),
  validateTeamRef: async () => undefined,
  validateTeamAssignment: async () => undefined,
  TaskValidationError: class extends Error {},
}))

interface BoardTask { id: string }
const emptyBoard = {
  columns: {
    todo: [] as BoardTask[], inProgress: [] as BoardTask[], review: [] as BoardTask[],
    blocked: [] as BoardTask[], done: [] as BoardTask[], archived: [] as BoardTask[], backlog: [] as BoardTask[],
  },
}
mock.module('@/core/task-store', () => ({ readTaskboard: mock(() => emptyBoard), addTaskLog: mock(async () => undefined) }))
mock.module('../../../src/core/task-store', () => ({ readTaskboard: mock(() => emptyBoard), addTaskLog: mock(async () => undefined) }))

const mockHookRegistry = { invoke: mock(async () => undefined), register: mock(), has: mock(() => false) }
mock.module('../../../src/core/plugin-registry', () => ({ getHookRegistry: () => mockHookRegistry }))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({ getHookRegistry: () => mockHookRegistry }))

import { upsertJob, getJob } from '@bakin/schedule/lib/sidecar'
import { runClaimedFire } from '@bakin/schedule/lib/fire-engine'
import { __scheduleTestInternals } from '@bakin/schedule/index'
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

const AT = '2026-06-07T15:00:00.000Z'

function oneShotMeta(overrides: Partial<BakinJobMeta> = {}): BakinJobMeta {
  return {
    jobId: 'sch_once',
    isBakinJob: true,
    enabled: true,
    displayName: 'One-shot reminder',
    agentId: 'chef',
    owner: 'main',
    taskPrompt: 'Do the one thing',
    schedule: { kind: 'at', expr: AT },
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  mkdirSync(sidecarDir, { recursive: true })
  createdTasks = []
  mockCreateTask.mockClear()
  setPluginCtxForTests(makeCtx())
})

afterEach(() => {
  setPluginCtxForTests(null)
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('one-shot completion', () => {
  it('auto-disables and stamps completedAt after its occurrence fires', async () => {
    upsertJob(oneShotMeta())
    const result = await fireScheduledRunFromPayload({
      jobId: 'sch_once', runId: `sch_once:${AT}`, timestamp: AT,
    })
    expect(result.body.taskId).toBe(createdTasks[0])

    const after = getJob('sch_once')!
    expect(after.enabled).toBe(false)
    expect(after.completedAt).toBe(AT)
    expect(after.lastTaskId).toBe(createdTasks[0])
  })

  it('a cron job keeps firing state untouched (no disable, no completedAt)', async () => {
    upsertJob(oneShotMeta({ jobId: 'sch_daily', schedule: { kind: 'cron', expr: '0 9 * * *' } }))
    await fireScheduledRunFromPayload({
      jobId: 'sch_daily', runId: 'sch_daily:run-1', timestamp: AT,
    })
    const after = getJob('sch_daily')!
    expect(after.enabled).not.toBe(false)
    expect(after.completedAt).toBeUndefined()
  })

  it('a blocked catch-up fire still completes the one-shot (occurrence consumed)', async () => {
    const meta = oneShotMeta()
    upsertJob(meta)
    const result = await runClaimedFire(meta, 'sch_once', `sch_once:${AT}`, {
      column: 'blocked', blockedReason: 'missed schedule window', firedAtMs: Date.parse(AT),
    })
    expect(result.body.taskId).toBe(createdTasks[0])
    const after = getJob('sch_once')!
    expect(after.enabled).toBe(false)
    expect(after.completedAt).toBe(AT)
  })
})
