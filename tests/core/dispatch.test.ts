import { describe, it, expect, beforeEach, afterEach, mock, spyOn, type Mock } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
// Failure simulations throw what the OpenClaw adapter actually emits: typed
// RuntimeErrors produced by its single provider-string interpreter.
import { openClawRuntimeErrorFromMessage } from '../../packages/adapter-openclaw/src/errors'
import { RuntimeError } from '../../packages/core/src/adapters/runtime'

// Defensive content-dir mock (per CLAUDE.md test isolation rules). The
// dispatch module takes `contentDir` as a parameter so it never calls
// getContentDir() directly, but transitive imports could.
const sentinelContentDir = join(tmpdir(), `bakin-dispatch-test-content-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => sentinelContentDir,
  getBakinPaths: () => ({ root: sentinelContentDir, home: sentinelContentDir, db: join(sentinelContentDir, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => sentinelContentDir,
  getBakinPaths: () => ({ root: sentinelContentDir, home: sentinelContentDir, db: join(sentinelContentDir, 'bakin.db') }),
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../src/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: mock().mockReturnValue({
    dispatch: {
      intervalMs: 1000,
      maxRetries: 3,
      failureCooldownMs: 30 * 60 * 1000,  // 30m — structural
      transientCooldownMs: 60 * 1000,     // 60s — transient
      maxDispatched: 500,
      oversizedOutputBytes: 128 * 1024,
      maxConcurrentTurns: 3,
      maxTurnsPerAgent: 1,
    },
    agents: ['main', 'pixel', 'trainer'],
    watchdog: { stuckThresholdMs: 30 * 60 * 1000 },
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
    { id: 'pixel', name: 'Pixel', status: 'active' },
    { id: 'trainer', name: 'Trainer', status: 'active' },
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
mock.module('../../src/core/app-services-store', () => ({
  getAppServices: () => mockAppServices,
}))
mock.module('@/core/app-services', () => ({
  getAppServices: () => mockAppServices,
}))
mock.module('@/core/app-services-store', () => ({
  getAppServices: () => mockAppServices,
}))

type DispatchTestColumns = {
  backlog: unknown[]
  todo: unknown[]
  inProgress: unknown[]
  review: unknown[]
  done: unknown[]
  archived: unknown[]
  blocked: unknown[]
}

let currentDispatchColumns: DispatchTestColumns = emptyDispatchTestColumns()
const mockStoreBlockTask = mock(async (..._args: unknown[]) => undefined)
const mockStoreAddTaskLog = mock(async (..._args: unknown[]) => undefined)
const mockStoreUpdateTask = mock(async (..._args: unknown[]) => undefined)
const mockStoreMoveTask = mock(async (..._args: unknown[]) => undefined)

function emptyDispatchTestColumns(): DispatchTestColumns {
  return { backlog: [], todo: [], inProgress: [], review: [], done: [], archived: [], blocked: [] }
}

function setDispatchColumns(columns: Partial<DispatchTestColumns>): void {
  currentDispatchColumns = { ...emptyDispatchTestColumns(), ...columns }
}

mock.module('../../src/core/task-store', () => ({
  readTaskboard: mock(() => ({ columns: currentDispatchColumns })),
  addTaskLog: (...args: unknown[]) => mockStoreAddTaskLog(...args),
  updateTask: (...args: unknown[]) => mockStoreUpdateTask(...args),
  moveTask: (...args: unknown[]) => mockStoreMoveTask(...args),
  blockTask: (...args: unknown[]) => mockStoreBlockTask(...args),
}))
mock.module('@/core/task-store', () => ({
  readTaskboard: mock(() => ({ columns: currentDispatchColumns })),
  addTaskLog: (...args: unknown[]) => mockStoreAddTaskLog(...args),
  updateTask: (...args: unknown[]) => mockStoreUpdateTask(...args),
  moveTask: (...args: unknown[]) => mockStoreMoveTask(...args),
  blockTask: (...args: unknown[]) => mockStoreBlockTask(...args),
}))

mock.module('../../src/core/plugin-registry', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock().mockResolvedValue(undefined),
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock().mockResolvedValue(undefined),
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
}))

mock.module('../../src/lib/format', () => ({
  isStale: mock().mockReturnValue(true),
}))

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => sentinelContentDir,
  getOpenClawPath: (sub: string) => join(sentinelContentDir, sub),
}))

import { loadDispatchState, start, stop, getDispatchInfo, isTaskDispatchEligible } from '../../src/core/dispatch'
import { dispatchTasks, awaitDispatchIdle } from '../../src/core/dispatch'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import type { HookRegistry } from '../../packages/core/src/hooks/hook-registry'

describe('dispatch', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-dispatch-'))
    vi.useFakeTimers()
    setDispatchColumns({})
    mockStoreBlockTask.mockClear()
    mockStoreAddTaskLog.mockClear()
    mockStoreUpdateTask.mockClear()
    mockStoreMoveTask.mockClear()
  })

  afterEach(() => {
    stop()
    vi.useRealTimers()
    rmSync(tempDir, { recursive: true, force: true })
    mock.restore()
  })

  // -------------------------------------------------------------------------
  // isTaskDispatchEligible
  // -------------------------------------------------------------------------

  describe('isTaskDispatchEligible', () => {
    const nowMs = Date.parse('2026-05-12T12:00:00.000Z')
    const runtimeAgentIds = new Set(['main', 'pixel'])
    const completedTaskIds = new Set(['done-task'])

    it('skips tasks whose availableAt is in the future', () => {
      expect(isTaskDispatchEligible(
        { id: 'future', title: 'Future task', availableAt: '2026-05-12T13:00:00.000Z' },
        { nowMs, runtimeAgentIds, completedTaskIds },
      )).toEqual({ eligible: false, reason: 'scheduled' })
    })

    it('allows tasks once availableAt has passed', () => {
      expect(isTaskDispatchEligible(
        { id: 'ready', title: 'Ready task', availableAt: '2026-05-12T11:59:00.000Z' },
        { nowMs, runtimeAgentIds, completedTaskIds },
      )).toEqual({ eligible: true })
    })

    it('skips tasks whose dependency is not complete', () => {
      expect(isTaskDispatchEligible(
        { id: 'blocked', title: 'Blocked task', dependsOn: 'other-task' },
        { nowMs, runtimeAgentIds, completedTaskIds },
      )).toEqual({ eligible: false, reason: 'dependency' })
    })

    it('allows tasks whose dependency is complete', () => {
      expect(isTaskDispatchEligible(
        { id: 'unblocked', title: 'Unblocked task', dependsOn: 'done-task' },
        { nowMs, runtimeAgentIds, completedTaskIds },
      )).toEqual({ eligible: true })
    })

    it('skips tasks assigned to missing agents', () => {
      expect(isTaskDispatchEligible(
        { id: 'missing-agent', title: 'Missing agent task', agent: 'ghost' },
        { nowMs, runtimeAgentIds, completedTaskIds },
      )).toEqual({ eligible: false, reason: 'agent' })
    })

    it('treats a dependency on a hard-deleted task as satisfied (stranding guard)', () => {
      // archiveOldTasks removes old task files entirely — a dependent must
      // not strand forever waiting on an id that no longer exists anywhere.
      const knownTaskIds = new Set(['some-live-task'])
      expect(isTaskDispatchEligible(
        { id: 'stranded', title: 'Stranded task', dependsOn: 'vanished-task' },
        { nowMs, runtimeAgentIds, completedTaskIds, knownTaskIds },
      )).toEqual({ eligible: true, danglingDependency: 'vanished-task' })
    })

    it('still gates on a dependency that exists but is not complete', () => {
      const knownTaskIds = new Set(['other-task'])
      expect(isTaskDispatchEligible(
        { id: 'gated', title: 'Gated task', dependsOn: 'other-task' },
        { nowMs, runtimeAgentIds, completedTaskIds, knownTaskIds },
      )).toEqual({ eligible: false, reason: 'dependency' })
    })

    it('without knownTaskIds context the legacy gating is unchanged', () => {
      expect(isTaskDispatchEligible(
        { id: 'legacy', title: 'Legacy gate', dependsOn: 'other-task' },
        { nowMs, runtimeAgentIds, completedTaskIds },
      )).toEqual({ eligible: false, reason: 'dependency' })
    })
  })

  // -------------------------------------------------------------------------
  // loadDispatchState
  // -------------------------------------------------------------------------

  describe('loadDispatchState', () => {
    it('returns default state when no file exists', () => {
      const state = loadDispatchState(tempDir)
      expect(state.lastRun).toBeNull()
      expect(state.dispatched).toEqual([])
      expect(state.failedDispatches).toEqual({})
      expect(state.serverStart).toBeGreaterThan(0)
    })

    it('reads existing state file', () => {
      const stateFile = join(tempDir, '.dispatch-state.json')
      writeFileSync(stateFile, JSON.stringify({
        lastRun: 1000,
        serverStart: 500,
        dispatched: ['t1', 't2'],
        failedDispatches: { t3: { lastAttempt: 900, count: 2, kind: 'structural' } },
      }))

      const state = loadDispatchState(tempDir)
      expect(state.lastRun).toBe(1000)
      expect(state.dispatched).toEqual(['t1', 't2'])
      expect(state.failedDispatches.t3).toEqual({ lastAttempt: 900, count: 2, kind: 'structural' })
    })

    it('handles corrupted state file gracefully', () => {
      writeFileSync(join(tempDir, '.dispatch-state.json'), '{ broken')
      const state = loadDispatchState(tempDir)
      expect(state.lastRun).toBeNull()
      expect(state.dispatched).toEqual([])
    })

    it('normalizes missing dispatched array', () => {
      writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify({
        lastRun: 1000,
        serverStart: 500,
      }))

      const state = loadDispatchState(tempDir)
      expect(state.dispatched).toEqual([])
    })
  })

  // -------------------------------------------------------------------------
  // start / stop
  // -------------------------------------------------------------------------

  describe('start and stop', () => {
    it('starts dispatch timer', () => {
      start(tempDir, 3737)
      expect(() => vi.advanceTimersByTime(500)).not.toThrow()
    })

    it('stop clears the timer', () => {
      start(tempDir, 3737)
      stop()
      expect(() => stop()).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // getDispatchInfo
  // -------------------------------------------------------------------------

  describe('getDispatchInfo', () => {
    it('returns dispatch info with no prior state', () => {
      const info = getDispatchInfo(tempDir)
      expect(info.intervalMs).toBe(1000)
      expect(info.lastRun).toBeNull()
      expect(info.dispatchedCount).toBe(0)
      expect(info.secondsUntilNext).toBeGreaterThanOrEqual(0)
    })

    it('includes last run when state exists', () => {
      const now = Date.now()
      writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify({
        lastRun: now - 500,
        serverStart: now - 10000,
        dispatched: ['t1'],
        failedDispatches: {},
      }))

      const info = getDispatchInfo(tempDir)
      expect(info.lastRun).not.toBeNull()
      expect(info.dispatchedCount).toBe(1)
    })

    it('calculates next run in the future', () => {
      const now = Date.now()
      writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify({
        lastRun: now - 5000, // 5 seconds ago, interval is 1s
        serverStart: now - 10000,
        dispatched: [],
        failedDispatches: {},
      }))

      const info = getDispatchInfo(tempDir)
      // secondsUntilNext should be > 0 (next tick in the future)
      expect(info.secondsUntilNext).toBeGreaterThanOrEqual(0)
    })
  })

  // -------------------------------------------------------------------------
  // failure classification + cooldown (issue #115)
  // -------------------------------------------------------------------------

  describe('failure classification and cooldown', () => {
    type DispatchTaskShape = { id: string; title: string; agent?: string; log?: Array<{ timestamp: string; message?: string }> }
    type ColumnsShape = { todo: DispatchTaskShape[]; inProgress: DispatchTaskShape[]; done: DispatchTaskShape[]; archived: DispatchTaskShape[] }

    function setupTodoTask(
      task: { id: string; title: string; agent?: string },
      initialState?: Partial<{ failedDispatches: Record<string, unknown>; dispatched: string[]; lastRun: number; serverStart: number }>,
    ): void {
      const stateFile = join(tempDir, '.dispatch-state.json')
      if (initialState) {
        writeFileSync(stateFile, JSON.stringify({
          lastRun: initialState.lastRun ?? Date.now(),
          serverStart: initialState.serverStart ?? Date.now(),
          dispatched: initialState.dispatched ?? [],
          failedDispatches: initialState.failedDispatches ?? {},
        }))
      }

      const columns: ColumnsShape = { todo: [task], inProgress: [], done: [], archived: [] }
      setDispatchColumns(columns)

      const invoke = mock(async (hook: string) => {
        if (hook === 'workflows.getActiveAgents') return []
        return undefined
      })
      vi.mocked(getHookRegistry).mockReturnValue({
        invoke,
        has: mock().mockReturnValue(false),
        register: mock(),
      } as unknown as HookRegistry)
    }

    function readState() {
      return JSON.parse(readFileSync(join(tempDir, '.dispatch-state.json'), 'utf-8'))
    }

    beforeEach(() => {
      vi.useRealTimers()  // these tests don't need fake timers; cooldown checks use Date.now arithmetic
    })

    afterEach(() => {
      // Reset mocks to a clean state so later test suites don't inherit
      // accumulated sendMessage call records. `vi.restoreAllMocks` in the
      // parent afterEach restores spies but not `mock()` mocks from factories.
      mockRuntimeSend.mockClear()
      mockRuntimeSend.mockResolvedValue({ id: 'runtime-msg' })
    })

    it('records kind="transient" on TypeError("fetch failed") and expires after transientCooldownMs', async () => {
      setupTodoTask({ id: 't-transient', title: 'Transient-failing task' })
      mockRuntimeSend.mockRejectedValueOnce(new TypeError('fetch failed'))

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      const state1 = readState()
      expect(state1.failedDispatches['t-transient']).toBeDefined()
      expect(state1.failedDispatches['t-transient'].kind).toBe('transient')
      expect(state1.failedDispatches['t-transient'].count).toBe(1)

      // 30s later — still inside 60s transient cooldown → skipped
      state1.failedDispatches['t-transient'].lastAttempt = Date.now() - 30_000
      writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify(state1))
      mockRuntimeSend.mockClear()
      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()
      expect(mockRuntimeSend).not.toHaveBeenCalled()

      // 65s later — cooldown expired → retried
      const state2 = readState()
      state2.failedDispatches['t-transient'].lastAttempt = Date.now() - 65_000
      writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify(state2))
      mockRuntimeSend.mockResolvedValueOnce({ id: 'runtime-msg' })
      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()
      expect(mockRuntimeSend).toHaveBeenCalledTimes(1)
    })

    it('records kind="structural" on 5xx error and does NOT expire after transientCooldownMs', async () => {
      setupTodoTask({ id: 't-structural', title: 'Structural-failing task' })
      mockRuntimeSend.mockRejectedValueOnce(
        new Error('Runtime adapter send failed (500): upstream boom'),
      )

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      const state1 = readState()
      expect(state1.failedDispatches['t-structural'].kind).toBe('structural')

      // 5 minutes later — past transient cooldown (60s) but inside structural (30m) → still skipped
      state1.failedDispatches['t-structural'].lastAttempt = Date.now() - 5 * 60_000
      writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify(state1))
      mockRuntimeSend.mockClear()
      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()
      expect(mockRuntimeSend).not.toHaveBeenCalled()
    })

    it('escalates to blocked after maxRetries cumulative failures', async () => {
      const columns: ColumnsShape = {
        todo: [{ id: 't-exhausted', title: 'About to exhaust' }],
        inProgress: [], done: [], archived: [],
      }
      setDispatchColumns(columns)
      const invoke = mock(async (hook: string) => {
        if (hook === 'workflows.getActiveAgents') return []
        return undefined
      })
      vi.mocked(getHookRegistry).mockReturnValue({
        invoke,
        has: mock().mockReturnValue(false),
        register: mock(),
      } as unknown as HookRegistry)
      // Seed state already at maxRetries (3 in the test settings mock)
      writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify({
        lastRun: Date.now(),
        serverStart: Date.now(),
        dispatched: [],
        failedDispatches: {
          't-exhausted': { lastAttempt: Date.now() - 1_000_000, count: 3, kind: 'transient' },
        },
      }))

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()
      expect(mockStoreBlockTask).toHaveBeenCalledTimes(1)
      expect(mockRuntimeSend).not.toHaveBeenCalled()
    })

    it('audit event carries the classified kind', async () => {
      const { appendAudit } = require('../../src/core/audit') as typeof import('../../src/core/audit')
      vi.mocked(appendAudit).mockClear()

      setupTodoTask({ id: 't-audit', title: 'Audit carries kind' })
      mockRuntimeSend.mockRejectedValueOnce(new TypeError('fetch failed'))

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      const dispatchFailed = vi.mocked(appendAudit).mock.calls.find((c: any[]) => c[1] === 'task.dispatch_failed')
      expect(dispatchFailed).toBeDefined()
      expect((dispatchFailed?.[3] as { kind: string }).kind).toBe('transient')
    })

    it('records provider cooldown details in audit and task log data', async () => {
      const { appendAudit } = require('../../src/core/audit') as typeof import('../../src/core/audit')
      vi.mocked(appendAudit).mockClear()
      mockStoreAddTaskLog.mockClear()

      setupTodoTask({ id: 't-provider-cooldown', title: 'Provider cooldown task', agent: 'main' })
      mockRuntimeSend.mockRejectedValueOnce(
        openClawRuntimeErrorFromMessage('FallbackSummaryError: All models failed (1): openai-codex/gpt-5.5: Provider openai-codex is in cooldown (suspending lanes) (timeout); code=UNAVAILABLE'),
      )

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      const dispatchFailed = vi.mocked(appendAudit).mock.calls.find((c: any[]) => c[1] === 'task.dispatch_failed')
      expect(dispatchFailed).toBeDefined()
      expect(dispatchFailed?.[3]).toMatchObject({
        reasonCode: 'provider_cooldown',
        provider: 'openai-codex',
        model: 'openai-codex/gpt-5.5',
        retryable: true,
      })
      expect((dispatchFailed?.[3] as { rawError?: string }).rawError).toContain('Provider openai-codex is in cooldown')

      expect(mockStoreAddTaskLog).toHaveBeenCalledWith(
        't-provider-cooldown',
        'system',
        expect.stringContaining('model provider unavailable'),
        expect.objectContaining({
          dispatchFailure: expect.objectContaining({
            reasonCode: 'provider_cooldown',
            provider: 'openai-codex',
            model: 'openai-codex/gpt-5.5',
            retryable: true,
          }),
        }),
      )
    })

    it('records auth profile availability details in audit and task log data', async () => {
      const { appendAudit } = require('../../src/core/audit') as typeof import('../../src/core/audit')
      vi.mocked(appendAudit).mockClear()
      mockStoreAddTaskLog.mockClear()

      setupTodoTask({ id: 't-auth-profile', title: 'Auth profile task', agent: 'main' })
      mockRuntimeSend.mockRejectedValueOnce(
        openClawRuntimeErrorFromMessage('Error: No available auth profile for openai-codex (all in cooldown or unavailable).; code=UNAVAILABLE'),
      )

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      const dispatchFailed = vi.mocked(appendAudit).mock.calls.find((c: any[]) => c[1] === 'task.dispatch_failed')
      expect(dispatchFailed).toBeDefined()
      expect(dispatchFailed?.[3]).toMatchObject({
        reasonCode: 'auth_profile_unavailable',
        provider: 'openai-codex',
        retryable: true,
      })
      expect((dispatchFailed?.[3] as { rawError?: string }).rawError).toContain('No available auth profile for openai-codex')

      expect(mockStoreAddTaskLog).toHaveBeenCalledWith(
        't-auth-profile',
        'system',
        expect.stringContaining('model provider unavailable'),
        expect.objectContaining({
          dispatchFailure: expect.objectContaining({
            reasonCode: 'auth_profile_unavailable',
            provider: 'openai-codex',
            retryable: true,
          }),
        }),
      )
    })

    it('classifies AbortError as transient', async () => {
      setupTodoTask({ id: 't-abort', title: 'AbortError task' })
      const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
      mockRuntimeSend.mockRejectedValueOnce(abortErr)

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      const state = readState()
      expect(state.failedDispatches['t-abort'].kind).toBe('transient')
    })

    it('defaults to structural for unrecognized errors (safe side)', async () => {
      setupTodoTask({ id: 't-unknown', title: 'Weird error task' })
      mockRuntimeSend.mockRejectedValueOnce(new Error('something entirely unexpected'))

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      const state = readState()
      expect(state.failedDispatches['t-unknown'].kind).toBe('structural')
    })

    it('workflow dispatch failure writes FailureRecord shape', async () => {
      const columns = {
        todo: [{ id: 'wf-fail', title: 'Failing workflow task', workflowId: 'img-flow', agent: 'pixel' }],
        inProgress: [], done: [], archived: [],
      }
      setDispatchColumns(columns)
      const invoke = mock(async (hook: string) => {
        if (hook === 'workflows.loadInstance') return null
        if (hook === 'workflows.createInstance') return { id: 'inst-1' }
        if (hook === 'workflows.getActiveAgents') return [{ agent: 'pixel', stepId: 'step-generate' }]
        if (hook === 'workflows.getCurrentStep') {
          return { stepId: 'step-generate', label: 'Generate', instructions: 'make it', output_schema: {} }
        }
        return undefined
      })
      vi.mocked(getHookRegistry).mockReturnValue({
        invoke,
        has: mock().mockReturnValue(false),
        register: mock(),
      } as unknown as HookRegistry)
      // The workflow branch calls sendMessage inside dispatchWorkflowTask; make it throw transiently.
      mockRuntimeSend.mockRejectedValueOnce(new TypeError('fetch failed'))

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      const state = readState()
      const record = state.failedDispatches['wf-fail']
      expect(record).toBeDefined()
      expect(typeof record).toBe('object')                  // not the legacy plain number
      expect(record.kind).toBe('transient')
      expect(record.count).toBe(1)
      expect(typeof record.lastAttempt).toBe('number')
    })

    it('routes an idle-timeout turn death into the recovery ladder instead of blocking immediately', async () => {
      // Pre-P10 behavior blocked on the first idle-timeout death. The ladder
      // supersedes that: death 1 → corrective re-dispatch (deterministic
      // failures get a changed approach, not a parked task). Full ladder
      // coverage lives in dispatch-session-death.test.ts.
      const task = { id: 't-idle-timeout', title: 'Terminal timeout task', agent: 'pixel', log: [] }
      setupTodoTask(task)
      mockRuntimeSend.mockImplementationOnce(async () => {
        setDispatchColumns({
          todo: [],
          inProgress: [{
            ...task,
            log: [
              { timestamp: new Date().toISOString(), message: 'Started work' },
            ],
          }],
          done: [],
          archived: [],
        })
        throw openClawRuntimeErrorFromMessage('codex app-server turn idle timed out waiting for turn/completed')
      })

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      expect(mockStoreBlockTask).not.toHaveBeenCalled()
      // Bounced back to todo for the corrective attempt.
      expect(mockStoreMoveTask).toHaveBeenCalledWith('t-idle-timeout', 'todo', 'inProgress')
      const state = readState()
      expect(state.failedDispatches['t-idle-timeout']?.sessionDeath).toMatchObject({
        stage: 'corrective',
        deaths: 1,
      })
      expect(state.dispatched).not.toContain('t-idle-timeout')
    })

    it('does not mutate or log dispatch failure when a late runtime error arrives after task completion', async () => {
      const task = { id: 't-completed-before-timeout', title: 'Completed before timeout', agent: 'pixel', log: [] }
      setupTodoTask(task)
      mockRuntimeSend.mockImplementationOnce(async () => {
        setDispatchColumns({
          todo: [],
          inProgress: [],
          done: [{
            ...task,
            log: [
              { timestamp: new Date().toISOString(), message: 'Task complete' },
            ],
          }],
          archived: [],
        })
        throw new RuntimeError('OpenClaw chat gateway request timed out: agent', { kind: 'timeout' })
      })

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      expect(mockStoreBlockTask).not.toHaveBeenCalled()
      expect(mockStoreMoveTask).not.toHaveBeenCalled()
      expect(mockStoreAddTaskLog).not.toHaveBeenCalledWith(
        't-completed-before-timeout',
        'system',
        expect.stringContaining('Dispatch failed'),
      )
      const state = readState()
      expect(state.failedDispatches['t-completed-before-timeout']).toBeUndefined()
      expect(state.dispatched).not.toContain('t-completed-before-timeout')
    })
  })

  describe('per-dispatch sessions (threadId d<seq>)', () => {
    type ColumnsShape = { todo: Array<{ id: string; title: string; agent?: string }>; inProgress: never[]; done: never[]; archived: never[] }

    function setupTask(task: { id: string; title: string; agent?: string }): void {
      const columns: ColumnsShape = { todo: [task], inProgress: [], done: [], archived: [] }
      setDispatchColumns(columns)
      const invoke = mock(async (hook: string) => {
        if (hook === 'workflows.getActiveAgents') return []
        return undefined
      })
      vi.mocked(getHookRegistry).mockReturnValue({
        invoke,
        has: mock().mockReturnValue(false),
        register: mock(),
      } as unknown as HookRegistry)
    }

    function readState() {
      return JSON.parse(readFileSync(join(tempDir, '.dispatch-state.json'), 'utf-8'))
    }

    afterEach(() => {
      mockRuntimeSend.mockClear()
      mockRuntimeSend.mockImplementation((...args: unknown[]) => {
        void args
        return Promise.resolve({ id: 'runtime-msg' })
      })
    })

    it('passes a per-attempt threadId + oversized threshold and persists the monotonic seq', async () => {
      setupTask({ id: 't-thread', title: 'Threaded task', agent: 'pixel' })

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      expect(mockRuntimeSend).toHaveBeenCalledTimes(1)
      const args = mockRuntimeSend.mock.calls[0]?.[0] as Record<string, unknown>
      expect(args.threadId).toBe('task:t-thread:d1')
      // Typed contract field (T29) — core policy never rides the metadata bag.
      expect(args.oversizedOutputBytes).toBeGreaterThan(0)
      expect(args.metadata).toBeUndefined()
      // Seq ownership moved to the execution ledger (run rows + watermarks).
      const { currentSeq } = require('../../src/core/execution-ledger') as typeof import('../../src/core/execution-ledger')
      expect(currentSeq('t-thread')).toBe(1)
    })

    it('seq survives success: a later re-dispatch of the same task gets a FRESH session key', async () => {
      setupTask({ id: 't-again', title: 'Comes back later', agent: 'pixel' })
      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()
      expect((mockRuntimeSend.mock.calls[0]?.[0] as Record<string, unknown>).threadId).toBe('task:t-again:d1')

      // Task completed, then returns to todo (e.g. dependency continuation).
      // Failure count is empty — the OLD attempt-derived scheme would mint
      // d1 again and resume the stale session.
      const state = readState()
      state.dispatched = []
      writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify(state))
      setupTask({ id: 't-again', title: 'Comes back later', agent: 'pixel' })

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      const second = mockRuntimeSend.mock.calls[1]?.[0] as Record<string, unknown>
      expect(second.threadId).toBe('task:t-again:d2')
    })

    it('workflow step dispatches scope the threadId by stepId', async () => {
      const columns = {
        todo: [{ id: 'wf-thread', title: 'Workflow task', workflowId: 'flow-1', agent: 'pixel' }],
        inProgress: [], done: [], archived: [],
      }
      setDispatchColumns(columns)
      const invoke = mock(async (hook: string) => {
        if (hook === 'workflows.loadInstance') return { id: 'inst-1' }
        if (hook === 'workflows.getActiveAgents') return [{ agent: 'pixel', stepId: 'step-generate' }]
        if (hook === 'workflows.getCurrentStep') {
          return { stepId: 'step-generate', label: 'Generate', instructions: 'make it', output_schema: {} }
        }
        return undefined
      })
      vi.mocked(getHookRegistry).mockReturnValue({
        invoke,
        has: mock().mockReturnValue(false),
        register: mock(),
      } as unknown as HookRegistry)

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      const args = mockRuntimeSend.mock.calls[0]?.[0] as Record<string, unknown>
      expect(args.threadId).toBe('task:wf-thread:step:step-generate:d1')
    })

    it('writes dispatch state exactly once per cycle, before any turn fires', async () => {
      const fs = await import('fs')
      const events: string[] = []
      const originalWrite = fs.writeFileSync
      const writeSpy = spyOn(fs, 'writeFileSync').mockImplementation(((...args: Parameters<typeof fs.writeFileSync>) => {
        if (String(args[0]).includes('.dispatch-state.json')) events.push('save')
        return originalWrite.apply(fs, args)
      }) as typeof fs.writeFileSync)
      mockRuntimeSend.mockImplementation((...args: unknown[]) => {
        void args
        events.push('send')
        return Promise.resolve({ id: 'runtime-msg' })
      })

      // Distinct agents (the mock runtime roster has main + pixel) —
      // maxTurnsPerAgent is 1 and collected-but-unfired turns reserve slots.
      const columns = {
        todo: [
          { id: 't-batch-1', title: 'Batch one', agent: 'pixel' },
          { id: 't-batch-2', title: 'Batch two', agent: 'main' },
        ],
        inProgress: [], done: [], archived: [],
      }
      setDispatchColumns(columns)
      const invoke = mock(async (hook: string) => {
        if (hook === 'workflows.getActiveAgents') return []
        return undefined
      })
      vi.mocked(getHookRegistry).mockReturnValue({
        invoke,
        has: mock().mockReturnValue(false),
        register: mock(),
      } as unknown as HookRegistry)

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      writeSpy.mockRestore()

      const saves = events.filter((e) => e === 'save')
      const sends = events.filter((e) => e === 'send')
      expect(sends).toHaveLength(2)
      // One state write for the whole cycle — not one per minted threadId
      // (the old per-mint behavior would write 3 times here).
      expect(saves).toHaveLength(1)
      // Persist-before-send: the save precedes every turn fire.
      expect(events.indexOf('save')).toBeLessThan(events.indexOf('send'))

      // Seq durability moved to the ledger: both claims are on disk there
      // (persist-before-send now means "run row inserted before send").
      const { currentSeq } = require('../../src/core/execution-ledger') as typeof import('../../src/core/execution-ledger')
      expect(currentSeq('t-batch-1')).toBe(1)
      expect(currentSeq('t-batch-2')).toBe(1)
    })

    it('audits exactly one row per dispatch: task.dispatched with from/to, no task.moved', async () => {
      const { appendAudit } = require('../../src/core/audit') as typeof import('../../src/core/audit')
      vi.mocked(appendAudit).mockClear()
      setupTask({ id: 't-audit-one', title: 'Single audit row', agent: 'pixel' })

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      const calls = vi.mocked(appendAudit).mock.calls as unknown as Array<[string, string, string, Record<string, unknown>]>
      const moved = calls.filter((c) => c[1] === 'task.moved')
      const dispatched = calls.filter((c) => c[1] === 'task.dispatched')
      expect(moved).toHaveLength(0)
      expect(dispatched).toHaveLength(1)
      // The fold preserves the transition info on the dispatched row.
      expect(dispatched[0]?.[3]).toMatchObject({ id: 't-audit-one', from: 'todo', to: 'inProgress' })
    })

    it('records a run_costs row from the turn usage + priceTurn hook on settle', async () => {
      const { listRunCostsSince } = require('../../src/core/execution-ledger') as typeof import('../../src/core/execution-ledger')
      setDispatchColumns({ todo: [{ id: 't-cost', title: 'Costed task', agent: 'pixel' }] })
      vi.mocked(getHookRegistry).mockReturnValue({
        invoke: mock(async (hook: string) => {
          if (hook === 'models.priceTurn') return { model: 'anthropic/claude-sonnet-4-6', costUsdMicros: 123_456 }
          return undefined
        }),
        has: mock().mockReturnValue(false),
        register: mock(),
      } as unknown as HookRegistry)
      mockRuntimeSend.mockResolvedValueOnce({ id: 'm', usage: { input: 1000, output: 200, total: 1200 } } as never)

      const t0 = Date.now()
      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      // run_id == threadId; scoped by t0 so prior tests' rows don't bleed in.
      const costed = listRunCostsSince(t0).filter((r) => r.agent === 'pixel')
      expect(costed).toHaveLength(1)
      expect(costed[0]).toMatchObject({ costUsdMicros: 123_456 })
    })

    it('records an unmetered run_costs row (zero dollars) when the turn reports no usage', async () => {
      const { listRunCostsSince } = require('../../src/core/execution-ledger') as typeof import('../../src/core/execution-ledger')
      setDispatchColumns({ todo: [{ id: 't-unmetered', title: 'Unmetered task', agent: 'trainer' }] })
      vi.mocked(getHookRegistry).mockReturnValue({
        invoke: mock(async () => undefined), // no priceTurn handler → null model/cost
        has: mock().mockReturnValue(false),
        register: mock(),
      } as unknown as HookRegistry)
      mockRuntimeSend.mockResolvedValueOnce({ id: 'm' }) // no usage

      const t0 = Date.now()
      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      const trainer = listRunCostsSince(t0).filter((r) => r.agent === 'trainer')
      expect(trainer).toHaveLength(1)
      expect(trainer[0]).toMatchObject({ costUsdMicros: null }) // honest null, never $0
    })

    it('applies the resolved routing model/thinking to the turn (work-class route)', async () => {
      setDispatchColumns({ todo: [{ id: 't-routed', title: 'Scheduled task', agent: 'pixel', scheduleJobId: 'job-1' }] })
      vi.mocked(getHookRegistry).mockReturnValue({
        invoke: mock(async (hook: string) => {
          if (hook === 'models.getRoutingConfig') {
            return { routes: [{ workClass: 'scheduled', model: 'anthropic/claude-haiku-4-5', thinking: 'low' }], tagOverrides: [] }
          }
          return undefined
        }),
        has: mock().mockReturnValue(false),
        register: mock(),
      } as unknown as HookRegistry)

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      const args = mockRuntimeSend.mock.calls[0]?.[0] as Record<string, unknown>
      expect(args.model).toBe('anthropic/claude-haiku-4-5')
      expect(args.thinking).toBe('low')

      // Route receipt on the cost row: class + source recorded at metering.
      const { listRunCostsSince } = require('../../src/core/execution-ledger') as typeof import('../../src/core/execution-ledger')
      const row = listRunCostsSince(0).find((r) => r.runId.startsWith('task:t-routed:'))
      expect(row).toMatchObject({ workClass: 'scheduled', routeSource: 'class' })
    })

    it('defers dispatch when a budget cap is exceeded (task stays in todo, no send)', async () => {
      // Seed >$1 of spend "today" for the agent so a $1 daily cap is exceeded.
      const { recordRunCost } = require('../../src/core/execution-ledger') as typeof import('../../src/core/execution-ledger')
      recordRunCost({ workClass: null, runId: 'seed:budget:d1', taskId: 'seed-b', agent: 'pixel', model: 'm', inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsdMicros: 2_000_000, occurredAt: Date.now() })
      setDispatchColumns({ todo: [{ id: 't-budget', title: 'Over budget', agent: 'pixel' }] })
      vi.mocked(getHookRegistry).mockReturnValue({
        invoke: mock(async (hook: string) => {
          if (hook === 'models.getBudgetPolicy') return { rules: [{ scope: 'global', lane: 'metered', dailyCap: 1 }] }
          return undefined
        }),
        has: mock().mockReturnValue(false),
        register: mock(),
      } as unknown as HookRegistry)

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      // The TASK must not dispatch (no send carrying a task: threadId). The
      // breach itself sends ONE budget-alert relay to the main agent
      // (budget-notify) — that is intended, not a dispatch.
      const dispatchSends = mockRuntimeSend.mock.calls.filter(
        (c) => typeof (c[0] as { threadId?: string })?.threadId === 'string',
      )
      expect(dispatchSends).toHaveLength(0)
    })

    it('regression: no budget policy → dispatch proceeds normally', async () => {
      setDispatchColumns({ todo: [{ id: 't-nobudget', title: 'No cap', agent: 'pixel' }] })
      vi.mocked(getHookRegistry).mockReturnValue({
        invoke: mock(async (hook: string) => (hook === 'models.getBudgetPolicy' ? {} : undefined)),
        has: mock().mockReturnValue(false),
        register: mock(),
      } as unknown as HookRegistry)

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      expect(mockRuntimeSend).toHaveBeenCalledTimes(1)
    })

    it('routes a session-death recovery re-dispatch on the MAIN cycle to the recovery origin', async () => {
      // A task with a persisted sessionDeath record re-dispatched via the
      // normal cycle (ladder timer lost / budget-deferred) must still route
      // to 'recovery' — not its task-shape origin.
      setDispatchColumns({ todo: [{ id: 't-recover', title: 'Died once', agent: 'pixel' }] })
      writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify({
        lastRun: Date.now(),
        dispatched: [],
        failedDispatches: {
          't-recover': { count: 1, lastAttempt: Date.now(), kind: 'structural', sessionDeath: { stage: 'corrective', deaths: 1, lastDiagnosis: { reason: 'session_interrupted' }, salvagedAssetIds: [] } },
        },
      }))
      vi.mocked(getHookRegistry).mockReturnValue({
        invoke: mock(async (hook: string) => {
          if (hook === 'models.getRoutingConfig') return { routes: [{ workClass: 'recovery', model: 'anthropic/claude-opus-4-6' }], tagOverrides: [] }
          return undefined
        }),
        has: mock().mockReturnValue(false),
        register: mock(),
      } as unknown as HookRegistry)

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      const args = mockRuntimeSend.mock.calls[0]?.[0] as Record<string, unknown>
      expect(args?.model).toBe('anthropic/claude-opus-4-6')
    })

    it('regression: empty routing config leaves the turn with no model/thinking (inherit)', async () => {
      setDispatchColumns({ todo: [{ id: 't-inherit', title: 'Adhoc task', agent: 'pixel' }] })
      vi.mocked(getHookRegistry).mockReturnValue({
        invoke: mock(async (hook: string) => (hook === 'models.getRoutingConfig' ? { routes: [], tagOverrides: [] } : undefined)),
        has: mock().mockReturnValue(false),
        register: mock(),
      } as unknown as HookRegistry)

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      const args = mockRuntimeSend.mock.calls[0]?.[0] as Record<string, unknown>
      expect(args).not.toHaveProperty('model')
      expect(args).not.toHaveProperty('thinking')
    })
  })

  describe('workflow re-dispatch guard', () => {
    it('preserves workflow step dispatch markers for active in-progress tasks', async () => {
      writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify({
        lastRun: Date.now(),
        serverStart: Date.now(),
        dispatched: ['wf-1', 'wf-1:step-generate'],
        failedDispatches: {},
      }))

      setDispatchColumns({
        todo: [],
        inProgress: [{ id: 'wf-1', title: 'Generate image', workflowId: 'image-flow', agent: 'pixel' }],
        done: [],
        archived: [],
      })
      const invoke = mock(async (hook: string) => {
        if (hook === 'workflows.getActiveAgents') {
          return [{ agent: 'pixel', stepId: 'step-generate' }]
        }
        return undefined
      })

      vi.mocked(getHookRegistry).mockReturnValue({
        invoke,
        has: mock().mockReturnValue(false),
        register: mock(),
      } as unknown as HookRegistry)

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      expect(mockRuntimeSend).not.toHaveBeenCalled()

      const state = JSON.parse(readFileSync(join(tempDir, '.dispatch-state.json'), 'utf-8'))
      expect(state.dispatched).toContain('wf-1:step-generate')
    })

    it('drops dispatch markers for completed tasks during reconciliation', async () => {
      writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify({
        lastRun: Date.now(),
        serverStart: Date.now(),
        dispatched: ['done-1', 'active-1'],
        failedDispatches: {
          'done-1': { lastAttempt: Date.now() - 1000, count: 1, kind: 'structural' },
        },
      }))

      setDispatchColumns({
        todo: [],
        inProgress: [{ id: 'active-1', title: 'Still running', agent: 'pixel' }],
        done: [{ id: 'done-1', title: 'Already done', agent: 'pixel' }],
        archived: [],
      })

      await dispatchTasks(tempDir, 3737)
      await awaitDispatchIdle()

      const state = JSON.parse(readFileSync(join(tempDir, '.dispatch-state.json'), 'utf-8'))
      expect(state.dispatched).toEqual(['active-1'])
      expect(state.failedDispatches['done-1']).toBeUndefined()
    })
  })
})
