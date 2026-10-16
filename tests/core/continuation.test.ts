import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-continuation-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
}))

const loggerMock = () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

// In-memory liveness fake — continuation only needs "does this task hold a
// live run"; ledger semantics are covered by tests/core/task-liveness.test.ts.
const liveRuns = new Set<string>()
const ledgerMock = () => ({
  getLiveRun: (taskId: string) => (liveRuns.has(taskId) ? { runId: `task:${taskId}:d1`, taskId, status: 'running' } : null),
  getLiveRunByKey: () => null,
  bumpHeartbeat: () => {},
  bumpHeartbeatByTaskAgent: () => false,
  listLiveRuns: () => [],
})
mock.module('@/core/execution-ledger', ledgerMock)
mock.module('../../src/core/execution-ledger', ledgerMock)

mock.module('../../src/core/audit', () => ({
  appendAudit: mock(),
}))

// Continuation routes through the real dispatch path — mock it and assert
// the routing semantics (full re-dispatch, not a resume nudge).
const mockDispatchSingleTask = mock((...args: unknown[]) => {
  void args
  return Promise.resolve()
})
const mockClearDispatchMarker = mock(() => Promise.resolve())

const dispatchModuleMock = {
  dispatchSingleTask: (...args: unknown[]) => mockDispatchSingleTask(...(args as []) ),
  clearDispatchMarker: (...args: unknown[]) => mockClearDispatchMarker(...(args as [])),
}
mock.module('../../src/core/dispatch', () => dispatchModuleMock)
mock.module('@/core/dispatch', () => dispatchModuleMock)

let currentColumns: { todo?: unknown[]; inProgress?: unknown[]; blocked?: unknown[]; done?: unknown[] } = {}
// Resolves true like the store does when the task still waits on the completed one.
const mockClearDependency = mock().mockResolvedValue(true)
const mockAddTaskLog = mock().mockResolvedValue(undefined)
const mockMoveTask = mock().mockResolvedValue(undefined)

const taskStoreMock = {
  readTaskboard: mock(() => ({
    columns: {
      todo: currentColumns.todo || [],
      inProgress: currentColumns.inProgress || [],
      blocked: currentColumns.blocked || [],
      done: currentColumns.done || [],
    },
  })),
  clearDependency: (taskId: string, dependsOn: string) => mockClearDependency(taskId, dependsOn),
  addTaskLog: (identifier: string, author: string, message: string) => mockAddTaskLog(identifier, author, message),
  moveTask: (taskId: string, to: string, from?: string) => mockMoveTask(taskId, to, from),
}

mock.module('../../src/core/task-store', () => taskStoreMock)
mock.module('@/core/task-store', () => taskStoreMock)

import { checkAndContinueDependents } from '../../src/core/continuation'
import { appendAudit } from '../../src/core/audit'
import { withStateLock } from '../../src/core/dispatch-state'
import { settleFor, waitUntil } from '../helpers/wait'

