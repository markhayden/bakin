import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../src/core/audit', () => ({
  appendAudit: vi.fn(),
}))

vi.mock('../../src/core/openclaw-client', () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
}))

// Mock the taskboard module that gets dynamically imported
// The source imports from '../lib/taskboard' which resolves to src/lib/taskboard
// which re-exports from plugins/tasks/lib/taskboard — mock both paths
const mockReadAllColumns = vi.fn()
const mockClearDependency = vi.fn().mockResolvedValue(undefined)
const mockAddTaskLog = vi.fn().mockResolvedValue(undefined)

vi.mock('../../src/lib/taskboard', () => ({
  readAllColumns: mockReadAllColumns,
  clearDependency: mockClearDependency,
  addTaskLog: mockAddTaskLog,
}))

import { checkAndContinueDependents } from '../../src/core/continuation'
import { appendAudit } from '../../src/core/audit'
import * as openclaw from '../../src/core/openclaw-client'

describe('continuation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('maps roscoe agent to main for OpenClaw', async () => {
    mockColumns({
      todo: [{ id: 't3', title: 'Roscoe Task', agent: 'roscoe', dependsOn: 'completed-1' }],
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
