import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { BeaconJobMeta, ScheduleSidecar } from '@mc/schedule/types'

const testDir = join(tmpdir(), `beacon-test-bridge-${Date.now()}`)
const sidecarDir = join(testDir, 'schedule')
const sidecarPath = join(sidecarDir, 'sidecar.json')

// Mock external deps
vi.mock('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

const mockCreateTask = vi.fn((_opts?: unknown) => Promise.resolve({ id: 'task-abc', workflowId: undefined }))
vi.mock('../../../src/core/task-service', () => ({
  createTaskWithEffects: (opts: unknown) => mockCreateTask(opts),
}))

vi.mock('../../../src/core/audit', () => ({
  appendAudit: vi.fn(),
}))

// Mock taskboard for overlap checks
const mockTaskboard = {
  columns: {
    todo: [] as Array<{ id: string }>,
    inProgress: [] as Array<{ id: string }>,
    review: [] as Array<{ id: string }>,
    blocked: [] as Array<{ id: string }>,
    done: [] as Array<{ id: string }>,
    confirmed: [] as Array<{ id: string }>,
    backlog: [] as Array<{ id: string }>,
  },
}

vi.mock('../../../plugins/tasks/taskboard', () => ({
  getTask: vi.fn((id: string) => {
    for (const col of Object.values(mockTaskboard.columns)) {
      const t = col.find(task => task.id === id)
      if (t) return t
    }
    return null
  }),
  readTaskboard: vi.fn(() => mockTaskboard),
}))

// Mock OpenClaw cron wrappers
vi.mock('@mc/schedule/lib/openclaw-cron', () => ({
  cronAdd: vi.fn(() => Promise.resolve('new-job')),
  cronEdit: vi.fn(() => Promise.resolve()),
  cronRemove: vi.fn(() => Promise.resolve()),
  cronRun: vi.fn(() => Promise.resolve()),
  cronList: vi.fn(() => Promise.resolve([])),
}))

import { readSidecar, writeSidecar, upsertJob, getJob } from '@mc/schedule/lib/sidecar'

function makeMeta(overrides: Partial<BeaconJobMeta> = {}): BeaconJobMeta {
  return {
    jobId: 'test-job',
    isBeaconJob: true,
    displayName: 'Test Job',
    agentId: 'chef',
    owner: 'main-operator',
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

function writeSidecarFile(sidecar: ScheduleSidecar) {
  writeFileSync(sidecarPath, JSON.stringify(sidecar))
}

// We test the bridge by importing the plugin and calling the bridge handler directly
// The bridge is registered as a route, so we simulate Request/Response
async function callBridge(payload: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  // Dynamically import the plugin to get fresh state
  const mod = await import('@mc/schedule/index')
  const plugin = mod.default

  // Find the bridge route handler by activating the plugin
  let bridgeHandler: ((req: Request) => Promise<Response>) | undefined
  const ctx = {
    registerRoute: (route: { path: string; method: string; handler: (req: Request) => Promise<Response> }) => {
      if (route.path === '/bridge') bridgeHandler = route.handler
    },
    registerExecTool: vi.fn(),
    registerNav: vi.fn(),
    registerSlot: vi.fn(),
    registerSkill: vi.fn(),
    watchFiles: vi.fn(),
    storage: {} as any,
    events: {} as any,
    pluginId: 'schedule',
  }

  await plugin.activate(ctx as any)

  if (!bridgeHandler) throw new Error('Bridge handler not found')

  const req = new Request('http://localhost/api/plugins/schedule/bridge', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  })

  const res = await bridgeHandler(req)
  const body = await res.json()
  return { status: res.status, body }
}

describe('schedule/bridge', () => {
  let mockBroadcast: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mkdirSync(sidecarDir, { recursive: true })
    mockCreateTask.mockResolvedValue({ id: 'task-abc', workflowId: undefined })

    // Reset taskboard
    for (const col of Object.values(mockTaskboard.columns)) col.length = 0

    // Setup broadcast mock
    mockBroadcast = vi.fn()
    ;(globalThis as Record<string, unknown>).__beaconBroadcast = mockBroadcast
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
    delete (globalThis as Record<string, unknown>).__beaconBroadcast
  })

  it('skips non-Beacon jobs', async () => {
    // No sidecar entry = not a Beacon job
    const { body } = await callBridge({ jobId: 'unknown-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' })
    expect(body.ok).toBe(true)
    expect(body.skipped).toBe('not-beacon')
    expect(mockCreateTask).not.toHaveBeenCalled()
  })

  it('creates a task for Beacon jobs', async () => {
    upsertJob(makeMeta())

    const { body } = await callBridge({ jobId: 'test-job', runId: 'r1', timestamp: '2026-03-27T09:00:00Z' })
    expect(body.ok).toBe(true)
    expect(body.taskId).toBe('task-abc')
    expect(mockCreateTask).toHaveBeenCalledOnce()

    // Verify task creation args
    const args = mockCreateTask.mock.calls[0]![0] as unknown as Record<string, unknown>
    expect(args.assignee).toBe('chef')
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

    expect(mockBroadcast).toHaveBeenCalledOnce()
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
