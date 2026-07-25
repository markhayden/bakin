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
mock.module('../../src/core/app-services-store', () => ({
  getAppServices: () => mockAppServices,
}))
mock.module('@/core/app-services', () => ({
  getAppServices: () => mockAppServices,
}))
mock.module('@/core/app-services-store', () => ({
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

// getTask backs the orphan-turn sweep's store-existence check (#604): any
// task present in ANY column exists; only missing ids are orphans.
function lookupWatchdogTask(id: string): WatchdogTask | null {
  for (const column of Object.values(currentWatchdogColumns)) {
    const found = column.find((t) => t.id === id)
    if (found) return found
  }
  return null
}

mock.module('../../src/core/task-store', () => ({
  readTaskboard: mock(() => ({ columns: currentWatchdogColumns })),
  getTask: (id: string) => lookupWatchdogTask(id),
  addTaskLog: (...args: unknown[]) => mockStoreAddTaskLog(...args),
  blockTask: (...args: unknown[]) => mockStoreBlockTask(...args),
  moveTask: (...args: unknown[]) => mockStoreMoveTask(...args),
}))
mock.module('@/core/task-store', () => ({
  readTaskboard: mock(() => ({ columns: currentWatchdogColumns })),
  getTask: (id: string) => lookupWatchdogTask(id),
  addTaskLog: (...args: unknown[]) => mockStoreAddTaskLog(...args),
  blockTask: (...args: unknown[]) => mockStoreBlockTask(...args),
  moveTask: (...args: unknown[]) => mockStoreMoveTask(...args),
}))

// In-flight turn registry mock for the orphan sweep (#604).
type TurnSnapshot = { marker: string; agentId: string; taskId: string; threadId: string; startedAt: number; abortedAt?: number }
let turnsSnapshot: TurnSnapshot[] = []
let snapshotThrows = false
const abortTurnsSpy = mock((_taskId: string, _reason: string) => 1)
const abortByRunIdsSpy = mock((_runIds: string[], _reason: string) => 1)
const forceReleaseSpy = mock((_marker: string) => true)
mock.module('../../src/core/dispatch-registry', () => ({
  getInFlightTurnsSnapshot: () => {
    if (snapshotThrows) throw new Error('registry exploded')
    return turnsSnapshot
  },
  abortTurnsForTask: (...args: unknown[]) => abortTurnsSpy(...(args as [string, string])),
  abortTurnsByRunIds: (...args: unknown[]) => abortByRunIdsSpy(...(args as [string[], string])),
  forceReleaseTurn: (...args: unknown[]) => forceReleaseSpy(...(args as [string])),
  ORPHAN_TURN_FORCE_RELEASE_GRACE_MS: 60_000,
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
    turnsSnapshot = []
    snapshotThrows = false
    forceReleaseSpy.mockReturnValue(true)
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
  // Orphan turn sweep (#604)
  // -------------------------------------------------------------------------

  describe('orphan turn sweep', () => {
    const baseTurn = { agentId: 'pixel', threadId: 'task:ghost-1:d1', startedAt: 0 }

    it('aborts a turn whose task no longer exists in the store', async () => {
      turnsSnapshot = [{ ...baseTurn, marker: 'ghost-1', taskId: 'ghost-1' }]

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(abortTurnsSpy).toHaveBeenCalledWith('ghost-1', 'orphan-sweep')
      expect(forceReleaseSpy).not.toHaveBeenCalled()
    })

    it('leaves turns alone when their task exists anywhere in the store (done column included)', async () => {
      setWatchdogColumns({ done: [{ id: 'finished-1', title: 'Done task' }] })
      turnsSnapshot = [{ ...baseTurn, marker: 'finished-1', taskId: 'finished-1' }]

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(abortTurnsSpy).not.toHaveBeenCalled()
      expect(forceReleaseSpy).not.toHaveBeenCalled()
    })

    it('force-releases an aborted orphan only after the grace period, with audit + ledger settle', async () => {
      // Force-release keys by threadId (the run identity) and settles the
      // ledger row as lost so a zombie's late asset saves can't pass the
      // staleness gate (same-agent-concurrency D3). Claim a real run so the
      // ledger settle has a row to flip.
      claimRun({ runId: 'task:ghost-2:d1', taskId: 'ghost-2', seq: 1, agent: 'pixel', bootId: 'boot-wd', now: Date.now() })
      turnsSnapshot = [{ ...baseTurn, marker: 'ghost-2', taskId: 'ghost-2', threadId: 'task:ghost-2:d1', abortedAt: Date.now() - 61_000 }]

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(abortTurnsSpy).not.toHaveBeenCalled()
      expect(forceReleaseSpy).toHaveBeenCalledWith('task:ghost-2:d1')
      expect(getLiveRun('ghost-2')).toBeNull()
      expect(vi.mocked(appendAudit)).toHaveBeenCalledWith(
        tempDir,
        'task.turn_force_released',
        'watchdog',
        expect.objectContaining({ id: 'ghost-2', agent: 'pixel', runId: 'task:ghost-2:d1' }),
      )
    })

    it('does not force-release inside the grace window', async () => {
      turnsSnapshot = [{ ...baseTurn, marker: 'ghost-3', taskId: 'ghost-3', abortedAt: Date.now() - 5_000 }]

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(abortTurnsSpy).not.toHaveBeenCalled()
      expect(forceReleaseSpy).not.toHaveBeenCalled()
    })

    it('a sweep failure never breaks the watchdog tick (board scan still runs)', async () => {
      snapshotThrows = true
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
      vi.mocked(isStale).mockReturnValue(false)
      mkdirSync(join(tempDir, 'heartbeats'), { recursive: true })
      writeFileSync(
        join(tempDir, 'heartbeats', 'pixel.json'),
        JSON.stringify({ timestamp: new Date().toISOString() }),
      )

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      // The stuck-task alert still fired despite the sweep throwing.
      expect(vi.mocked(broadcast)).toHaveBeenCalled()
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
      // ONLY the superseded runs' turns are aborted (by runId) — a healthy
      // parallel workflow-step sibling sharing the taskId must survive
      // (same-agent-concurrency D3 + review F2).
      expect(abortByRunIdsSpy).toHaveBeenCalledWith(['task:hb-stale:d1'], 'superseded')
      expect(abortTurnsSpy).not.toHaveBeenCalledWith('hb-stale', 'superseded')

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
