import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { BakinJobMeta } from '@bakin/schedule/types'

const testDir = join(tmpdir(), `bakin-test-bridge-${Date.now()}`)
const sidecarDir = join(testDir, 'schedule')
const openclawDir = join(testDir, 'openclaw')

// Mock external deps
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
  initBakinHome: () => {},
}))

mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => openclawDir,
  getOpenClawPath: (...segments: string[]) => join(openclawDir, ...segments),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

const mockCreateTask = mock((opts?: unknown) => {
  void opts
  return Promise.resolve({ id: 'task-abc', workflowId: undefined })
})
mock.module('../../../src/core/task-service', () => ({
  createTaskWithEffects: (opts: unknown) => mockCreateTask(opts),
}))

mock.module('../../../src/core/audit', () => ({
  appendAudit: mock(),
}))

// Mock taskboard for overlap checks
const mockTaskboard = {
  columns: {
    todo: [] as Array<{ id: string }>,
    inProgress: [] as Array<{ id: string }>,
    review: [] as Array<{ id: string }>,
    blocked: [] as Array<{ id: string }>,
    done: [] as Array<{ id: string }>,
    archived: [] as Array<{ id: string }>,
    backlog: [] as Array<{ id: string }>,
  },
}

mock.module('@/core/task-store', () => ({
  getTask: mock((id: string) => {
    for (const col of Object.values(mockTaskboard.columns)) {
      const t = col.find(task => task.id === id)
      if (t) return t
    }
    return null
  }),
  readTaskboard: mock(() => mockTaskboard),
  createTask: mock(() => Promise.resolve({ id: 'task-abc' })),
  addTaskLog: mock(() => Promise.resolve()),
}))
mock.module('../../../src/core/task-store', () => ({
  readTaskboard: mock(() => mockTaskboard),
}))
mock.module('@/core/task-store', () => ({
  readTaskboard: mock(() => mockTaskboard),
}))

// Mock the hook registry for workflow/project side effects. Schedule reads and
// creates task metadata through task-store/task-service mocks.
const mockHookRegistry = {
  invoke: mock(async <R>(name: string, _data: unknown): Promise<R | undefined> => {
    return undefined
  }),
  register: mock(),
  has: mock(() => false),
}

mock.module('../../../src/lib/plugin-registry', () => ({
  getHookRegistry: () => mockHookRegistry,
}))

import { readSidecar, upsertJob, getJob } from '@bakin/schedule/lib/sidecar'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'

function makeMeta(overrides: Partial<BakinJobMeta> = {}): BakinJobMeta {
  return {
    jobId: 'test-job',
    isBakinJob: true,
    displayName: 'Test Job',
    agentId: 'basil',
    owner: 'main',
    taskPrompt: 'Do the thing',
    taskTitle: 'Scheduled: {jobName} on {date}',
    allowOverlap: false,
    maxFailures: 3,
    consecutiveFailures: 0,
    createdAt: '2026-03-27T00:00:00Z',
    updatedAt: '2026-03-27T00:00:00Z',
    ...overrides,
  }
}

// 64-char hex matches the length of a real randomBytes(32).toString('hex')
// secret, so getOrCreateBridgeSecret treats it as valid and won't regenerate.
const TEST_BRIDGE_SECRET = 'a'.repeat(64)

// Stateful settings store so plugin-side updateSettings() persists across the
// bridge call — needed so getOrCreateBridgeSecret returns the same value the
// test is passing as the query param.
let mockSettings: Record<string, unknown> = {}

interface CallBridgeOptions {
  /** Override settings for this call. */
  settings?: Record<string, unknown>
  /** Secret to append to the URL. Defaults to TEST_BRIDGE_SECRET; set to
   *  an empty string or a wrong value to exercise the auth failure path. */
  secret?: string
}

