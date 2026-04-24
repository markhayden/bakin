/**
 * Integration test for T2.3: verify agent-kind usage entries are emitted
 * from dispatch, heartbeat, and task-lifecycle source points.
 *
 * CRITICAL (CLAUDE.md): every filesystem path must resolve under testDir.
 * Never touches ~/.bakin/.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync, mkdirSync } from 'fs'

const testDir = join(tmpdir(), `bakin-usage-wiring-agent-${Date.now()}`)
mkdirSync(testDir, { recursive: true })
mkdirSync(join(testDir, 'heartbeats'), { recursive: true })

vi.mock('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    root: testDir,
    settings: join(testDir, 'settings.json'),
    audit: join(testDir, 'audit.jsonl'),
    logs: join(testDir, 'logs'),
  }),
}))

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('../../src/core/openclaw-client', () => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  openclaw: { sendMessage: vi.fn().mockResolvedValue(undefined) },
}))

// Mock audit so it doesn't try to write jsonl with real paths pulled in elsewhere.
vi.mock('../../src/core/audit', () => ({
  appendAudit: vi.fn(),
}))

// Watcher would otherwise try to chokidar the temp dir.
vi.mock('../../src/core/watcher', () => ({
  watchContentDir: vi.fn(),
  getWatcher: () => ({ on: vi.fn(), close: vi.fn() }),
}))

// Stub the plugin registry / hooks so task-service can call hooks without
// loading real plugins. We install a per-test registry via globalThis so
// mutations to hook handlers are scoped.
vi.mock('../../src/lib/plugin-registry', () => {
  const handlers = new Map<string, (data: unknown) => unknown>()
  return {
    getHookRegistry: () => ({
      register: (name: string, handler: (data: unknown) => unknown) => {
        handlers.set(name, handler)
        return () => handlers.delete(name)
      },
      has: (name: string) => handlers.has(name),
      invoke: async <R>(name: string, data: unknown): Promise<R | undefined> => {
        const h = handlers.get(name)
        if (!h) return undefined
        return (await h(data)) as R
      },
    }),
  }
})

// Prevent main-agent lookup from touching files.
vi.mock('../../src/core/main-agent', () => ({
  getMainAgentId: () => 'orchestrator',
}))

// Pin openclaw home under testDir so nothing reads real ~/.openclaw.
vi.mock('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => join(testDir, '.openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, '.openclaw', ...parts),
}))

import { clearUsage, getUsageFeed } from '../../src/core/usage'
import { getHookRegistry } from '../../src/lib/plugin-registry'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('T2.3 agent usage wiring', () => {
  beforeEach(() => {
    clearUsage()
  })

  it('heartbeat tool records an agent usage entry', async () => {
    // Importing the module auto-registers the exec tool via addExecTool.
    await import('../../scripts/lib/heartbeat')
    const { getExecTool } = await import('../../scripts/lib/registry')
    const tool = getExecTool('bakin_exec_heartbeat')
    expect(tool).toBeTruthy()

    const result = await tool!.handler({ status: 'working', message: 'test' }, 'alice')
    expect((result as { ok: boolean }).ok).toBe(true)

    const feed = getUsageFeed({ window: '5m', kind: 'agent' })
    const heartbeats = feed.recent.filter(e => e.name === 'heartbeat')
    expect(heartbeats.length).toBe(1)
    expect(heartbeats[0]).toMatchObject({
      kind: 'agent',
      name: 'heartbeat',
      agent: 'alice',
      status: 'ok',
    })
  })

  it('task-service moveTaskWithEffects records a task.<status> usage entry', async () => {
    const { moveTaskWithEffects } = await import('../../src/core/task-service')
    const hooks = getHookRegistry()

    // Register minimal hook handlers so moveTaskWithEffects can run.
    hooks.register('tasks.readTaskboard', () => ({
      columns: {
        todo: [],
        inProgress: [{ id: 'task-1', title: 'Test task' }],
        done: [],
      },
    }))
    hooks.register('tasks.moveTask', () => undefined)

    await moveTaskWithEffects('task-1', 'inProgress', 'alice', { from: 'todo' })

    const feed = getUsageFeed({ window: '5m', kind: 'agent' })
    const lifecycle = feed.recent.filter(e => e.name.startsWith('task.'))
    expect(lifecycle.length).toBeGreaterThanOrEqual(1)
    expect(lifecycle[0]).toMatchObject({
      kind: 'agent',
      name: 'task.inprogress',
      agent: 'alice',
      status: 'ok',
    })
    expect(lifecycle[0].meta).toMatchObject({ taskId: 'task-1', previousStatus: 'todo' })
  })

  it('dispatchSingleTask records an agent dispatch usage entry on success', async () => {
    // Stub settings before importing dispatch.
    vi.doMock('../../src/core/settings', () => ({
      getSettings: () => ({
        dispatch: { maxRetries: 3, failureCooldownMs: 1000, transientCooldownMs: 500, maxDispatched: 200 },
      }),
    }))
    // Dispatch now derives the agent roster from openclaw-config (T2).
    vi.doMock('@bakin/core/openclaw-config', () => ({
      getAgentIds: () => ['alice'],
      findAgentById: (id: string) => (id === 'alice' ? { id: 'alice' } : null),
      readOpenClawConfig: () => ({ agents: [{ id: 'alice' }] }),
      resetOpenClawConfigCache: () => {},
    }))
    // Stub taskboard lib used via dynamic import inside dispatch.
    vi.doMock('@bakin/tasks/lib/flow-store', () => ({
      moveTaskToInProgress: vi.fn().mockResolvedValue(undefined),
      addTaskLog: vi.fn().mockResolvedValue(undefined),
    }))

    // State file is written under testDir — provide an empty file ok.
    const { dispatchSingleTask } = await import('../../src/core/dispatch')
    const hooks = getHookRegistry()

    hooks.register('tasks.readTaskboard', () => ({
      columns: {
        todo: [{ id: 'dispatch-task-1', title: 'Dispatch me', agent: 'alice' }],
        inProgress: [],
        done: [],
      },
    }))

    await dispatchSingleTask('dispatch-task-1', testDir, 3737, 'kick')

    const feed = getUsageFeed({ window: '5m', kind: 'agent' })
    const dispatches = feed.recent.filter(e => e.name === 'dispatch')
    if (dispatches.length === 0) {
      // Document gracefully: dispatch is entangled with plugin state; if it
      // short-circuited we still want the rest of the test suite to pass and
      // the report to call this out. Fail loudly so the report catches it.
      throw new Error('Expected at least one dispatch usage entry. Feed: ' + JSON.stringify(feed.recent))
    }
    expect(dispatches[0]).toMatchObject({
      kind: 'agent',
      name: 'dispatch',
      agent: 'alice',
      status: 'ok',
    })
    expect(dispatches[0].meta).toMatchObject({ taskId: 'dispatch-task-1' })
  })
})
