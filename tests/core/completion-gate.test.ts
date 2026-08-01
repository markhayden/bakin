/**
 * Completion first-write-wins gate (SPEC §8 test #2).
 *
 * Prove-It: before the gate, two reportComplete() calls (agent MCP retry,
 * double-click, late zombie turn) BOTH notified the orchestrator and BOTH
 * fired continuation — the double side effects behind the image double-bill.
 * The completions table makes the second caller a suppressed, audited no-op
 * that returns alreadyComplete instead of erroring.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-completion-gate-${Date.now()}-${randomUUID()}`)

// Real ledger isolated to a temp dir — mock BOTH content-dir modules.
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
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const auditEvents: Array<{ event: string; agent: string; data: Record<string, unknown> }> = []
const auditMock = () => ({
  appendAudit: mock((_dir: string, event: string, agent: string, data?: Record<string, unknown>) => {
    auditEvents.push({ event, agent, data: data ?? {} })
  }),
})
mock.module('@/core/audit', auditMock)
mock.module('../../src/core/audit', auditMock)

const mockContinuation = mock(() => Promise.resolve())
const continuationMock = () => ({ checkAndContinueDependents: mockContinuation })
mock.module('@/core/continuation', continuationMock)
mock.module('../../src/core/continuation', continuationMock)

const mockRuntimeSend = mock((...args: unknown[]) => {
  void args
  return Promise.resolve({ id: 'runtime-msg' })
})
const mockAppServices = {
  runtime: {
    agents: { list: () => Promise.resolve([{ id: 'main', name: 'Main', status: 'active' }]) },
    messaging: { send: (...args: unknown[]) => mockRuntimeSend(...args) },
  },
}
mock.module('@/core/app-services', () => ({ getAppServices: () => mockAppServices }))
mock.module('@/core/app-services-store', () => ({ getAppServices: () => mockAppServices }))
mock.module('../../src/core/app-services', () => ({ getAppServices: () => mockAppServices }))
mock.module('../../src/core/app-services-store', () => ({ getAppServices: () => mockAppServices }))

mock.module('@bakin/core/adapters/runtime', () => ({
  getRuntimeMainAgentId: () => Promise.resolve('main'),
}))

// Task-store fake: slow-able move so concurrent completions genuinely overlap.
let moveDelayMs = 0
let boardColumns: Record<string, Array<{ id: string; title: string; workflowId?: string; updatedAt?: number }>> = {
  todo: [], inProgress: [], review: [], done: [], blocked: [], archived: [],
}
const mockMoveTask = mock(async (taskId: unknown, to: unknown) => {
  // Mirror the real store's transition validation — a done task cannot be
  // "moved" to done again (this is exactly what broke the retry path in
  // the live smoke test).
  for (const [column, tasks] of Object.entries(boardColumns)) {
    if (tasks.some((t) => t.id === taskId) && column === 'done' && String(to).toLowerCase() === 'done') {
      throw new Error('Invalid transition: done -> done. Allowed: archived, todo, inProgress')
    }
  }
  // Simulated store latency — the delay IS the condition under test (racing moves).
  if (moveDelayMs > 0) await new Promise((r) => setTimeout(r, moveDelayMs))
})
const mockAddTaskLog = mock((..._args: unknown[]) => Promise.resolve())
const mockBlockTaskStore = mock(() => Promise.resolve())
const taskStoreMock = () => ({
  addTaskLog: mockAddTaskLog,
  blockTask: mockBlockTaskStore,
  createTask: mock(() => Promise.resolve({ id: 'new-task' })),
  getTaskWithColumn: mock((id: string) => {
    for (const [column, tasks] of Object.entries(boardColumns)) {
      const task = tasks.find((t) => t.id === id)
      if (task) return { task, column }
    }
    return null
  }),
  getTasksByColumn: mock((col: string) => boardColumns[col] ?? []),
  moveTask: mockMoveTask,
  readTaskboard: mock(() => ({ columns: boardColumns })),
  setDependency: mock(() => Promise.resolve()),
  updateTask: mock(() => Promise.resolve()),
})
mock.module('@/core/task-store', taskStoreMock)
mock.module('../../src/core/task-store', taskStoreMock)

mock.module('../../src/core/plugin-registry', () => ({
  getHookRegistry: () => ({
    invoke: mock(async () => undefined),
    callAll: mock(async () => undefined),
    register: mock(),
    has: mock(() => false),
  }),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: mock(async () => undefined),
    callAll: mock(async () => undefined),
    register: mock(),
    has: mock(() => false),
  }),
}))

mock.module('../../src/core/workflow-tool-authorization', () => ({
  assertWorkflowToolAllowed: mock(() => Promise.resolve()),
}))

mock.module('../../src/core/usage', () => ({
  recordUsage: mock(),
}))

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('@/core/logger', loggerMock)
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import { reportComplete, moveTaskWithEffects, blockTaskWithEffects, reopenIfLeavingDone, syncLedgerForStoreMove, backfillMissingCompletionRows } from '../../src/core/task-service'
import { hasCompletion, recordCompletion } from '../../src/core/execution-ledger'
import { closeDb } from '../../packages/core/src/storage/db'

function auditCount(event: string): number {
  return auditEvents.filter((e) => e.event === event).length
}

beforeEach(() => {
  mkdirSync(testDir, { recursive: true })
  auditEvents.length = 0
  moveDelayMs = 0
  mockRuntimeSend.mockClear()
  mockContinuation.mockClear()
  mockMoveTask.mockClear()
  mockAddTaskLog.mockClear()
  mockBlockTaskStore.mockClear()
  boardColumns = {
    todo: [],
    inProgress: [{ id: 'task-1', title: 'Test Task' }],
    review: [], done: [], blocked: [], archived: [],
  }
})

afterEach(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('completion gate — first write wins', () => {
  it('Prove-It: CONCURRENT double reportComplete → one notify, one continuation, one task.completed', async () => {
    moveDelayMs = 30 // both calls in flight at once

    const [a, b] = await Promise.all([
      reportComplete('task-1', 'agent-a', 'did the thing', 'mcp'),
      reportComplete('task-1', 'agent-b', 'did the thing again', 'mcp'),
    ])

    expect(mockRuntimeSend).toHaveBeenCalledTimes(1)
    expect(mockContinuation).toHaveBeenCalledTimes(1)
    expect(auditCount('task.completed')).toBe(1)
    expect(auditCount('task.completion_suppressed')).toBe(1)
    expect([a.alreadyComplete, b.alreadyComplete].sort()).toEqual([false, true])
  })

  it('sequential retry returns alreadyComplete and never errors', async () => {
    const first = await reportComplete('task-1', 'agent-a', 'done', 'mcp')
    expect(first.alreadyComplete).toBe(false)
    expect(mockRuntimeSend).toHaveBeenCalledTimes(1)

    boardColumns.done = boardColumns.inProgress
    boardColumns.inProgress = []

    const retry = await reportComplete('task-1', 'agent-a', 'done', 'mcp')
    expect(retry.alreadyComplete).toBe(true)
    expect(mockRuntimeSend).toHaveBeenCalledTimes(1) // no second notify
    expect(mockContinuation).toHaveBeenCalledTimes(1) // no second continuation
    expect(auditCount('task.completion_suppressed')).toBe(1)
    // The summary log is gated too — no duplicate "Task complete" entries
    expect(mockAddTaskLog).toHaveBeenCalledTimes(1)
  })

  it('move-to-done goes through the same gate', async () => {
    const first = await moveTaskWithEffects('task-1', 'done', 'agent-a', { channel: 'rest' })
    expect(first.alreadyComplete).toBe(false)
    boardColumns.done = boardColumns.inProgress
    boardColumns.inProgress = []

    const second = await moveTaskWithEffects('task-1', 'done', 'agent-b', { channel: 'human' })
    expect(second.alreadyComplete).toBe(true)
    expect(mockContinuation).toHaveBeenCalledTimes(1)
    expect(auditCount('task.completed')).toBe(1)
  })

  it('reopen deletes the completion row and allows a fresh completion', async () => {
    await reportComplete('task-1', 'agent-a', 'first pass', 'mcp')
    expect(hasCompletion('task-1')).toBe(true)
    boardColumns.done = boardColumns.inProgress
    boardColumns.inProgress = []

    // Explicit reopen: done → todo
    await moveTaskWithEffects('task-1', 'todo', 'human', { from: 'done', channel: 'human' })
    expect(hasCompletion('task-1')).toBe(false)
    expect(auditCount('task.reopened')).toBe(1)

    boardColumns.inProgress = boardColumns.done
    boardColumns.done = []

    const again = await reportComplete('task-1', 'agent-a', 'second pass', 'mcp')
    expect(again.alreadyComplete).toBe(false)
    expect(mockRuntimeSend).toHaveBeenCalledTimes(2)
    expect(auditCount('task.completed')).toBe(2)
  })

  it('archiving a done task does NOT reopen it', async () => {
    await reportComplete('task-1', 'agent-a', 'done', 'mcp')
    boardColumns.done = boardColumns.inProgress
    boardColumns.inProgress = []

    await moveTaskWithEffects('task-1', 'archived', 'system', { from: 'done', channel: 'system' })
    expect(hasCompletion('task-1')).toBe(true)
    expect(auditCount('task.reopened')).toBe(0)
  })

  it('block on a completed task is a guarded no-op: no store call, no audit, row survives', async () => {
    await reportComplete('task-1', 'agent-a', 'done', 'mcp')
    boardColumns.done = boardColumns.inProgress
    boardColumns.inProgress = []

    const result = await blockTaskWithEffects('task-1', 'stale agent retry', 'agent-b', 'mcp')
    expect(result.alreadyComplete).toBe(true)
    expect(mockBlockTaskStore).not.toHaveBeenCalled()
    expect(auditCount('task.blocked')).toBe(0)
    expect(hasCompletion('task-1')).toBe(true)
  })

  it('block on an uncompleted task still goes through with effects', async () => {
    const result = await blockTaskWithEffects('task-1', 'waiting on api', 'agent-a', 'mcp')
    expect(result.alreadyComplete).toBe(false)
    expect(mockBlockTaskStore).toHaveBeenCalledWith('task-1', 'waiting on api', 'agent-a', 'mcp')
    expect(auditCount('task.blocked')).toBe(1)
  })

  it('a done parent never breaks a child block: propagation is swallowed', async () => {
    boardColumns.inProgress = [{ id: 'parent-1--step', title: 'Child step' }]
    boardColumns.done = [{ id: 'parent-1', title: 'Done parent' }]
    // Child block succeeds; the parent (done) transition is rejected by the
    // store guard — blockTaskWithEffects must swallow it, not propagate.
    mockBlockTaskStore
      .mockImplementationOnce(() => Promise.resolve()) // child
      .mockImplementationOnce(() => Promise.reject(new Error('Invalid transition: done -> blocked'))) // parent

    const result = await blockTaskWithEffects('parent-1--step', 'child stuck', 'agent-a', 'mcp')
    expect(result.alreadyComplete).toBe(false)
    expect(auditCount('task.blocked')).toBe(1) // child audited; no parent audit
  })

  it('reopenIfLeavingDone deletes the row and audits when leaving done for an active column', () => {
    recordCompletion('task-1', { agent: 'agent-a', channel: 'mcp' })
    boardColumns.done = boardColumns.inProgress
    boardColumns.inProgress = []

    reopenIfLeavingDone('task-1', 'inProgress', 'workflow')
    expect(hasCompletion('task-1')).toBe(false)
    expect(auditCount('task.reopened')).toBe(1)
  })

  it('reopenIfLeavingDone keeps the row for archive and no-ops without a row', () => {
    recordCompletion('task-1', { agent: 'agent-a', channel: 'mcp' })
    reopenIfLeavingDone('task-1', 'archived', 'system')
    expect(hasCompletion('task-1')).toBe(true)
    expect(auditCount('task.reopened')).toBe(0)

    reopenIfLeavingDone('task-2', 'todo', 'system') // no row → silent no-op
    expect(auditCount('task.reopened')).toBe(0)
  })

  it('syncLedgerForStoreMove off done deletes the row, then moves', async () => {
    recordCompletion('task-1', { agent: 'agent-a', channel: 'mcp' })
    boardColumns.done = boardColumns.inProgress
    boardColumns.inProgress = []

    await syncLedgerForStoreMove('task-1', 'inProgress', 'workflow', { from: 'done' })
    expect(hasCompletion('task-1')).toBe(false)
    expect(auditCount('task.reopened')).toBe(1)
    expect(mockMoveTask).toHaveBeenCalledTimes(1)
  })

  it('syncLedgerForStoreMove to done records a completion row, insert-if-missing on retry', async () => {
    await syncLedgerForStoreMove('task-1', 'done', 'workflow')
    expect(hasCompletion('task-1')).toBe(true)

    // Duplicate record attempt is a silent no-op, never an error — simulate a
    // second workflow path landing the same task on done.
    boardColumns.todo = boardColumns.inProgress
    boardColumns.inProgress = []
    await syncLedgerForStoreMove('task-1', 'done', 'workflow')
    expect(hasCompletion('task-1')).toBe(true)
  })

  it('syncLedgerForStoreMove does not record when the store move throws', async () => {
    boardColumns.done = boardColumns.inProgress
    boardColumns.inProgress = []

    // done → done is rejected by the store; the ledger must not gain a row
    expect(syncLedgerForStoreMove('task-1', 'done', 'workflow')).rejects.toThrow('Invalid transition')
    expect(hasCompletion('task-1')).toBe(false)
  })

  it('backfill heals done tasks without a row, idempotently, stamping the task updatedAt', () => {
    boardColumns.done = [{ id: 'legacy-1', title: 'Pre-ledger done', updatedAt: 1750000000000 }]

    expect(backfillMissingCompletionRows()).toBe(1)
    expect(hasCompletion('legacy-1')).toBe(true)
    expect(auditCount('task.completion_backfilled')).toBe(1)

    // completedAt carries the task's updatedAt — observable via the gate's
    // first-write-wins report on a duplicate attempt
    const dup = recordCompletion('legacy-1', { agent: 'x' })
    expect(dup.recorded).toBe(false)
    if (!dup.recorded) expect(dup.existing.completedAt).toBe(1750000000000)

    // second run is a no-op
    expect(backfillMissingCompletionRows()).toBe(0)
    expect(auditCount('task.completion_backfilled')).toBe(1)
  })

  it('backfill leaves rowed done tasks and non-done columns untouched', async () => {
    await reportComplete('task-1', 'agent-a', 'done', 'mcp')
    boardColumns.done = boardColumns.inProgress
    boardColumns.inProgress = []
    boardColumns.archived = [{ id: 'old-arch', title: 'Archived without row', updatedAt: 1 }]

    expect(backfillMissingCompletionRows()).toBe(0)
    expect(hasCompletion('old-arch')).toBe(false)
  })

  it('heals the crash window: completion row exists but task never reached done', async () => {
    // Simulate: a prior process recorded the completion, crashed before the move
    recordCompletion('task-1', { agent: 'agent-a', channel: 'mcp' })

    const result = await moveTaskWithEffects('task-1', 'done', 'agent-a', { channel: 'mcp' })
    expect(result.alreadyComplete).toBe(true)
    // The idempotent column move still happens so the board converges to done
    expect(mockMoveTask).toHaveBeenCalledTimes(1)
    // ...but side effects stay suppressed
    expect(mockContinuation).not.toHaveBeenCalled()
  })
})
