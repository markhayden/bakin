/**
 * T4 (#189): dispatch resolves team-assigned tasks to a concrete agent
 * BEFORE the concurrency gate and ledger claim.
 *
 * - ok → recordTeamResolution (agent persisted, team retained) + task log +
 *   task.team_resolved audit → dispatch continues with the resolved agent
 * - transient → skip this cycle (visible reason once, no log spam) → retried
 * - structural / hook missing → task blocked with a clear reason
 * - resolved tasks NEVER re-invoke the resolver (call-count assertion)
 * - direct-agent tasks never touch the hook
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const sentinelContentDir = join(tmpdir(), `bakin-dispatch-team-test-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => sentinelContentDir,
  getBakinPaths: () => ({ home: sentinelContentDir, db: join(sentinelContentDir, 'bakin.db'), tasks: join(sentinelContentDir, 'tasks') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => sentinelContentDir,
  getBakinPaths: () => ({ home: sentinelContentDir, db: join(sentinelContentDir, 'bakin.db'), tasks: join(sentinelContentDir, 'tasks') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => sentinelContentDir,
  getOpenClawPath: (sub: string) => join(sentinelContentDir, sub),
  resetOpenClawHome: () => {},
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
      maxConcurrentTurns: 3,
      maxTurnsPerAgent: 1,
    },
    watchdog: { stuckThresholdMs: 30 * 60 * 1000 },
  }),
}))

const auditSpy = mock((..._args: unknown[]) => undefined)
mock.module('../../src/core/audit', () => ({ appendAudit: auditSpy }))

const mockRuntimeAgentsList = mock(async () => [
  { id: 'main', name: 'Main', status: 'active' },
  { id: 'dev', name: 'Dev', status: 'active' },
  { id: 'reviewer', name: 'Reviewer', status: 'active' },
])
const mockAppServices = {
  runtime: { agents: { list: () => mockRuntimeAgentsList() } },
}
mock.module('../../src/core/app-services', () => ({ getAppServices: () => mockAppServices }))
mock.module('@/core/app-services', () => ({ getAppServices: () => mockAppServices }))

// ── task-store mock: recordTeamResolution "persists" into the board data ──
type TestTask = {
  id: string; title: string; agent?: string; team?: string
  log?: Array<{ timestamp: string; message?: string }>
}
type TestColumns = Record<'backlog' | 'todo' | 'inProgress' | 'review' | 'done' | 'blocked' | 'archived', TestTask[]>
const emptyColumns = (): TestColumns => ({ backlog: [], todo: [], inProgress: [], review: [], done: [], blocked: [], archived: [] })
let columns: TestColumns = emptyColumns()

const blockTaskSpy = mock(async (..._args: unknown[]) => undefined)
const addTaskLogSpy = mock(async (taskId: string, _author: string, message: string) => {
  for (const col of Object.values(columns)) {
    const t = col.find((x) => x.id === taskId)
    if (t) (t.log ??= []).push({ timestamp: new Date().toISOString(), message })
  }
})
const recordTeamResolutionSpy = mock(async (taskId: string, agent: string) => {
  for (const col of Object.values(columns)) {
    const t = col.find((x) => x.id === taskId)
    if (t) t.agent = agent
  }
})
const taskStoreMock = () => ({
  readTaskboard: () => ({ columns }),
  getTask: (id: string) => {
    for (const col of Object.values(columns)) {
      const t = col.find((x) => x.id === id)
      if (t) return t
    }
    return null
  },
  getTaskWithColumn: (id: string) => {
    for (const [column, col] of Object.entries(columns)) {
      const t = col.find((x) => x.id === id)
      if (t) return { task: t, column }
    }
    return null
  },
  addTaskLog: (...args: [string, string, string]) => addTaskLogSpy(...args),
  updateTask: mock(async () => undefined),
  moveTask: mock(async () => undefined),
  blockTask: (...args: unknown[]) => blockTaskSpy(...args),
  recordTeamResolution: (...args: [string, string]) => recordTeamResolutionSpy(...args),
})
mock.module('../../src/core/task-store', taskStoreMock)
mock.module('@/core/task-store', taskStoreMock)

// ── hook registry: configurable per test ──
let hookHasHandler = true
let hookResult: unknown = { ok: true, agentId: 'reviewer', reason: 'best fit', model: 'anthropic/haiku' }
const hookInvokeSpy = mock(async (_name: string, _data: unknown) => hookResult)
const hookRegistryMock = () => ({
  getHookRegistry: () => ({
    invoke: hookInvokeSpy,
    has: () => hookHasHandler,
    register: mock(),
    call: mock(async (_n: string, d: unknown) => d),
    callAll: mock(async () => undefined),
  }),
})
mock.module('@bakin/core/hooks/hook-registry-singleton', hookRegistryMock)
mock.module('../../packages/core/src/hooks/hook-registry-singleton', hookRegistryMock)

// ── stub the fire path: prepare captures targetAgent; nothing actually fires ──
const prepareSpy = mock(async (_input: { task: TestTask; targetAgent: string }) => ({ status: 'suppressed' as const }))
mock.module('../../src/core/dispatch-prepare', () => ({
  prepareRegularDispatch: prepareSpy,
}))
mock.module('../../src/core/dispatch-turns', () => ({
  concurrencyGate: () => null,
  deferForBudget: async () => false,
  fireDispatchTurn: mock(async () => undefined),
  claimDispatchRun: mock(async () => ({ ok: true })),
  auditDispatchSuppressed: mock(() => undefined),
}))
mock.module('../../src/core/dispatch-workflow', () => ({
  dispatchWorkflowTask: mock(async () => undefined),
}))
mock.module('../../src/core/execution-ledger', () => ({
  loseRun: mock(() => undefined),
}))

import { dispatchTasks } from '../../src/core/dispatch-cycle'
import { resolveTeamAssignmentForDispatch, resolveTeamAssignmentForSingle } from '../../src/core/dispatch-team'
import { loadDispatchState, saveDispatchState } from '../../src/core/dispatch-state'

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'bakin-dispatch-team-'))
  columns = emptyColumns()
  hookHasHandler = true
  hookResult = { ok: true, agentId: 'reviewer', reason: 'best fit', model: 'anthropic/haiku' }
  hookInvokeSpy.mockClear()
  prepareSpy.mockClear()
  blockTaskSpy.mockClear()
  addTaskLogSpy.mockClear()
  recordTeamResolutionSpy.mockClear()
  auditSpy.mockClear()
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('resolveTeamAssignmentForDispatch (helper)', () => {
  const teamTask = (): TestTask => ({ id: 'task-1', title: 'Review PR', team: 'development' })

  it('ok → persists agent, logs, audits task.team_resolved', async () => {
    const task = teamTask()
    columns.todo.push(task)
    const outcome = await resolveTeamAssignmentForDispatch(task, tempDir)
    expect(outcome).toEqual({ status: 'resolved', agentId: 'reviewer' })
    expect(recordTeamResolutionSpy).toHaveBeenCalledWith('task-1', 'reviewer')
    expect(auditSpy).toHaveBeenCalledWith(tempDir, 'task.team_resolved', 'system', expect.objectContaining({
      id: 'task-1', team: 'development', agent: 'reviewer', reason: 'best fit',
    }))
    const logged = addTaskLogSpy.mock.calls.map((c) => String(c[2])).join('\n')
    expect(logged).toContain('reviewer')
    expect(logged).toContain('best fit')
  })

  it('transient → skipped, audited, NOT blocked', async () => {
    hookResult = { ok: false, kind: 'transient', message: 'rate limited' }
    const task = teamTask()
    columns.todo.push(task)
    const outcome = await resolveTeamAssignmentForDispatch(task, tempDir)
    expect(outcome).toEqual({ status: 'skipped' })
    expect(blockTaskSpy).not.toHaveBeenCalled()
    expect(auditSpy).toHaveBeenCalledWith(tempDir, 'task.team_resolution_failed', 'system', expect.objectContaining({ kind: 'transient' }))
  })

  it('transient failure does not spam the task log across cycles', async () => {
    hookResult = { ok: false, kind: 'transient', message: 'rate limited' }
    const task = teamTask()
    columns.todo.push(task)
    await resolveTeamAssignmentForDispatch(task, tempDir)
    await resolveTeamAssignmentForDispatch(task, tempDir)
    const failureLogs = addTaskLogSpy.mock.calls.filter((c) => String(c[2]).includes('rate limited'))
    expect(failureLogs).toHaveLength(1)
  })

  it('structural → blocked with reason', async () => {
    hookResult = { ok: false, kind: 'structural', message: 'no API key configured' }
    const task = teamTask()
    columns.todo.push(task)
    const outcome = await resolveTeamAssignmentForDispatch(task, tempDir)
    expect(outcome).toEqual({ status: 'blocked' })
    expect(blockTaskSpy).toHaveBeenCalledWith('task-1', 'team routing failed — re-assign this task')
    const structLog = addTaskLogSpy.mock.calls.map((c) => String(c[2])).join('\n')
    expect(structLog).toContain('no API key configured')
  })

  it('hook not registered → blocked (structural)', async () => {
    hookHasHandler = false
    const task = teamTask()
    columns.todo.push(task)
    const outcome = await resolveTeamAssignmentForDispatch(task, tempDir)
    expect(outcome).toEqual({ status: 'blocked' })
    expect(hookInvokeSpy).not.toHaveBeenCalled()
  })
})

describe('dispatch cycle wiring', () => {
  it('team task resolves then dispatches with the resolved agent', async () => {
    columns.todo.push({ id: 'task-t', title: 'Team work', team: 'development' })
    await dispatchTasks(tempDir, 3737)
    expect(hookInvokeSpy).toHaveBeenCalledTimes(1)
    expect(prepareSpy).toHaveBeenCalledTimes(1)
    expect(prepareSpy.mock.calls[0][0].targetAgent).toBe('reviewer')
  })

  it('resolver is invoked exactly once per task lifetime (sticky resolution)', async () => {
    columns.todo.push({ id: 'task-t', title: 'Team work', team: 'development' })
    await dispatchTasks(tempDir, 3737)
    // Simulate the next cycle: task still in todo (prepare was suppressed),
    // but resolution was persisted (agent set by recordTeamResolution).
    await dispatchTasks(tempDir, 3737)
    expect(hookInvokeSpy).toHaveBeenCalledTimes(1)
  })

  it('transient failure skips dispatch, joins the failure ladder, and cools down (R2)', async () => {
    hookResult = { ok: false, kind: 'transient', message: 'rate limited' }
    columns.todo.push({ id: 'task-t', title: 'Team work', team: 'development' })
    await dispatchTasks(tempDir, 3737)
    expect(prepareSpy).not.toHaveBeenCalled()
    expect(hookInvokeSpy).toHaveBeenCalledTimes(1)

    // A failure record was written to the ladder…
    const state = loadDispatchState(tempDir)
    expect(state.failedDispatches['task-t']).toMatchObject({ count: 1, kind: 'transient' })

    // …so an immediate next cycle does NOT re-bill the router (cooldown).
    await dispatchTasks(tempDir, 3737)
    expect(hookInvokeSpy).toHaveBeenCalledTimes(1)

    // After the cooldown elapses, the next cycle retries.
    state.failedDispatches['task-t'].lastAttempt = Date.now() - 10 * 60 * 1000
    saveDispatchState(tempDir, state)
    await dispatchTasks(tempDir, 3737)
    expect(hookInvokeSpy).toHaveBeenCalledTimes(2)
  })

  it('resolution failures escalate to blocked at maxRetries without re-billing (R2)', async () => {
    hookResult = { ok: false, kind: 'transient', message: 'rate limited' }
    columns.todo.push({ id: 'task-t', title: 'Team work', team: 'development' })
    const state = loadDispatchState(tempDir)
    state.failedDispatches['task-t'] = {
      count: 3, // == mocked settings.dispatch.maxRetries
      lastAttempt: Date.now() - 10 * 60 * 1000,
      kind: 'transient',
    }
    saveDispatchState(tempDir, state)

    await dispatchTasks(tempDir, 3737)
    expect(hookInvokeSpy).not.toHaveBeenCalled() // pre-pass respects the exhausted ladder
    expect(blockTaskSpy).toHaveBeenCalledWith('task-t', expect.stringContaining('re-assign this task'))
    const exhaustLog = addTaskLogSpy.mock.calls.map((c) => String(c[2])).join('\n')
    expect(exhaustLog).toContain('3 times')
    expect(prepareSpy).not.toHaveBeenCalled()
  })

  it('structural failure blocks the task and does not dispatch', async () => {
    hookResult = { ok: false, kind: 'structural', message: 'team has no members' }
    columns.todo.push({ id: 'task-t', title: 'Team work', team: 'development' })
    await dispatchTasks(tempDir, 3737)
    expect(blockTaskSpy).toHaveBeenCalled()
    expect(prepareSpy).not.toHaveBeenCalled()
  })

  it('direct-agent tasks never touch the resolver', async () => {
    columns.todo.push({ id: 'task-d', title: 'Direct work', agent: 'dev' })
    await dispatchTasks(tempDir, 3737)
    expect(hookInvokeSpy).not.toHaveBeenCalled()
    expect(prepareSpy).toHaveBeenCalledTimes(1)
    expect(prepareSpy.mock.calls[0][0].targetAgent).toBe('dev')
  })
})

describe('hook-throw visibility (R8)', () => {
  it('a throwing hook writes a task-log line and an audit event, not just a server log', async () => {
    hookInvokeSpy.mockImplementationOnce(async () => { throw new Error('heartbeats corrupted') })
    const task: TestTask = { id: 'task-x', title: 'Team work', team: 'development' }
    columns.todo.push(task)
    const outcome = await resolveTeamAssignmentForDispatch(task, tempDir)
    expect(outcome).toEqual({ status: 'skipped' })
    expect(auditSpy).toHaveBeenCalledWith(tempDir, 'task.team_resolution_failed', 'system', expect.objectContaining({
      kind: 'transient',
      message: expect.stringContaining('heartbeats corrupted'),
    }))
    const logged = addTaskLogSpy.mock.calls.map((c) => String(c[2])).join('\n')
    expect(logged).toContain('heartbeats corrupted')
  })
})

describe('round-3 guards', () => {
  it('pre-pass skips tasks not yet dispatch-eligible — future availableAt bills nothing', async () => {
    columns.todo.push({ id: 'task-later', title: 'Later', team: 'development', availableAt: new Date(Date.now() + 86_400_000).toISOString() } as TestTask & { availableAt: string })
    await dispatchTasks(tempDir, 3737)
    expect(hookInvokeSpy).not.toHaveBeenCalled()
  })

  it('pre-pass skips tasks with an unmet dependency on an EXISTING task', async () => {
    columns.inProgress.push({ id: 'task-parent', title: 'Parent' })
    columns.todo.push({ id: 'task-dep', title: 'Dependent', team: 'development', dependsOn: 'task-parent' } as TestTask & { dependsOn: string })
    await dispatchTasks(tempDir, 3737)
    expect(hookInvokeSpy).not.toHaveBeenCalled()
  })

  it('a dangling dependency (target deleted) does NOT strand resolution (round-4)', async () => {
    columns.todo.push({ id: 'task-dangling', title: 'Dangling dep', team: 'development', dependsOn: 'task-gone' } as TestTask & { dependsOn: string })
    await dispatchTasks(tempDir, 3737)
    expect(hookInvokeSpy).toHaveBeenCalledTimes(1) // treated as satisfied, mirrors isTaskDispatchEligible
  })

  it('a joined kick proceeds when the in-flight resolution succeeds (round-4)', async () => {
    columns.todo.push({ id: 'task-join', title: 'Join', team: 'development' })
    hookInvokeSpy.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 40))
      return { ok: true, agentId: 'reviewer', reason: 'fit', model: 'anthropic/haiku' }
    })
    const [, kickOk] = await Promise.all([
      dispatchTasks(tempDir, 3737),
      resolveTeamAssignmentForSingle('task-join', tempDir, 'kick'),
    ])
    expect(hookInvokeSpy).toHaveBeenCalledTimes(1)
    expect(kickOk).toBe(true) // the kick is NOT swallowed — it may proceed to dispatch
    hookInvokeSpy.mockImplementation(async () => hookResult)
  })

  it('sessionDeath records are NOT exempt: exhausted ladder blocks without billing', async () => {
    columns.todo.push({ id: 'task-sd', title: 'Was dead', team: 'development' })
    const state = loadDispatchState(tempDir)
    state.failedDispatches['task-sd'] = {
      count: 3,
      lastAttempt: Date.now() - 10 * 60 * 1000,
      kind: 'transient',
      sessionDeath: { kind: 'session_death' } as never,
    }
    saveDispatchState(tempDir, state)

    await dispatchTasks(tempDir, 3737)
    expect(hookInvokeSpy).not.toHaveBeenCalled()
    expect(blockTaskSpy).toHaveBeenCalledWith('task-sd', expect.stringContaining('re-assign this task'))
    const sdLog = addTaskLogSpy.mock.calls.map((c) => String(c[2])).join('\n')
    expect(sdLog).toContain('3 times')
  })

  it('sessionDeath records are NOT exempt: cooldown pacing applies', async () => {
    columns.todo.push({ id: 'task-sd2', title: 'Was dead', team: 'development' })
    const state = loadDispatchState(tempDir)
    state.failedDispatches['task-sd2'] = {
      count: 1,
      lastAttempt: Date.now(), // fresh — inside transientCooldownMs
      kind: 'transient',
      sessionDeath: { kind: 'session_death' } as never,
    }
    saveDispatchState(tempDir, state)

    await dispatchTasks(tempDir, 3737)
    expect(hookInvokeSpy).not.toHaveBeenCalled()
    expect(blockTaskSpy).not.toHaveBeenCalled()
  })

  it('a kick racing the cycle resolves the task exactly once (in-flight guard)', async () => {
    columns.todo.push({ id: 'task-race', title: 'Race', team: 'development' })
    hookInvokeSpy.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50))
      return { ok: true, agentId: 'reviewer', reason: 'fit', model: 'anthropic/haiku' }
    })
    await Promise.all([
      dispatchTasks(tempDir, 3737),
      resolveTeamAssignmentForSingle('task-race', tempDir),
    ])
    expect(hookInvokeSpy).toHaveBeenCalledTimes(1)
    hookInvokeSpy.mockImplementation(async () => hookResult)
  })

  it('a stale routing result is discarded, never overwriting a changed task', async () => {
    const task: TestTask = { id: 'task-stale', title: 'Stale', team: 'development' }
    columns.todo.push(task)
    hookInvokeSpy.mockImplementationOnce(async () => {
      // Task gets directly assigned while the router is thinking.
      task.agent = 'someone-else'
      return { ok: true, agentId: 'reviewer', reason: 'fit', model: 'anthropic/haiku' }
    })
    const outcome = await resolveTeamAssignmentForDispatch({ ...task, agent: undefined }, tempDir)
    expect(outcome).toEqual({ status: 'stale' })
    expect(recordTeamResolutionSpy).not.toHaveBeenCalled()
  })
})
