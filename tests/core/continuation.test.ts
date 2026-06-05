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

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

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
const mockClearDependency = mock().mockResolvedValue(undefined)
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
  clearDependency: (taskId: string) => mockClearDependency(taskId),
  addTaskLog: (identifier: string, author: string, message: string) => mockAddTaskLog(identifier, author, message),
  moveTask: (taskId: string, to: string, from?: string) => mockMoveTask(taskId, to, from),
}

mock.module('../../src/core/task-store', () => taskStoreMock)
mock.module('@/core/task-store', () => taskStoreMock)

import { checkAndContinueDependents } from '../../src/core/continuation'
import { appendAudit } from '../../src/core/audit'

describe('continuation (full re-dispatch semantics)', () => {
  beforeEach(() => {
    mock.clearAllMocks()
    currentColumns = {}
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

    expect(mockClearDependency).toHaveBeenCalledWith('t2')
    expect(mockClearDispatchMarker).toHaveBeenCalledWith('/tmp/test', 't2')
    expect(mockDispatchSingleTask).toHaveBeenCalledWith(
      't2',
      '/tmp/test',
      3737,
      'continuation',
      { completedDependency: { id: 'completed-1', title: 'Done Task' } },
    )
  })

  it('skips a dependent already in progress (active work — no double-run)', async () => {
    mockColumns({
      inProgress: [{ id: 't5', title: 'Already Running', agent: 'pixel', dependsOn: 'completed-1' }],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', { port: 3737 })

    expect(mockDispatchSingleTask).not.toHaveBeenCalled()
    expect(mockClearDependency).toHaveBeenCalledWith('t5')
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
