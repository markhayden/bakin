import { describe, it, expect, beforeEach, afterEach, mock, type Mock } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Defensive content-dir mock (per CLAUDE.md test isolation rules) — the
// watchdog receives its contentDir via `start()`, but any transitive import
// must be prevented from reading/writing ~/.bakin/.
const contentDirMockPath = join(tmpdir(), `bakin-watchdog-test-${Date.now()}`)
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

mock.module('../../src/core/settings', () => ({
  getSettings: mock().mockReturnValue({
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

mock.module('../../src/core/audit', () => ({
  appendAudit: mock(),
}))

mock.module('../../src/core/sse', () => ({
  broadcast: mock(),
}))

mock.module('../../src/core/openclaw-client', () => ({
  sendChannelMessage: mock().mockResolvedValue(undefined),
  sendMessage: mock().mockResolvedValue(undefined),
  getAgentLastReply: mock().mockReturnValue(null),
}))

mock.module('../../src/lib/plugin-registry', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock().mockResolvedValue(undefined),
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
}))

mock.module('../../src/lib/format', () => ({
  isStale: mock().mockReturnValue(false),
}))

import { start, stop } from '../../src/core/watchdog'
import { appendAudit } from '../../src/core/audit'
import { broadcast } from '../../src/core/sse'
import { getHookRegistry } from '../../src/lib/plugin-registry'
import { isStale } from '../../src/lib/format'

describe('watchdog', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-watchdog-'))
    vi.useFakeTimers()
    mock.clearAllMocks()
    // Default: no recorded gateway reply for any agent (forces watchdog
    // to fall back to the heartbeat-file path). Individual tests override.
    const openclaw = await import('../../src/core/openclaw-client')
    vi.mocked(openclaw.getAgentLastReply).mockReturnValue(null)
  })

  afterEach(() => {
    stop()
    vi.useRealTimers()
    rmSync(tempDir, { recursive: true, force: true })
    mock.restore()
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

    it('does not auto-recover when the gateway has a recent reply from the agent', async () => {
      const hookRegistry = getHookRegistry()
      const invokeMock = vi.mocked(hookRegistry.invoke)

      invokeMock.mockImplementation(async (name: string) => {
        if (name === 'tasks.readTaskboard') {
          return {
            columns: {
              todo: [],
              inProgress: [
                {
                  id: 'task-alive',
                  title: 'Slow but alive task',
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

      // Heartbeat file is stale...
      vi.mocked(isStale).mockReturnValue(true)
      // ...but the gateway just replied successfully, so the agent is alive.
      const openclaw = await import('../../src/core/openclaw-client')
      vi.mocked(openclaw.getAgentLastReply).mockReturnValue(Date.now())

      start(tempDir, 3737)
      await vi.advanceTimersByTimeAsync(1500)

      // No recovery should fire — the task is stuck but the agent is online,
      // so the watchdog should fall through to the alert path instead.
      expect(invokeMock).not.toHaveBeenCalledWith('tasks.moveTask', expect.anything())
      expect(invokeMock).not.toHaveBeenCalledWith('tasks.blockTask', expect.anything())
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

    // Regression guard for issue #114 — dispatch moves a task
    // todo → inProgress and the watchdog, running in the same tick off a
    // stale pre-move snapshot, declares the task "30 min stuck" and moves
    // it back to todo. The task's log timestamps are ancient (the task was
    // queued long ago) but `updatedAt` was just bumped by dispatch's move,
    // so we key the guard off that.
    it('does not auto-recover when task.updatedAt is within the guard window', async () => {
      const hookRegistry = getHookRegistry()
      const invokeMock = vi.mocked(hookRegistry.invoke)

      invokeMock.mockImplementation(async (name: string) => {
        if (name === 'tasks.readTaskboard') {
          return {
            columns: {
              todo: [],
              inProgress: [
                {
                  id: 'race-task',
                  title: 'Just-dispatched task',
                  agent: 'pixel',
                  // Log is ancient — the "stuck" check would normally fire.
                  log: [{ message: 'Queued', timestamp: '2020-01-01T00:00:00Z' }],
                  // But updatedAt was bumped by dispatch's moveTask 1s ago.
                  updatedAt: Date.now() - 1000,
                },
              ],
              done: [],
            },
          }
        }
        return undefined
      })

      // Heartbeat stale — so absent the guard this would auto-recover.
      vi.mocked(isStale).mockReturnValue(true)

      start(tempDir, 3737)
      await vi.advanceTimersByTimeAsync(1500)

      // Guard must block both branches of the recovery decision.
      expect(invokeMock).not.toHaveBeenCalledWith('tasks.moveTask', expect.anything())
      expect(invokeMock).not.toHaveBeenCalledWith('tasks.blockTask', expect.anything())
      expect(invokeMock).not.toHaveBeenCalledWith(
        'tasks.addTaskLog',
        expect.objectContaining({ message: expect.stringContaining('Auto-recovered') }),
      )
      expect(vi.mocked(appendAudit)).not.toHaveBeenCalledWith(
        tempDir,
        'task.auto_recovered',
        expect.anything(),
        expect.anything(),
      )
      expect(vi.mocked(appendAudit)).not.toHaveBeenCalledWith(
        tempDir,
        'task.auto_recovery_exhausted',
        expect.anything(),
        expect.anything(),
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
