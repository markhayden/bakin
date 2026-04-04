import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../src/core/settings', () => ({
  getSettings: vi.fn().mockReturnValue({
    dispatch: {
      intervalMs: 1000,
      maxRetries: 3,
      failureCooldownMs: 60000,
      maxDispatched: 500,
    },
    agents: ['main-operator', 'pixel', 'trainer'],
    watchdog: { stuckThresholdMs: 30 * 60 * 1000 },
  }),
}))

vi.mock('../../src/core/audit', () => ({
  appendAudit: vi.fn(),
}))

vi.mock('../../src/core/openclaw-client', () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/lib/taskboard', () => ({
  getTodoTasks: vi.fn().mockReturnValue({ todoTasks: [] }),
  moveTaskToInProgress: vi.fn(),
  addTaskLog: vi.fn(),
}))

vi.mock('../../src/lib/plugin-registry', () => ({
  getHookRegistry: vi.fn().mockReturnValue({
    invoke: vi.fn().mockResolvedValue(undefined),
    has: vi.fn().mockReturnValue(false),
    register: vi.fn(),
  }),
}))

vi.mock('../../src/lib/format', () => ({
  isStale: vi.fn().mockReturnValue(true),
}))

import { loadDispatchState, start, stop, getDispatchInfo } from '../../src/core/dispatch'
import { dispatchTasks } from '../../src/core/dispatch'
import * as openclaw from '../../src/core/openclaw-client'
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
    vi.restoreAllMocks()
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
        failedDispatches: { t3: { lastAttempt: 900, count: 2 } },
      }))

      const state = loadDispatchState(tempDir)
      expect(state.lastRun).toBe(1000)
      expect(state.dispatched).toEqual(['t1', 't2'])
      expect(state.failedDispatches.t3).toEqual({ lastAttempt: 900, count: 2 })
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

  describe('workflow re-dispatch guard', () => {
    it('preserves workflow step dispatch markers for active in-progress tasks', async () => {
      writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify({
        lastRun: Date.now(),
        serverStart: Date.now(),
        dispatched: ['wf-1', 'wf-1:step-generate'],
        failedDispatches: {},
      }))

      const invoke = vi.fn(async (hook: string) => {
        if (hook === 'tasks.readTaskboard') {
          return {
            columns: {
              todo: [],
              inProgress: [{ id: 'wf-1', title: 'Generate image', workflowId: 'image-flow', agent: 'pixel' }],
              done: [],
              confirmed: [],
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
        has: vi.fn().mockReturnValue(false),
        register: vi.fn(),
      } as unknown as HookRegistry)

      await dispatchTasks(tempDir, 3737)

      expect(openclaw.sendMessage).not.toHaveBeenCalled()

      const state = JSON.parse(readFileSync(join(tempDir, '.dispatch-state.json'), 'utf-8'))
      expect(state.dispatched).toContain('wf-1:step-generate')
    })
  })
})
