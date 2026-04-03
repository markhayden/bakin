import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
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
    watchdog: {
      intervalMs: 1000,
      stuckThresholdMs: 30 * 60 * 1000,
      autoRecover: true,
      maxAutoRecoveries: 3,
      alertChannelId: 'test-channel',
    },
    workflow: {
      stepTimeoutMs: 60 * 60 * 1000,
      maxRedispatches: 3,
    },
    notifications: { channel: 'none' },
  }),
}))

vi.mock('../../src/core/audit', () => ({
  appendAudit: vi.fn(),
}))

vi.mock('../../src/core/sse', () => ({
  broadcast: vi.fn(),
}))

vi.mock('../../src/core/openclaw-client', () => ({
  sendChannelMessage: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/lib/plugin-registry', () => ({
  getHookRegistry: vi.fn().mockReturnValue({
    invoke: vi.fn().mockResolvedValue(undefined),
    has: vi.fn().mockReturnValue(false),
    register: vi.fn(),
  }),
}))

vi.mock('../../src/lib/format', () => ({
  isStale: vi.fn().mockReturnValue(false),
}))

import { start, stop } from '../../src/core/watchdog'
import { appendAudit } from '../../src/core/audit'
import { broadcast } from '../../src/core/sse'
import { getHookRegistry } from '../../src/lib/plugin-registry'
import { isStale } from '../../src/lib/format'

