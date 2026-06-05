import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
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
    },
    workflow: {
      stepTimeoutMs: 60 * 60 * 1000,
      maxRedispatches: 3,
    },
    notifications: { channel: '', target: '', gateAlerts: true, channelAliases: {} },
  }),
}))

mock.module('../../src/core/audit', () => ({
  appendAudit: mock(),
}))

mock.module('../../src/core/sse', () => ({
  broadcast: mock(),
}))

const mockRuntimeSend = mock((...args: unknown[]) => {
  void args
  return Promise.resolve({ id: 'runtime-msg' })
})
const mockRuntimeChannelSend = mock((...args: unknown[]) => {
  void args
  return Promise.resolve({ deliveries: [] })
})

const mockAppServices = {
  runtime: {
    agents: {
      list: mock(async () => [{ id: 'main', name: 'Main', status: 'active' }]),
    },
    messaging: {
      send: (...args: unknown[]) => mockRuntimeSend(...args),
    },
    channels: {
      sendMessage: (...args: unknown[]) => mockRuntimeChannelSend(...args),
    },
  },
}

mock.module('../../src/core/app-services', () => ({
  getAppServices: () => mockAppServices,
}))
mock.module('@/core/app-services', () => ({
  getAppServices: () => mockAppServices,
}))

type WatchdogTask = {
  id: string
  title: string
  agent?: string
  workflowId?: string
  updatedAt?: number
  log?: Array<{ message: string; timestamp: string; data?: Record<string, unknown> }>
}

type WatchdogColumns = {
  backlog: WatchdogTask[]
  todo: WatchdogTask[]
  inProgress: WatchdogTask[]
  review: WatchdogTask[]
  done: WatchdogTask[]
  archived: WatchdogTask[]
  blocked: WatchdogTask[]
}

function emptyWatchdogColumns(): WatchdogColumns {
  return { backlog: [], todo: [], inProgress: [], review: [], done: [], archived: [], blocked: [] }
}

let currentWatchdogColumns = emptyWatchdogColumns()
const mockStoreAddTaskLog = mock(async (..._args: unknown[]) => undefined)
const mockStoreBlockTask = mock(async (..._args: unknown[]) => undefined)
const mockStoreMoveTask = mock(async (..._args: unknown[]) => undefined)

function setWatchdogColumns(columns: Partial<WatchdogColumns>): void {
  currentWatchdogColumns = { ...emptyWatchdogColumns(), ...columns }
}

