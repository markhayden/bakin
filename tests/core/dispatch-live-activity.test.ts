/**
 * T9 (prelaunch-hardening PR 1b): live turn activity — dispatch forwards the
 * adapter's onActivity tap to an EPHEMERAL SSE broadcast. Nothing is
 * persisted (no task log, no audit row); late chunks after the turn settles
 * are dropped silently.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const sentinelContentDir = join(tmpdir(), `bakin-dispatch-live-activity-content-${Date.now()}`)
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

import type { ChatChunk } from '../../packages/core/src/adapters/runtime'

// Controllable send that captures the onActivity tap so tests can drive it
// mid-turn and after settle.
type Pending = { resolve: () => void }
const pendingSends = new Map<string, Pending[]>()
const capturedTaps: Array<((chunk: ChatChunk) => void) | undefined> = []

const mockRuntimeSend = mock((args: { agentId: string; threadId: string; onActivity?: (chunk: ChatChunk) => void }) => {
  capturedTaps.push(args.onActivity)
  return new Promise((resolve) => {
    const queue = pendingSends.get(args.agentId) ?? []
    queue.push({ resolve: () => resolve({ id: 'msg' }) })
    pendingSends.set(args.agentId, queue)
  })
})

function releaseSend(agentId: string): void {
  const next = (pendingSends.get(agentId) ?? []).shift()
  if (next) next.resolve()
}

const mockAppServices = {
  runtime: {
    agents: { list: async () => [{ id: 'jessica', name: 'Jessica', status: 'active' }] },
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

const hookRegistryMock = () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock(async (hook: string) => (hook === 'workflows.getActiveAgents' ? [] : undefined)),
    has: mock().mockReturnValue(false),
    register: mock(),
  }),
})
mock.module('../../src/core/plugin-registry', hookRegistryMock)
mock.module('@bakin/core/hooks/hook-registry-singleton', hookRegistryMock)

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => sentinelContentDir,
  getOpenClawPath: (sub: string) => join(sentinelContentDir, sub),
}))

import { fireDispatchTurn, awaitDispatchIdle } from '../../src/core/dispatch-turns'
import { closeDb } from '../../packages/core/src/storage/db'

let tempDir: string
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

// Capture the ephemeral SSE broadcasts (dispatch-turns uses the
// globalThis.__bakinBroadcastEphemeral seam — live sockets only, never the
// replay buffer). The durable __bakinBroadcast seam is stubbed too so we can
// prove turn-activity NEVER rides it.
const broadcasts: Array<Record<string, unknown>> = []
const durableBroadcasts: Array<Record<string, unknown>> = []
const g = globalThis as {
  __bakinBroadcast?: (data: Record<string, unknown>) => void
  __bakinBroadcastEphemeral?: (data: Record<string, unknown>) => void
}
const originalBroadcast = g.__bakinBroadcast
const originalEphemeral = g.__bakinBroadcastEphemeral

function fireTurn(taskId: string, opts: { childTaskId?: string } = {}): void {
  fireDispatchTurn({
    marker: taskId,
    task: { id: taskId, title: `Task ${taskId}` } as never,
    targetAgent: 'jessica',
    threadId: `task:${taskId}:d1`,
    message: 'work it',
    contentDir: tempDir,
    port: 3737,
    initialLogCount: 0,
    logPrefix: 'test',
    dispatchKind: 'regular',
    ...(opts.childTaskId ? { childTaskId: opts.childTaskId } : {}),
  })
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'bakin-dispatch-live-activity-'))
  pendingSends.clear()
  capturedTaps.length = 0
  broadcasts.length = 0
  durableBroadcasts.length = 0
  auditEvents.length = 0
  taskStoreMock.addTaskLog.mockClear()
  taskStoreMock.updateTask.mockClear()
  g.__bakinBroadcast = (data) => { durableBroadcasts.push(data) }
  g.__bakinBroadcastEphemeral = (data) => { broadcasts.push(data) }
})

afterEach(async () => {
  for (const [agent, queue] of pendingSends) {
    while (queue.length) releaseSend(agent)
  }
  await awaitDispatchIdle()
  rmSync(tempDir, { recursive: true, force: true })
})

afterAll(() => {
  g.__bakinBroadcast = originalBroadcast
  g.__bakinBroadcastEphemeral = originalEphemeral
  closeDb()
  rmSync(sentinelContentDir, { recursive: true, force: true })
})

describe('dispatch live turn activity (ephemeral SSE)', () => {
  it('passes onActivity to messaging.send and broadcasts turn-activity with the full shape', async () => {
    setColumns({ inProgress: [{ id: 't-live', title: 'Task t-live' }] })
    fireTurn('t-live')
    await tick()

    const tap = capturedTaps[0]
    expect(tap).toBeInstanceOf(Function)

    tap!({ type: 'status', content: 'thinking' })
    tap!({ type: 'tool', data: { phase: 'call', toolName: 'web_fetch', status: 'running' } })

    expect(broadcasts.length).toBe(2)
    expect(broadcasts[0]).toMatchObject({
      type: 'turn-activity',
      taskId: 't-live',
      agentId: 'jessica',
      runId: 'task:t-live:d1',
      chunk: { type: 'status', content: 'thinking' },
    })
    expect(typeof broadcasts[0].ts).toBe('string')
    expect(broadcasts[1]).toMatchObject({
      type: 'turn-activity',
      taskId: 't-live',
      chunk: { type: 'tool', data: { toolName: 'web_fetch', phase: 'call' } },
    })

    releaseSend('jessica')
    await awaitDispatchIdle()
  })

  it('includes childTaskId for nested-workflow step turns', async () => {
    setColumns({ inProgress: [{ id: 'wf-p', title: 'Parent' }, { id: 'wf-p--sub', title: 'Child' }] })
    fireDispatchTurn({
      marker: 'wf-p:step-1',
      task: { id: 'wf-p', title: 'Parent' } as never,
      targetAgent: 'jessica',
      threadId: 'task:wf-p:step:step-1:d1',
      message: 'step work',
      contentDir: tempDir,
      port: 3737,
      initialLogCount: 0,
      logPrefix: 'test',
      dispatchKind: 'workflow',
      childTaskId: 'wf-p--sub',
    })
    await tick()

    capturedTaps[0]!({ type: 'status', content: 'thinking' })
    expect(broadcasts[0]).toMatchObject({ taskId: 'wf-p', childTaskId: 'wf-p--sub' })

    releaseSend('jessica')
    await awaitDispatchIdle()
  })

  it('rides ONLY the ephemeral seam — the durable replay-buffered broadcast never sees activity', async () => {
    setColumns({ inProgress: [{ id: 't-seam', title: 'Task t-seam' }] })
    fireTurn('t-seam')
    await tick()

    capturedTaps[0]!({ type: 'status', content: 'thinking' })
    capturedTaps[0]!({ type: 'tool', data: { phase: 'call', toolName: 'exec', status: 'running' } })

    expect(broadcasts.length).toBe(2)
    expect(durableBroadcasts.filter((b) => b.type === 'turn-activity').length).toBe(0)

    releaseSend('jessica')
    await awaitDispatchIdle()
  })

  it('gates on the EXACT registry entry: a reused marker with a new threadId drops the old tap', async () => {
    setColumns({ inProgress: [{ id: 't-reuse', title: 'Task t-reuse' }] })
    fireTurn('t-reuse') // threadId task:t-reuse:d1
    await tick()
    const oldTap = capturedTaps[0]!

    releaseSend('jessica')
    await awaitDispatchIdle()

    // Same marker, new attempt (d2) — the registry entry exists again, but
    // for a DIFFERENT threadId. The old turn's zombie tap must not broadcast
    // under the stale runId.
    fireDispatchTurn({
      marker: 't-reuse',
      task: { id: 't-reuse', title: 'Task t-reuse' } as never,
      targetAgent: 'jessica',
      threadId: 'task:t-reuse:d2',
      message: 'retry',
      contentDir: tempDir,
      port: 3737,
      initialLogCount: 0,
      logPrefix: 'test',
      dispatchKind: 'regular',
    })
    await tick()
    const before = broadcasts.length

    oldTap({ type: 'status', content: 'thinking' })
    expect(broadcasts.length).toBe(before)

    // The live attempt's own tap still broadcasts, under the new runId.
    capturedTaps[1]!({ type: 'status', content: 'thinking' })
    expect(broadcasts.length).toBe(before + 1)
    expect(broadcasts.at(-1)).toMatchObject({ runId: 'task:t-reuse:d2' })

    releaseSend('jessica')
    await awaitDispatchIdle()
  })

  it('persists nothing: no task log writes, no audit rows for activity', async () => {
    setColumns({ inProgress: [{ id: 't-eph', title: 'Task t-eph' }] })
    fireTurn('t-eph')
    await tick()

    capturedTaps[0]!({ type: 'tool', data: { phase: 'result', toolName: 'read', status: 'completed' } })
    capturedTaps[0]!({ type: 'status', content: 'thinking' })

    expect(taskStoreMock.addTaskLog.mock.calls.length).toBe(0)
    expect(taskStoreMock.updateTask.mock.calls.length).toBe(0)
    expect(auditEvents.length).toBe(0)

    releaseSend('jessica')
    await awaitDispatchIdle()
  })

  it('drops late chunks after the turn settles — no broadcast', async () => {
    setColumns({ inProgress: [{ id: 't-late', title: 'Task t-late' }] })
    fireTurn('t-late')
    await tick()

    const tap = capturedTaps[0]!
    tap({ type: 'status', content: 'thinking' })
    expect(broadcasts.length).toBe(1)

    releaseSend('jessica')
    await awaitDispatchIdle()

    // The registry entry is gone — a late frame must broadcast nothing.
    tap({ type: 'tool', data: { phase: 'result', toolName: 'zombie', status: 'completed' } })
    expect(broadcasts.length).toBe(1)
  })
})
