import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const contentDirMockPath = join(tmpdir(), `bakin-restart-recovery-test-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => contentDirMockPath,
  getBakinPaths: () => ({ root: contentDirMockPath }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => contentDirMockPath,
  getBakinPaths: () => ({ root: contentDirMockPath }),
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

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

  it('recovers a plain in-progress task with a missing heartbeat even when logs are recent', async () => {
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
      expect.stringContaining('Restart recovery: inactive agent heartbeat'),
    )
    expect(mockMoveTask).toHaveBeenCalledWith('task-1', 'todo', 'inProgress')
    expect(mockAppendAudit).toHaveBeenCalledWith(
      tempDir,
      'task.restart_recovered',
      'system',
      expect.objectContaining({ id: 'task-1', reason: 'plain-agent-stale' }),
    )
  })

  it('skips plain in-progress tasks when the assigned agent heartbeat is fresh', async () => {
    mkdirSync(join(tempDir, 'heartbeats'), { recursive: true })
    writeFileSync(
      join(tempDir, 'heartbeats', 'pixel.json'),
      JSON.stringify({ timestamp: new Date().toISOString() }),
    )
    setColumns({
      inProgress: [{ id: 'task-2', title: 'Still active', agent: 'pixel' }],
    })

    const candidates = await findRestartRecoveryCandidates(tempDir)

    expect(candidates).toHaveLength(0)
    expect(mockMoveTask).not.toHaveBeenCalled()
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

  it('uses workflow active agents instead of the card assignee', async () => {
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
      expect.objectContaining({ id: 'task-4', effectiveAgents: ['pixel'], reason: 'workflow-agent-stale' }),
    )
  })

  it('reports partial workflow heartbeat loss as manual instead of redispatching live agents', async () => {
    mkdirSync(join(tempDir, 'heartbeats'), { recursive: true })
    writeFileSync(
      join(tempDir, 'heartbeats', 'pixel.json'),
      JSON.stringify({ timestamp: new Date().toISOString() }),
    )
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
        reason: 'workflow-partial-agent-stale',
        effectiveAgents: ['pixel', 'rolo'],
        staleAgents: ['rolo'],
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
        incident: expect.objectContaining({ disposition: 'action_required' }),
      }),
    ])
  })
})
