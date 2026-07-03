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
  getBakinPaths: () => ({ root: contentDirMockPath, home: contentDirMockPath, db: join(contentDirMockPath, 'bakin.db') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => contentDirMockPath,
  getBakinPaths: () => ({ root: contentDirMockPath, home: contentDirMockPath, db: join(contentDirMockPath, 'bakin.db') }),
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
  isStale: mock().mockReturnValue(false),
}))

import { start, stop, getNotificationChannel } from '../../src/core/watchdog'
import { appendAudit } from '../../src/core/audit'
import { broadcast } from '../../src/core/sse'
import { isStale } from '../../src/lib/format'
import { claimRun, getLiveRun, recordCompletion, supersedeStaleRun } from '../../src/core/execution-ledger'
import { closeDb } from '../../packages/core/src/storage/db'

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
    closeDb()
    rmSync(contentDirMockPath, { recursive: true, force: true })
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

  })

  // -------------------------------------------------------------------------
  // Supersede-first recovery (SPEC §8 #4 + #5 completion leg). Replaces the
  // old issue-#114 updatedAt guard test: a just-dispatched task now has a
  // LIVE LEDGER CLAIM with a fresh heartbeat — the real signal the file
  // mtime was a proxy for.
  // -------------------------------------------------------------------------

  describe('supersede-first recovery (execution ledger)', () => {
    const staleTask = (id: string) => ({
      id,
      title: 'Ledger-arbitrated task',
      agent: 'pixel',
      // Log is ancient — the "stuck" check fires; the ledger arbitrates.
      log: [{ message: 'Queued', timestamp: '2020-01-01T00:00:00Z' }],
    })

    it('skips recovery while the live run heartbeat is fresh (replaces the updatedAt guard)', async () => {
      setWatchdogColumns({ inProgress: [staleTask('hb-fresh')] })
      vi.mocked(isStale).mockReturnValue(true) // agent heartbeat file stale

      // Live run claimed with a CURRENT heartbeat — agent is genuinely working.
      claimRun({ runId: 'task:hb-fresh:d1', taskId: 'hb-fresh', seq: 1, agent: 'pixel', bootId: 'boot-wd', now: Date.now() })

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(mockStoreMoveTask).not.toHaveBeenCalled()
      expect(mockStoreBlockTask).not.toHaveBeenCalled()
      expect(getLiveRun('hb-fresh')?.status).toBe('running')
    })

    it('supersedes a stale run exactly once, audits it, then recovers', async () => {
      setWatchdogColumns({ inProgress: [staleTask('hb-stale')] })
      vi.mocked(isStale).mockReturnValue(true)

      // Heartbeat far older than stuckThresholdMs (30min in the settings mock).
      claimRun({ runId: 'task:hb-stale:d1', taskId: 'hb-stale', seq: 1, agent: 'pixel', bootId: 'boot-wd', now: Date.now() - 60 * 60 * 1000 })

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(vi.mocked(appendAudit)).toHaveBeenCalledWith(
        tempDir,
        'task.run_superseded',
        'watchdog',
        expect.objectContaining({ id: 'hb-stale', runIds: ['task:hb-stale:d1'] }),
      )
      expect(mockStoreMoveTask).toHaveBeenCalledWith('hb-stale', 'todo')
      expect(getLiveRun('hb-stale')).toBeNull()

      // The slot is freed exactly once — a racing second supersede loses.
      expect(supersedeStaleRun('hb-stale', Date.now())).toEqual({ superseded: false })
    })

    it('late zombie: the superseded run completes first and wins; the re-dispatch is suppressed', async () => {
      // The superseded run d1 turns out alive and records its completion…
      const first = recordCompletion('zombie-task', { runId: 'task:zombie-task:d1', agent: 'pixel', channel: 'mcp' })
      expect(first.recorded).toBe(true)

      // …so the re-dispatched run d2's completion is suppressed — first
      // completion wins regardless of which run produced it.
      const second = recordCompletion('zombie-task', { runId: 'task:zombie-task:d2', agent: 'pixel', channel: 'mcp' })
      expect(second.recorded).toBe(false)
      if (!second.recorded) expect(second.existing.runId).toBe('task:zombie-task:d1')
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

  describe('getNotificationChannel', () => {
    const settingsWith = (channel: string, target: string) =>
      ({ notifications: { channel, target, gateAlerts: true, channelAliases: {} } }) as never

    it('composes channel:target — OpenClaw send REQUIRES a destination', () => {
      expect(getNotificationChannel(settingsWith('discord', '1492965013642543205')))
        .toBe('discord:1492965013642543205')
    })

    it('passes a pre-composed channel:target through untouched', () => {
      expect(getNotificationChannel(settingsWith('discord:user:42', 'ignored'))).toBe('discord:user:42')
    })

    it('bare channel with no target stays bare (adapter may have a default)', () => {
      expect(getNotificationChannel(settingsWith('discord', ''))).toBe('discord')
    })

    it("'none' and empty disable alerts", () => {
      expect(getNotificationChannel(settingsWith('none', 'x'))).toBeNull()
      expect(getNotificationChannel(settingsWith('', 'x'))).toBeNull()
    })
  })
})
