/**
 * Concurrent dispatch tests (session-death hardening P11, Checkpoint 4).
 *
 * The dispatch cycle fires sends and returns — one slow 10-minute turn must
 * not stall dispatching to other agents (the old serial-await loop blocked
 * the entire board, and the 3-min mutex force-release could overlap cycles
 * mid-send). Caps bound the parallelism; settle handlers reconcile.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'
import { tmpdir } from 'os'

const sentinelContentDir = join(tmpdir(), `bakin-dispatch-conc-content-${Date.now()}`)
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
    maxDispatched: 5, // small so the cap fix is observable
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

const auditEvents: Array<{ event: string; data: Record<string, unknown> }> = []
const appendAuditMock = mock((_dir: string, event: string, _agent: string, data?: Record<string, unknown>) => {
  auditEvents.push({ event, data: data ?? {} })
})
mock.module('../../src/core/audit', () => ({ appendAudit: appendAuditMock }))
mock.module('@/core/audit', () => ({ appendAudit: appendAuditMock }))
mock.module('../../src/core/usage', () => ({ recordUsage: mock() }))

// Per-agent controllable send: resolves when the test releases it.
type Pending = { resolve: () => void; reject: (err: unknown) => void }
const pendingSends = new Map<string, Pending[]>()
const sendCalls: Array<{ agentId: string; threadId: string; startedAt: number; runWorkspace?: string }> = []
// Capability-declared concurrency mode for the mock runtime (settable per test).
let mockSameAgentTurns: 'isolated' | 'serialized' = 'serialized'

const mockRuntimeSend = mock((args: { agentId: string; threadId: string; runWorkspace?: string }) => {
  sendCalls.push({ agentId: args.agentId, threadId: args.threadId, startedAt: Date.now(), ...(args.runWorkspace ? { runWorkspace: args.runWorkspace } : {}) })
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
    capabilities: async () => ({ concurrency: { sameAgentTurns: mockSameAgentTurns } }),
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

// Configurable hook responses — workflow-path tests install step rosters;
// everything else falls through to the empty defaults.
const hookResponses = new Map<string, unknown>()
const invokeHook = async (hook: string): Promise<unknown> => {
  if (hookResponses.has(hook)) return hookResponses.get(hook)
  return hook === 'workflows.getActiveAgents' ? [] : undefined
}
mock.module('../../src/core/plugin-registry', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock(invokeHook),
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock(invokeHook),
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
}))

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => sentinelContentDir,
  getOpenClawPath: (sub: string) => join(sentinelContentDir, sub),
}))

import { dispatchTasks, dispatchSingleTask, awaitDispatchIdle, getInFlightTurnCount } from '../../src/core/dispatch'
import { resetSameAgentTurnsModeCache } from '../../src/core/dispatch-turns'
import { readRunSidecar } from '../../src/core/run-workspace'
import { getLiveRun } from '../../src/core/execution-ledger'
import { closeDb } from '../../packages/core/src/storage/db'

let tempDir: string

function readState() {
  return JSON.parse(readFileSync(join(tempDir, '.dispatch-state.json'), 'utf-8'))
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'bakin-dispatch-conc-'))
  pendingSends.clear()
  sendCalls.length = 0
  auditEvents.length = 0
  hookResponses.clear()
  mockRuntimeSend.mockClear()
  mockSameAgentTurns = 'serialized'
  resetSameAgentTurnsModeCache()
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
  closeDb()
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

  it('isolated runtime + cap 2: two same-agent tasks fire concurrently with DISTINCT run workspaces', async () => {
    mockSameAgentTurns = 'isolated'
    settingsValue.dispatch.maxTurnsPerAgent = 2
    setColumns({ todo: [
      { id: 'iso-a', title: 'First', agent: 'jessica' },
      { id: 'iso-b', title: 'Second', agent: 'jessica' },
    ] })

    await dispatchTasks(tempDir, 3737)
    await tick()

    const jessicaSends = sendCalls.filter((c) => c.agentId === 'jessica')
    expect(jessicaSends.length).toBe(2)
    const [wsA, wsB] = jessicaSends.map((c) => c.runWorkspace)
    expect(wsA).toContain('run-workspaces/jessica/')
    expect(wsB).toContain('run-workspaces/jessica/')
    expect(wsA).not.toBe(wsB)
    // Sidecars are born 'running' and settle 'ok' with the turn.
    expect(readRunSidecar(wsA!)?.status).toBe('running')
    releaseSend('jessica')
    releaseSend('jessica')
    await awaitDispatchIdle()
    expect(readRunSidecar(wsA!)?.status).toBe('settled')
    expect(readRunSidecar(wsA!)?.outcome).toBe('ok')
    expect(readRunSidecar(wsB!)?.status).toBe('settled')
  })

  it('repo-BOUND task on an isolated runtime: worktree materialized, cwd = checkout, branch survives successful settle, worktree removed', async () => {
    mockSameAgentTurns = 'isolated'
    // Real bound repo inside an allowlisted root under the mocked content dir.
    const allowedRoot = join(sentinelContentDir, 'code')
    const repo = join(allowedRoot, 'proj')
    mkdirSync(repo, { recursive: true })
    execFileSync('git', ['init', '-q', repo])
    execFileSync('git', ['-C', repo, 'config', 'user.email', 't@bakin.local'])
    execFileSync('git', ['-C', repo, 'config', 'user.name', 'T'])
    writeFileSync(join(repo, 'README.md'), 'x')
    execFileSync('git', ['-C', repo, 'add', '-A'])
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init'])
    mkdirSync(join(sentinelContentDir, 'plugin-settings'), { recursive: true })
    writeFileSync(join(sentinelContentDir, 'plugin-settings', 'git.json'), JSON.stringify({ allowedRepoRoots: [allowedRoot] }))

    setColumns({ todo: [{ id: 'bound-1', title: 'Repo work', agent: 'jessica', repoPath: repo }] })
    await dispatchTasks(tempDir, 3737)
    await tick(50)

    const send = sendCalls.find((c) => c.agentId === 'jessica')
    expect(send?.runWorkspace?.endsWith('/repo')).toBe(true)
    expect(existsSync(join(send!.runWorkspace!, 'README.md'))).toBe(true)
    const branch = execFileSync('git', ['-C', send!.runWorkspace!, 'branch', '--show-current'], { encoding: 'utf-8' }).trim()
    expect(branch.startsWith('bakin/run/task-bound-1-d')).toBe(true)
    expect(auditEvents.some((e) => e.event === 'task.worktree_materialized')).toBe(true)

    releaseSend('jessica')
    await awaitDispatchIdle()
    await tick(100) // async worktree removal after settle

    // Worktree died at settle; the branch (the deliverable) survives.
    expect(existsSync(send!.runWorkspace!)).toBe(false)
    const branches = execFileSync('git', ['-C', repo, 'branch', '--list', 'bakin/run/*'], { encoding: 'utf-8' })
    expect(branches).toContain('bakin/run/task-bound-1-d')
  })

  it('a bound task with an EMPTY allowlist blocks FAST with the real reason (never a generic retry grind)', async () => {
    mockSameAgentTurns = 'isolated'
    const repo = join(sentinelContentDir, 'code', 'proj') // exists from prior test
    writeFileSync(join(sentinelContentDir, 'plugin-settings', 'git.json'), JSON.stringify({ allowedRepoRoots: [] }))

    setColumns({ todo: [{ id: 'bound-2', title: 'Refused repo work', agent: 'pixel', repoPath: repo }] })
    await dispatchTasks(tempDir, 3737)
    await awaitDispatchIdle()

    // No send fired; the dir was cleaned eagerly.
    expect(sendCalls.some((c) => c.agentId === 'pixel')).toBe(false)
    expect(existsSync(join(sentinelContentDir, 'run-workspaces', 'pixel'))
      ? readdirSync(join(sentinelContentDir, 'run-workspaces', 'pixel')).length
      : 0).toBe(0)
    // Configuration problems are deterministic: blocked IMMEDIATELY with the
    // binding error's own remediation text — never 5x30-min generic retries
    // ending in a false "agent may be unavailable" (UI review #1).
    expect(taskStoreMock.blockTask).toHaveBeenCalledWith('bound-2', expect.stringContaining('allowedRepoRoots is not configured'))
    expect(auditEvents.some((e) => e.event === 'task.repo_binding_blocked')).toBe(true)
    expect(auditEvents.some((e) => e.event === 'task.dispatch_failed' && e.data.id === 'bound-2')).toBe(false)
  })

  it('serialized runtime clamps the per-agent cap to 1 with a once-per-boot audit; sends carry NO runWorkspace', async () => {
    settingsValue.dispatch.maxTurnsPerAgent = 3
    setColumns({ todo: [
      { id: 'ser-a', title: 'First', agent: 'jessica' },
      { id: 'ser-b', title: 'Second', agent: 'jessica' },
    ] })

    await dispatchTasks(tempDir, 3737)
    await tick()

    const jessicaSends = sendCalls.filter((c) => c.agentId === 'jessica')
    expect(jessicaSends.length).toBe(1)
    expect(jessicaSends[0].runWorkspace).toBeUndefined()
    expect(auditEvents.filter((e) => e.event === 'dispatch.concurrency_clamped').length).toBe(1)

    // A second cycle does not re-audit the standing clamp.
    releaseSend('jessica')
    await awaitDispatchIdle()
    await dispatchTasks(tempDir, 3737)
    await tick()
    expect(auditEvents.filter((e) => e.event === 'dispatch.concurrency_clamped').length).toBe(1)
    releaseSend('jessica')
    await awaitDispatchIdle()
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

  it('CONTROL: a lone workflow step fires through this harness', async () => {
    hookResponses.set('workflows.getActiveAgents', [{ agent: 'jessica', stepId: 's1' }])
    hookResponses.set('workflows.getCurrentStep', { stepId: 's1', label: 'Step 1', instructions: 'do it' })
    setColumns({ todo: [{ id: 'wf-solo', title: 'Solo workflow', agent: 'jessica', workflowId: 'wf' }] })

    await dispatchTasks(tempDir, 3737)
    await tick()

    expect(sendCalls.filter((c) => c.agentId === 'jessica').length).toBe(1)

    releaseSend('jessica')
    await awaitDispatchIdle()
  })

  it('workflow steps respect the per-agent cap against collected-but-unfired cycle turns (D3 live bug)', async () => {
    // A regular task for jessica is COLLECTED (phase 1 — invisible to the
    // registry until phase 2 fires it) while a workflow step for the same
    // agent is encountered later in the same loop. The workflow path fires
    // immediately, so its gate must see the reserved slot or both dispatch
    // at cap 1 — the exact shared-workspace breach the cap exists to stop.
    hookResponses.set('workflows.getActiveAgents', [{ agent: 'jessica', stepId: 's1' }])
    hookResponses.set('workflows.getCurrentStep', { stepId: 's1', label: 'Step 1', instructions: 'do it' })
    setColumns({ todo: [
      { id: 'reg-1', title: 'Regular first', agent: 'jessica' },
      { id: 'wf-1', title: 'Workflow second', agent: 'jessica', workflowId: 'wf' },
    ] })

    await dispatchTasks(tempDir, 3737)
    await tick()

    // Only the regular turn fires this cycle; the step defers with no failure.
    expect(sendCalls.filter((c) => c.agentId === 'jessica').length).toBe(1)
    expect(getInFlightTurnCount('jessica')).toBe(1)
    expect(auditEvents.filter((e) => e.event.startsWith('task.dispatch_failed')).length).toBe(0)

    releaseSend('jessica')
    await awaitDispatchIdle()
  })

  it('workflow steps respect the GLOBAL cap against collected-but-unfired cycle turns', async () => {
    settingsValue.dispatch.maxConcurrentTurns = 2
    hookResponses.set('workflows.getActiveAgents', [{ agent: 'main', stepId: 's1' }])
    hookResponses.set('workflows.getCurrentStep', { stepId: 's1', label: 'Step 1', instructions: 'do it' })
    setColumns({ todo: [
      { id: 'reg-a', title: 'A', agent: 'jessica' },
      { id: 'reg-b', title: 'B', agent: 'pixel' },
      { id: 'wf-2', title: 'Workflow third', agent: 'main', workflowId: 'wf' },
    ] })

    await dispatchTasks(tempDir, 3737)
    await tick()

    // Two regulars reserve the whole global budget; the step must wait.
    expect(sendCalls.length).toBe(2)
    expect(sendCalls.some((c) => c.agentId === 'main')).toBe(false)

    releaseSend('jessica')
    releaseSend('pixel')
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

  it('claim suppresses a re-dispatch even when the in-memory markers are GONE (second process / lost state)', async () => {
    // SPEC §8 test #3 — the guarantee markers can't give. A live turn is in
    // flight; the dispatch state file is wiped (simulating a second server
    // process or lost markers). Before the ledger, this re-sent the task.
    setColumns({ todo: [{ id: 't-claimed', title: 'Claimed task', agent: 'jessica' }] })
    await dispatchTasks(tempDir, 3737)
    expect(sendCalls.length).toBe(1)
    expect(getLiveRun('t-claimed')?.runId).toBe('task:t-claimed:d1')

    // Wipe every advisory marker — only the ledger claim remains.
    const { writeFileSync } = await import('fs')
    writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify({
      lastRun: null, serverStart: Date.now(), dispatched: [], failedDispatches: {},
    }))
    setColumns({ todo: [{ id: 't-claimed', title: 'Claimed task', agent: 'pixel' }] })

    await dispatchTasks(tempDir, 3737)
    await dispatchSingleTask('t-claimed', tempDir, 3737, 'kick')

    expect(sendCalls.length).toBe(1) // suppressed by the claim, not markers
    const suppressions = auditEvents.filter((e) => e.event === 'task.dispatch_suppressed')
    expect(suppressions.length).toBeGreaterThanOrEqual(2) // cycle + kick
    expect(suppressions[0]?.data.liveRunId).toBe('task:t-claimed:d1')

    releaseSend('jessica')
    await awaitDispatchIdle()
  })

  it('settle frees the claim and the next dispatch mints the next seq', async () => {
    setColumns({ todo: [{ id: 't-seq', title: 'Seq task', agent: 'jessica' }] })
    await dispatchTasks(tempDir, 3737)
    expect(sendCalls[0]?.threadId).toBe('task:t-seq:d1')
    releaseSend('jessica')
    await awaitDispatchIdle()
    expect(getLiveRun('t-seq')).toBeNull()

    // Task back in todo (e.g. watchdog recovery) — fresh claim, next seq.
    const { writeFileSync } = await import('fs')
    writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify({
      lastRun: null, serverStart: Date.now(), dispatched: [], failedDispatches: {},
    }))
    setColumns({ todo: [{ id: 't-seq', title: 'Seq task', agent: 'jessica' }] })
    await dispatchTasks(tempDir, 3737)

    expect(sendCalls[1]?.threadId).toBe('task:t-seq:d2') // never reuses d1
    releaseSend('jessica')
    await awaitDispatchIdle()
  })

  it('a failed turn settles its claim as failed and a retry can claim anew', async () => {
    setColumns({ todo: [{ id: 't-retry', title: 'Retry task', agent: 'jessica' }] })
    await dispatchTasks(tempDir, 3737)
    releaseSend('jessica', 'error')
    await awaitDispatchIdle()
    expect(getLiveRun('t-retry')).toBeNull() // slot freed for the retry path

    // Clear cooldown bookkeeping and re-dispatch — claim succeeds with d2.
    const { writeFileSync } = await import('fs')
    writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify({
      lastRun: null, serverStart: Date.now(), dispatched: [], failedDispatches: {},
    }))
    setColumns({ todo: [{ id: 't-retry', title: 'Retry task', agent: 'jessica' }] })
    await dispatchTasks(tempDir, 3737)
    expect(sendCalls[1]?.threadId).toBe('task:t-retry:d2')
    releaseSend('jessica')
    await awaitDispatchIdle()
  })

  it('a dispatch-prep failure releases the claim instead of wedging the task', async () => {
    setColumns({ todo: [{ id: 't-prep', title: 'Prep fails', agent: 'jessica' }] })
    // moveTaskToInProgress (via task-store.updateTask) blows up once.
    taskStoreMock.updateTask.mockImplementationOnce(async () => {
      throw new Error('store hiccup')
    })

    await dispatchTasks(tempDir, 3737)
    expect(sendCalls.length).toBe(0)
    expect(getLiveRun('t-prep')).toBeNull() // claim released (lost)

    // Next cycle dispatches cleanly with the NEXT seq.
    const { writeFileSync } = await import('fs')
    writeFileSync(join(tempDir, '.dispatch-state.json'), JSON.stringify({
      lastRun: null, serverStart: Date.now(), dispatched: [], failedDispatches: {},
    }))
    setColumns({ todo: [{ id: 't-prep', title: 'Prep fails', agent: 'jessica' }] })
    await dispatchTasks(tempDir, 3737)
    expect(sendCalls.length).toBe(1)
    expect(sendCalls[0]?.threadId).toBe('task:t-prep:d2')
    releaseSend('jessica')
    await awaitDispatchIdle()
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