// We test the bridge by importing the plugin and calling the bridge handler directly
// The bridge is registered as a route, so we simulate Request/Response
async function callBridge(
  payload: Record<string, unknown>,
  opts: CallBridgeOptions = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  // Dynamically import the plugin to get fresh state
  const mod = await import('@bakin/schedule/index')
  const plugin = mod.default

  mockSettings = { bridgeEnabled: true, bridgeSecret: TEST_BRIDGE_SECRET, ...(opts.settings ?? {}) }

  // Find the bridge route handler by activating the plugin
  let bridgeHandler: ((req: Request) => Promise<Response>) | undefined
  const ctx = {
    registerRoute: (route: { path: string; method: string; handler: (req: Request) => Promise<Response> }) => {
      if (route.path === '/bridge') bridgeHandler = route.handler
    },
    registerExecTool: mock(),
    registerNav: mock(),
    registerSlot: mock(),
    registerSkill: mock(),
    registerHealthCheck: mock(),
    watchFiles: mock(),
    storage: {},
    events: {},
    pluginId: 'schedule',
    runtime: makeBridgeRuntime(),
    activity: {
      log: mock((agent: string, message: string, opts?: { taskId?: string }) => {
        const broadcastFn = (globalThis as Record<string, unknown>).__bakinBroadcast as ((...args: unknown[]) => void) | undefined
        if (broadcastFn) {
          broadcastFn({
            type: 'activity',
            agent,
            message,
            ts: new Date().toISOString(),
            pluginId: 'schedule',
            ...(opts?.taskId ? { taskId: opts.taskId } : {}),
          })
        }
      }),
      audit: mock(),
    },
    hooks: {
      register: mock(),
      has: mock(() => false),
      invoke: mockHookRegistry.invoke,
    },
    getSettings: mock(() => ({ ...mockSettings })),
    updateSettings: mock((patch: Record<string, unknown>) => {
      mockSettings = { ...mockSettings, ...patch }
    }),
    search: {
      registerContentType: mock(),
      index: mock(async () => {}),
      remove: mock(async () => {}),
      transform: mock(async () => {}),
      query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'fallback' as const } })),
    },
  }

  await plugin.activate(ctx as unknown as Parameters<typeof plugin.activate>[0])

  if (!bridgeHandler) throw new Error('Bridge handler not found')

  const providedSecret = opts.secret === undefined ? TEST_BRIDGE_SECRET : opts.secret
  const url = providedSecret
    ? `http://localhost/api/plugins/schedule/bridge?secret=${providedSecret}`
    : 'http://localhost/api/plugins/schedule/bridge'
  const req = new Request(url, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  })

  const res = await bridgeHandler(req)
  const body = await res.json()
  return { status: res.status, body }
}

function makeBridgeRuntime() {
  const runtime = createMockRuntimeAdapter()
  runtime.cron.list = async () => Object.values(readSidecar().jobs).map((job) => ({
    id: job.jobId,
    name: job.displayName ?? job.jobId,
    schedule: '0 9 * * *',
    command: job.taskPrompt ?? `bakin:schedule:${job.displayName ?? job.jobId}`,
    enabled: true,
    metadata: { tz: job.tz, createdAt: job.createdAt, updatedAt: job.updatedAt },
  }))
  return runtime
}

