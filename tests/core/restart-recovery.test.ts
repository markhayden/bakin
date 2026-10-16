/**
 * Restart recovery decides on the execution ledger (spec D3): an in-progress
 * task with no running row is stranded; a live run is never a candidate.
 * Real ledger in a temp dir — heartbeat files play no part.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const contentDirMockPath = join(tmpdir(), `bakin-restart-recovery-test-${Date.now()}-${randomUUID()}`)
mkdirSync(contentDirMockPath, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => contentDirMockPath,
  getBakinPaths: () => ({ root: contentDirMockPath, home: contentDirMockPath, db: join(contentDirMockPath, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

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

const mockGetSettings = mock(() => ({
  watchdog: {
    maxAutoRecoveries: 3,
  },
  restartRecovery: {
    enabled: true,
  },
}))

mock.module('../../src/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: mockGetSettings,
}))

const mockAppendAudit = mock((..._args: unknown[]) => undefined)
mock.module('../../src/core/audit', () => ({
  appendAudit: (...args: unknown[]) => mockAppendAudit(...args),
}))

type RecoveryTask = {
  id: string
  title: string
  agent?: string
  workflowId?: string
  recoveries?: number
  version?: number
  log?: Array<{ message: string; timestamp: string; author?: string }>
}

type RecoveryColumns = {
  backlog: RecoveryTask[]
  todo: RecoveryTask[]
  inProgress: RecoveryTask[]
  review: RecoveryTask[]
  done: RecoveryTask[]
  archived: RecoveryTask[]
  blocked: RecoveryTask[]
}

function emptyColumns(): RecoveryColumns {
  return { backlog: [], todo: [], inProgress: [], review: [], done: [], archived: [], blocked: [] }
}

let currentColumns = emptyColumns()
function setColumns(columns: Partial<RecoveryColumns>): void {
  currentColumns = { ...emptyColumns(), ...columns }
}

const storeCallOrder: string[] = []
const mockAddTaskLog = mock(async (...args: unknown[]) => { storeCallOrder.push(`log:${String(args[0])}`); return undefined })
const mockBlockTask = mock(async (...args: unknown[]) => { storeCallOrder.push(`block:${String(args[0])}`); return undefined })
const mockMoveTask = mock(async (..._args: unknown[]) => undefined)
const mockRecoverTask = mock(async (id: string) => {
  storeCallOrder.push(`recover:${id}`)
  const task = findColumnTask(id)
  if (task) task.recoveries = (task.recoveries ?? 0) + 1
  return undefined
})

function findColumnTask(id: string): RecoveryTask | null {
  for (const column of Object.values(currentColumns)) {
    const found = column.find((t) => t.id === id)
    if (found) return found
  }
  return null
}
function columnOf(id: string): string | null {
  for (const [name, column] of Object.entries(currentColumns)) {
    if (column.some((t) => t.id === id)) return name
  }
  return null
}

// A test can act on the ledger at a specific row read — the only seam between
// the awaited re-assessment and the synchronous mutation boundary.
let onTaskRead: ((id: string, nth: number) => void) | null = null
const taskReads = new Map<string, number>()

// Fresh projections on every read, like the real store's taskToView.
mock.module('../../src/core/task-store', () => ({
  readTaskboard: mock(() => ({
    columns: Object.fromEntries(Object.entries(currentColumns).map(([name, tasks]) => [name, tasks.map((t) => ({ ...t }))])) as RecoveryColumns,
  })),
  getTaskWithColumn: (id: string) => {
    const nth = (taskReads.get(id) ?? 0) + 1
    taskReads.set(id, nth)
    onTaskRead?.(id, nth)
    const task = findColumnTask(id)
    const column = columnOf(id)
    return task && column ? { task: { ...task }, column } : null
  },
  addTaskLog: (...args: unknown[]) => mockAddTaskLog(...args),
  blockTask: (...args: unknown[]) => mockBlockTask(...args),
  moveTask: (...args: unknown[]) => mockMoveTask(...args),
  recoverTask: (id: string) => mockRecoverTask(id),
}))

const mockHookInvoke = mock(async (..._args: unknown[]): Promise<unknown> => undefined)
mock.module('../../src/core/plugin-registry', () => ({
  getHookRegistry: mock(() => ({
    invoke: (...args: unknown[]) => mockHookInvoke(...args),
  })),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: mock(() => ({
    invoke: (...args: unknown[]) => mockHookInvoke(...args),
  })),
}))

import {
  findRestartRecoveryCandidates,
  runRestartRecovery,
} from '../../src/core/restart-recovery'
import { checkRestartRecovery } from '../../plugins/health/lib/system-checks/restart-recovery'
import { claimRun, markPriorBootRunsLost } from '../../src/core/execution-ledger'
import { stepExecKey } from '../../src/core/task-liveness'
import { closeDb } from '../../packages/core/src/storage/db'

const BOOT = 'boot-recovery-1'

function liveRun(taskId: string, agent = 'pixel', stepId?: string): void {
  const claimed = claimRun({
    runId: stepId ? `task:${taskId}:step:${stepId}:d1` : `task:${taskId}:d1`,
    taskId,
    ...(stepId ? { execKey: stepExecKey(taskId, stepId) } : {}),
    seq: 1,
    agent,
    bootId: BOOT,
  })
  if (!claimed.claimed) throw new Error(`could not claim ${taskId}`)
}

afterAll(() => {
  closeDb()
  rmSync(contentDirMockPath, { recursive: true, force: true })
})

describe('restart recovery', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-restart-recovery-'))
    mock.clearAllMocks()
    setColumns({})
    storeCallOrder.length = 0
    onTaskRead = null
    taskReads.clear()
    mockGetSettings.mockReturnValue({
      watchdog: {
        maxAutoRecoveries: 3,
      },
      restartRecovery: {
        enabled: true,
      },
    })
    mockHookInvoke.mockImplementation(async () => undefined)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    mock.restore()
  })

  it('recovers a plain in-progress task with no live run even when logs are recent', async () => {
    setColumns({
      inProgress: [{
        id: 'task-1',
        title: 'Needs recovery',
        agent: 'pixel',
        log: [{ message: 'Still working', timestamp: new Date().toISOString() }],
      }],
    })

    const result = await runRestartRecovery(tempDir)

    expect(result.recovered).toBe(1)
    expect(mockAddTaskLog).toHaveBeenCalledWith(
      'task-1',
      'system',
      expect.stringContaining('Restart recovery: no live run after server restart'),
    )
    // ONE store write (todo + recoveries+1), THEN the log line (spec D3/D9).
    expect(mockRecoverTask).toHaveBeenCalledWith('task-1')
    expect(mockMoveTask).not.toHaveBeenCalled()
    expect(storeCallOrder.indexOf('recover:task-1')).toBeLessThan(storeCallOrder.indexOf('log:task-1'))
    expect(mockAppendAudit).toHaveBeenCalledWith(
      tempDir,
      'task.restart_recovered',
      'system',
      expect.objectContaining({ id: 'task-1', reason: 'no-live-run' }),
    )
  })

  it('a task with a live run is never a candidate, however old its logs are', async () => {
    liveRun('task-2')
    setColumns({
      inProgress: [{
        id: 'task-2',
        title: 'Still active',
        agent: 'pixel',
        log: [{ message: 'Started', timestamp: '2020-01-01T00:00:00Z' }],
      }],
    })

    const candidates = await findRestartRecoveryCandidates(tempDir)

    expect(candidates).toHaveLength(0)
    expect(mockMoveTask).not.toHaveBeenCalled()
  })

  it('becomes a candidate once the boot sweep marks its prior-boot run lost', async () => {
    liveRun('task-2b')
    setColumns({ inProgress: [{ id: 'task-2b', title: 'Survived a restart', agent: 'pixel' }] })
    expect(await findRestartRecoveryCandidates(tempDir)).toHaveLength(0)

    markPriorBootRunsLost('boot-recovery-2')

    const candidates = await findRestartRecoveryCandidates(tempDir)
    expect(candidates).toEqual([expect.objectContaining({ id: 'task-2b', reason: 'no-live-run', action: 'recover' })])
  })

  it('skips workflow tasks that are legitimately waiting on approval', async () => {
    setColumns({
      inProgress: [{ id: 'task-3', title: 'Gate wait', agent: 'pixel', workflowId: 'publish' }],
    })
    mockHookInvoke.mockImplementation(async (hook: unknown) => {
      if (hook === 'workflows.loadInstance') return { status: 'pending_approval' }
      return undefined
    })

    const result = await runRestartRecovery(tempDir)

    expect(result.recovered).toBe(0)
    expect(result.blocked).toBe(0)
    expect(mockMoveTask).not.toHaveBeenCalled()
  })

  it('uses workflow active steps instead of the card assignee', async () => {
    setColumns({
      inProgress: [{ id: 'task-4', title: 'Workflow task', agent: 'trainer', workflowId: 'video' }],
    })
    mockHookInvoke.mockImplementation(async (hook: unknown) => {
      if (hook === 'workflows.loadInstance') return { status: 'in_progress' }
      if (hook === 'workflows.getActiveAgents') return [{ agent: 'pixel', stepId: 'clip' }]
      return undefined
    })

    const result = await runRestartRecovery(tempDir)

    expect(result.recovered).toBe(1)
    expect(mockRecoverTask).toHaveBeenCalledWith('task-4')
    expect(mockAppendAudit).toHaveBeenCalledWith(
      tempDir,
      'task.restart_recovered',
      'system',
      expect.objectContaining({ id: 'task-4', effectiveAgents: ['pixel'], reason: 'workflow-no-live-run' }),
    )
  })

  it('a nested workflow step live on the CHILD task id keeps the parent out of recovery', async () => {
    liveRun('task-4-child', 'pixel', 'clip')
    setColumns({
      inProgress: [{ id: 'task-4-parent', title: 'Nested parent', agent: 'trainer', workflowId: 'video' }],
    })
    mockHookInvoke.mockImplementation(async (hook: unknown) => {
      if (hook === 'workflows.loadInstance') return { status: 'in_progress' }
      if (hook === 'workflows.getActiveAgents') return [{ agent: 'pixel', stepId: 'clip', effectiveTaskId: 'task-4-child' }]
      return undefined
    })

    expect(await findRestartRecoveryCandidates(tempDir)).toHaveLength(0)
  })

  it('a previous step still running after the engine advanced is execution — not a candidate (review P1)', async () => {
    liveRun('task-4b', 'pixel', 'previous')
    setColumns({
      inProgress: [{ id: 'task-4b', title: 'Step transition', workflowId: 'video' }],
    })
    mockHookInvoke.mockImplementation(async (hook: unknown) => {
      if (hook === 'workflows.loadInstance') return { status: 'in_progress' }
      if (hook === 'workflows.getActiveAgents') return [{ agent: 'patch', stepId: 'next' }]
      return undefined
    })

    const candidates = await findRestartRecoveryCandidates(tempDir)
    const result = await runRestartRecovery(tempDir)

    expect(candidates).toHaveLength(0)
    expect(result.recovered + result.blocked + result.skipped).toBe(0)
    expect(mockMoveTask).not.toHaveBeenCalled()
    expect(mockAddTaskLog).not.toHaveBeenCalled()
  })

  it('a completed nested child whose final turn is still running keeps the parent out of recovery (review round 2)', async () => {
    liveRun('inner-done', 'pixel', 'final')
    setColumns({ inProgress: [{ id: 'outer-done', title: 'Outer', workflowId: 'outer' }] })
    mockHookInvoke.mockImplementation(async (hook: unknown, data: unknown) => {
      const taskId = (data as { taskId?: string } | undefined)?.taskId
      if (hook === 'workflows.loadInstance') {
        return taskId === 'outer-done'
          ? { status: 'in_progress', stepStates: { nested: { status: 'complete', childTaskId: 'inner-done' }, next: { status: 'in_progress' } } }
          : { status: 'complete', stepStates: {} }
      }
      if (hook === 'workflows.getActiveAgents') return [{ agent: 'patch', stepId: 'next' }]
      return undefined
    })

    expect(await findRestartRecoveryCandidates(tempDir)).toHaveLength(0)
    const result = await runRestartRecovery(tempDir)
    expect(result.recovered + result.blocked + result.skipped).toBe(0)
  })

  it('a joined map child whose final turn is still running keeps the parent out of recovery (review round 2)', async () => {
    liveRun('map-p--fan-1', 'pixel', 'write')
    setColumns({ inProgress: [{ id: 'map-p', title: 'Map parent', workflowId: 'fanout' }] })
    mockHookInvoke.mockImplementation(async (hook: unknown, data: unknown) => {
      const taskId = (data as { taskId?: string } | undefined)?.taskId
      if (hook === 'workflows.loadInstance') {
        return taskId === 'map-p'
          ? { status: 'in_progress', stepStates: { fan: { status: 'complete', children: [{ index: 0, childTaskId: 'map-p--fan-0', status: 'complete' }, { index: 1, childTaskId: 'map-p--fan-1', status: 'complete' }] }, assemble: { status: 'in_progress' } } }
          : { status: 'complete', stepStates: {} }
      }
      if (hook === 'workflows.getActiveAgents') return [{ agent: 'patch', stepId: 'assemble' }]
      return undefined
    })

    expect(await findRestartRecoveryCandidates(tempDir)).toHaveLength(0)
  })

  it('reports partial live steps as manual instead of redispatching live agents', async () => {
    liveRun('task-5', 'pixel', 'design')
    setColumns({
      inProgress: [{ id: 'task-5', title: 'Partial workflow', workflowId: 'parallel' }],
    })
    mockHookInvoke.mockImplementation(async (hook: unknown) => {
      if (hook === 'workflows.loadInstance') return { status: 'in_progress' }
      if (hook === 'workflows.getActiveAgents') {
        return [
          { agent: 'pixel', stepId: 'design' },
          { agent: 'rolo', stepId: 'copy' },
        ]
      }
      return undefined
    })

    const candidates = await findRestartRecoveryCandidates(tempDir)
    const result = await runRestartRecovery(tempDir)

    expect(candidates).toEqual([
      expect.objectContaining({
        id: 'task-5',
        action: 'manual',
        reason: 'workflow-partial-live-run',
        effectiveAgents: ['pixel', 'rolo'],
        missingRuns: ['task-5:copy'],
      }),
    ])
    expect(result.skipped).toBe(1)
    expect(mockMoveTask).not.toHaveBeenCalled()

    // Manual classification is durable + visible: a structured hold marker is
    // written so the watchdog skips the task instead of auto-recovering it.
    const holdCall = mockAddTaskLog.mock.calls.find((c) => c[0] === 'task-5')
    expect(holdCall).toBeDefined()
    expect(holdCall?.[1]).toBe('system')
    expect(holdCall?.[3]).toMatchObject({ restartRecovery: 'manual' })
    // A hold is not an attempt: the counter is untouched.
    expect(mockRecoverTask).not.toHaveBeenCalled()
  })

  it('escalates exhausted restart recovery loops to blocked, counted from the persisted field', async () => {
    setColumns({
      inProgress: [{
        id: 'task-6',
        title: 'Exhausted',
        agent: 'pixel',
        recoveries: 3,
        log: [{ message: 'Started', timestamp: '2020-01-01T00:00:00Z' }],
      }],
    })

    const result = await runRestartRecovery(tempDir)

    expect(result.blocked).toBe(1)
    expect(mockBlockTask).toHaveBeenCalledWith('task-6', expect.stringContaining('Restart recovery limit reached (3 attempts)'))
    expect(storeCallOrder.indexOf('block:task-6')).toBeLessThan(storeCallOrder.indexOf('log:task-6'))
    expect(mockMoveTask).not.toHaveBeenCalled()
    expect(mockAppendAudit).toHaveBeenCalledWith(
      tempDir,
      'task.restart_recovery_exhausted',
      'system',
      expect.objectContaining({ id: 'task-6', recoveryCount: 3 }),
    )
  })

  it('legacy "Restart recovery:" / "Auto-recovered:" log lines are inert — recoveries 0 means recover', async () => {
    setColumns({
      inProgress: [{
        id: 'task-6b',
        title: 'Pre-upgrade task',
        agent: 'pixel',
        log: [
          { author: 'watchdog', message: 'Auto-recovered: attempt 1', timestamp: '2020-01-01T00:00:00Z' },
          { author: 'system', message: 'Restart recovery: attempt 2', timestamp: '2020-01-01T01:00:00Z' },
          { author: 'system', message: 'Restart recovery: attempt 3', timestamp: '2020-01-01T02:00:00Z' },
        ],
      }],
    })

    const result = await runRestartRecovery(tempDir)

    expect(result.recovered).toBe(1)
    expect(mockRecoverTask).toHaveBeenCalledWith('task-6b')
    expect(mockBlockTask).not.toHaveBeenCalled()
  })

  // Fresh validation at the mutation boundary (spec D9): candidates come from
  // one board snapshot, but the loop awaits between tasks.
  it('a candidate the operator moved while an earlier candidate was being recovered is skipped', async () => {
    setColumns({
      inProgress: [
        { id: 'task-r1', title: 'First', agent: 'pixel' },
        { id: 'task-r2', title: 'Second', agent: 'pixel' },
      ],
    })
    mockRecoverTask.mockImplementationOnce(async (id: string) => {
      storeCallOrder.push(`recover:${id}`)
      const second = findColumnTask('task-r2')!
      currentColumns.inProgress = currentColumns.inProgress.filter((t) => t.id !== 'task-r2')
      currentColumns.todo.push(second)
      return undefined
    })

    const result = await runRestartRecovery(tempDir)

    expect(mockRecoverTask).toHaveBeenCalledWith('task-r1')
    expect(mockRecoverTask).not.toHaveBeenCalledWith('task-r2')
    expect(result.recovered).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('an exhausted candidate whose counter was reset before its turn is recovered under the fresh count, not blocked', async () => {
    setColumns({
      inProgress: [
        { id: 'task-r3', title: 'First', agent: 'pixel', version: 1 },
        { id: 'task-r4', title: 'Exhausted in the snapshot', agent: 'pixel', recoveries: 3, version: 5 },
      ],
    })
    mockRecoverTask.mockImplementationOnce(async (id: string) => {
      storeCallOrder.push(`recover:${id}`)
      const r4 = findColumnTask('task-r4')!
      r4.recoveries = 0
      r4.version = 6
      return undefined
    })

    const result = await runRestartRecovery(tempDir)

    // The reset landed BEFORE task-r4's fresh read, so the fresh verdict is "recover".
    expect(mockBlockTask).not.toHaveBeenCalled()
    expect(mockRecoverTask).toHaveBeenCalledWith('task-r4')
    expect(result.recovered).toBe(2)
  })

  // Code review (PR #975): the fresh read preceded the awaited re-assessment,
  // so a write DURING re-assessment still acted on the pre-await row.
  it('a workflow candidate written during its own re-assessment is skipped, not blocked on the pre-await count', async () => {
    setColumns({
      inProgress: [{ id: 'task-r7', title: 'Exhausted workflow', agent: 'pixel', workflowId: 'wf', recoveries: 3, version: 2 }],
    })
    let activeAgentCalls = 0
    mockHookInvoke.mockImplementation(async (hook: unknown, data?: unknown) => {
      const taskId = (data as { taskId?: string } | undefined)?.taskId
      if (taskId !== 'task-r7') return undefined
      if (hook === 'workflows.loadInstance') return { status: 'in_progress' }
      if (hook === 'workflows.getActiveAgents') {
        activeAgentCalls += 1
        // Discovery pass sees the exhausted row; the operator resets the card
        // while the RE-ASSESSMENT's hook is in flight.
        if (activeAgentCalls === 2) {
          const r7 = findColumnTask('task-r7')!
          r7.recoveries = 0
          r7.version = 3
        }
        return [{ agent: 'pixel', stepId: 'design' }]
      }
      return undefined
    })

    const result = await runRestartRecovery(tempDir)

    expect(mockBlockTask).not.toHaveBeenCalled()
    expect(mockRecoverTask).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
  })

  // Code review round 3: a workflow step claim writes the ledger, not the task
  // row (the card is already in progress), so the version compare cannot see
  // it. The mutation boundary re-checks the ledger synchronously.
  it('a workflow step claimed after the re-assessment, with the row unchanged, is left alone', async () => {
    setColumns({
      inProgress: [{ id: 'task-r8', title: 'Workflow', agent: 'pixel', workflowId: 'wf', version: 2 }],
    })
    mockHookInvoke.mockImplementation(async (hook: unknown, data?: unknown) => {
      if ((data as { taskId?: string } | undefined)?.taskId !== 'task-r8') return undefined
      if (hook === 'workflows.loadInstance') return { status: 'in_progress' }
      if (hook === 'workflows.getActiveAgents') return [{ agent: 'pixel', stepId: 'design' }]
      return undefined
    })
    // Reads: 1 = fresh (before re-assessment), 2 = again (after it). The
    // engine claims the step between the re-assessment and the mutation.
    onTaskRead = (id, nth) => {
      if (id === 'task-r8' && nth === 2) liveRun('task-r8', 'pixel', 'design')
    }

    const result = await runRestartRecovery(tempDir)

    expect(mockRecoverTask).not.toHaveBeenCalled()
    expect(mockBlockTask).not.toHaveBeenCalled()
    expect(result.skipped).toBe(1)
  })

  it('a manual hold is not written for a task that gained a live run mid-run', async () => {
    setColumns({
      inProgress: [
        { id: 'task-r5', title: 'First', agent: 'pixel' },
        { id: 'task-r6', title: 'Partial workflow', workflowId: 'parallel' },
      ],
    })
    mockHookInvoke.mockImplementation(async (hook: unknown, data?: unknown) => {
      const taskId = (data as { taskId?: string } | undefined)?.taskId
      if (taskId !== 'task-r6') return undefined
      if (hook === 'workflows.loadInstance') return { status: 'in_progress' }
      if (hook === 'workflows.getActiveAgents') return [{ agent: 'pixel', stepId: 'design' }, { agent: 'rolo', stepId: 'copy' }]
      return undefined
    })
    liveRun('task-r6', 'pixel', 'design')
    // Recovering task-r5 yields; meanwhile the missing step claims its run.
    mockRecoverTask.mockImplementationOnce(async (id: string) => {
      storeCallOrder.push(`recover:${id}`)
      // seq 2: the design step already holds seq 1 on this task.
      const claimed = claimRun({ runId: 'task:task-r6:step:copy:d1', taskId: 'task-r6', execKey: stepExecKey('task-r6', 'copy'), seq: 2, agent: 'rolo', bootId: BOOT })
      if (!claimed.claimed) throw new Error('could not claim task-r6 copy step')
      return undefined
    })

    const result = await runRestartRecovery(tempDir)

    expect(mockAddTaskLog).not.toHaveBeenCalledWith('task-r6', 'system', expect.anything(), expect.anything())
    expect(result.recovered).toBe(1)
    expect(result.skipped).toBe(1)
  })

  it('does not mutate candidates when restart recovery is disabled', async () => {
    mockGetSettings.mockReturnValue({
      watchdog: {
        maxAutoRecoveries: 3,
      },
      restartRecovery: {
        enabled: false,
      },
    })
    setColumns({
      inProgress: [{ id: 'task-7', title: 'Disabled recovery', agent: 'pixel' }],
    })

    const result = await runRestartRecovery(tempDir)

    expect(result.skipped).toBe(1)
    expect(mockMoveTask).not.toHaveBeenCalled()
    expect(mockBlockTask).not.toHaveBeenCalled()
  })

  it('surfaces restart recovery candidates through the health check', async () => {
    setColumns({
      inProgress: [{ id: 'task-8', title: 'Health candidate', agent: 'pixel' }],
    })

    const result = await checkRestartRecovery()

    expect(result.outcome).toBe('observed')
    if (result.outcome !== 'observed') throw new Error('expected observations')
    expect(result.observations).toEqual([
      expect.objectContaining({
        key: 'candidates',
        status: 'warning',
        detail: expect.stringContaining('Health candidate'),
        incident: expect.objectContaining({ key: 'stale-tasks', title: 'In-progress tasks have no live run', disposition: 'action_required' }),
      }),
    ])
  })

  it('the health check reports healthy while every in-progress task has a live run', async () => {
    liveRun('task-9')
    setColumns({
      inProgress: [{ id: 'task-9', title: 'Live and well', agent: 'pixel' }],
    })

    const result = await checkRestartRecovery()

    expect(result.outcome).toBe('observed')
    if (result.outcome !== 'observed') throw new Error('expected observations')
    expect(result.observations).toEqual([
      expect.objectContaining({ key: 'candidates', status: 'healthy', summary: 'No stranded in-progress tasks.' }),
    ])
  })
})
