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
  log?: Array<{ message: string; timestamp: string }>
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

const mockAddTaskLog = mock(async (..._args: unknown[]) => undefined)
const mockBlockTask = mock(async (..._args: unknown[]) => undefined)
const mockMoveTask = mock(async (..._args: unknown[]) => undefined)

mock.module('../../src/core/task-store', () => ({
  readTaskboard: mock(() => ({ columns: currentColumns })),
  addTaskLog: (...args: unknown[]) => mockAddTaskLog(...args),
  blockTask: (...args: unknown[]) => mockBlockTask(...args),
  moveTask: (...args: unknown[]) => mockMoveTask(...args),
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
    expect(mockMoveTask).toHaveBeenCalledWith('task-1', 'todo', 'inProgress')
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
    expect(mockMoveTask).toHaveBeenCalledWith('task-4', 'todo', 'inProgress')
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
    // NOT the 'Restart recovery:' prefix — countRecoveries() matches that
    // prefix and a hold must not count as a recovery attempt.
    expect(String(holdCall?.[2])).not.toMatch(/^Restart recovery:/)
    expect(holdCall?.[3]).toMatchObject({ restartRecovery: 'manual' })
  })

  it('escalates exhausted restart recovery loops to blocked', async () => {
    setColumns({
      inProgress: [{
        id: 'task-6',
        title: 'Exhausted',
        agent: 'pixel',
        log: [
          { message: 'Auto-recovered: attempt 1', timestamp: '2020-01-01T00:00:00Z' },
          { message: 'Restart recovery: attempt 2', timestamp: '2020-01-01T01:00:00Z' },
          { message: 'Restart recovery: attempt 3', timestamp: '2020-01-01T02:00:00Z' },
        ],
      }],
    })

    const result = await runRestartRecovery(tempDir)

    expect(result.blocked).toBe(1)
    expect(mockBlockTask).toHaveBeenCalledWith('task-6', expect.stringContaining('Restart recovery limit reached'))
    expect(mockMoveTask).not.toHaveBeenCalled()
    expect(mockAppendAudit).toHaveBeenCalledWith(
      tempDir,
      'task.restart_recovery_exhausted',
      'system',
      expect.objectContaining({ id: 'task-6', recoveryCount: 3 }),
    )
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