describe('watchdog', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-watchdog-'))
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    stop()
    vi.useRealTimers()
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // start / stop
  // -------------------------------------------------------------------------

  describe('start and stop', () => {
    it('starts without throwing', () => {
      expect(() => start(tempDir, 3737)).not.toThrow()
    })

    it('stop is idempotent', () => {
      start(tempDir, 3737)
      stop()
      expect(() => stop()).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Stuck task detection
  // -------------------------------------------------------------------------

  describe('stuck task detection', () => {
    it('does nothing when taskboard hook returns undefined', async () => {
      const hookRegistry = getHookRegistry()
      vi.mocked(hookRegistry.invoke).mockResolvedValue(undefined)

      start(tempDir, 3737)
      await vi.advanceTimersByTimeAsync(1500)

      expect(vi.mocked(broadcast)).not.toHaveBeenCalled()
    })

    it('does nothing when no in-progress tasks', async () => {
      const hookRegistry = getHookRegistry()
      vi.mocked(hookRegistry.invoke).mockResolvedValue({
        columns: { todo: [], inProgress: [], done: [] },
      })

      start(tempDir, 3737)
      await vi.advanceTimersByTimeAsync(1500)

      expect(vi.mocked(broadcast)).not.toHaveBeenCalled()
    })

    it('alerts on stuck task with stale log', async () => {
      const hookRegistry = getHookRegistry()
      vi.mocked(hookRegistry.invoke).mockResolvedValue({
        columns: {
          todo: [],
          inProgress: [
            {
              id: 'task-1',
              title: 'Stuck task',
              agent: 'pixel',
              log: [{ message: 'Started', timestamp: '2020-01-01T00:00:00Z' }],
            },
          ],
          done: [],
        },
      })
      // Agent is alive (not stale) — should alert but not auto-recover
      vi.mocked(isStale).mockReturnValue(false)

      // Write a heartbeat so isAgentHeartbeatStale returns false
      mkdirSync(join(tempDir, 'heartbeats'), { recursive: true })
      writeFileSync(
        join(tempDir, 'heartbeats', 'pixel.json'),
        JSON.stringify({ timestamp: new Date().toISOString() }),
      )

      start(tempDir, 3737)
      await vi.advanceTimersByTimeAsync(1500)

      expect(vi.mocked(broadcast)).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'alert' }),
      )
    })

    it('auto-recovers when agent heartbeat is stale', async () => {
      const hookRegistry = getHookRegistry()
      const invokeMock = vi.mocked(hookRegistry.invoke)

      // First call: readTaskboard, subsequent: task operations
      invokeMock.mockImplementation(async (name: string) => {
        if (name === 'tasks.readTaskboard') {
          return {
            columns: {
              todo: [],
              inProgress: [
                {
                  id: 'task-2',
                  title: 'Stale task',
                  agent: 'pixel',
                  log: [{ message: 'Started', timestamp: '2020-01-01T00:00:00Z' }],
                },
              ],
              done: [],
            },
          }
        }
        return undefined
      })

      // Agent heartbeat is stale (no heartbeat file)
      vi.mocked(isStale).mockReturnValue(true)

      start(tempDir, 3737)
      await vi.advanceTimersByTimeAsync(1500)

      // Should have called moveTask to recover
      expect(invokeMock).toHaveBeenCalledWith('tasks.addTaskLog', expect.objectContaining({
        identifier: 'task-2',
        message: expect.stringContaining('Auto-recovered'),
      }))
      expect(invokeMock).toHaveBeenCalledWith('tasks.moveTask', { identifier: 'task-2', to: 'todo' })
      expect(vi.mocked(appendAudit)).toHaveBeenCalledWith(
        tempDir,
        'task.auto_recovered',
        'watchdog',
        expect.objectContaining({ id: 'task-2' }),
      )
    })

    it('escalates to blocked after max auto-recoveries', async () => {
      const hookRegistry = getHookRegistry()
      const invokeMock = vi.mocked(hookRegistry.invoke)

      invokeMock.mockImplementation(async (name: string) => {
        if (name === 'tasks.readTaskboard') {
          return {
            columns: {
              todo: [],
              inProgress: [
                {
                  id: 'task-3',
                  title: 'Exhausted task',
                  agent: 'pixel',
                  log: [
                    { message: 'Auto-recovered: attempt 1', timestamp: '2020-01-01T00:00:00Z' },
                    { message: 'Auto-recovered: attempt 2', timestamp: '2020-01-01T01:00:00Z' },
                    { message: 'Auto-recovered: attempt 3', timestamp: '2020-01-01T02:00:00Z' },
                  ],
                },
              ],
              done: [],
            },
          }
        }
        return undefined
      })

      vi.mocked(isStale).mockReturnValue(true)

      start(tempDir, 3737)
      await vi.advanceTimersByTimeAsync(1500)

      expect(invokeMock).toHaveBeenCalledWith('tasks.blockTask', expect.objectContaining({
        identifier: 'task-3',
      }))
      expect(vi.mocked(appendAudit)).toHaveBeenCalledWith(
        tempDir,
        'task.auto_recovery_exhausted',
        'watchdog',
        expect.objectContaining({ id: 'task-3', recoveryCount: 3 }),
      )
    })
  })

  // -------------------------------------------------------------------------
  // Bypass detection (via checkBypassPatterns)
  // -------------------------------------------------------------------------

  describe('bypass pattern detection', () => {
    it('detects "working around" pattern in recent logs', async () => {
      const hookRegistry = getHookRegistry()
      vi.mocked(hookRegistry.invoke).mockResolvedValue({
        columns: {
          todo: [],
          inProgress: [
            {
              id: 'task-bp',
              title: 'Bypass task',
              agent: 'pixel',
              log: [
                { message: 'Working around the error by skipping validation', timestamp: new Date().toISOString() },
              ],
            },
          ],
          done: [],
        },
      })

      start(tempDir, 3737)
      await vi.advanceTimersByTimeAsync(1500)

      expect(vi.mocked(broadcast)).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'alert', message: expect.stringContaining('bypass') }),
      )
      expect(vi.mocked(appendAudit)).toHaveBeenCalledWith(
        tempDir,
        'task.bypass_detected',
        'watchdog',
        expect.objectContaining({ id: 'task-bp' }),
      )
    })

    it('ignores watchdog own log entries', async () => {
      const hookRegistry = getHookRegistry()
      vi.mocked(hookRegistry.invoke).mockResolvedValue({
        columns: {
          todo: [],
          inProgress: [
            {
              id: 'task-safe',
              title: 'Safe task',
              agent: 'pixel',
              log: [
                { message: 'ALERT: No progress logged in 30+ minutes', timestamp: new Date().toISOString() },
              ],
            },
          ],
          done: [],
        },
      })

      start(tempDir, 3737)
      await vi.advanceTimersByTimeAsync(1500)

      expect(vi.mocked(appendAudit)).not.toHaveBeenCalledWith(
        tempDir,
        'task.bypass_detected',
        'watchdog',
        expect.anything(),
      )
    })
  })
})