describe('continuation (full re-dispatch semantics)', () => {
  beforeEach(() => {
    mock.clearAllMocks()
    currentColumns = {}
    liveRuns.clear()
  })

  function mockColumns(columns: typeof currentColumns) {
    currentColumns = columns
  }

  it('does nothing when no tasks depend on the completed task', async () => {
    mockColumns({ todo: [{ id: 't1', title: 'Unrelated', agent: 'pixel' }] })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', { port: 3737 })

    expect(mockDispatchSingleTask).not.toHaveBeenCalled()
    expect(mockClearDependency).not.toHaveBeenCalled()
  })

  it('re-dispatches a todo dependent through the dispatch path with the completed-dependency context', async () => {
    mockColumns({
      todo: [{ id: 't2', title: 'Waiting Task', agent: 'pixel', dependsOn: 'completed-1' }],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', { port: 3737 })

    expect(mockClearDependency).toHaveBeenCalledWith('t2', 'completed-1')
    expect(mockClearDispatchMarker).toHaveBeenCalledWith('/tmp/test', 't2')
    expect(mockDispatchSingleTask).toHaveBeenCalledWith(
      't2',
      '/tmp/test',
      3737,
      'continuation',
      { completedDependency: { id: 'completed-1', title: 'Done Task' } },
    )
  })

  it('skips an in-progress dependent that holds a live run (active work — no double-run)', async () => {
    liveRuns.add('t5')
    mockColumns({
      inProgress: [{ id: 't5', title: 'Already Running', agent: 'pixel', dependsOn: 'completed-1' }],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', { port: 3737 })

    expect(mockDispatchSingleTask).not.toHaveBeenCalled()
    expect(mockMoveTask).not.toHaveBeenCalled()
    // The live turn may have JUST registered this dependency and stopped; the
    // settle-time park reads dependsOn to know the task is waiting (spec D2).
    // Clearing it here would strand the task in progress.
    expect(mockClearDependency).not.toHaveBeenCalled()
  })

  it('reconciles under the dispatch state lock and only dispatches after releasing it', async () => {
    mockColumns({ todo: [{ id: 't-lock', title: 'Locked', agent: 'pixel', dependsOn: 'completed-1' }] })
    // dispatchSingleTask takes the (non-reentrant) lock itself in production —
    // if continuation still held it, this would never resolve.
    mockDispatchSingleTask.mockImplementation(() => withStateLock(async () => undefined))

    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    const holder = withStateLock(() => held)

    try {
      const run = checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', { port: 3737 })
      await settleFor(30, 'continuation must wait for the lock before touching the board')
      const touchedEarly = mockClearDependency.mock.calls.length + mockDispatchSingleTask.mock.calls.length
      release()
      await holder
      await run
      expect(touchedEarly).toBe(0)
      await waitUntil(() => mockDispatchSingleTask.mock.calls.length === 1, { label: 'dispatch after lock release' })
      expect(mockClearDependency).toHaveBeenCalledWith('t-lock', 'completed-1')
    } finally {
      release()
      mockDispatchSingleTask.mockImplementation(() => Promise.resolve())
    }
  })

  it('re-queues an in-progress dependent with NO live run (the parent idled after delegating)', async () => {
    mockColumns({
      inProgress: [{ id: 't5b', title: 'Waiting Parent', agent: 'main', dependsOn: 'completed-1' }],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', { port: 3737 })

    expect(mockMoveTask).toHaveBeenCalledWith('t5b', 'todo', 'inProgress')
    expect(mockAddTaskLog).toHaveBeenCalledWith('t5b', 'system', expect.stringContaining('no live run'))
    expect(mockDispatchSingleTask).toHaveBeenCalledWith(
      't5b',
      '/tmp/test',
      3737,
      'continuation',
      { completedDependency: { id: 'completed-1', title: 'Done Task' } },
    )
  })

  // Code review round 3: every clear names the completed dependency and the
  // store refuses when the task has since re-registered on something else.
  it('clears by the completed id and leaves a dependent that moved on to another dependency alone', async () => {
    mockColumns({
      todo: [{ id: 't-moved-on', title: 'Re-registered', agent: 'main', dependsOn: 'completed-1' }],
      blocked: [{ id: 't-still', title: 'Still waiting', agent: 'main', dependsOn: 'completed-1' }],
    })
    mockClearDependency.mockImplementation(async (taskId: string) => taskId !== 't-moved-on')

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', { port: 3737 })

    expect(mockClearDependency).toHaveBeenCalledWith('t-moved-on', 'completed-1')
    expect(mockDispatchSingleTask).not.toHaveBeenCalledWith('t-moved-on', expect.anything(), expect.anything(), expect.anything(), expect.anything())
    expect(mockMoveTask).toHaveBeenCalledWith('t-still', 'todo', 'blocked')
    expect(mockDispatchSingleTask).toHaveBeenCalledWith('t-still', '/tmp/test', 3737, 'continuation', expect.anything())
    mockClearDependency.mockImplementation(async () => true)
  })

  it('leaves an in-progress WORKFLOW dependent to the engine even without a live run', async () => {
    mockColumns({
      inProgress: [{ id: 't5c', title: 'Workflow Parent', agent: 'main', workflowId: 'publish', dependsOn: 'completed-1' }],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', { port: 3737 })

    expect(mockDispatchSingleTask).not.toHaveBeenCalled()
    expect(mockMoveTask).not.toHaveBeenCalled()
  })

  it('unblocks a blocked dependent (move to todo + log) before re-dispatching', async () => {
    mockColumns({
      blocked: [{ id: 't6', title: 'Blocked Task', agent: 'trainer', dependsOn: 'completed-1' }],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', { port: 3737 })

    expect(mockMoveTask).toHaveBeenCalledWith('t6', 'todo', 'blocked')
    expect(mockAddTaskLog).toHaveBeenCalledWith('t6', 'system', expect.stringContaining('unblocked for re-dispatch'))
    expect(mockDispatchSingleTask).toHaveBeenCalledWith('t6', '/tmp/test', 3737, 'continuation', expect.anything())
  })

  it('audits the continuation with dispatch outcome', async () => {
    mockColumns({
      todo: [{ id: 't7', title: 'Audit Task', agent: 'pixel', dependsOn: 'completed-1' }],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', { port: 3737 })

    expect(appendAudit).toHaveBeenCalledWith(
      '/tmp/test',
      'task.continuation',
      'pixel',
      expect.objectContaining({ id: 't7', completedDep: 'completed-1', dispatched: true }),
    )
  })

  it('logs and audits dispatched:false when the re-dispatch throws', async () => {
    mockColumns({
      todo: [{ id: 't8', title: 'Failing Task', agent: 'pixel', dependsOn: 'completed-1' }],
    })
    mockDispatchSingleTask.mockRejectedValueOnce(new Error('dispatch exploded'))

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', { port: 3737 })

    expect(mockAddTaskLog).toHaveBeenCalledWith('t8', 'system', expect.stringContaining('Continuation re-dispatch failed'))
    expect(appendAudit).toHaveBeenCalledWith(
      '/tmp/test',
      'task.continuation',
      'pixel',
      expect.objectContaining({ id: 't8', dispatched: false }),
    )
  })
})
