/**
 * T3 (#604): in-flight turn abort — registry handles, delete→abort, and the
 * 'aborted' settle branch (clean exit: audit, no recovery ladder, no
 * reconcile fail-noise).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const sentinelContentDir = join(tmpdir(), `bakin-dispatch-abort-content-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => sentinelContentDir,
  getBakinPaths: () => ({ root: sentinelContentDir, home: sentinelContentDir, db: join(sentinelContentDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

const settingsValue = {
  dispatch: {
    intervalMs: 1000,
    maxRetries: 3,
    failureCooldownMs: 30 * 60 * 1000,
    transientCooldownMs: 60 * 1000,
    maxDispatched: 5,
    oversizedOutputBytes: 128 * 1024,
    maxConcurrentTurns: 3,
    maxTurnsPerAgent: 1,
  },
  agentPackages: { lessonsRetrieval: { enabled: false } },
}
mock.module('../../src/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: mock(() => settingsValue),
}))

const auditEvents: Array<{ event: string; agent: string; data: Record<string, unknown> }> = []
const appendAuditMock = mock((_dir: string, event: string, agent: string, data?: Record<string, unknown>) => {
  auditEvents.push({ event, agent, data: data ?? {} })
})
mock.module('../../src/core/audit', () => ({ appendAudit: appendAuditMock }))
mock.module('@/core/audit', () => ({ appendAudit: appendAuditMock }))
mock.module('../../src/core/usage', () => ({ recordUsage: mock() }))

import { RuntimeError } from '../../packages/core/src/adapters/runtime/errors'

// Signal-honoring controllable send: hangs until released or its signal
// aborts (mirroring the adapter contract from T2).
type Pending = { resolve: () => void; reject: (err: unknown) => void }
const pendingSends = new Map<string, Pending[]>()
const sendCalls: Array<{ agentId: string; threadId: string; hadSignal: boolean }> = []

const mockRuntimeSend = mock((args: { agentId: string; threadId: string; signal?: AbortSignal }) => {
  sendCalls.push({ agentId: args.agentId, threadId: args.threadId, hadSignal: Boolean(args.signal) })
  return new Promise((resolve, reject) => {
    args.signal?.addEventListener('abort', () => {
      reject(new RuntimeError('turn aborted', { kind: 'aborted', cause: args.signal?.reason }))
    }, { once: true })
    const queue = pendingSends.get(args.agentId) ?? []
    queue.push({ resolve: () => resolve({ id: 'msg' }), reject })
    pendingSends.set(args.agentId, queue)
  })
})

function releaseSend(agentId: string): void {
  const next = (pendingSends.get(agentId) ?? []).shift()
  if (next) next.resolve()
}

const mockAppServices = {
  runtime: {
    agents: {
      list: async () => [
        { id: 'jessica', name: 'Jessica', status: 'active' },
        { id: 'pixel', name: 'Pixel', status: 'active' },
      ],
    },
    messaging: { send: (...args: unknown[]) => mockRuntimeSend(...(args as [never])) },
  },
}
mock.module('../../src/core/app-services', () => ({ getAppServices: () => mockAppServices }))
mock.module('../../src/core/app-services-store', () => ({ getAppServices: () => mockAppServices }))
mock.module('@/core/app-services', () => ({ getAppServices: () => mockAppServices }))
mock.module('@/core/app-services-store', () => ({ getAppServices: () => mockAppServices }))

type Columns = { backlog: unknown[]; todo: unknown[]; inProgress: unknown[]; review: unknown[]; done: unknown[]; archived: unknown[]; blocked: unknown[] }
let currentColumns: Columns = { backlog: [], todo: [], inProgress: [], review: [], done: [], archived: [], blocked: [] }
function setColumns(c: Partial<Columns>): void {
  currentColumns = { backlog: [], todo: [], inProgress: [], review: [], done: [], archived: [], blocked: [], ...c }
}

const taskStoreMock = {
  readTaskboard: mock(() => ({ columns: currentColumns })),
  addTaskLog: mock(async () => undefined),
  updateTask: mock(async () => undefined),
  moveTask: mock(async () => undefined),
  blockTask: mock(async () => undefined),
}
mock.module('../../src/core/task-store', () => taskStoreMock)
mock.module('@/core/task-store', () => taskStoreMock)

mock.module('../../src/core/plugin-registry', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock(async (hook: string) => (hook === 'workflows.getActiveAgents' ? [] : undefined)),
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock(async (hook: string) => (hook === 'workflows.getActiveAgents' ? [] : undefined)),
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
}))

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => sentinelContentDir,
  getOpenClawPath: (sub: string) => join(sentinelContentDir, sub),
}))

import { dispatchTasks, awaitDispatchIdle, getInFlightTurnCount } from '../../src/core/dispatch'
import { fireDispatchTurn } from '../../src/core/dispatch-turns'
import {
  abortTurnsForTask,
  getInFlightTurnsSnapshot,
  forceReleaseTurn,
} from '../../src/core/dispatch-registry'
import { closeDb } from '../../packages/core/src/storage/db'

let tempDir: string
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

function readStateOrNull(): { failedDispatches?: Record<string, unknown> } | null {
  const p = join(tempDir, '.dispatch-state.json')
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'bakin-dispatch-abort-'))
  pendingSends.clear()
  sendCalls.length = 0
  auditEvents.length = 0
  mockRuntimeSend.mockClear()
})

afterEach(async () => {
  for (const [agent, queue] of pendingSends) {
    while (queue.length) releaseSend(agent)
  }
  await awaitDispatchIdle()
  rmSync(tempDir, { recursive: true, force: true })
})

afterAll(() => {
  closeDb()
  rmSync(sentinelContentDir, { recursive: true, force: true })
})

describe('abortTurnsForTask', () => {
  it('aborts an in-flight turn: slot freed, task.turn_aborted audited, no recovery ladder', async () => {
    setColumns({ todo: [{ id: 't-abort', title: 'Doomed task', agent: 'jessica' }] })
    await dispatchTasks(tempDir, 3737)
    expect(getInFlightTurnCount('jessica')).toBe(1)
    expect(sendCalls[0]?.hadSignal).toBe(true)

    const aborted = abortTurnsForTask('t-abort', 'task-deleted')
    expect(aborted).toBe(1)
    await awaitDispatchIdle()

    expect(getInFlightTurnCount()).toBe(0)
    const abortAudits = auditEvents.filter((e) => e.event === 'task.turn_aborted')
    expect(abortAudits.length).toBe(1)
    expect(abortAudits[0].data.id).toBe('t-abort')
    expect(abortAudits[0].data.reason).toBe('task-deleted')
    // Clean exit: no failure reconciliation, no ladder bookkeeping.
    expect(readStateOrNull()?.failedDispatches ?? {}).toEqual({})
    expect(auditEvents.filter((e) => e.event.startsWith('task.dispatch_failed')).length).toBe(0)
  })

  it('matches workflow-step markers (taskId:stepId) by taskId', async () => {
    setColumns({ inProgress: [{ id: 'wf-1', title: 'Workflow task' }] })
    fireDispatchTurn({
      marker: 'wf-1:step-2',
      task: { id: 'wf-1', title: 'Workflow task' } as never,
      targetAgent: 'pixel',
      threadId: 'task:wf-1:step:step-2:d1',
      message: 'do the step',
      contentDir: tempDir,
      port: 3737,
      initialLogCount: 0,
      logPrefix: 'test',
      dispatchKind: 'workflow',
    })
    await tick()
    expect(getInFlightTurnCount('pixel')).toBe(1)

    expect(abortTurnsForTask('wf-1', 'orphan-sweep')).toBe(1)
    await awaitDispatchIdle()
    expect(getInFlightTurnCount()).toBe(0)
    const audit = auditEvents.find((e) => e.event === 'task.turn_aborted')
    expect(audit?.data.reason).toBe('orphan-sweep')
  })

  it('aborts a nested-workflow step turn by its CHILD task id (review F0)', async () => {
    setColumns({ inProgress: [
      { id: 'parent-1', title: 'Parent workflow task' },
      { id: 'parent-1--sub', title: 'Child (sub-workflow)' },
    ] })
    fireDispatchTurn({
      marker: 'parent-1:nested-step',
      task: { id: 'parent-1', title: 'Parent workflow task' } as never,
      targetAgent: 'pixel',
      threadId: 'task:parent-1:step:nested-step:d1',
      message: 'work the child step',
      contentDir: tempDir,
      port: 3737,
      initialLogCount: 0,
      logPrefix: 'test',
      dispatchKind: 'workflow',
      childTaskId: 'parent-1--sub',
    })
    await tick()
    expect(getInFlightTurnCount('pixel')).toBe(1)

    // Deleting the CHILD board task aborts the parent-registered step turn.
    expect(abortTurnsForTask('parent-1--sub', 'task-deleted')).toBe(1)
    await awaitDispatchIdle()
    expect(getInFlightTurnCount()).toBe(0)
    expect(auditEvents.filter((e) => e.event === 'task.turn_aborted').length).toBe(1)
  })

  it('fire-time guard: a turn for a task deleted between claim and fire never sends (review F3)', async () => {
    // Task is NOT on the board — simulates deleteTask interleaving between
    // the cycle's phase-1 claim and the phase-2 fire.
    setColumns({})
    fireDispatchTurn({
      marker: 't-gone',
      task: { id: 't-gone', title: 'Deleted before fire' } as never,
      targetAgent: 'pixel',
      threadId: 'task:t-gone:d1',
      message: 'never sent',
      contentDir: tempDir,
      port: 3737,
      initialLogCount: 0,
      logPrefix: 'test',
      dispatchKind: 'regular',
    })
    await awaitDispatchIdle()

    expect(sendCalls.length).toBe(0)
    expect(getInFlightTurnCount()).toBe(0)
    const audit = auditEvents.find((e) => e.event === 'task.turn_aborted')
    expect(audit?.data.id).toBe('t-gone')
    expect(audit?.data.reason).toBe('task-deleted')
  })

  it('is idempotent: a second abort of the same turn is a no-op', async () => {
    setColumns({ todo: [{ id: 't-twice', title: 'Abort twice', agent: 'jessica' }] })
    await dispatchTasks(tempDir, 3737)
    expect(abortTurnsForTask('t-twice', 'task-deleted')).toBe(1)
    expect(abortTurnsForTask('t-twice', 'task-deleted')).toBe(0)
    await awaitDispatchIdle()
    expect(auditEvents.filter((e) => e.event === 'task.turn_aborted').length).toBe(1)
  })

  it('abort after natural settle is a benign no-op (race pinned)', async () => {
    setColumns({ todo: [{ id: 't-done', title: 'Finishes first', agent: 'jessica' }] })
    await dispatchTasks(tempDir, 3737)
    releaseSend('jessica')
    await awaitDispatchIdle()
    expect(getInFlightTurnCount()).toBe(0)

    expect(abortTurnsForTask('t-done', 'task-deleted')).toBe(0)
    expect(auditEvents.filter((e) => e.event === 'task.turn_aborted').length).toBe(0)
  })
})

describe('registry threadId keying — supersede-refire (same-agent-concurrency D3)', () => {
  const fireAttempt = (threadId: string): void => {
    fireDispatchTurn({
      marker: 't-super',
      task: { id: 't-super', title: 'Supersede me' } as never,
      targetAgent: 'jessica',
      threadId,
      message: 'attempt',
      contentDir: tempDir,
      port: 3737,
      initialLogCount: 0,
      logPrefix: 'test',
      dispatchKind: 'regular',
    })
  }

  it('a superseded-then-refired marker holds two entries; the zombie settle releases only its own', async () => {
    setColumns({ todo: [{ id: 't-super', title: 'Supersede me', agent: 'jessica' }] })

    // d1 fires and hangs (the zombie-to-be).
    fireAttempt('task:t-super:d1')
    await tick()
    expect(getInFlightTurnCount('jessica')).toBe(1)

    // Watchdog supersedes: d1 aborted, task refires as d2 under the SAME marker
    // while d1's abort rejection is still in flight.
    expect(abortTurnsForTask('t-super', 'superseded')).toBe(1)
    fireAttempt('task:t-super:d2')
    await tick()

    // d1's abort has settled by now; d2 must survive it — the old marker-keyed
    // registry let d1's finally DELETE d2's live entry (uncounted, unabortable).
    expect(getInFlightTurnCount('jessica')).toBe(1)
    const snap = getInFlightTurnsSnapshot()
    expect(snap.length).toBe(1)
    expect(snap[0].threadId).toBe('task:t-super:d2')
    expect(snap[0].marker).toBe('t-super')

    // d2 is still abortable through its task id.
    expect(abortTurnsForTask('t-super', 'task-deleted')).toBe(1)
    await awaitDispatchIdle()
    expect(getInFlightTurnCount()).toBe(0)
  })

  it('the aborted zombie still counts against the gate until it settles (documented transient)', async () => {
    setColumns({ todo: [{ id: 't-super', title: 'Supersede me', agent: 'jessica' }] })
    fireAttempt('task:t-super:d1')
    await tick()

    // Abort d1 and refire d2 in the same synchronous window: the abort
    // rejection hasn't run its finally yet, so BOTH attempts are counted —
    // the documented transient double-count (safe choice: an early-freed
    // slot on a serialized runtime would mean shared-workspace overlap).
    abortTurnsForTask('t-super', 'superseded')
    fireAttempt('task:t-super:d2')
    expect(getInFlightTurnCount('jessica')).toBe(2)

    // The zombie's rejection settles on its own; only its entry drops.
    await tick()
    expect(getInFlightTurnCount('jessica')).toBe(1)

    abortTurnsForTask('t-super', 'task-deleted')
    await awaitDispatchIdle()
    expect(getInFlightTurnCount()).toBe(0)
  })

  it('re-registering a live threadId audits dispatch.registry_clobber', async () => {
    setColumns({ todo: [{ id: 't-super', title: 'Supersede me', agent: 'jessica' }] })
    fireAttempt('task:t-super:d1')
    await tick()
    fireAttempt('task:t-super:d1')
    await tick()

    expect(auditEvents.some((e) => e.event === 'dispatch.registry_clobber')).toBe(true)
    abortTurnsForTask('t-super', 'task-deleted')
    await awaitDispatchIdle()
    // Release any stragglers so afterEach drains cleanly.
    releaseSend('jessica')
  })
})

describe('registry snapshot + force release', () => {
  it('snapshot exposes advisory turn facts; forceReleaseTurn frees the slot', async () => {
    setColumns({ todo: [{ id: 't-snap', title: 'Snapshot me', agent: 'jessica' }] })
    await dispatchTasks(tempDir, 3737)

    const snapshot = getInFlightTurnsSnapshot()
    expect(snapshot.length).toBe(1)
    expect(snapshot[0].taskId).toBe('t-snap')
    expect(snapshot[0].agentId).toBe('jessica')
    expect(snapshot[0].marker).toBe('t-snap')
    expect(snapshot[0].abortedAt).toBeUndefined()

    abortTurnsForTask('t-snap', 'orphan-sweep')
    const after = getInFlightTurnsSnapshot()
    // The abort settles asynchronously; abortedAt is stamped synchronously.
    if (after.length > 0) expect(after[0].abortedAt).toBeGreaterThan(0)

    // Simulate a hung turn that never settles: force-release clears the slot
    // (keyed by threadId — the run identity — not the task marker).
    expect(forceReleaseTurn(after[0]?.threadId ?? 'missing')).toBe(after.length > 0)
    expect(getInFlightTurnCount()).toBe(0)
    // Force-release detaches the settle chain from awaitDispatchIdle — give
    // the zombie's catch handler a tick to run its bookkeeping.
    await tick()
    // The audit reason survives force-release (it rides the abort signal,
    // not the registry entry).
    const audit = auditEvents.find((e) => e.event === 'task.turn_aborted')
    expect(audit?.data.reason).toBe('orphan-sweep')
  })
})
