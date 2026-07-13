/**
 * Integration test for T2.3: verify agent-kind usage entries are emitted
 * from dispatch, heartbeat, and task-lifecycle source points.
 *
 * CRITICAL (CLAUDE.md): every filesystem path must resolve under testDir.
 * Never touches ~/.bakin/.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync, mkdirSync } from 'fs'

const testDir = join(tmpdir(), `bakin-usage-wiring-agent-${Date.now()}`)
mkdirSync(testDir, { recursive: true })
mkdirSync(join(testDir, 'heartbeats'), { recursive: true })

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    root: testDir,
    tasks: join(testDir, 'tasks'),
    settings: join(testDir, 'settings.json'),
    audit: join(testDir, 'audit.jsonl'),
    logs: join(testDir, 'logs'),
  }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    root: testDir,
    tasks: join(testDir, 'tasks'),
    settings: join(testDir, 'settings.json'),
    audit: join(testDir, 'audit.jsonl'),
    logs: join(testDir, 'logs'),
  }),
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

// Mock audit so it doesn't try to write jsonl with real paths pulled in elsewhere.
mock.module('../../src/core/audit', () => ({
  appendAudit: mock(),
}))

// In-memory execution-ledger fake — usage wiring, not ledger semantics.
// Includes the dispatch-facing verbs (claimNextRun etc.) since dispatch.ts
// imports them at module load.
let fakeSeq = 0
const ledgerMock = () => ({
  recordCompletion: (_taskId: string, _input: { runId?: string; agent: string; channel?: string }) => ({
    recorded: true as const,
  }),
  hasCompletion: () => false,
  deleteCompletion: () => false,
  getLiveRun: () => null,
  bumpHeartbeatByTask: () => {},
  claimNextRun: (input: { runIdFor: (seq: number) => string }) => {
    fakeSeq += 1
    return { claimed: true as const, runId: input.runIdFor(fakeSeq), seq: fakeSeq }
  },
  settleRun: () => true,
  loseRun: () => true,
  currentSeq: () => fakeSeq,
  recordRunCost: () => {},
  spendTotal: () => 0,
  listRunCostsSince: () => [],
  openBudgetIncident: () => ({ opened: false, id: 1 }),
  resolveExpiredBudgetIncidents: () => 0,
  findOpenCapIncident: () => null,
})
mock.module('@/core/execution-ledger', ledgerMock)
mock.module('../../src/core/execution-ledger', ledgerMock)

// Watcher would otherwise try to chokidar the temp dir.
mock.module('../../src/core/watcher', () => ({
  watchContentDir: mock(),
  getWatcher: () => ({ on: mock(), close: mock() }),
  registerSyncHook: mock(() => {}),
  registerUnlinkHook: mock(() => {}),
}))

// Stub the plugin registry / hooks so task-service can call hooks without
// loading real plugins. We install a per-test registry via globalThis so
// mutations to hook handlers are scoped.
// Shared by both the plugin-registry mock and the hook-registry-singleton mock
// (getHookRegistry now lives in the leaf), so hook handlers are one map.
const handlers = new Map<string, (data: unknown) => unknown>()
mock.module('../../src/core/plugin-registry', () => {
  return {
    getHookRegistry: () => ({
      register: (name: string, handler: (data: unknown) => unknown) => {
        handlers.set(name, handler)
        return () => handlers.delete(name)
      },
      has: (name: string) => handlers.has(name),
      call: async <T>(name: string, data: T): Promise<T> => {
        const h = handlers.get(name)
        if (!h) return data
        const result = await h(data)
        return (result === undefined || result === null ? data : result) as T
      },
      callAll: async (name: string, data: Record<string, unknown>): Promise<void> => {
        const h = handlers.get(name)
        if (h) await h(data)
      },
      invoke: async <R>(name: string, data: unknown): Promise<R | undefined> => {
        const h = handlers.get(name)
        if (!h) return undefined
        return (await h(data)) as R
      },
    }),
  }
})
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
      register: (name: string, handler: (data: unknown) => unknown) => {
        handlers.set(name, handler)
        return () => handlers.delete(name)
      },
      has: (name: string) => handlers.has(name),
      call: async <T>(name: string, data: T): Promise<T> => {
        const h = handlers.get(name)
        if (!h) return data
        const result = await h(data)
        return (result === undefined || result === null ? data : result) as T
      },
      callAll: async (name: string, data: Record<string, unknown>): Promise<void> => {
        const h = handlers.get(name)
        if (h) await h(data)
      },
      invoke: async <R>(name: string, data: unknown): Promise<R | undefined> => {
        const h = handlers.get(name)
        if (!h) return undefined
        return (await h(data)) as R
      },
    }),
}))

// Prevent main-agent lookup from touching files.
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'orchestrator',
  tryGetMainAgentId: () => 'orchestrator',
  getMainAgentName: () => 'Orchestrator',
}))

// Pin openclaw home under testDir so nothing reads real ~/.openclaw.
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, '.openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, '.openclaw', ...parts),
}))

mock.module('../../src/core/app-services', () => ({
  getAppServices: () => ({
    runtime: {
      agents: {
        list: async () => [
          { id: 'alice', name: 'Alice', role: 'Builder', status: 'active' },
          { id: 'orchestrator', name: 'Orchestrator', role: 'Orchestrator', status: 'active' },
        ],
      },
      messaging: {
        send: async () => ({ id: 'msg-1', content: '' }),
      },
    },
  }),
}))
mock.module('../../src/core/app-services-store', () => ({
  getAppServices: () => ({
    runtime: {
      agents: {
        list: async () => [
          { id: 'alice', name: 'Alice', role: 'Builder', status: 'active' },
          { id: 'orchestrator', name: 'Orchestrator', role: 'Orchestrator', status: 'active' },
        ],
      },
      messaging: {
        send: async () => ({ id: 'msg-1', content: '' }),
      },
    },
  }),
}))

const taskColumns = {
  backlog: [] as any[],
  todo: [] as any[],
  inProgress: [] as any[],
  review: [] as any[],
  done: [] as any[],
  archived: [] as any[],
  blocked: [] as any[],
}
const mockMoveTask = mock(async (..._args: unknown[]) => undefined)
const mockUpdateTask = mock(async (..._args: unknown[]) => undefined)
const mockAddTaskLog = mock(async (..._args: unknown[]) => undefined)

function resetTaskColumns(): void {
  for (const tasks of Object.values(taskColumns)) tasks.length = 0
}

function allTasks(): any[] {
  return Object.values(taskColumns).flat()
}

function getTaskWithColumn(taskId: string): { task: any; column: string } | null {
  for (const [column, tasks] of Object.entries(taskColumns)) {
    const task = tasks.find((candidate) => candidate.id === taskId)
    if (task) return { task, column }
  }
  return null
}

function taskStoreMock() {
  return {
    VALID_TRANSITIONS: {},
    readTaskboard: mock(() => ({ columns: taskColumns })),
    readAllColumns: mock(() => taskColumns),
    getAllTasks: mock(() => allTasks()),
    getTask: mock((taskId: string) => getTaskWithColumn(taskId)?.task ?? null),
    getTaskWithColumn: mock((taskId: string) => getTaskWithColumn(taskId)),
    getTodoTasks: mock(() => taskColumns.todo),
    getTasksByColumn: mock((column: keyof typeof taskColumns) => taskColumns[column] ?? []),
    getTasksByAgent: mock((agent: string) => allTasks().filter((task) => task.agent === agent)),
    getAgentTasks: mock((agent: string) => allTasks().filter((task) => task.agent === agent)),
    getArchivedCount: mock(() => taskColumns.archived.length),
    localDateString: mock(() => '2026-04-28'),
    normalizeColumn: mock((column: string) => column),
    createTask: mock(async (..._args: unknown[]) => ({ id: 'created-task', title: 'Created task' })),
    assignTask: mock(async (..._args: unknown[]) => undefined),
    deleteTask: mock(async (..._args: unknown[]) => undefined),
    moveTask: (...args: unknown[]) => mockMoveTask(...args),
    moveTaskToInProgress: mock(async (taskId: string, agent: string) => mockUpdateTask(taskId, { column: 'inProgress', agent })),
    updateTask: (...args: unknown[]) => mockUpdateTask(...args),
    addTaskLog: (...args: unknown[]) => mockAddTaskLog(...args),
    blockTask: mock(async (..._args: unknown[]) => undefined),
    setDependency: mock(async (..._args: unknown[]) => undefined),
    clearDependency: mock(async (..._args: unknown[]) => undefined),
    reorderTasks: mock(async (..._args: unknown[]) => undefined),
    assignTaskToTeam: mock(async (..._args: unknown[]) => undefined),
    recordTeamResolution: mock(async (..._args: unknown[]) => undefined),
    archiveOldTasks: mock(() => 0),
    autoArchiveDoneTasks: mock(() => 0),
  }
}

mock.module('../../src/core/task-store', () => taskStoreMock())
mock.module('@/core/task-store', () => taskStoreMock())

import { clearUsage, getUsageFeed } from '../../src/core/usage'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

describe('T2.3 agent usage wiring', () => {
  beforeEach(() => {
    clearUsage()
    resetTaskColumns()
    mockMoveTask.mockClear()
    mockUpdateTask.mockClear()
    mockAddTaskLog.mockClear()
  })

  it('heartbeat tool records an agent usage entry', async () => {
    // Importing the module auto-registers the exec tool via addExecTool.
    await import('../../src/core/exec-tools/tools/heartbeat')
    const { getExecTool } = require('@/core/exec-tools/registry') as typeof import('@/core/exec-tools/registry')
    const tool = getExecTool('bakin_exec_heartbeat')
    expect(tool).toBeTruthy()

    const result = await tool!.handler({ status: 'working', message: 'test' }, 'alice')
    expect((result as { ok: boolean }).ok).toBe(true)

    const feed = getUsageFeed({ window: '5m', kind: 'agent', includeRoutine: true })
    const heartbeats = feed.recent.filter(e => e.name === 'heartbeat')
    expect(heartbeats.length).toBe(1)
    expect(heartbeats[0]).toMatchObject({
      kind: 'agent',
      name: 'heartbeat',
      agent: 'alice',
      status: 'ok',
      activityClass: 'routine',
    })
  })

  it('task-service moveTaskWithEffects records a task.<status> usage entry', async () => {
    const { moveTaskWithEffects } = require('../../src/core/task-service') as typeof import('../../src/core/task-service')
    taskColumns.inProgress.push({ id: 'task-1', title: 'Test task' })

    await moveTaskWithEffects('task-1', 'inProgress', 'alice', { from: 'todo' })

    const feed = getUsageFeed({ window: '5m', kind: 'agent' })
    const lifecycle = feed.recent.filter(e => e.name.startsWith('task.'))
    expect(lifecycle.length).toBeGreaterThanOrEqual(1)
    expect(lifecycle[0]).toMatchObject({
      kind: 'agent',
      name: 'task.inprogress',
      agent: 'alice',
      status: 'ok',
      activityClass: 'user',
    })
    expect(lifecycle[0].meta).toMatchObject({ taskId: 'task-1', previousStatus: 'todo' })
  })

  it('dispatchSingleTask records an agent dispatch usage entry on success', async () => {
    // Stub settings before importing dispatch.
    mock.module('../../src/core/settings', () => ({
  resetSettingsCache: () => {},
      getSettings: () => ({
        dispatch: {
          maxRetries: 3,
          failureCooldownMs: 1000,
          transientCooldownMs: 500,
          maxDispatched: 200,
          oversizedOutputBytes: 128 * 1024,
          maxConcurrentTurns: 3,
          maxTurnsPerAgent: 1,
        },
      }),
    }))
    // Stub taskboard lib used via dynamic import inside dispatch.
    mock.module('@/core/task-store', () => ({
      moveTaskToInProgress: mock().mockResolvedValue(undefined),
      addTaskLog: mock().mockResolvedValue(undefined),
      recordTeamResolution: mock().mockResolvedValue(undefined),
      blockTask: mock().mockResolvedValue(undefined),
    }))

    // State file is written under testDir — provide an empty file ok.
    const { dispatchSingleTask, awaitDispatchIdle } = require('../../src/core/dispatch') as typeof import('../../src/core/dispatch')
    taskColumns.todo.push({ id: 'dispatch-task-1', title: 'Dispatch me', agent: 'alice' })

    await dispatchSingleTask('dispatch-task-1', testDir, 3737, 'kick')
    // Usage records at turn settle under concurrent dispatch.
    await awaitDispatchIdle()

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
      activityClass: 'user',
    })
    expect(dispatches[0].meta).toMatchObject({ taskId: 'dispatch-task-1' })
  })
})
