/**
 * Recovery-ladder tests (session-death hardening P10, Checkpoint 3).
 *
 * A diagnosed session death is deterministic — the ladder changes the
 * approach each rung instead of blind-retrying:
 *   death 1 → salvage + immediate corrective re-dispatch
 *   death 2 → decomposition dispatch (split into chained subtasks)
 *   death 3 → block with the full diagnosis
 * Workflow steps: corrective → block (no decomposition rung).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const sentinelContentDir = join(tmpdir(), `bakin-session-death-content-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => sentinelContentDir,
  getBakinPaths: () => ({ root: sentinelContentDir, home: sentinelContentDir, db: join(sentinelContentDir, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => sentinelContentDir,
  getBakinPaths: () => ({ root: sentinelContentDir, home: sentinelContentDir, db: join(sentinelContentDir, 'bakin.db') }),
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

mock.module('../../src/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: mock().mockReturnValue({
    dispatch: {
      intervalMs: 1000,
      maxRetries: 3,
      failureCooldownMs: 30 * 60 * 1000,
      transientCooldownMs: 60 * 1000,
      maxDispatched: 500,
      oversizedOutputBytes: 128 * 1024,
      maxConcurrentTurns: 3,
      maxTurnsPerAgent: 1,
    },
    agentPackages: { lessonsRetrieval: { enabled: false } },
  }),
}))

const mockAppendAudit = mock((..._args: unknown[]) => undefined)
mock.module('../../src/core/audit', () => ({ appendAudit: (...args: unknown[]) => mockAppendAudit(...args) }))
mock.module('@/core/audit', () => ({ appendAudit: (...args: unknown[]) => mockAppendAudit(...args) }))

mock.module('../../src/core/usage', () => ({ recordUsage: mock() }))

const mockRuntimeSend = mock((...args: unknown[]) => {
  void args
  return Promise.resolve({ id: 'runtime-msg' })
})
const mockAppServices = {
  runtime: {
    agents: { list: async () => [{ id: 'main', name: 'Main', status: 'active' }, { id: 'jessica', name: 'Jessica', status: 'active' }] },
    messaging: { send: (...args: unknown[]) => mockRuntimeSend(...args) },
  },
}
mock.module('../../src/core/app-services', () => ({ getAppServices: () => mockAppServices }))
mock.module('../../src/core/app-services-store', () => ({ getAppServices: () => mockAppServices }))
mock.module('@/core/app-services', () => ({ getAppServices: () => mockAppServices }))
mock.module('@/core/app-services-store', () => ({ getAppServices: () => mockAppServices }))

type Columns = { backlog: unknown[]; todo: unknown[]; inProgress: unknown[]; review: unknown[]; done: unknown[]; archived: unknown[]; blocked: unknown[] }
let currentColumns: Columns = empty()
function empty(): Columns {
  return { backlog: [], todo: [], inProgress: [], review: [], done: [], archived: [], blocked: [] }
}
function setColumns(c: Partial<Columns>): void {
  currentColumns = { ...empty(), ...c }
}

const mockStoreBlockTask = mock(async (..._args: unknown[]) => undefined)
const mockStoreAddTaskLog = mock(async (..._args: unknown[]) => undefined)
const mockStoreMoveTask = mock(async (..._args: unknown[]) => undefined)

// Stateful column mock: dispatch moves tasks between columns (todo →
// inProgress at fire, back on recovery, todo-park after decomposition) and
// reads the board back via snapshots — a static mock would lie to the
// settle-time guards.
function relocate(taskId: string, to: keyof Columns): void {
  for (const column of Object.keys(currentColumns) as Array<keyof Columns>) {
    const list = currentColumns[column] as Array<{ id: string }>
    const idx = list.findIndex((t) => t.id === taskId)
    if (idx >= 0) {
      const [task] = list.splice(idx, 1)
      ;(currentColumns[to] as Array<{ id: string }>).push(task!)
      return
    }
  }
}

const taskStoreMock = {
  readTaskboard: mock(() => ({ columns: currentColumns })),
  addTaskLog: (...args: unknown[]) => mockStoreAddTaskLog(...args),
  updateTask: mock(async (taskId: string, patch: { column?: string }) => {
    if (patch?.column) relocate(taskId, patch.column as keyof Columns)
    return undefined
  }),
  moveTask: (...args: unknown[]) => {
    relocate(args[0] as string, args[1] as keyof Columns)
    return mockStoreMoveTask(...args)
  },
  blockTask: (...args: unknown[]) => {
    relocate(args[0] as string, 'blocked')
    return mockStoreBlockTask(...args)
  },
}
mock.module('../../src/core/task-store', () => taskStoreMock)
mock.module('@/core/task-store', () => taskStoreMock)

// Hook registry: assets.saveFromSource returns a fresh assetId per call.
let assetCounter = 0
const mockHookInvoke = mock(async (hook: string, _data?: Record<string, unknown>): Promise<unknown> => {
  if (hook === 'assets.saveFromSource') {
    assetCounter += 1
    return { assetId: `asset-salvage-${assetCounter}`, version: 1, changed: true }
  }
  if (hook === 'workflows.getActiveAgents') return []
  return undefined
})
mock.module('../../src/core/plugin-registry', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mockHookInvoke,
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mockHookInvoke,
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
}))

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => sentinelContentDir,
  getOpenClawPath: (sub: string) => join(sentinelContentDir, sub),
}))

import { dispatchTasks, awaitDispatchIdle } from '../../src/core/dispatch'
import { RuntimeTurnError, RuntimeError } from '../../packages/core/src/adapters/runtime'

let tempDir: string

function deathError(overrides: Partial<ConstructorParameters<typeof RuntimeTurnError>[0]> = {}): RuntimeTurnError {
  return new RuntimeTurnError({
    reason: 'session_interrupted',
    sessionId: '69435183-055a-457c-a3ff-379b5cf0d929',
    sessionStatus: 'interrupted',
    timedOut: false,
    completionBytes: 708567,
    outputTruncated: true,
    oversizedOutput: true,
    lastToolCall: 'bakin_exec_tasks_log_progress',
    salvagedText: '# partial deliverables\n' + 'X'.repeat(2048),
    detail: 'OpenClaw session interrupted after oversized model completion (692KB, truncated); agent never reported completion',
    ...overrides,
  })
}

function readState() {
  return JSON.parse(readFileSync(join(tempDir, '.dispatch-state.json'), 'utf-8'))
}

function auditCalls(kind: string) {
  return mockAppendAudit.mock.calls.filter((c) => c[1] === kind)
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'bakin-session-death-'))
  assetCounter = 0
  mockAppendAudit.mockClear()
  mockRuntimeSend.mockClear()
  mockStoreBlockTask.mockClear()
  mockStoreAddTaskLog.mockClear()
  mockStoreMoveTask.mockClear()
  mockHookInvoke.mockClear()
  mockRuntimeSend.mockImplementation((...args: unknown[]) => {
    void args
    return Promise.resolve({ id: 'runtime-msg' })
  })
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

afterAll(() => {
  rmSync(sentinelContentDir, { recursive: true, force: true })
})

describe('recovery ladder — death 1: salvage + immediate corrective re-dispatch', () => {
  it('salvages output, audits, and re-dispatches with the corrective prompt in a fresh session', async () => {
    setColumns({ todo: [{ id: 't-100', title: 'Six deliverables', agent: 'jessica' }] })
    mockRuntimeSend.mockRejectedValueOnce(deathError())

    await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

    // Salvage file written + hook invoked with the parent task linkage.
    const salvageDir = join(tempDir, 'tasks', 'salvage')
    expect(existsSync(salvageDir)).toBe(true)
    expect(readdirSync(salvageDir)).toEqual(['t-100-d1.md'])
    const saveCall = mockHookInvoke.mock.calls.find((c) => c[0] === 'assets.saveFromSource')
    expect(saveCall?.[1]).toMatchObject({ taskId: 't-100', agent: 'jessica', type: 'text', tags: ['salvaged-output'] })

    // Structured audit trail.
    expect(auditCalls('task.runtime_session_died')[0]?.[3]).toMatchObject({
      id: 't-100',
      deaths: 1,
      reason: 'session_interrupted',
      sessionStatus: 'interrupted',
      completionBytes: 708567,
      oversizedOutput: true,
      lastToolCall: 'bakin_exec_tasks_log_progress',
      salvagedAssetId: 'asset-salvage-1',
    })
    expect(auditCalls('task.corrective_redispatch').length).toBe(1)

    // awaitDispatchIdle now waits THROUGH the scheduled ladder re-dispatch,
    // whose successful corrective turn clears the ladder record — the
    // durable evidence is the audit trail + the corrective prompt below.
    expect(readState().failedDispatches['t-100']).toBeUndefined()

    // Immediate re-dispatch fired with corrective guidance, salvaged asset
    // reference, and a FRESH session key.
    await wait(100)
    expect(mockRuntimeSend.mock.calls.length).toBe(2)
    const second = mockRuntimeSend.mock.calls[1]?.[0] as Record<string, unknown>
    expect(second.threadId).toBe('task:t-100:d2')
    expect(second.content).toContain('PREVIOUS ATTEMPT FAILED')
    expect(second.content).toContain('asset-salvage-1')
    expect(second.content).toContain('ONE AT A TIME')
  })
})

describe('recovery ladder — death 2: decomposition', () => {
  it('second death dispatches the decomposition prompt (chained subtasks, assets to parent)', async () => {
    setColumns({ todo: [{ id: 't-200', title: 'Mega research', agent: 'jessica' }] })
    // Both the initial dispatch and the corrective re-dispatch die.
    mockRuntimeSend.mockRejectedValueOnce(deathError())
    mockRuntimeSend.mockRejectedValueOnce(deathError({ completionBytes: 562593 }))

    await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()
    await wait(300) // corrective re-dispatch fires + dies + decomposition dispatch fires

    expect(auditCalls('task.runtime_session_died').length).toBe(2)
    expect(auditCalls('task.decomposition_dispatched').length).toBe(1)
    expect(auditCalls('task.decomposition_dispatched')[0]?.[3]).toMatchObject({
      deaths: 2,
      salvagedAssetId: 'asset-salvage-2',
    })

    // The decomposition turn itself succeeded (tiny output), which clears
    // the ladder state — the subtask chain takes over from here.
    expect(readState().failedDispatches['t-200']).toBeUndefined()

    expect(mockRuntimeSend.mock.calls.length).toBe(3)
    const third = mockRuntimeSend.mock.calls[2]?.[0] as Record<string, unknown>
    expect(third.threadId).toBe('task:t-200:d3')
    const content = third.content as string
    expect(content).toContain('DECOMPOSITION REQUIRED — DO NOT DO THE WORK')
    expect(content).toContain('parentId=t-200')
    expect(content).toContain('bakin_exec_tasks_set_dependency')
    expect(content).toContain('link assets to the PARENT task')
    expect(content).toContain('asset-salvage-1, asset-salvage-2')
  })
})

describe('recovery ladder — death 3: block with full diagnosis', () => {
  it('exhausts the ladder into an actionable blocked reason (the red herring is extinct)', async () => {
    setColumns({ todo: [{ id: 't-300', title: 'Doomed task', agent: 'jessica' }] })
    mockRuntimeSend.mockRejectedValue(deathError())

    await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()
    await wait(450) // ladder: corrective → decomposition → block

    expect(auditCalls('task.runtime_session_died').length).toBe(3)
    expect(auditCalls('task.runtime_failed_blocked').length).toBe(1)

    expect(mockStoreBlockTask).toHaveBeenCalledTimes(1)
    const reason = mockStoreBlockTask.mock.calls[0]?.[1] as string
    expect(reason).toContain('Runtime session died 3 time(s)')
    expect(reason).toContain('oversized model completion')
    expect(reason).toContain('Last tool call: bakin_exec_tasks_log_progress')
    expect(reason).toContain('asset-salvage-1, asset-salvage-2, asset-salvage-3')
    expect(reason).toContain('Next step: split this task')
    // The old generic red herring must never appear for a diagnosed death.
    expect(reason).not.toContain('gateway request timed out')

    // Ladder state cleaned up after the terminal rung.
    expect(readState().failedDispatches['t-300']).toBeUndefined()
  })
})

describe('recovery ladder — interplay with generic failures', () => {
  it('a transport failure still takes the cooldown path (no ladder, no salvage)', async () => {
    setColumns({ todo: [{ id: 't-400', title: 'Network blip', agent: 'jessica' }] })
    mockRuntimeSend.mockRejectedValueOnce(new RuntimeError('socket dropped', { kind: 'transport' }))

    await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()
    await wait(150)

    expect(auditCalls('task.runtime_session_died').length).toBe(0)
    const record = readState().failedDispatches['t-400']
    expect(record.kind).toBe('transient')
    expect(record.sessionDeath).toBeUndefined()
    expect(mockRuntimeSend.mock.calls.length).toBe(1) // no immediate re-dispatch
  })

  it('an adapter-recovered turn (lost frame, trajectory success) is a plain success — no death record', async () => {
    // When post-mortem recovery returns the salvaged response text, the send
    // RESOLVES; dispatch must record nothing ladder- or cooldown-related.
    setColumns({ todo: [{ id: 't-450', title: 'Recovered turn', agent: 'jessica' }] })
    mockRuntimeSend.mockResolvedValueOnce({ id: 'msg', content: 'recovered from trajectory', metadata: { sessionId: 's-1' } } as { id: string })

    await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

    expect(auditCalls('task.runtime_session_died').length).toBe(0)
    expect(readState().failedDispatches['t-450']).toBeUndefined()
    expect(mockStoreBlockTask).not.toHaveBeenCalled()
  })

  it('a failing salvage hook does not derail the ladder — corrective fires without the asset pointer', async () => {
    setColumns({ todo: [{ id: 't-460', title: 'Salvage hook down', agent: 'jessica' }] })
    mockHookInvoke.mockImplementation(async (hook: string): Promise<unknown> => {
      if (hook === 'assets.saveFromSource') throw new Error('assets plugin disabled')
      if (hook === 'workflows.getActiveAgents') return []
      return undefined
    })
    mockRuntimeSend.mockRejectedValueOnce(deathError())

    await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()
    await wait(250)

    // Death audited WITHOUT a salvagedAssetId; corrective re-dispatch fires.
    const death = auditCalls('task.runtime_session_died')[0]?.[3] as Record<string, unknown>
    expect(death.deaths).toBe(1)
    expect(death.salvagedAssetId).toBeUndefined()
    expect(auditCalls('task.corrective_redispatch').length).toBe(1)
    expect(mockRuntimeSend.mock.calls.length).toBe(2)
    const second = mockRuntimeSend.mock.calls[1]?.[0] as Record<string, unknown>
    expect(second.content).toContain('PREVIOUS ATTEMPT FAILED')
    expect(second.content).not.toContain('salvaged as asset')
  })

  it('a successful DECOMPOSITION turn parks the parent in todo so continuation can re-dispatch it', async () => {
    // Live-rig finding: the decomposition turn ends with "create subtasks,
    // then STOP" (no tasks_complete), leaving the parent inProgress — where
    // continuation skips it when the subtask chain completes, stranding it
    // until watchdog recovery. The settle-success handler must move a
    // decomposition parent back to todo (the dependsOn gate holds it there).
    setColumns({ todo: [{ id: 't-480', title: 'Decomposing task', agent: 'jessica' }] })
    mockRuntimeSend.mockRejectedValueOnce(deathError())
    mockRuntimeSend.mockRejectedValueOnce(deathError())
    // third send = the decomposition turn → succeeds (default resolve)

    await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()
    await wait(300)

    expect(auditCalls('task.decomposition_dispatched').length).toBe(1)
    // The decomposition turn's success must bounce the parent to todo.
    const moveCalls = mockStoreMoveTask.mock.calls.filter((c) => c[0] === 't-480' && c[1] === 'todo')
    expect(moveCalls.length).toBeGreaterThanOrEqual(1)
    expect(readState().failedDispatches['t-480']).toBeUndefined()
  })

  it('a transport failure between ladder rungs PRESERVES the ladder state (gateway rebooting mid-recovery)', async () => {
    // Real-rig scenario: death 1 → immediate corrective re-dispatch fires
    // while the gateway is still restarting → transport failure. The generic
    // cooldown record must not wipe sessionDeath, or the ladder restarts
    // from scratch and the corrective prompt is lost.
    setColumns({ todo: [{ id: 't-470', title: 'Gateway rebooting', agent: 'jessica' }] })
    mockRuntimeSend.mockRejectedValueOnce(deathError())
    mockRuntimeSend.mockRejectedValueOnce(new RuntimeError('OpenClaw chat gateway is not connected', { kind: 'transport' }))

    await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()
    await wait(150)

    const record = readState().failedDispatches['t-470']
    expect(record.kind).toBe('transient') // the transport failure is recorded…
    expect(record.sessionDeath).toMatchObject({ stage: 'corrective', deaths: 1 }) // …but the ladder survives
  })

  it('a successful corrective attempt clears the ladder state', async () => {
    setColumns({ todo: [{ id: 't-500', title: 'Recovers on retry', agent: 'jessica' }] })
    mockRuntimeSend.mockRejectedValueOnce(deathError())
    // corrective attempt succeeds (default mock resolves)

    await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()
    await wait(250)

    expect(mockRuntimeSend.mock.calls.length).toBe(2)
    expect(readState().failedDispatches['t-500']).toBeUndefined()
  })
})

describe('recovery ladder — workflow variant (corrective → block, no decomposition)', () => {
  function setupWorkflowTask(id: string) {
    setColumns({ todo: [{ id, title: 'WF task', workflowId: 'flow-1', agent: 'jessica' }] })
    mockHookInvoke.mockImplementation(async (hook: string): Promise<unknown> => {
      if (hook === 'assets.saveFromSource') {
        assetCounter += 1
        return { assetId: `asset-salvage-${assetCounter}`, version: 1, changed: true }
      }
      if (hook === 'workflows.loadInstance') return { id: 'inst-1' }
      if (hook === 'workflows.getActiveAgents') return [{ agent: 'jessica', stepId: 'step-1' }]
      if (hook === 'workflows.getCurrentStep') {
        return { stepId: 'step-1', label: 'Research', instructions: 'do research', output_schema: {} }
      }
      return undefined
    })
  }

  it('first death: corrective state, task stays in progress (no decomposition rung)', async () => {
    setupWorkflowTask('wf-100')
    mockRuntimeSend.mockRejectedValueOnce(deathError())

    await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()
    await wait(150)

    expect(auditCalls('task.runtime_session_died').length).toBe(1)
    expect(auditCalls('task.corrective_redispatch').length).toBe(1)
    const record = readState().failedDispatches['wf-100']
    expect(record.sessionDeath).toMatchObject({ stage: 'corrective', deaths: 1 })
    // Workflow tasks are not bounced back to todo — the step machinery
    // re-dispatches; the task must not be moved by the ladder.
    expect(mockStoreMoveTask).not.toHaveBeenCalled()
    expect(mockStoreBlockTask).not.toHaveBeenCalled()
  })

  it('second death blocks the workflow task with the diagnosis', async () => {
    setupWorkflowTask('wf-200')
    mockRuntimeSend.mockRejectedValue(deathError())

    // First cycle → death 1 (corrective). Second cycle re-dispatches the
    // step (markers were cleared) with the corrective prompt → death 2 → block.
    await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()
    const correctiveSend = mockRuntimeSend.mock.calls.length
    setColumns({ inProgress: [{ id: 'wf-200', title: 'WF task', workflowId: 'flow-1', agent: 'jessica' }] })
    await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

    expect(mockRuntimeSend.mock.calls.length).toBeGreaterThan(correctiveSend)
    const retry = mockRuntimeSend.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(retry.content).toContain('PREVIOUS ATTEMPT FAILED')

    expect(auditCalls('task.runtime_session_died').length).toBe(2)
    expect(mockStoreBlockTask).toHaveBeenCalledTimes(1)
    const reason = mockStoreBlockTask.mock.calls[0]?.[1] as string
    expect(reason).toContain('Runtime session died 2 time(s)')
    expect(readState().failedDispatches['wf-200']).toBeUndefined()
  })
})
