import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
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
  recoveries?: number
  version?: number
  log?: Array<{ message: string; timestamp: string; author?: string; data?: Record<string, unknown> }>
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
/** Store-call order per task — the counter write must land BEFORE its log line (spec D9). */
const storeCallOrder: string[] = []
const mockStoreAddTaskLog = mock(async (...args: unknown[]) => { storeCallOrder.push(`log:${String(args[0])}`); return undefined })
const mockStoreBlockTask = mock(async (...args: unknown[]) => { storeCallOrder.push(`block:${String(args[0])}`); return undefined })
const mockStoreMoveTask = mock(async (..._args: unknown[]) => undefined)
const mockStoreRecoverTask = mock(async (id: string) => {
  storeCallOrder.push(`recover:${id}`)
  const task = lookupWatchdogTask(id)
  if (task) task.recoveries = (task.recoveries ?? 0) + 1
  return undefined
})

/**
 * Mirrors the real store: updatedAt is bumped on EVERY write, log appends
 * included, so a fixture that gives only log timestamps gets updatedAt = the
 * newest of them. A fixture that sets updatedAt explicitly keeps it.
 */
function setWatchdogColumns(columns: Partial<WatchdogColumns>): void {
  currentWatchdogColumns = { ...emptyWatchdogColumns(), ...columns }
  for (const column of Object.values(currentWatchdogColumns)) {
    for (const task of column) {
      if (task.updatedAt !== undefined) continue
      const stamps = (task.log ?? []).map((e) => Date.parse(e.timestamp)).filter((n) => !Number.isNaN(n))
      if (stamps.length > 0) task.updatedAt = Math.max(...stamps)
    }
  }
}

function columnOf(id: string): string | null {
  for (const [name, column] of Object.entries(currentWatchdogColumns)) {
    if (column.some((t) => t.id === id)) return name
  }
  return null
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

// Like the real store's taskToView, every read hands back a fresh projection:
// the scan's snapshot never aliases a row a later mock mutation changes.
const taskStoreMock = () => ({
  readTaskboard: mock(() => ({
    columns: Object.fromEntries(Object.entries(currentWatchdogColumns).map(([name, tasks]) => [name, tasks.map((t) => ({ ...t }))])) as WatchdogColumns,
  })),
  getTask: (id: string) => lookupWatchdogTask(id),
  getTaskWithColumn: (id: string) => {
    const task = lookupWatchdogTask(id)
    const column = columnOf(id)
    return task && column ? { task: { ...task }, column } : null
  },
  addTaskLog: (...args: unknown[]) => mockStoreAddTaskLog(...args),
  blockTask: (...args: unknown[]) => mockStoreBlockTask(...args),
  moveTask: (...args: unknown[]) => mockStoreMoveTask(...args),
  recoverTask: (id: string) => mockStoreRecoverTask(id),
})
mock.module('../../src/core/task-store', taskStoreMock)
mock.module('@/core/task-store', taskStoreMock)

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
    has: mock((name: string) => name === 'spend.getBudgetPolicy'),
    register: mock(),
  }),
}))
// The workflow-timeout sweep reads instances through this hook; tests set
// `hookInvokeImpl` to feed it instance lists (default: undefined = no-op).
let hookInvokeImpl: (name: string, data?: unknown) => Promise<unknown> = async () => undefined
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: (name: string, data?: unknown) => hookInvokeImpl(name, data),
    has: mock((name: string) => name === 'spend.getBudgetPolicy'),
    register: mock(),
  }),
}))

// The tick awaits a dynamic import of the spend observer; under the fake
// timer shim that import never resolves inside advanceTimersByTimeAsync, so
// the board scan silently never runs. The observer is its own unit — stub it.
mock.module('../../src/core/spend-observer', () => ({
  observeSpend: async () => undefined,
}))

// Same class: the main-agent alert path awaits resolveSystemRoute, which
// dynamic-imports the hook-registry singleton. bun ≥ 1.4 settles every
// dynamic import on a macrotask, so the send would land after the
// assertion. Routing is its own unit (tests/core/system-route.test.ts) — stub
// it to the inherit route.
mock.module('../../src/core/system-route', () => ({
  resolveSystemRoute: async () => ({ source: 'inherit' }),
  routeSendArgs: () => ({}),
}))

