import { describe, it, expect, beforeEach, mock, type Mock } from 'bun:test'

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
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

mock.module('../../src/core/openclaw-client', () => ({
  sendMessage: mock().mockResolvedValue(undefined),
}))

// Mock flow-store that gets dynamically imported by continuation.ts
const mockReadAllColumns = mock()
const mockClearDependency = mock().mockResolvedValue(undefined)
const mockAddTaskLog = mock().mockResolvedValue(undefined)

mock.module('@bakin/tasks/lib/flow-store', () => ({
  readAllColumns: mockReadAllColumns,
  clearDependency: mockClearDependency,
  addTaskLog: mockAddTaskLog,
}))

import { checkAndContinueDependents } from '../../src/core/continuation'
import { appendAudit } from '../../src/core/audit'
import * as openclaw from '../../src/core/openclaw-client'

describe('continuation', () => {
  beforeEach(() => {
    mock.clearAllMocks()
  })

  function mockColumns(columns: { todo?: any[]; inProgress?: any[]; blocked?: any[]; done?: any[] }) {
    mockReadAllColumns.mockReturnValue({
      todo: columns.todo || [],
      inProgress: columns.inProgress || [],
      blocked: columns.blocked || [],
      done: columns.done || [],
    })
  }

  it('does nothing when no tasks depend on completed task', async () => {
    mockColumns({
      todo: [{ id: 't1', title: 'Unrelated', agent: 'pixel' }],
      inProgress: [],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', 3737)
    expect(vi.mocked(openclaw.sendMessage)).not.toHaveBeenCalled()
  })

  it('dispatches continuation to dependent task in todo', async () => {
    mockColumns({
      todo: [{ id: 't2', title: 'Waiting Task', agent: 'pixel', dependsOn: 'completed-1' }],
      inProgress: [],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', 3737)

    expect(vi.mocked(openclaw.sendMessage)).toHaveBeenCalledWith(
      'pixel',
      expect.stringContaining('Done Task'),
    )

    expect(mockClearDependency).toHaveBeenCalledWith('t2')
  })

  it('passes the canonical main agent id through unchanged', async () => {
    mockColumns({
      todo: [{ id: 't3', title: 'Main Task', agent: 'main', dependsOn: 'completed-1' }],
      inProgress: [],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', 3737)

    expect(vi.mocked(openclaw.sendMessage)).toHaveBeenCalledWith(
      'main',
      expect.any(String),
    )
  })

  it('defaults to main agent when task has no agent', async () => {
    mockColumns({
      todo: [{ id: 't4', title: 'No Agent', dependsOn: 'completed-1' }],
      inProgress: [],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', 3737)

    expect(vi.mocked(openclaw.sendMessage)).toHaveBeenCalledWith('main', expect.any(String))
  })

  it('skips task already in progress (dedup)', async () => {
    mockColumns({
      inProgress: [{ id: 't5', title: 'Already Running', agent: 'pixel', dependsOn: 'completed-1' }],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', 3737)

    expect(vi.mocked(openclaw.sendMessage)).not.toHaveBeenCalled()
    expect(mockClearDependency).toHaveBeenCalledWith('t5')
  })

  it('scans blocked column for dependents', async () => {
    mockColumns({
      todo: [],
      inProgress: [],
      blocked: [{ id: 't6', title: 'Blocked Task', agent: 'nemo', dependsOn: 'completed-1' }],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', 3737)

    expect(vi.mocked(openclaw.sendMessage)).toHaveBeenCalledWith('nemo', expect.any(String))
  })

  it('writes audit entry after dispatching', async () => {
    mockColumns({
      todo: [{ id: 't7', title: 'Audit Task', agent: 'pixel', dependsOn: 'completed-1' }],
      inProgress: [],
    })

    await checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', 3737)

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

    vi.mocked(openclaw.sendMessage).mockRejectedValue(new Error('unreachable'))
    // Use real timers briefly for retry delays
    vi.useFakeTimers()

    const promise = checkAndContinueDependents('completed-1', 'Done Task', '/tmp/test', 3737)

    // Advance through retry delays (3 retries × 5000ms)
    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(5000)
    await vi.advanceTimersByTimeAsync(5000)
    await promise

    // Should have attempted 3 times
    expect(vi.mocked(openclaw.sendMessage)).toHaveBeenCalledTimes(3)

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
