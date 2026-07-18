/**
 * Workflow-step team resolution (#611): resolveTeamAssignmentForStep.
 *
 * Same policy as task-level (#189): structural failures block the PARENT
 * task honestly, transient failures ride the failedDispatches ladder (keyed
 * `<contextTaskId>:<stepId>`), pause gates defer quietly OUTSIDE the ladder,
 * and the pick persists sticky via workflows.recordStepTeamResolution
 * (first write wins — a racing resolution's recorded pick is authoritative).
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const sentinelContentDir = join(tmpdir(), `bakin-dispatch-team-step-test-${Date.now()}`)
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

// ── routing-call gate collaborators (lazy-imported by dispatch-team) ──
let paused = false
mock.module('../../src/core/dispatch-turns', () => ({
  dispatchPaused: () => paused,
  deferForBudget: async () => false,
}))
mock.module('../../src/core/system-route', () => ({
  resolveSystemRoute: async () => ({ source: 'inherit' }),
  routeSendArgs: () => ({}),
}))
const mockAppServices = { runtime: { agents: { list: async () => [{ id: 'main', name: 'Main' }] } } }
mock.module('../../src/core/app-services', () => ({ getAppServices: () => mockAppServices }))
mock.module('../../src/core/app-services-store', () => ({ getAppServices: () => mockAppServices }))

// ── task-store: block/log spies ──
const blockTaskSpy = mock(async (..._args: unknown[]) => undefined)
const addTaskLogSpy = mock(async (..._args: unknown[]) => undefined)
const taskStoreMock = () => ({
  readTaskboard: () => ({ columns: {} }),
  getTaskWithColumn: () => null,
  addTaskLog: (...args: unknown[]) => addTaskLogSpy(...args),
  blockTask: (...args: unknown[]) => blockTaskSpy(...args),
  recordTeamResolution: mock(async () => undefined),
})
mock.module('../../src/core/task-store', taskStoreMock)
mock.module('@/core/task-store', taskStoreMock)

// ── hook registry: team.resolveAssignment + workflows.recordStepTeamResolution ──
let hookHasHandler = true
let resolveResult: unknown = { ok: true, agentId: 'dev', reason: 'best fit', model: 'inherit' }
let recordResult: unknown = { agentId: 'dev', team: 'builders', reason: 'best fit', at: 'now' }
const resolveSpy = mock(async (_data: unknown) => resolveResult)
const recordSpy = mock(async (_data: unknown) => recordResult)
const hookRegistryMock = () => ({
  getHookRegistry: () => ({
    invoke: async (name: string, data: unknown) => {
      if (name === 'team.resolveAssignment') return resolveSpy(data)
      if (name === 'workflows.recordStepTeamResolution') return recordSpy(data)
      return undefined
    },
    has: () => hookHasHandler,
    register: mock(),
    call: mock(async (_n: string, d: unknown) => d),
    callAll: mock(async () => undefined),
  }),
})
mock.module('@bakin/core/hooks/hook-registry-singleton', hookRegistryMock)
mock.module('../../packages/core/src/hooks/hook-registry-singleton', hookRegistryMock)

import { resolveTeamAssignmentForStep } from '../../src/core/dispatch-team'
import { TEAM_ROUTING_BLOCK_REASON, TEAM_ROUTING_EXHAUSTED_REASON } from '../../src/core/dispatch-types'
import { loadDispatchState, saveDispatchState } from '../../src/core/dispatch-state'

let tempDir: string

const args = (overrides: Partial<Parameters<typeof resolveTeamAssignmentForStep>[0]> = {}) => ({
  task: { id: 'parent-1', title: 'Ship the campaign' },
  contextTaskId: 'parent-1',
  stepId: 'route-me',
  stepLabel: 'Routed step',
  teamId: 'builders',
  instructions: 'Do the thing well',
  contentDir: tempDir,
  ...overrides,
})

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'bakin-dispatch-team-step-'))
  paused = false
  hookHasHandler = true
  resolveResult = { ok: true, agentId: 'dev', reason: 'best fit', model: 'inherit' }
  recordResult = { agentId: 'dev', team: 'builders', reason: 'best fit', at: 'now' }
  resolveSpy.mockClear()
  recordSpy.mockClear()
  blockTaskSpy.mockClear()
  addTaskLogSpy.mockClear()
  auditSpy.mockClear()
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('resolveTeamAssignmentForStep', () => {
  it('ok → resolved: persists sticky, logs the step, audits with stepId', async () => {
    const outcome = await resolveTeamAssignmentForStep(args())
    expect(outcome).toEqual({ status: 'resolved', agentId: 'dev' })
    expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'parent-1',
      stepId: 'route-me',
      resolution: { agentId: 'dev', team: 'builders', reason: 'best fit' },
    }))
    expect(auditSpy).toHaveBeenCalledWith(tempDir, 'task.team_resolved', 'system', expect.objectContaining({
      id: 'parent-1', stepId: 'route-me', team: 'builders', agent: 'dev',
    }))
    const logged = addTaskLogSpy.mock.calls.map((c) => String(c[2])).join('\n')
    expect(logged).toContain('Routed step "Routed step" to dev')
  })

  it('router context: step label rides the title, instructions are bounded', async () => {
    await resolveTeamAssignmentForStep(args({ instructions: 'x'.repeat(5000) }))
    const request = resolveSpy.mock.calls[0][0] as { task: { title: string; description?: string } }
    expect(request.task.title).toBe('Ship the campaign — step: Routed step')
    expect(request.task.description!.length).toBeLessThanOrEqual(1500)
  })

  it('a racing resolution wins: the RECORDED pick is authoritative', async () => {
    recordResult = { agentId: 'reviewer', team: 'builders', reason: 'earlier pick', at: 'now' }
    const outcome = await resolveTeamAssignmentForStep(args())
    expect(outcome).toEqual({ status: 'resolved', agentId: 'reviewer' })
  })

  it('instance gone (record returns null) → skipped, nothing dispatched', async () => {
    recordResult = null
    const outcome = await resolveTeamAssignmentForStep(args())
    expect(outcome).toEqual({ status: 'skipped' })
    expect(blockTaskSpy).not.toHaveBeenCalled()
  })

  it('structural → parent task blocked with the sentinel + step detail', async () => {
    resolveResult = { ok: false, kind: 'structural', message: 'Team "builders" has no members present in the runtime roster' }
    const outcome = await resolveTeamAssignmentForStep(args())
    expect(outcome).toEqual({ status: 'blocked' })
    expect(blockTaskSpy).toHaveBeenCalledWith('parent-1', TEAM_ROUTING_BLOCK_REASON)
    expect(auditSpy).toHaveBeenCalledWith(tempDir, 'task.team_resolution_failed', 'system', expect.objectContaining({
      stepId: 'route-me', kind: 'structural',
    }))
    const logged = addTaskLogSpy.mock.calls.map((c) => String(c[2])).join('\n')
    expect(logged).toContain('Team routing failed for step "Routed step"')
  })

  it('transient → skipped + ladder failure recorded under taskId:stepId', async () => {
    resolveResult = { ok: false, kind: 'transient', message: 'rate limited' }
    const outcome = await resolveTeamAssignmentForStep(args())
    expect(outcome).toEqual({ status: 'skipped' })
    expect(blockTaskSpy).not.toHaveBeenCalled()
    const state = loadDispatchState(tempDir)
    expect(state.failedDispatches['parent-1:route-me']?.count).toBe(1)
  })

  it('ladder exhaustion → parent blocked with the EXHAUSTED sentinel, router not billed', async () => {
    const state = loadDispatchState(tempDir)
    state.failedDispatches['parent-1:route-me'] = { count: 3, lastAttempt: Date.now() - 60 * 60 * 1000, kind: 'transient' }
    saveDispatchState(tempDir, state)
    const outcome = await resolveTeamAssignmentForStep(args())
    expect(outcome).toEqual({ status: 'blocked' })
    expect(blockTaskSpy).toHaveBeenCalledWith('parent-1', TEAM_ROUTING_EXHAUSTED_REASON)
    expect(resolveSpy).not.toHaveBeenCalled()
  })

  it('ladder cooldown → skipped without billing the router', async () => {
    const state = loadDispatchState(tempDir)
    state.failedDispatches['parent-1:route-me'] = { count: 1, lastAttempt: Date.now(), kind: 'transient' }
    saveDispatchState(tempDir, state)
    const outcome = await resolveTeamAssignmentForStep(args())
    expect(outcome).toEqual({ status: 'skipped' })
    expect(resolveSpy).not.toHaveBeenCalled()
  })

  it('dispatch paused → skipped quietly: no hook call, no ladder record', async () => {
    paused = true
    const outcome = await resolveTeamAssignmentForStep(args())
    expect(outcome).toEqual({ status: 'skipped' })
    expect(resolveSpy).not.toHaveBeenCalled()
    expect(loadDispatchState(tempDir).failedDispatches['parent-1:route-me']).toBeUndefined()
  })

  it('hook not registered → parent blocked honestly', async () => {
    hookHasHandler = false
    const outcome = await resolveTeamAssignmentForStep(args())
    expect(outcome).toEqual({ status: 'blocked' })
    expect(blockTaskSpy).toHaveBeenCalledWith('parent-1', TEAM_ROUTING_BLOCK_REASON)
  })

  it('throwing hook → transient: skipped + ladder recorded', async () => {
    resolveResult = Promise.reject(new Error('infra down'))
    const outcome = await resolveTeamAssignmentForStep(args())
    expect(outcome).toEqual({ status: 'skipped' })
    expect(loadDispatchState(tempDir).failedDispatches['parent-1:route-me']?.count).toBe(1)
  })

  it('concurrent calls for the same step JOIN one resolution (single bill)', async () => {
    const [a, b] = await Promise.all([
      resolveTeamAssignmentForStep(args()),
      resolveTeamAssignmentForStep(args()),
    ])
    expect(a).toEqual({ status: 'resolved', agentId: 'dev' })
    expect(b).toEqual({ status: 'resolved', agentId: 'dev' })
    expect(resolveSpy).toHaveBeenCalledTimes(1)
  })
})
