import { describe, it, expect, beforeEach, mock, type Mock } from 'bun:test'

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

const mockRuntimeSend = mock((...args: unknown[]) => {
  void args
  return Promise.resolve({ id: 'runtime-msg' })
})
const mockRuntimeAgentsList = mock((...args: unknown[]) => {
  void args
  return Promise.resolve([
    { id: 'main', name: 'Main', status: 'active' },
  ])
})

const mockAppServices = {
  runtime: {
    agents: {
      list: (...args: unknown[]) => mockRuntimeAgentsList(...args),
    },
    messaging: {
      send: (...args: unknown[]) => mockRuntimeSend(...args),
    },
  },
}

mock.module('../../src/core/app-services', () => ({
  getAppServices: () => mockAppServices,
}))
mock.module('@/core/app-services', () => ({
  getAppServices: () => mockAppServices,
}))

let currentColumns: { todo?: any[]; inProgress?: any[]; blocked?: any[]; done?: any[] } = {}
const mockClearDependency = mock().mockResolvedValue(undefined)
const mockAddTaskLog = mock().mockResolvedValue(undefined)

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
}

mock.module('../../src/core/task-store', () => taskStoreMock)
mock.module('@/core/task-store', () => taskStoreMock)

const mockInvoke = mock(async (hook: string, args?: Record<string, unknown>) => {
  void args
  return undefined
})

mock.module('../../src/lib/plugin-registry', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mockInvoke,
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
}))

import { checkAndContinueDependents } from '../../src/core/continuation'
import { appendAudit } from '../../src/core/audit'

describe('continuation', () => {
  beforeEach(() => {
    mock.clearAllMocks()
  })

  function mockColumns(columns: { todo?: any[]; inProgress?: any[]; blocked?: any[]; done?: any[] }) {
    currentColumns = columns
  }

  it('does nothing when no tasks depend on completed task', async () => {
    mockColumns({
      todo: [{ id: 't1', title: 'Unrelated', agent: 'pixel' }],
      inProgress: [],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test')
    expect(mockRuntimeSend).not.toHaveBeenCalled()
  })

  it('dispatches continuation to dependent task in todo', async () => {
    mockColumns({
      todo: [{ id: 't2', title: 'Waiting Task', agent: 'pixel', dependsOn: 'completed-1' }],
      inProgress: [],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test')

    expect(mockRuntimeSend).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'pixel',
        content: expect.stringContaining('Done Task'),
      }),
    )

    expect(mockClearDependency).toHaveBeenCalledWith('t2')
  })

  it('passes the canonical main agent id through unchanged', async () => {
    mockColumns({
      todo: [{ id: 't3', title: 'Main Task', agent: 'main', dependsOn: 'completed-1' }],
      inProgress: [],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test')

    expect(mockRuntimeSend).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'main',
        content: expect.any(String),
      }),
    )
  })

  it('defaults to main agent when task has no agent', async () => {
    mockColumns({
      todo: [{ id: 't4', title: 'No Agent', dependsOn: 'completed-1' }],
      inProgress: [],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test')

    expect(mockRuntimeSend).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'main',
      content: expect.any(String),
    }))
  })

  it('skips task already in progress (dedup)', async () => {
    mockColumns({
      inProgress: [{ id: 't5', title: 'Already Running', agent: 'pixel', dependsOn: 'completed-1' }],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test')

    expect(mockRuntimeSend).not.toHaveBeenCalled()
    expect(mockClearDependency).toHaveBeenCalledWith('t5')
  })

  it('scans blocked column for dependents', async () => {
    mockColumns({
      todo: [],
      inProgress: [],
      blocked: [{ id: 't6', title: 'Blocked Task', agent: 'nemo', dependsOn: 'completed-1' }],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test')

    expect(mockRuntimeSend).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'nemo',
      content: expect.any(String),
    }))
  })

  it('writes audit entry after dispatching', async () => {
    mockColumns({
      todo: [{ id: 't7', title: 'Audit Task', agent: 'pixel', dependsOn: 'completed-1' }],
      inProgress: [],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test')

    expect(vi.mocked(appendAudit)).toHaveBeenCalledWith(
      '/tmp/test',
      'task.continuation',
      'pixel',
      expect.objectContaining({ id: 't7', sent: true, completedDep: 'completed-1' }),
    )
  })

  it('retries on sendMessage failure and logs failure after max retries', async () => {
    mockColumns({
      todo: [{ id: 't8', title: 'Retry Task', agent: 'pixel', dependsOn: 'completed-1' }],
      inProgress: [],
    })

    mockRuntimeSend.mockRejectedValue(new Error('unreachable'))
    // Use real timers briefly for retry delays
    vi.useFakeTimers()

    const promise = checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test')

    // Advance through retry delays (3 retries × 5000ms)
    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(5000)
    await promise

    // Should have attempted 3 times
    expect(mockRuntimeSend).toHaveBeenCalledTimes(3)

    // Audit should show sent: false
    expect(vi.mocked(appendAudit)).toHaveBeenCalledWith(
      '/tmp/test',
      'task.continuation',
      'pixel',
      expect.objectContaining({ sent: false }),
    )

    vi.useRealTimers()
  })
})