// Budget gate probe (Fix: budget-held steps must not log TIMEOUT spam).
let budgetGateDecision: { action: string } = { action: 'allow' }
const budgetGateSpy = mock(async (..._args: unknown[]) => budgetGateDecision)
mock.module('../../src/core/dispatch-turns', () => ({
  budgetGate: (...args: unknown[]) => budgetGateSpy(...args),
}))

import { start, stop, getNotificationChannel } from '../../src/core/watchdog'
import { appendAudit } from '../../src/core/audit'
import { broadcast } from '../../src/core/sse'
import { getSettings } from '../../src/core/settings'
import { claimRun, getLiveRun, recordCompletion, supersedeStaleRun } from '../../src/core/execution-ledger'
import { withStateLock } from '../../src/core/dispatch-state'
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
    storeCallOrder.length = 0
    turnsSnapshot = []
    snapshotThrows = false
    forceReleaseSpy.mockReturnValue(true)
    hookInvokeImpl = async () => undefined
    budgetGateDecision = { action: 'allow' }
    mockStoreAddTaskLog.mockImplementation(async (...args: unknown[]) => { storeCallOrder.push(`log:${String(args[0])}`); return undefined })
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
      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      // The stranded task was still recovered despite the sweep throwing.
      expect(mockStoreRecoverTask).toHaveBeenCalledWith('task-1')
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

    it('a live run with a fresh heartbeat and ancient logs is left alone — no alert, no recovery', async () => {
      setWatchdogColumns({
        inProgress: [
          {
            id: 'task-1',
            title: 'Quiet but working',
            agent: 'pixel',
            log: [{ message: 'Started', timestamp: '2020-01-01T00:00:00Z' }],
          },
        ],
      })
      claimRun({ runId: 'task:task-1:d1', taskId: 'task-1', seq: 1, agent: 'pixel', bootId: 'boot-wd', now: Date.now() })

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(vi.mocked(broadcast)).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'alert' }))
      expect(mockStoreMoveTask).not.toHaveBeenCalled()
      expect(mockStoreAddTaskLog).not.toHaveBeenCalledWith('task-1', 'watchdog', expect.stringContaining('ALERT'))
    })

    it('with autoRecover off, a stranded task only alerts', async () => {
      // start() reads settings once up front and the tick re-reads them.
      const alertOnly = {
        watchdog: { intervalMs: 1000, stuckThresholdMs: 30 * 60 * 1000, autoRecover: false, maxAutoRecoveries: 3 },
        workflow: { stepTimeoutMs: 60 * 60 * 1000, maxRedispatches: 3 },
        notifications: { channel: '', target: '', gateAlerts: true, channelAliases: {} },
      } as never
      vi.mocked(getSettings).mockReturnValueOnce(alertOnly).mockReturnValueOnce(alertOnly)
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

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(vi.mocked(broadcast)).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'alert', message: expect.stringContaining('(no live run)') }),
      )
      expect(mockStoreMoveTask).not.toHaveBeenCalled()
    })

    it('a still-running prior workflow step prevents task recovery after the engine advanced (review P1)', async () => {
      setWatchdogColumns({ inProgress: [{ id: 'wf-transition', title: 'Workflow transition', agent: 'pixel', workflowId: 'wf', log: [{ message: 'Started', timestamp: '2020-01-01T00:00:00Z' }] }] })
      hookInvokeImpl = async (name) => name === 'workflows.loadInstance'
        ? { status: 'in_progress' }
        : name === 'workflows.getActiveAgents' ? [{ agent: 'patch', stepId: 'next' }] : undefined
      // Step "previous" still holds a fresh running row; the engine already
      // advanced the workflow to "next", which has not claimed yet.
      claimRun({ runId: 'wf-old-run', taskId: 'wf-transition', execKey: 'wf-transition:previous', seq: 1, agent: 'pixel', bootId: 'boot-wd', now: Date.now() })

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(getLiveRun('wf-transition')?.status).toBe('running')
      expect(mockStoreMoveTask).not.toHaveBeenCalled()
      expect(mockStoreBlockTask).not.toHaveBeenCalled()
    })

    it('a completed nested child whose final turn is still running keeps the parent out of recovery (review round 2)', async () => {
      setWatchdogColumns({
        inProgress: [{ id: 'outer-review', title: 'Outer workflow', agent: 'pixel', workflowId: 'outer', log: [{ message: 'Started', timestamp: '2020-01-01T00:00:00Z' }] }],
        done: [{ id: 'inner-review', title: 'Completed child', agent: 'pixel', workflowId: 'inner' }],
      })
      hookInvokeImpl = async (name) => name === 'workflows.loadInstance'
        ? { status: 'in_progress', currentStepId: 'next', stepStates: { nested: { status: 'complete', childTaskId: 'inner-review' }, next: { status: 'in_progress' } } }
        : name === 'workflows.getActiveAgents' ? [{ agent: 'patch', stepId: 'next' }] : undefined
      claimRun({ runId: 'inner-final-run', taskId: 'inner-review', execKey: 'inner-review:final', seq: 1, agent: 'pixel', bootId: 'boot-wd', now: Date.now() })

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(getLiveRun('inner-review')?.status).toBe('running')
      expect(mockStoreMoveTask).not.toHaveBeenCalled()
      expect(mockStoreBlockTask).not.toHaveBeenCalled()
    })

    it('a joined map child whose final turn is still running keeps the parent out of recovery (review round 2)', async () => {
      setWatchdogColumns({
        inProgress: [{ id: 'map-parent', title: 'Map workflow', agent: 'pixel', workflowId: 'fanout', log: [{ message: 'Started', timestamp: '2020-01-01T00:00:00Z' }] }],
      })
      hookInvokeImpl = async (name, data) => {
        const taskId = (data as { taskId?: string } | undefined)?.taskId
        if (name === 'workflows.loadInstance') {
          return taskId === 'map-parent'
            ? { status: 'in_progress', currentStepId: 'assemble', stepStates: { fan: { status: 'complete', children: [{ index: 0, childTaskId: 'map-parent--fan-0', status: 'complete' }, { index: 1, childTaskId: 'map-parent--fan-1', status: 'complete' }] }, assemble: { status: 'in_progress' } } }
            : { status: 'complete', stepStates: {} }
        }
        return name === 'workflows.getActiveAgents' ? [{ agent: 'patch', stepId: 'assemble' }] : undefined
      }
      claimRun({ runId: 'fan-1-final', taskId: 'map-parent--fan-1', execKey: 'map-parent--fan-1:write', seq: 1, agent: 'pixel', bootId: 'boot-wd', now: Date.now() })

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(getLiveRun('map-parent--fan-1')?.status).toBe('running')
      expect(mockStoreMoveTask).not.toHaveBeenCalled()
    })

    it('auto-recovers a stranded task (no live run) with stale logs', async () => {
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

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      // ONE store write (todo + recoveries+1), THEN the log line (spec D3/D9).
      expect(mockStoreRecoverTask).toHaveBeenCalledWith('task-2')
      expect(mockStoreMoveTask).not.toHaveBeenCalled()
      expect(mockStoreAddTaskLog).toHaveBeenCalledWith('task-2', 'watchdog', expect.stringContaining('Auto-recovered: no live run'))
      expect(storeCallOrder.indexOf('recover:task-2')).toBeLessThan(storeCallOrder.indexOf('log:task-2'))
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
                message: 'Manual recovery hold: workflow-partial-live-run; left in progress.',
                timestamp: '2020-01-01T01:00:00Z',
                data: { restartRecovery: 'manual' },
              },
            ],
          },
        ],
      })

      // No live run + ancient timestamps — without the hold marker this
      // would auto-recover on the first tick.

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
                message: 'Manual recovery hold: workflow-partial-live-run; left in progress.',
                timestamp: '2020-01-01T00:00:00Z',
                data: { restartRecovery: 'manual' },
              },
              { message: 'Human kicked the workflow again', timestamp: '2020-01-01T01:00:00Z' },
            ],
          },
        ],
      })

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      // Marker is no longer latest — the task is eligible again.
      expect(mockStoreRecoverTask).toHaveBeenCalledWith('task-resumed')
    })

    it('escalates to blocked after max auto-recoveries, counted from the persisted field', async () => {
      setWatchdogColumns({
        inProgress: [
          {
            id: 'task-3',
            title: 'Exhausted task',
            agent: 'pixel',
            recoveries: 3,
            log: [{ message: 'Started', timestamp: '2020-01-01T00:00:00Z' }],
          },
        ],
      })

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(mockStoreBlockTask).toHaveBeenCalledWith('task-3', expect.stringContaining('Auto-recovery limit reached (3 attempts)'))
      expect(storeCallOrder.indexOf('block:task-3')).toBeLessThan(storeCallOrder.indexOf('log:task-3'))
      expect(vi.mocked(appendAudit)).toHaveBeenCalledWith(
        tempDir,
        'task.auto_recovery_exhausted',
        'watchdog',
        expect.objectContaining({ id: 'task-3', recoveryCount: 3 }),
      )
    })

    it('legacy "Auto-recovered:" log lines are inert history — a task with recoveries 0 is recovered, not blocked', async () => {
      setWatchdogColumns({
        inProgress: [
          {
            id: 'task-legacy',
            title: 'Pre-upgrade task',
            agent: 'pixel',
            log: [
              { author: 'watchdog', message: 'Auto-recovered: attempt 1', timestamp: '2020-01-01T00:00:00Z' },
              { author: 'watchdog', message: 'Auto-recovered: attempt 2', timestamp: '2020-01-01T01:00:00Z' },
              { author: 'watchdog', message: 'Auto-recovered: attempt 3', timestamp: '2020-01-01T02:00:00Z' },
            ],
          },
        ],
      })

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(mockStoreRecoverTask).toHaveBeenCalledWith('task-legacy')
      expect(mockStoreBlockTask).not.toHaveBeenCalled()
    })

    // ── The activity clock is updatedAt (spec D5) ───────────────────────────
    // margo 2026-10-16: an operator moved a blocked card to Todo at 02:30:33Z,
    // it was dispatched at 02:30:37Z and RE-BLOCKED at 02:31:32Z — staleness
    // was read from the newest log line (the watchdog's own ten-hour-old
    // "Escalated to blocked"), and the recovery count never reset.

    it('a fresh updatedAt with ancient log lines is NOT stuck', async () => {
      setWatchdogColumns({
        inProgress: [
          {
            id: 'task-fresh',
            title: 'Just re-dispatched',
            agent: 'pixel',
            updatedAt: Date.now() - 60 * 1000,
            log: [{ author: 'watchdog', message: 'Escalated to blocked: 3 auto-recoveries exhausted.', timestamp: '2020-01-01T00:00:00Z' }],
          },
        ],
      })

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(mockStoreRecoverTask).not.toHaveBeenCalled()
      expect(mockStoreMoveTask).not.toHaveBeenCalled()
      expect(mockStoreBlockTask).not.toHaveBeenCalled()
      expect(vi.mocked(broadcast)).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'alert' }))
    })

    it('an exhausted counter with a fresh updatedAt is left alone — the grace window applies before the budget', async () => {
      setWatchdogColumns({
        inProgress: [{ id: 'task-fresh-3', title: 'Operator retry', agent: 'pixel', recoveries: 3, updatedAt: Date.now() - 60 * 1000 }],
      })

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(mockStoreBlockTask).not.toHaveBeenCalled()
      expect(mockStoreRecoverTask).not.toHaveBeenCalled()
    })

    // ── Fresh validation at the mutation boundary (spec D9) ─────────────────
    it('a task moved by the operator while the scan awaited an earlier recovery is skipped this tick', async () => {
      setWatchdogColumns({
        inProgress: [
          { id: 'task-a', title: 'First stranded', agent: 'pixel', updatedAt: Date.parse('2020-01-01T00:00:00Z') },
          { id: 'task-b', title: 'Second stranded', agent: 'pixel', updatedAt: Date.parse('2020-01-01T00:00:00Z') },
        ],
      })
      // Recovering task-a yields; during that await the operator moves task-b
      // to Todo (fresh updatedAt, column todo). The snapshot still says stale.
      mockStoreRecoverTask.mockImplementationOnce(async (id: string) => {
        storeCallOrder.push(`recover:${id}`)
        const b = lookupWatchdogTask('task-b')!
        currentWatchdogColumns.inProgress = currentWatchdogColumns.inProgress.filter((t) => t.id !== 'task-b')
        currentWatchdogColumns.todo.push({ ...b, updatedAt: Date.now(), version: (b.version ?? 0) + 1 })
        return undefined
      })

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(mockStoreRecoverTask).toHaveBeenCalledWith('task-a')
      expect(mockStoreRecoverTask).not.toHaveBeenCalledWith('task-b')
      expect(mockStoreBlockTask).not.toHaveBeenCalled()
      expect(mockStoreAddTaskLog).not.toHaveBeenCalledWith('task-b', 'watchdog', expect.anything())
    })

    it('a task whose counter was reset by the operator mid-scan is left for the next tick — never blocked on the stale count', async () => {
      setWatchdogColumns({
        inProgress: [
          { id: 'task-a2', title: 'First stranded', agent: 'pixel', updatedAt: Date.parse('2020-01-01T00:00:00Z'), version: 1 },
          { id: 'task-b2', title: 'Exhausted in the snapshot', agent: 'pixel', recoveries: 3, updatedAt: Date.parse('2020-01-01T00:00:00Z'), version: 7 },
        ],
      })
      // The snapshot the scan iterates must stay stale while the store row moves on.
      const snapshotB = { ...lookupWatchdogTask('task-b2')! }
      mockStoreRecoverTask.mockImplementationOnce(async (id: string) => {
        storeCallOrder.push(`recover:${id}`)
        const b = lookupWatchdogTask('task-b2')!
        b.recoveries = 0
        b.version = 8 // every store write bumps version
        return undefined
      })
      void snapshotB

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(mockStoreBlockTask).not.toHaveBeenCalled()
      expect(mockStoreRecoverTask).not.toHaveBeenCalledWith('task-b2')
    })

    // Code review (PR #975): validation must precede the supersede, or a card
    // the operator just moved still has its stale LIVE run superseded and
    // its turn aborted before the fresh check skips the move.
    it('an operator write during the scan is detected BEFORE a stale live run is superseded or aborted', async () => {
      setWatchdogColumns({
        inProgress: [
          { id: 'task-a3', title: 'First stranded', agent: 'pixel', updatedAt: Date.parse('2020-01-01T00:00:00Z'), version: 1 },
          { id: 'task-b3', title: 'Live but stale run', agent: 'pixel', updatedAt: Date.parse('2020-01-01T00:00:00Z'), version: 3 },
        ],
      })
      // task-b3 holds a live run whose heartbeat is far older than the threshold.
      claimRun({ runId: 'task:task-b3:d1', taskId: 'task-b3', seq: 1, agent: 'pixel', bootId: 'boot-wd', now: Date.now() - 60 * 60 * 1000 })
      mockStoreRecoverTask.mockImplementationOnce(async (id: string) => {
        storeCallOrder.push(`recover:${id}`)
        const b = lookupWatchdogTask('task-b3')!
        b.updatedAt = Date.now()
        b.version = 4 // the operator touched the card during task-a3's recovery
        return undefined
      })

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(getLiveRun('task-b3')?.status).toBe('running')
      expect(abortByRunIdsSpy).not.toHaveBeenCalledWith(['task:task-b3:d1'], 'superseded')
      expect(vi.mocked(appendAudit)).not.toHaveBeenCalledWith(tempDir, 'task.run_superseded', 'watchdog', expect.objectContaining({ id: 'task-b3' }))
      expect(mockStoreRecoverTask).not.toHaveBeenCalledWith('task-b3')
    })

    // #977: a child spawn writes the instance file and the child's own row —
    // never the parent's — so `version` cannot see it, and the child's run is
    // keyed on the child id. The decision re-walks the topology under the
    // dispatch state lock and leaves a changed scope for the next tick.
    it('a workflow child spawned and claimed during the scan is seen — the parent is never recovered on the stale scope (#977)', async () => {
      setWatchdogColumns({
        inProgress: [{ id: 'wf-spawn', title: 'Map parent', agent: 'pixel', workflowId: 'wf', updatedAt: Date.parse('2020-01-01T00:00:00Z'), version: 2 }],
      })
      let walks = 0
      hookInvokeImpl = async (name, data) => {
        const taskId = (data as { taskId?: string } | undefined)?.taskId
        if (name === 'workflows.loadInstance') return taskId === 'wf-spawn' ? { status: 'in_progress' } : null
        if (name !== 'workflows.getActiveAgents') return undefined
        walks += 1
        // Scan: the fan-out step has not claimed yet.
        if (walks === 1) return [{ agent: 'patch', stepId: 'fan' }]
        // Re-walk under the lock: the engine fanned out a child and the
        // dispatcher claimed its step — the parent row is untouched.
        claimRun({ runId: 'child-run', taskId: 'wf-spawn--child-1', execKey: 'wf-spawn--child-1:write', seq: 1, agent: 'pixel', bootId: 'boot-wd', now: Date.now() })
        return [{ agent: 'patch', stepId: 'fan' }, { agent: 'pixel', stepId: 'write', effectiveTaskId: 'wf-spawn--child-1' }]
      }

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(walks).toBe(2)
      expect(mockStoreRecoverTask).not.toHaveBeenCalled()
      expect(mockStoreBlockTask).not.toHaveBeenCalled()
      expect(getLiveRun('wf-spawn--child-1')?.status).toBe('running')
    })

    it('the recovery decision waits for the dispatch state lock — a claim made under it lands first (#977)', async () => {
      setWatchdogColumns({
        inProgress: [{ id: 'task-lock', title: 'Stranded until claimed', agent: 'pixel', updatedAt: Date.parse('2020-01-01T00:00:00Z'), version: 1 }],
      })
      let release!: () => void
      const held = withStateLock(() => new Promise<void>((resolve) => { release = resolve }))

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)
      // The scan saw no live run, but the decision is parked behind the lock.
      expect(mockStoreRecoverTask).not.toHaveBeenCalled()

      // The lock holder (a dispatch cycle) claims the task's run before releasing.
      claimRun({ runId: 'task:task-lock:d1', taskId: 'task-lock', seq: 1, agent: 'pixel', bootId: 'boot-wd', now: Date.now() })
      release()
      await held
      await vi.advanceTimersByTimeAsync(10)

      expect(mockStoreRecoverTask).not.toHaveBeenCalled()
      expect(mockStoreBlockTask).not.toHaveBeenCalled()
      expect(getLiveRun('task-lock')?.status).toBe('running')
    })

    it('a workflow whose topology changed during the scan is left for the next tick, then recovered once it holds still (#977)', async () => {
      setWatchdogColumns({
        inProgress: [{ id: 'wf-shift', title: 'Advancing workflow', agent: 'pixel', workflowId: 'wf', updatedAt: Date.parse('2020-01-01T00:00:00Z'), version: 1 }],
      })
      let walks = 0
      hookInvokeImpl = async (name, data) => {
        const taskId = (data as { taskId?: string } | undefined)?.taskId
        if (name === 'workflows.loadInstance') return taskId === 'wf-shift' ? { status: 'in_progress' } : null
        if (name !== 'workflows.getActiveAgents') return undefined
        walks += 1
        // Tick 1: the scan saw step "a"; the engine advanced to "b" before the
        // re-walk under the lock. Nothing is claimed in either scope.
        return walks === 1 ? [{ agent: 'patch', stepId: 'a' }] : [{ agent: 'patch', stepId: 'b' }]
      }

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)
      // Stale scope → no verdict this tick, even though no run is live.
      expect(walks).toBe(2)
      expect(mockStoreRecoverTask).not.toHaveBeenCalled()

      // Tick 2: both walks see "b" and still nothing live — now it recovers.
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockStoreRecoverTask).toHaveBeenCalledWith('wf-shift')
    })

    it('a claim racing the recovery decision queues behind its lock (#977)', async () => {
      setWatchdogColumns({
        inProgress: [{ id: 'wf-hold', title: 'Decided under the lock', agent: 'pixel', workflowId: 'wf', updatedAt: Date.parse('2020-01-01T00:00:00Z'), version: 1 }],
      })
      let walks = 0
      let releaseWalk!: () => void
      const walkParked = new Promise<void>((resolve) => { releaseWalk = resolve })
      hookInvokeImpl = async (name, data) => {
        const taskId = (data as { taskId?: string } | undefined)?.taskId
        if (name === 'workflows.loadInstance') return taskId === 'wf-hold' ? { status: 'in_progress' } : null
        if (name !== 'workflows.getActiveAgents') return undefined
        walks += 1
        if (walks === 2) await walkParked // the re-walk under the lock parks — the lock stays held
        return [{ agent: 'patch', stepId: 'a' }]
      }

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)
      expect(walks).toBe(2)

      // A dispatch cycle arrives and wants to claim the step under the same lock.
      let claimed = false
      const claim = withStateLock(() => {
        claimRun({ runId: 'wf-hold-a', taskId: 'wf-hold', execKey: 'wf-hold:a', seq: 1, agent: 'patch', bootId: 'boot-wd', now: Date.now() })
        claimed = true
      })
      await vi.advanceTimersByTimeAsync(10)
      expect(claimed).toBe(false)
      expect(mockStoreRecoverTask).not.toHaveBeenCalled()

      releaseWalk()
      await claim
      // Strict order: the recovery verdict (stranded, nothing live) landed
      // first, the claim only after the lock was released.
      expect(claimed).toBe(true)
      expect(mockStoreRecoverTask).toHaveBeenCalledWith('wf-hold')
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
      expect(mockStoreRecoverTask).toHaveBeenCalledWith('hb-stale')
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
  // Workflow step timeout vs budget hold
  // -------------------------------------------------------------------------

  describe('workflow step timeout under budget hold', () => {
    const STEP_STARTED = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2h > 60min timeout

    function wfInstance(over: Record<string, unknown> = {}) {
      return {
        taskId: 'wf-task-1',
        workflowId: 'image-generation',
        currentStepId: 'develop-prompt',
        status: 'in_progress',
        resolvedAgent: 'pixel',
        stepStates: { 'develop-prompt': { status: 'in_progress', startedAt: STEP_STARTED } },
        history: [] as Array<{ stepId: string; rejectionReason?: string }>,
        ...over,
      }
    }

    function armTimeoutSweep(instance: Record<string, unknown>) {
      // Task must be on the board (any column) for the sweep to consider it.
      setWatchdogColumns({ review: [{ id: 'wf-task-1', title: 'Taco image', agent: 'pixel', workflowId: 'image-generation', log: [] }] })
      hookInvokeImpl = async (name: string) =>
        name === 'workflows.instances.list' ? [instance] : undefined
      // Mirror the real store: log writes land on the task so the dedupe
      // read (getTask().log) sees them on the next tick.
      mockStoreAddTaskLog.mockImplementation(async (...args: unknown[]) => {
        const [id, author, message] = args as [string, string, string]
        const t = lookupWatchdogTask(id)
        if (t) (t.log ??= []).push({ message, timestamp: new Date().toISOString(), author } as never)
        return undefined
      })
    }

    it('a budget-held step logs ONE BUDGET HOLD note instead of TIMEOUT spam', async () => {
      armTimeoutSweep(wfInstance())
      budgetGateDecision = { action: 'defer' }

      start(tempDir)
      await vi.advanceTimersByTimeAsync(3500) // three ticks

      const messages = mockStoreAddTaskLog.mock.calls.map((c) => String(c[2]))
      expect(messages.filter((m) => m.startsWith('BUDGET HOLD:'))).toHaveLength(1)
      expect(messages.some((m) => m.startsWith('TIMEOUT:'))).toBe(false)
      expect(mockStoreBlockTask).not.toHaveBeenCalled()
    })

    it('escalation to blocked is suppressed while the hold lasts', async () => {
      armTimeoutSweep(wfInstance({
        history: [
          { stepId: 'develop-prompt', rejectionReason: 'TIMEOUT: 1' },
          { stepId: 'develop-prompt', rejectionReason: 'TIMEOUT: 2' },
          { stepId: 'develop-prompt', rejectionReason: 'TIMEOUT: 3' },
        ],
      }))
      budgetGateDecision = { action: 'defer' }

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      expect(mockStoreBlockTask).not.toHaveBeenCalled()
    })

    it('TIMEOUT logging resumes when the budget gate allows', async () => {
      armTimeoutSweep(wfInstance())
      budgetGateDecision = { action: 'allow' }

      start(tempDir)
      await vi.advanceTimersByTimeAsync(1500)

      const messages = mockStoreAddTaskLog.mock.calls.map((c) => String(c[2]))
      expect(messages.some((m) => m.startsWith('TIMEOUT:'))).toBe(true)
      expect(messages.some((m) => m.startsWith('BUDGET HOLD:'))).toBe(false)
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
              { author: 'pixel', message: 'Working around the error by skipping validation', timestamp: new Date().toISOString() },
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

    it('ignores watchdog own log entries — by author, never by message text', async () => {
      setWatchdogColumns({
        inProgress: [
          {
            id: 'task-safe',
            title: 'Safe task',
            agent: 'pixel',
            log: [
              // A watchdog line whose wording would trip the scan if read as the agent's.
              { author: 'watchdog', message: 'Auto-recovered: the agent was working around the error for 30+ minutes', timestamp: new Date().toISOString() },
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
