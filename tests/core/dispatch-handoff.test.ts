/**
 * Settle-time hand-off (spec D4, plan review R3): when a REGULAR turn settles
 * successfully and the task is still in progress but now belongs to a
 * different agent (triage re-assigned it) or to a team (agent cleared), the
 * task is parked in todo so the next dispatch cycle fires the new owner.
 * Workflow step turns never park — a card owner and a step agent legitimately
 * differ there.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const sentinelContentDir = join(tmpdir(), `bakin-dispatch-handoff-content-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => sentinelContentDir,
  getBakinPaths: () => ({ root: sentinelContentDir, home: sentinelContentDir, db: join(sentinelContentDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

const settingsValue = {
  dispatch: {
    intervalMs: 1000,
    maxRetries: 3,
    failureCooldownMs: 30 * 60 * 1000,
    transientCooldownMs: 60 * 1000,
    maxDispatched: 5,
    oversizedOutputBytes: 128 * 1024,
    maxConcurrentTurns: 3,
    maxTurnsPerAgent: 2,
  },
  agentPackages: { lessonsRetrieval: { enabled: false } },
}
mock.module('../../src/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: mock(() => settingsValue),
}))

const auditEvents: Array<{ event: string; agent: string; data: Record<string, unknown> }> = []
const appendAuditMock = mock((_dir: string, event: string, agent: string, data?: Record<string, unknown>) => {
  auditEvents.push({ event, agent, data: data ?? {} })
})
mock.module('../../src/core/audit', () => ({ appendAudit: appendAuditMock }))
mock.module('@/core/audit', () => ({ appendAudit: appendAuditMock }))
mock.module('../../src/core/usage', () => ({ recordUsage: mock() }))

// Controllable send: every turn parks until released, so the test can mutate
// the board mid-turn and then let the turn settle.
type Pending = { resolve: () => void }
const pendingSends = new Map<string, Pending[]>()
const mockRuntimeSend = mock((args: { agentId: string; threadId: string }) => {
  return new Promise((resolve) => {
    const queue = pendingSends.get(args.agentId) ?? []
    queue.push({ resolve: () => resolve({ id: 'msg' }) })
    pendingSends.set(args.agentId, queue)
  })
})
function releaseSend(agentId: string): void {
  const next = (pendingSends.get(agentId) ?? []).shift()
  if (next) next.resolve()
}

const mockAppServices = {
  runtime: {
    agents: { list: async () => [
      { id: 'jessica', name: 'Jessica', status: 'active' },
      { id: 'patch', name: 'Patch', status: 'active' },
      { id: 'pixel', name: 'Pixel', status: 'active' },
      { id: 'trainer', name: 'Trainer', status: 'active' },
    ] },
    messaging: { send: (...args: unknown[]) => mockRuntimeSend(...(args as [never])) },
  },
}
mock.module('../../src/core/app-services', () => ({ getAppServices: () => mockAppServices }))
mock.module('../../src/core/app-services-store', () => ({ getAppServices: () => mockAppServices }))
mock.module('@/core/app-services', () => ({ getAppServices: () => mockAppServices }))
mock.module('@/core/app-services-store', () => ({ getAppServices: () => mockAppServices }))

type BoardTask = { id: string; title: string; agent?: string; team?: string; workflowId?: string }
type Columns = { backlog: BoardTask[]; todo: BoardTask[]; inProgress: BoardTask[]; review: BoardTask[]; done: BoardTask[]; archived: BoardTask[]; blocked: BoardTask[] }
let currentColumns: Columns = { backlog: [], todo: [], inProgress: [], review: [], done: [], archived: [], blocked: [] }
function setColumns(c: Partial<Columns>): void {
  currentColumns = { backlog: [], todo: [], inProgress: [], review: [], done: [], archived: [], blocked: [], ...c }
}
function findTask(id: string): BoardTask | undefined {
  for (const column of Object.values(currentColumns)) {
    const found = column.find((t) => t.id === id)
    if (found) return found
  }
  return undefined
}
function relocate(id: string, to: keyof Columns): void {
  for (const column of Object.values(currentColumns)) {
    const idx = column.findIndex((t) => t.id === id)
    if (idx >= 0) {
      const [task] = column.splice(idx, 1)
      currentColumns[to].push(task)
      return
    }
  }
}

const mockStoreMoveTask = mock(async (..._args: unknown[]) => undefined)
const mockStoreAddTaskLog = mock(async (..._args: unknown[]) => undefined)
const taskStoreMock = {
  readTaskboard: mock(() => ({ columns: currentColumns })),
  addTaskLog: (...args: unknown[]) => mockStoreAddTaskLog(...args),
  updateTask: mock(async () => undefined),
  moveTask: (...args: unknown[]) => {
    relocate(args[0] as string, args[1] as keyof Columns)
    return mockStoreMoveTask(...args)
  },
  blockTask: mock(async () => undefined),
}
mock.module('../../src/core/task-store', () => taskStoreMock)
mock.module('@/core/task-store', () => taskStoreMock)

const hookRegistryMock = () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock(async (hook: string) => (hook === 'workflows.getActiveAgents' ? [] : undefined)),
    has: mock((name: string) => name === 'spend.getBudgetPolicy'),
    register: mock(),
  }),
})
mock.module('../../src/core/plugin-registry', hookRegistryMock)
mock.module('@bakin/core/hooks/hook-registry-singleton', hookRegistryMock)

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => sentinelContentDir,
  getOpenClawPath: (sub: string) => join(sentinelContentDir, sub),
}))

import { fireDispatchTurn, awaitDispatchIdle } from '../../src/core/dispatch-turns'
import { closeDb } from '../../packages/core/src/storage/db'
import { waitUntil, settleFor } from '../helpers/wait'

let tempDir: string

function fireTurn(taskId: string, targetAgent: string, opts: { dispatchKind?: 'regular' | 'workflow'; stepId?: string; childTaskId?: string } = {}): void {
  const stepId = opts.stepId
  fireDispatchTurn({
    marker: stepId ? `${taskId}:${stepId}` : taskId,
    task: findTask(taskId) as never,
    targetAgent,
    threadId: stepId ? `task:${taskId}:step:${stepId}:d1` : `task:${taskId}:d1`,
    message: 'work it',
    contentDir: tempDir,
    port: 3737,
    initialLogCount: 0,
    logPrefix: 'test',
    dispatchKind: opts.dispatchKind ?? 'regular',
    ...(stepId ? { stepId } : {}),
    ...(opts.childTaskId ? { childTaskId: opts.childTaskId } : {}),
  })
}

async function turnStarted(agent: string): Promise<void> {
  await waitUntil(() => (pendingSends.get(agent)?.length ?? 0) > 0, { label: `${agent} turn sent` })
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'bakin-dispatch-handoff-'))
  pendingSends.clear()
  auditEvents.length = 0
  mockStoreMoveTask.mockClear()
  mockStoreAddTaskLog.mockClear()
})

afterEach(async () => {
  for (const [agent, queue] of pendingSends) {
    while (queue.length) releaseSend(agent)
  }
  await awaitDispatchIdle()
  rmSync(tempDir, { recursive: true, force: true })
})

afterAll(() => {
  closeDb()
  rmSync(sentinelContentDir, { recursive: true, force: true })
})

describe('settle-time hand-off', () => {
  it('parks a task re-assigned to another agent during the turn, logs it, audits it', async () => {
    setColumns({ inProgress: [{ id: 't-handoff', title: 'Triage me', agent: 'jessica' }] })
    fireTurn('t-handoff', 'jessica')
    await turnStarted('jessica')

    // Triage assigned the task to patch mid-turn (bakin_exec_tasks_assign).
    findTask('t-handoff')!.agent = 'patch'
    releaseSend('jessica')
    await awaitDispatchIdle()

    expect(mockStoreMoveTask).toHaveBeenCalledWith('t-handoff', 'todo', 'inProgress')
    expect(mockStoreAddTaskLog).toHaveBeenCalledWith('t-handoff', 'system', 'Handed off to patch; queued for dispatch.')
    expect(auditEvents.find((e) => e.event === 'task.handed_off')?.data).toMatchObject({ id: 't-handoff', from: 'jessica', to: 'patch' })
  })

  it('parks a task handed to a team (agent cleared) during the turn', async () => {
    setColumns({ inProgress: [{ id: 't-team', title: 'Route me', agent: 'jessica' }] })
    fireTurn('t-team', 'jessica')
    await turnStarted('jessica')

    const task = findTask('t-team')!
    task.agent = undefined
    task.team = 'researchers'
    releaseSend('jessica')
    await awaitDispatchIdle()

    expect(mockStoreMoveTask).toHaveBeenCalledWith('t-team', 'todo', 'inProgress')
    expect(mockStoreAddTaskLog).toHaveBeenCalledWith('t-team', 'system', 'Handed off to team researchers; queued for dispatch.')
  })

  it('leaves a task alone when the same agent still owns it after settle', async () => {
    setColumns({ inProgress: [{ id: 't-same', title: 'Keep going', agent: 'jessica' }] })
    fireTurn('t-same', 'jessica')
    await turnStarted('jessica')
    releaseSend('jessica')
    await awaitDispatchIdle()
    await settleFor(50, 'a park would have happened during settle; none expected')

    expect(mockStoreMoveTask).not.toHaveBeenCalled()
    expect(auditEvents.some((e) => e.event === 'task.handed_off')).toBe(false)
  })

  it('a resolved team task (agent set, team retained) is not a hand-off', async () => {
    setColumns({ inProgress: [{ id: 't-resolved', title: 'Team pick', agent: 'jessica', team: 'researchers' }] })
    fireTurn('t-resolved', 'jessica')
    await turnStarted('jessica')
    releaseSend('jessica')
    await awaitDispatchIdle()
    await settleFor(50, 'a park would have happened during settle; none expected')

    expect(mockStoreMoveTask).not.toHaveBeenCalled()
  })

  it('does nothing when the task was completed during the turn', async () => {
    setColumns({ inProgress: [{ id: 't-done', title: 'Finish me', agent: 'jessica' }] })
    fireTurn('t-done', 'jessica')
    await turnStarted('jessica')

    const task = findTask('t-done')!
    task.agent = 'patch'
    relocate('t-done', 'done')
    releaseSend('jessica')
    await awaitDispatchIdle()
    await settleFor(50, 'a park would have happened during settle; none expected')

    expect(mockStoreMoveTask).not.toHaveBeenCalled()
  })

  it('never parks a workflow step turn whose card owner differs from the step agent', async () => {
    setColumns({ inProgress: [{ id: 'wf-card', title: 'Workflow task', agent: 'trainer', workflowId: 'video' }] })
    fireTurn('wf-card', 'pixel', { dispatchKind: 'workflow', stepId: 'clip' })
    await turnStarted('pixel')
    releaseSend('pixel')
    await awaitDispatchIdle()
    await settleFor(50, 'a park would have happened during settle; none expected')

    expect(mockStoreMoveTask).not.toHaveBeenCalled()
    expect(auditEvents.some((e) => e.event === 'task.handed_off')).toBe(false)
  })

  it('never parks parallel workflow steps running under different agents', async () => {
    setColumns({ inProgress: [{ id: 'wf-par', title: 'Parallel workflow', agent: 'trainer', workflowId: 'parallel' }] })
    fireTurn('wf-par', 'pixel', { dispatchKind: 'workflow', stepId: 'design' })
    fireTurn('wf-par', 'patch', { dispatchKind: 'workflow', stepId: 'copy' })
    await turnStarted('pixel')
    await turnStarted('patch')
    releaseSend('pixel')
    releaseSend('patch')
    await awaitDispatchIdle()
    await settleFor(50, 'a park would have happened during settle; none expected')

    expect(mockStoreMoveTask).not.toHaveBeenCalled()
  })

  it('never parks a nested workflow parent whose child step settles', async () => {
    setColumns({ inProgress: [
      { id: 'wf-parent', title: 'Nested parent', agent: 'trainer', workflowId: 'outer' },
      { id: 'wf-child', title: 'Nested child', agent: 'pixel', workflowId: 'inner' },
    ] })
    fireTurn('wf-parent', 'pixel', { dispatchKind: 'workflow', stepId: 'inner-step', childTaskId: 'wf-child' })
    await turnStarted('pixel')
    releaseSend('pixel')
    await awaitDispatchIdle()
    await settleFor(50, 'a park would have happened during settle; none expected')

    expect(mockStoreMoveTask).not.toHaveBeenCalled()
  })
})