describe('schedule/bridge', () => {
  let mockBroadcast: ReturnType<typeof mock>

  beforeEach(() => {
    mock.clearAllMocks()
    mkdirSync(sidecarDir, { recursive: true })
    mockCreateTask.mockResolvedValue({ id: 'task-abc', workflowId: undefined })

    // Reset taskboard
    for (const col of Object.values(mockTaskboard.columns)) col.length = 0

    // Setup broadcast mock
    mockBroadcast = mock()
    ;(globalThis as Record<string, unknown>).__bakinBroadcast = mockBroadcast
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    delete (globalThis as Record<string, unknown>).__bakinBroadcast
  })

  it('skips non-Bakin jobs', async () => {
    // No sidecar entry = not a Bakin job
    const { body } = await callBridge({ jobId: 'unknown-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' })
    expect(body.ok).toBe(true)
    expect(body.skipped).toBe('not-bakin')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('rejects request with no secret (401)', async () => {
    upsertJob(makeMeta())
    const { status, body } = await callBridge(
      { jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' },
      { secret: '' },
    )
    expect(status).toBe(401)
    expect(body.ok).toBe(false)
    expect(body.error).toBe('unauthorized')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('rejects request with wrong secret (401)', async () => {
    upsertJob(makeMeta())
    const { status, body } = await callBridge(
      { jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' },
      { secret: 'b'.repeat(64) },
    )
    expect(status).toBe(401)
    expect(body.error).toBe('unauthorized')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('rejects request when bridgeEnabled=false (503)', async () => {
    upsertJob(makeMeta())
    const { status, body } = await callBridge(
      { jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' },
      { settings: { bridgeEnabled: false } },
    )
    expect(status).toBe(503)
    expect(body.ok).toBe(false)
    expect(body.error).toBe('bridge disabled')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('creates a task for Bakin jobs', async () => {
    upsertJob(makeMeta())

    const { body } = await callBridge({ jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' })
    expect(body.ok).toBe(true)
    expect(body.taskId).toBe('task-abc')
    expect(mockCreateTask).toHaveBeenCalledTimes(1)

    // Verify task creation args
    const args = mockCreateTask.mock.calls[0]![0] as unknown as Record<string, unknown>
    expect(args.assignee).toBe('basil')
    expect(args.createdBy).toBe('schedule')
    expect(args.column).toBe('todo')
  })

  it('expands title template variables', async () => {
    upsertJob(makeMeta({ taskTitle: 'Daily: {jobName} on {date}' }))

    await callBridge({ jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' })

    const args = mockCreateTask.mock.calls[0]![0] as unknown as Record<string, unknown>
    const title = args.title as string
    expect(title).toContain('Test Job')
    expect(title).toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('skips paused jobs', async () => {
    upsertJob(makeMeta({ paused: true, pauseReason: 'manual' }))

    const { body } = await callBridge({ jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' })
    expect(body.skipped).toBe('paused')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('handles skip-next-N', async () => {
    upsertJob(makeMeta({ skipNextN: 2, skippedCount: 0 }))

    const { body } = await callBridge({ jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' })
    expect(body.skipped).toBe('skip-count')
    expect(mockCreateTask).not.toHaveBeenCalled()

    // Check counter incremented
    const meta = getJob('test-job')
    expect(meta!.skippedCount).toBe(1)
  })

  it('auto-pauses after max failures', async () => {
    upsertJob(makeMeta({ consecutiveFailures: 3, maxFailures: 3 }))

    const { body } = await callBridge({ jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' })
    expect(body.skipped).toBe('auto-paused')

    const meta = getJob('test-job')
    expect(meta!.paused).toBe(true)
    expect(meta!.pauseReason).toBe('auto-failures')
  })

  it('skips on overlap when allowOverlap=false and last task active', async () => {
    upsertJob(makeMeta({ lastTaskId: 'old-task', allowOverlap: false }))
    mockTaskboard.columns.inProgress.push({ id: 'old-task' })

    const { body } = await callBridge({ jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' })
    expect(body.skipped).toBe('overlap')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('creates task when allowOverlap=true despite active last task', async () => {
    upsertJob(makeMeta({ lastTaskId: 'old-task', allowOverlap: true }))
    mockTaskboard.columns.inProgress.push({ id: 'old-task' })

    const { body } = await callBridge({ jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' })
    expect(body.ok).toBe(true)
    expect(body.taskId).toBe('task-abc')
  })

  it('creates task when last task is done (no overlap)', async () => {
    upsertJob(makeMeta({ lastTaskId: 'old-task', allowOverlap: false }))
    mockTaskboard.columns.done.push({ id: 'old-task' })

    const { body } = await callBridge({ jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' })
    expect(body.ok).toBe(true)
    expect(body.taskId).toBe('task-abc')
  })

  it('resets failure counter when last task succeeded', async () => {
    upsertJob(makeMeta({ lastTaskId: 'old-task', consecutiveFailures: 2 }))
    mockTaskboard.columns.done.push({ id: 'old-task' })

    await callBridge({ jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' })

    const meta = getJob('test-job')
    expect(meta!.consecutiveFailures).toBe(0)
  })

  it('records lastTaskId in sidecar after creation', async () => {
    upsertJob(makeMeta())

    await callBridge({ jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' })

    const meta = getJob('test-job')
    expect(meta!.lastTaskId).toBe('task-abc')
  })

  it('broadcasts SSE event on task creation', async () => {
    upsertJob(makeMeta())

    await callBridge({ jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' })

    expect(mockBroadcast).toHaveBeenCalledTimes(1)
    const event = mockBroadcast.mock.calls[0][0]
    expect(event.type).toBe('activity')
    expect(event.agent).toBe('system')
    expect(event.message).toContain('Test Job')
    expect(event.taskId).toBe('task-abc')
  })

  it('creates task without assignee when requireTriage=true', async () => {
    upsertJob(makeMeta({ requireTriage: true }))

    await callBridge({ jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' })

    const args = mockCreateTask.mock.calls[0]![0] as unknown as Record<string, unknown>
    expect(args.assignee).toBeUndefined()
  })

  it('auto-resumes when pauseUntil is in the past', async () => {
    upsertJob(makeMeta({ paused: true, pauseUntil: '2020-01-01T00:00:00Z', pauseReason: 'manual' }))

    const { body } = await callBridge({ jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' })
    expect(body.ok).toBe(true)
    expect(body.taskId).toBe('task-abc')
  })
})