mock.module('../../src/core/task-store', () => ({
  readTaskboard: mock(() => ({ columns: currentWatchdogColumns })),
  addTaskLog: (...args: unknown[]) => mockStoreAddTaskLog(...args),
  blockTask: (...args: unknown[]) => mockStoreBlockTask(...args),
  moveTask: (...args: unknown[]) => mockStoreMoveTask(...args),
}))
mock.module('@/core/task-store', () => ({
  readTaskboard: mock(() => ({ columns: currentWatchdogColumns })),
  addTaskLog: (...args: unknown[]) => mockStoreAddTaskLog(...args),
  blockTask: (...args: unknown[]) => mockStoreBlockTask(...args),
  moveTask: (...args: unknown[]) => mockStoreMoveTask(...args),
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
import { isStale } from '../../src/lib/format'

describe('watchdog', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-watchdog-'))
    vi.useFakeTimers()
    mock.clearAllMocks()
    mockRuntimeSend.mockResolvedValue({ id: 'runtime-msg' })
    mockRuntimeChannelSend.mockResolvedValue({ deliveries: [] })
    setWatchdogColumns({})
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
      expect(() => start(tempDir)).not.toThrow()
    })

    it('stop is idempotent', () => {
      start(tempDir)
      stop()
      expect(() => stop()).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Stuck task detection
  // -------------------------------------------------------------------------

  describe('stuck task detection', () => {
    it('does nothing when taskboard hook returns undefined', async () => {
      setWatchdogColumns({})

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(vi.mocked(broadcast)).not.toHaveBeenCalled()
    })

    it('does nothing when no in-progress tasks', async () => {
      setWatchdogColumns({})

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(vi.mocked(broadcast)).not.toHaveBeenCalled()
    })

    it('alerts on stuck task with stale log', async () => {
      setWatchdogColumns({
        inProgress: [
          {
            id: 'task-1',
            title: 'Stuck task',
            agent: 'pixel',
            log: [{ message: 'Started', timestamp: '2020-01-01T00:00:00Z' }],
          },
        ],
      })
      // Agent is alive (not stale) — should alert but not auto-recover
      vi.mocked(isStale).mockReturnValue(false)

      // Write a heartbeat so isAgentHeartbeatStale returns false
      mkdirSync(join(tempDir, 'heartbeats'), { recursive: true })
      writeFileSync(
        join(tempDir, 'heartbeats', 'pixel.json'),
        JSON.stringify({ timestamp: new Date().toISOString() }),
      )

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(vi.mocked(broadcast)).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'alert' }),
      )
    })

    it('auto-recovers when agent heartbeat is stale', async () => {
      setWatchdogColumns({
        inProgress: [
          {
            id: 'task-2',
            title: 'Stale task',
            agent: 'pixel',
            log: [{ message: 'Started', timestamp: '2020-01-01T00:00:00Z' }],
          },
        ],
      })

      // Agent heartbeat is stale (no heartbeat file)
      vi.mocked(isStale).mockReturnValue(true)

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      // Should have called moveTask to recover
      expect(mockStoreAddTaskLog).toHaveBeenCalledWith('task-2', 'watchdog', expect.stringContaining('Auto-recovered'))
      expect(mockStoreMoveTask).toHaveBeenCalledWith('task-2', 'todo')
      expect(vi.mocked(appendAudit)).toHaveBeenCalledWith(
        tempDir,
        'task.auto_recovered',
        'watchdog',
        expect.objectContaining({ id: 'task-2' }),
      )
    })

    it('skips tasks whose latest log entry is a restart-recovery manual hold', async () => {
      setWatchdogColumns({
        inProgress: [
          {
            id: 'task-manual',
            title: 'Held for manual attention',
            agent: 'pixel',
            log: [
              { message: 'Started', timestamp: '2020-01-01T00:00:00Z' },
              {
                message: 'Manual recovery hold: workflow-partial-agent-stale; left in progress.',
                timestamp: '2020-01-01T01:00:00Z',
                data: { restartRecovery: 'manual' },
              },
            ],
          },
        ],
      })

      // Stale heartbeat + ancient timestamps — without the hold marker this
      // would auto-recover on the first tick.
      vi.mocked(isStale).mockReturnValue(true)

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(mockStoreMoveTask).not.toHaveBeenCalled()
      expect(mockStoreBlockTask).not.toHaveBeenCalled()
      expect(vi.mocked(appendAudit)).not.toHaveBeenCalledWith(
        tempDir,
        'task.auto_recovered',
        'watchdog',
        expect.anything(),
      )
    })

    it('resumes normal handling once a newer log entry follows the manual hold', async () => {
      setWatchdogColumns({
        inProgress: [
          {
            id: 'task-resumed',
            title: 'Human acted after hold',
            agent: 'pixel',
            log: [
              {
                message: 'Manual recovery hold: workflow-partial-agent-stale; left in progress.',
                timestamp: '2020-01-01T00:00:00Z',
                data: { restartRecovery: 'manual' },
              },
              { message: 'Human kicked the workflow again', timestamp: '2020-01-01T01:00:00Z' },
            ],
          },
        ],
      })

      vi.mocked(isStale).mockReturnValue(true)

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      // Marker is no longer latest — the task is eligible again.
      expect(mockStoreMoveTask).toHaveBeenCalledWith('task-resumed', 'todo')
    })

    it('escalates to blocked after max auto-recoveries', async () => {
      setWatchdogColumns({
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
      })

      vi.mocked(isStale).mockReturnValue(true)

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(mockStoreBlockTask).toHaveBeenCalledWith('task-3', expect.stringContaining('Auto-recovery limit reached'))
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
      setWatchdogColumns({
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
      })

      // Heartbeat stale — so absent the guard this would auto-recover.
      vi.mocked(isStale).mockReturnValue(true)

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      // Guard must block both branches of the recovery decision.
      expect(mockStoreMoveTask).not.toHaveBeenCalled()
      expect(mockStoreBlockTask).not.toHaveBeenCalled()
      expect(mockStoreAddTaskLog).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('Auto-recovered'),
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
      setWatchdogColumns({
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
      })

      start(tempDir)
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
      expect(mockRuntimeSend).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'main',
        content: expect.stringContaining('Possible rule bypass'),
      }))
    })

    it('ignores watchdog own log entries', async () => {
      setWatchdogColumns({
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
      })

      start(tempDir)
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
