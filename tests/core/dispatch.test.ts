import { describe, it, expect, beforeEach, afterEach, mock, type Mock } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Defensive content-dir mock (per CLAUDE.md test isolation rules). The
// dispatch module takes `contentDir` as a parameter so it never calls
// getContentDir() directly, but transitive imports could.
const sentinelContentDir = join(tmpdir(), `bakin-dispatch-test-content-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => sentinelContentDir,
  getBakinPaths: () => ({ root: sentinelContentDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => sentinelContentDir,
  getBakinPaths: () => ({ root: sentinelContentDir }),
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
  getSettings: mock().mockReturnValue({
    dispatch: {
      intervalMs: 1000,
      maxRetries: 3,
      failureCooldownMs: 30 * 60 * 1000,  // 30m — structural
      transientCooldownMs: 60 * 1000,     // 60s — transient
      maxDispatched: 500,
    },
    agents: ['main', 'pixel', 'nemo'],
    watchdog: { stuckThresholdMs: 30 * 60 * 1000 },
  }),
}))

mock.module('../../src/core/audit', () => ({
  appendAudit: mock(),
}))

mock.module('../../src/core/openclaw-client', () => ({
  sendMessage: mock().mockResolvedValue(undefined),
}))

mock.module('@bakin/tasks/lib/flow-store', () => ({
  getTodoTasks: mock().mockReturnValue({ todoTasks: [] }),
  moveTaskToInProgress: mock(),
  addTaskLog: mock(),
}))

mock.module('../../src/lib/plugin-registry', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock().mockResolvedValue(undefined),
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
}))

mock.module('../../src/lib/format', () => ({
  isStale: mock().mockReturnValue(true),
}))

mock.module('@bakin/core/openclaw-config', () => ({
  getAgentIds: mock().mockReturnValue(['main', 'pixel', 'nemo']),
}))

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: mock().mockReturnValue('main'),
}))

mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => sentinelContentDir,
  getOpenClawPath: (sub: string) => join(sentinelContentDir, sub),
}))

import { loadDispatchState, start, stop, getDispatchInfo } from '../../src/core/dispatch'
import { dispatchTasks } from '../../src/core/dispatch'
import * as openclaw from '../../src/core/openclaw-client'
import * as taskboard from '@bakin/tasks/lib/flow-store'
import { getHookRegistry } from '../../src/lib/plugin-registry'
import type { HookRegistry } from '../../packages/core/src/hooks/hook-registry'

describe('dispatch', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-dispatch-'))
    vi.useFakeTimers()
  })

  afterEach(() => {
    stop()
    vi.useRealTimers()
    rmSync(tempDir, { recursive: true, force: true })
    mock.restore()
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
    type ColumnsShape = { todo: Array<{ id: string; title: string; agent?: string }>; inProgress: unknown[]; done: unknown[]; archived: unknown[] }

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

      const invoke = mock(async (hook: string) => {
        if (hook === 'tasks.readTaskboard') return { columns }
        if (hook === 'workflows.getActiveAgents') return []
        if (hook === 'tasks.blockTask') return undefined
        return undefined
      })
      vi.mocked(getHookRegistry).mockReturnValue({
        invoke,
        has: mock().mockReturnValue(false),
        register: mock(),
      } as unknown as HookRegistry)

      // Make getTodoTasks return our seeded task
      vi.mocked(taskboard.getTodoTasks).mockReturnValue({ columns, todoTasks: [task] } as unknown as ReturnType<typeof taskboard.getTodoTasks>)
    }

    function readState() {
      return JSON.parse(readFileSync(join(tempDir, '.dispatch-state.json'), 'utf-8'))
    }

    beforeEach(() => {
      vi.useRealTimers()  // these tests don't need fake timers; cooldown checks use Date.now arithmetic
    })

    afterEach(() => {
      // Reset mocks to a clean state so later test suites don't inherit
      // todoTasks leaked from setupTodoTask or accumulated sendMessage
      // call records. `vi.restoreAllMocks` in the parent afterEach restores
      // spies but not `mock()` mocks from vi.mock factories.
      vi.mocked(taskboard.getTodoTasks).mockReturnValue({ todoTasks: [] } as unknown as ReturnType<typeof taskboard.getTodoTasks>)
      vi.mocked(openclaw.sendMessage).mockClear()
      vi.mocked(openclaw.sendMessage).mockResolvedValue(undefined as unknown as string)
    })

    it('records kind="transient" on TypeError("fetch failed") and expires after transientCooldownMs', async () => {
      setupTodoTask({ id: 't-transient', title: 'Transient-failing task' })
      vi.mocked(openclaw.sendMessage).mockRejectedValueOnce(new TypeError('fetch failed'))

      await dispatchTasks(tempDir, 3737)

      const state1 = readState()
      expect(state1.failedDispatches['t-transient']).toBeDefined()
      expect(state1.failedDispatches['t-transient'].kind).toBe('transient')
      expect(state1.failedDispatches['t-transient'].count).toBe(1)

      // 30s later — still inside 60s transient cooldown → skipped
      state1.failedDispatches['t-transient'].lastAttempt = Date.now() - 30_000
      writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify(state1))
      vi.mocked(openclaw.sendMessage).mockClear()
      await dispatchTasks(tempDir, 3737)
      expect(openclaw.sendMessage).not.toHaveBeenCalled()

      // 65s later — cooldown expired → retried
      const state2 = readState()
      state2.failedDispatches['t-transient'].lastAttempt = Date.now() - 65_000
      writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify(state2))
      vi.mocked(openclaw.sendMessage).mockResolvedValueOnce('')
      await dispatchTasks(tempDir, 3737)
      expect(openclaw.sendMessage).toHaveBeenCalledTimes(1)
    })

    it('records kind="structural" on 5xx error and does NOT expire after transientCooldownMs', async () => {
      setupTodoTask({ id: 't-structural', title: 'Structural-failing task' })
      vi.mocked(openclaw.sendMessage).mockRejectedValueOnce(
        new Error('OpenClaw sendMessage failed (500): upstream boom'),
      )

      await dispatchTasks(tempDir, 3737)

      const state1 = readState()
      expect(state1.failedDispatches['t-structural'].kind).toBe('structural')

      // 5 minutes later — past transient cooldown (60s) but inside structural (30m) → still skipped
      state1.failedDispatches['t-structural'].lastAttempt = Date.now() - 5 * 60_000
      writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify(state1))
      vi.mocked(openclaw.sendMessage).mockClear()
      await dispatchTasks(tempDir, 3737)
      expect(openclaw.sendMessage).not.toHaveBeenCalled()
    })

    it('escalates to blocked after maxRetries cumulative failures', async () => {
      const blockTask = mock()
      const columns: ColumnsShape = {
        todo: [{ id: 't-exhausted', title: 'About to exhaust' }],
        inProgress: [], done: [], archived: [],
      }
      const invoke = mock(async (hook: string, args?: unknown) => {
        if (hook === 'tasks.readTaskboard') return { columns }
        if (hook === 'workflows.getActiveAgents') return []
        if (hook === 'tasks.blockTask') { blockTask(args); return undefined }
        return undefined
      })
      vi.mocked(getHookRegistry).mockReturnValue({
        invoke,
        has: mock().mockReturnValue(false),
        register: mock(),
      } as unknown as HookRegistry)
      vi.mocked(taskboard.getTodoTasks).mockReturnValue({ todoTasks: columns.todo } as ReturnType<typeof taskboard.getTodoTasks>)

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
      expect(blockTask).toHaveBeenCalledTimes(1)
      expect(openclaw.sendMessage).not.toHaveBeenCalled()
    })

    it('audit event carries the classified kind', async () => {
      const { appendAudit } = require('../../src/core/audit') as typeof import('../../src/core/audit')
      vi.mocked(appendAudit).mockClear()

      setupTodoTask({ id: 't-audit', title: 'Audit carries kind' })
      vi.mocked(openclaw.sendMessage).mockRejectedValueOnce(new TypeError('fetch failed'))

      await dispatchTasks(tempDir, 3737)

      const dispatchFailed = vi.mocked(appendAudit).mock.calls.find((c: any[]) => c[1] === 'task.dispatch_failed')
      expect(dispatchFailed).toBeDefined()
      expect((dispatchFailed?.[3] as { kind: string }).kind).toBe('transient')
    })

    it('classifies AbortError as transient', async () => {
      setupTodoTask({ id: 't-abort', title: 'AbortError task' })
      const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
      vi.mocked(openclaw.sendMessage).mockRejectedValueOnce(abortErr)

      await dispatchTasks(tempDir, 3737)

      const state = readState()
      expect(state.failedDispatches['t-abort'].kind).toBe('transient')
    })

    it('defaults to structural for unrecognized errors (safe side)', async () => {
      setupTodoTask({ id: 't-unknown', title: 'Weird error task' })
      vi.mocked(openclaw.sendMessage).mockRejectedValueOnce(new Error('something entirely unexpected'))

      await dispatchTasks(tempDir, 3737)

      const state = readState()
      expect(state.failedDispatches['t-unknown'].kind).toBe('structural')
    })

    it('workflow dispatch failure writes FailureRecord shape', async () => {
      const columns = {
        todo: [{ id: 'wf-fail', title: 'Failing workflow task', workflowId: 'img-flow', agent: 'pixel' }],
        inProgress: [], done: [], archived: [],
      }
      const invoke = mock(async (hook: string) => {
        if (hook === 'tasks.readTaskboard') return { columns }
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
      vi.mocked(taskboard.getTodoTasks).mockReturnValue({ columns: columns as never, todoTasks: columns.todo as never } as ReturnType<typeof taskboard.getTodoTasks>)

      // The workflow branch calls sendMessage inside dispatchWorkflowTask; make it throw transiently.
      vi.mocked(openclaw.sendMessage).mockRejectedValueOnce(new TypeError('fetch failed'))

      await dispatchTasks(tempDir, 3737)

      const state = readState()
      const record = state.failedDispatches['wf-fail']
      expect(record).toBeDefined()
      expect(typeof record).toBe('object')                  // not the legacy plain number
      expect(record.kind).toBe('transient')
      expect(record.count).toBe(1)
      expect(typeof record.lastAttempt).toBe('number')
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

      const invoke = mock(async (hook: string) => {
        if (hook === 'tasks.readTaskboard') {
          return {
            columns: {
              todo: [],
              inProgress: [{ id: 'wf-1', title: 'Generate image', workflowId: 'image-flow', agent: 'pixel' }],
              done: [],
              archived: [],
            },
          }
        }
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

      expect(openclaw.sendMessage).not.toHaveBeenCalled()

      const state = JSON.parse(readFileSync(join(tempDir, '.dispatch-state.json'), 'utf-8'))
      expect(state.dispatched).toContain('wf-1:step-generate')
    })
  })
})
