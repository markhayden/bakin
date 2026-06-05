/**
 * Concurrent dispatch tests (session-death hardening P11, Checkpoint 4).
 *
 * The dispatch cycle fires sends and returns — one slow 10-minute turn must
 * not stall dispatching to other agents (the old serial-await loop blocked
 * the entire board, and the 3-min mutex force-release could overlap cycles
 * mid-send). Caps bound the parallelism; settle handlers reconcile.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const sentinelContentDir = join(tmpdir(), `bakin-dispatch-conc-content-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => sentinelContentDir,
  getBakinPaths: () => ({ root: sentinelContentDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => sentinelContentDir,
  getBakinPaths: () => ({ root: sentinelContentDir }),
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

const settingsValue = {
  dispatch: {
    intervalMs: 1000,
    maxRetries: 3,
    failureCooldownMs: 30 * 60 * 1000,
    transientCooldownMs: 60 * 1000,
    maxDispatched: 5, // small so the cap fix is observable
    oversizedOutputBytes: 128 * 1024,
    maxConcurrentTurns: 3,
    maxTurnsPerAgent: 1,
  },
  agentPackages: { lessonsRetrieval: { enabled: false } },
}
mock.module('../../src/core/settings', () => ({
  getSettings: mock(() => settingsValue),
}))

mock.module('../../src/core/audit', () => ({ appendAudit: mock() }))
mock.module('@/core/audit', () => ({ appendAudit: mock() }))
mock.module('../../src/core/usage', () => ({ recordUsage: mock() }))

// Per-agent controllable send: resolves when the test releases it.
type Pending = { resolve: () => void; reject: (err: unknown) => void }
const pendingSends = new Map<string, Pending[]>()
const sendCalls: Array<{ agentId: string; threadId: string; startedAt: number }> = []

const mockRuntimeSend = mock((args: { agentId: string; threadId: string }) => {
  sendCalls.push({ agentId: args.agentId, threadId: args.threadId, startedAt: Date.now() })
  return new Promise((resolve, reject) => {
    const queue = pendingSends.get(args.agentId) ?? []
    queue.push({ resolve: () => resolve({ id: 'msg' }), reject })
    pendingSends.set(args.agentId, queue)
  })
})

function releaseSend(agentId: string, outcome: 'ok' | 'error' = 'ok'): void {
  const queue = pendingSends.get(agentId) ?? []
  const next = queue.shift()
  if (!next) throw new Error(`no pending send for ${agentId}`)
  if (outcome === 'ok') next.resolve()
  else next.reject(new Error('released as failure'))
}

const mockAppServices = {
  runtime: {
    agents: {
      list: async () => [
        { id: 'main', name: 'Main', status: 'active' },
        { id: 'jessica', name: 'Jessica', status: 'active' },
        { id: 'pixel', name: 'Pixel', status: 'active' },
      ],
    },
    messaging: { send: (...args: unknown[]) => mockRuntimeSend(...(args as [never])) },
  },
}
mock.module('../../src/core/app-services', () => ({ getAppServices: () => mockAppServices }))
mock.module('@/core/app-services', () => ({ getAppServices: () => mockAppServices }))

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

mock.module('../../src/lib/plugin-registry', () => ({
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

import { dispatchTasks, dispatchSingleTask, awaitDispatchIdle, getInFlightTurnCount } from '../../src/core/dispatch'

let tempDir: string

function readState() {
  return JSON.parse(readFileSync(join(tempDir, '.dispatch-state.json'), 'utf-8'))
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'bakin-dispatch-conc-'))
  pendingSends.clear()
  sendCalls.length = 0
  mockRuntimeSend.mockClear()
  settingsValue.dispatch.maxConcurrentTurns = 3
  settingsValue.dispatch.maxTurnsPerAgent = 1
})

afterEach(async () => {
  // Drain anything left in flight so settle handlers can't leak across tests.
  for (const [agent, queue] of pendingSends) {
    while (queue.length) releaseSend(agent)
  }
  await awaitDispatchIdle()
  rmSync(tempDir, { recursive: true, force: true })
})

afterAll(() => {
  rmSync(sentinelContentDir, { recursive: true, force: true })
})

describe('concurrent dispatch', () => {
  it('a slow turn for one agent does not delay dispatching another agent (the incident bottleneck)', async () => {
    setColumns({
      todo: [
        { id: 't-slow', title: 'Slow jessica task', agent: 'jessica' },
        { id: 't-fast', title: 'Fast pixel task', agent: 'pixel' },
      ],
    })

    const cycleStart = Date.now()
    await dispatchTasks(tempDir, 3737) // returns without awaiting either turn
    const cycleDuration = Date.now() - cycleStart

    // Both sends fired in one cycle; the cycle didn't wait for any turn.
    expect(sendCalls.map((c) => c.agentId).sort()).toEqual(['jessica', 'pixel'])
    expect(cycleDuration).toBeLessThan(1000)
    expect(getInFlightTurnCount()).toBe(2)

    // pixel finishes while jessica is still mid-turn.
    releaseSend('pixel')
    await tick()
    expect(getInFlightTurnCount('pixel')).toBe(0)
    expect(getInFlightTurnCount('jessica')).toBe(1)

    releaseSend('jessica')
    await awaitDispatchIdle()
    expect(getInFlightTurnCount()).toBe(0)
  })

  it('respects the per-agent cap: a second task for a busy agent waits for a later cycle', async () => {
    setColumns({
      todo: [
        { id: 't-a', title: 'First jessica task', agent: 'jessica' },
        { id: 't-b', title: 'Second jessica task', agent: 'jessica' },
      ],
    })

    await dispatchTasks(tempDir, 3737)
    expect(sendCalls.length).toBe(1) // t-b deferred by agent_busy, no failure recorded
    expect(readState().failedDispatches['t-b']).toBeUndefined()

    releaseSend('jessica')
    await awaitDispatchIdle()

    // Next cycle picks up the deferred task.
    setColumns({ todo: [{ id: 't-b', title: 'Second jessica task', agent: 'jessica' }] })
    await dispatchTasks(tempDir, 3737)
    expect(sendCalls.length).toBe(2)
    expect(sendCalls[1]?.agentId).toBe('jessica')
    releaseSend('jessica')
    await awaitDispatchIdle()
  })

  it('respects the global cap across agents', async () => {
    settingsValue.dispatch.maxConcurrentTurns = 1
    setColumns({
      todo: [
        { id: 't-1', title: 'Jessica task', agent: 'jessica' },
        { id: 't-2', title: 'Pixel task', agent: 'pixel' },
      ],
    })

    await dispatchTasks(tempDir, 3737)
    expect(sendCalls.length).toBe(1)
    expect(getInFlightTurnCount()).toBe(1)

    releaseSend(sendCalls[0]!.agentId)
    await awaitDispatchIdle()
  })

  it('a manual kick interleaves while a cycle turn is still in flight', async () => {
    setColumns({ todo: [{ id: 't-long', title: 'Long task', agent: 'jessica' }] })
    await dispatchTasks(tempDir, 3737)
    expect(getInFlightTurnCount()).toBe(1)

    // While jessica's turn is pending, a kick for pixel goes through
    // immediately — the lock no longer spans sends.
    setColumns({
      todo: [{ id: 't-kick', title: 'Kicked task', agent: 'pixel' }],
      inProgress: [{ id: 't-long', title: 'Long task', agent: 'jessica' }],
    })
    await dispatchSingleTask('t-kick', tempDir, 3737, 'kick')
    expect(sendCalls.map((c) => c.agentId)).toEqual(['jessica', 'pixel'])

    releaseSend('pixel')
    releaseSend('jessica')
    await awaitDispatchIdle()
  })

  it('never double-dispatches a task across overlapping cycles', async () => {
    setColumns({ todo: [{ id: 't-once', title: 'Dispatch once', agent: 'jessica' }] })
    await dispatchTasks(tempDir, 3737)

    // A second cycle while the turn is in flight must not re-send: the
    // dispatched marker + in-flight registry both guard it.
    await dispatchTasks(tempDir, 3737)
    await dispatchSingleTask('t-once', tempDir, 3737, 'kick')

    expect(sendCalls.length).toBe(1)
    releaseSend('jessica')
    await awaitDispatchIdle()
  })

  it('honors the maxDispatched setting when trimming markers (500-vs-200 bug fix)', async () => {
    setColumns({ todo: [{ id: 't-trim', title: 'Trim check', agent: 'jessica' }] })
    // Pre-seed state with more markers than the cap.
    const { writeFileSync, mkdirSync } = await import('fs')
    mkdirSync(tempDir, { recursive: true })
    writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify({
      lastRun: null,
      serverStart: Date.now(),
      dispatched: Array.from({ length: 9 }, (_, i) => `old-${i}`),
      failedDispatches: {},
    }))

    await dispatchTasks(tempDir, 3737)
    releaseSend('jessica')
    await awaitDispatchIdle()

    // Trimmed to exactly maxDispatched (5), not a hardcoded 200.
    expect(readState().dispatched.length).toBeLessThanOrEqual(settingsValue.dispatch.maxDispatched)
  })

  it('settle reconciliation records a failure without blocking other in-flight turns', async () => {
    setColumns({
      todo: [
        { id: 't-fail', title: 'Will fail', agent: 'jessica' },
        { id: 't-ok', title: 'Will succeed', agent: 'pixel' },
      ],
    })
    await dispatchTasks(tempDir, 3737)

    releaseSend('jessica', 'error')
    await tick(50)
    // jessica's failure is reconciled while pixel is still mid-turn.
    expect(readState().failedDispatches['t-fail']).toBeDefined()
    expect(getInFlightTurnCount('pixel')).toBe(1)

    releaseSend('pixel')
    await awaitDispatchIdle()
    expect(readState().failedDispatches['t-ok']).toBeUndefined()
  })
})
