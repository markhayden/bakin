/**
 * Tasks-plugin-owned doctor checks.
 *
 * Migrated out of src/core/doctor.ts (#139 C2). Behavioral coverage for
 * the three checks (taskboard, task-consistency, order-integrity) plus
 * a registration-shape sanity test.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-tasks-health-${Date.now()}-${randomUUID()}`)
const mockPaths = { home: testDir, tasks: pathJoin(testDir, 'tasks'), heartbeats: pathJoin(testDir, 'heartbeats') }

process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'

// ─── Mocks (mandatory test-isolation per CLAUDE.md) ────────────────────────

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => mockPaths,
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => mockPaths,
  isUsingBakinHome: () => true,
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => mockPaths,
  isUsingBakinHome: () => true,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => mockPaths,
  isUsingBakinHome: () => true,
}))

let mockKnownAgents: string[] = ['main', 'patch', 'pixel']
mock.module('../../../packages/adapter-openclaw/src/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

type StoreTask = {
  id: string
  title: string
  agent?: string
  createdBy?: string
  description?: string
  dependsOn?: string
  log?: unknown[]
  order?: number
  updatedAt?: number
  blockedReason?: string
}

type StoreBoard = {
  columns: {
    backlog: StoreTask[]
    todo: StoreTask[]
    inProgress: StoreTask[]
    review: StoreTask[]
    done: StoreTask[]
    blocked: StoreTask[]
    archived: StoreTask[]
  }
}

function emptyStoreBoard(): StoreBoard {
  return { columns: { backlog: [], todo: [], inProgress: [], review: [], done: [], blocked: [], archived: [] } }
}

let storeBoard: StoreBoard = emptyStoreBoard()

const clearedDependencies: string[] = []
let clearDependencyShouldThrow = false

// task-store mock — taskboard/order checks import it directly, and the plugin
// registration smoke imports the full tasks plugin. Keep the surface complete.
mock.module('@/core/task-store', () => ({
  readTaskboard: () => storeBoard,
  getAllTasks: () => storeBoard,
  getTask: () => null,
  createTask: () => undefined,
  deleteTask: () => undefined,
  assignTask: () => undefined,
  addTaskLog: () => undefined,
  blockTask: () => undefined,
  updateTask: () => undefined,
  moveTask: () => undefined,
  setDependency: () => undefined,
  clearDependency: (taskId: string) => {
    if (clearDependencyShouldThrow) throw new Error('cleardep failed')
    clearedDependencies.push(taskId)
  },
  reorderTasks: async (_column: string, orderedIds: string[]) => {
    const tasks = Object.values(storeBoard.columns).flat()
    orderedIds.forEach((id, order) => {
      const task = tasks.find((candidate) => candidate.id === id)
      if (task) task.order = order
    })
  },
  archiveOldTasks: () => 0,
  autoArchiveDoneTasks: () => 0,
}))

// task-service surface used by the tasks plugin's exec tools.
mock.module('../../../src/core/task-service', () => ({
  WorkflowTaskMoveError: class WorkflowTaskMoveError extends Error {},
  validateTeamRef: async () => undefined,
  validateTeamAssignment: async () => undefined,
  TaskValidationError: class extends Error {},
  moveTaskWithEffects: async () => null,
  blockTaskWithEffects: async () => null,
  createTaskWithEffects: async () => null,
  reportComplete: async () => null,
  setDependencyWithEffects: async () => null,
  getTaskDetails: async () => null,
  logProgress: async () => null,
  triggerDispatch: async () => null,
}))

mock.module('../../../src/core/app-services', () => ({
  maybeGetAppServices: () => ({
    runtime: {
      agents: {
        list: async () => mockKnownAgents.map(id => ({ id, name: id })),
      },
    },
  }),
}))
mock.module('../../../src/core/app-services-store', () => ({
  maybeGetAppServices: () => ({
    runtime: {
      agents: {
        list: async () => mockKnownAgents.map(id => ({ id, name: id })),
      },
    },
  }),
}))

// Hook registry remains available for plugin activation tests, but task
// metadata checks read the shared task-store service directly.
mock.module('../../../src/core/plugin-registry', () => ({
  getHookRegistry: () => ({
    invoke: async (_name: string, _data: Record<string, unknown>) => {
      return undefined
    },
    has: () => false,
    register: () => () => {},
  }),
}))
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: async (_name: string, _data: Record<string, unknown>) => {
      return undefined
    },
    has: () => false,
    register: () => () => {},
  }),
}))

import {
  checkTaskboard,
  checkTaskConsistency,
  checkTaskPositionIntegrity,
  taskConsistencyRepair,
  taskOrderRepair,
} from '../../../plugins/tasks/lib/health-checks'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  storeBoard = emptyStoreBoard()
  mockKnownAgents = ['main', 'patch', 'pixel']
  clearedDependencies.length = 0
  clearDependencyShouldThrow = false
})

// ─── checkTaskboard ────────────────────────────────────────────────────────

describe('checkTaskboard', () => {
  it('reports ok with the Bakin-owned task count', () => {
    storeBoard.columns.todo.push({ id: 't1', title: 'Queued task' })
    storeBoard.columns.inProgress.push({ id: 't2', title: 'Running task' })
    const results = checkTaskboard()
    expect(results.outcome).toBe('observed')
    if (results.outcome !== 'observed') throw new Error('expected observations')
    expect(results.observations).toHaveLength(1)
    expect(results.observations[0].status).toBe('healthy')
    expect(results.observations[0].summary).toMatch(/2 tasks in the Bakin task store/)
  })

  it('returns ok with zero tasks when the store is empty', () => {
    const results = checkTaskboard()
    if (results.outcome !== 'observed') throw new Error('expected observations')
    expect(results.observations[0].status).toBe('healthy')
    expect(results.observations[0].summary).toMatch(/0 tasks/)
  })
})

// ─── checkTaskConsistency ─────────────────────────────────────────────────

describe('checkTaskConsistency', () => {
  it('reports ok when the Bakin task store is available and empty', async () => {
    const results = await checkTaskConsistency(testDir)
    if (results.outcome !== 'observed') throw new Error('expected observations')
    expect(results.observations).toHaveLength(1)
    expect(results.observations[0].status).toBe('healthy')
    expect(results.observations[0].summary).toMatch(/0 in progress and 0 done/)
  })

  it('reports ok when no inProgress / done tasks exist', async () => {
    const results = await checkTaskConsistency(testDir)
    if (results.outcome !== 'observed') throw new Error('expected observations')
    expect(results.observations).toHaveLength(1)
    expect(results.observations[0].status).toBe('healthy')
    expect(results.observations[0].summary).toMatch(/0 in progress and 0 done/)
  })

  it('flags an in-progress task assigned to an unknown agent', async () => {
    storeBoard.columns.inProgress.push({ id: 't1', title: 'Build something', agent: 'ghost', log: [{}] })
    // Heartbeat exists so we don't ALSO flag heartbeat
    mkdirSync(pathJoin(testDir, 'heartbeats'), { recursive: true })
    writeFileSync(pathJoin(testDir, 'heartbeats', 'ghost.json'), '{}')

    const results = await checkTaskConsistency(testDir)
    if (results.outcome !== 'observed') throw new Error('expected observations')
    expect(results.observations.some(r => r.status === 'warning' && r.summary.includes('unknown agent “ghost”'))).toBe(true)
  })

  it('flags an in-progress task with no heartbeat file', async () => {
    storeBoard.columns.inProgress.push({ id: 't2', title: 'Heartbeatless work', agent: 'patch', log: [{}] })
    const results = await checkTaskConsistency(testDir)
    if (results.outcome !== 'observed') throw new Error('expected observations')
    expect(results.observations.some(r => r.status === 'warning' && r.key === 'heartbeat-missing:t2')).toBe(true)
  })

  it('flags an in-progress task with zero log entries', async () => {
    storeBoard.columns.inProgress.push({ id: 't3', title: 'No logs', agent: 'patch', log: [] })
    mkdirSync(pathJoin(testDir, 'heartbeats'), { recursive: true })
    writeFileSync(pathJoin(testDir, 'heartbeats', 'patch.json'), '{}')
    const results = await checkTaskConsistency(testDir)
    if (results.outcome !== 'observed') throw new Error('expected observations')
    expect(results.observations.some(r => r.status === 'warning' && r.key === 'progress-missing:t3')).toBe(true)
  })

  it('flags an agent overloaded with > 3 concurrent in-progress tasks', async () => {
    mkdirSync(pathJoin(testDir, 'heartbeats'), { recursive: true })
    writeFileSync(pathJoin(testDir, 'heartbeats', 'patch.json'), '{}')
    storeBoard.columns.inProgress.push(...Array.from({ length: 4 }, (_, i) => ({
      id: `t${i}`, title: `Task ${i}`, agent: 'patch', log: [{}],
    })))
    const results = await checkTaskConsistency(testDir)
    if (results.outcome !== 'observed') throw new Error('expected observations')
    expect(results.observations.some(r => r.status === 'warning' && r.key === 'overloaded:patch')).toBe(true)
  })

  it('offers an explicit repair for orphaned dependsOn on a done task', async () => {
    storeBoard.columns.done.push({ id: 'd1', title: 'Stale dep', dependsOn: 'old-task' })
    const results = await checkTaskConsistency(testDir)
    if (results.outcome !== 'observed') throw new Error('expected observations')
    const finding = results.observations.find(r => r.key === 'orphaned-dependency:d1')
    expect(finding?.status).toBe('warning')
    expect(finding?.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'clear-done-depends-on' })
  })

  it('does not clear orphaned dependsOn during diagnostics', async () => {
    storeBoard.columns.done.push({ id: 'd2', title: 'Auto-clear', dependsOn: 'orphan' })
    const results = await checkTaskConsistency(testDir)
    if (results.outcome !== 'observed') throw new Error('expected observations')
    expect(results.observations.some(r => r.key === 'orphaned-dependency:d2')).toBe(true)
    expect(clearedDependencies).toEqual([])
  })

  it('plans and applies orphaned dependsOn repair explicitly', async () => {
    storeBoard.columns.done.push({ id: 'd2', title: 'Repair clear', dependsOn: 'orphan' })
    const repair = taskConsistencyRepair()
    const plan = await repair.plan({ type: 'all_actionable', reportId: 'report-1' })
    expect(plan).toHaveLength(1)
    expect(plan[0].id).toBe('clear-completed-task-dependencies')

    const applied = await repair.apply(plan)
    expect(applied[0].status).toBe('applied')
    expect(applied[0].actionId).toBe('clear-done-depends-on')
    expect(clearedDependencies).toContain('d2')
  })
})

// ─── checkTaskPositionIntegrity ───────────────────────────────────────────

describe('checkTaskPositionIntegrity', () => {
  it('reports ok when no tasks exist', async () => {
    const results = await checkTaskPositionIntegrity()
    expect(results.outcome).toBe('observed')
    if (results.outcome !== 'observed') throw new Error('expected observations')
    expect(results.observations).toHaveLength(1)
    expect(results.observations[0].key).toBe('order')
    expect(results.observations[0].status).toBe('healthy')
    expect(results.observations[0].summary).toMatch(/No tasks need order validation/)
  })

  it('reports ok when all tasks have unique orders', async () => {
    storeBoard.columns.todo.push(
      { id: 'a', title: 'Queued A', order: 0, updatedAt: 1 },
      { id: 'b', title: 'Queued B', order: 1, updatedAt: 2 },
    )
    storeBoard.columns.inProgress.push({ id: 'c', title: 'Running C', order: 0, updatedAt: 3 })
    const results = await checkTaskPositionIntegrity()
    if (results.outcome !== 'observed') throw new Error('expected observations')
    expect(results.observations[0].status).toBe('healthy')
    expect(results.observations[0].summary).toMatch(/All 3 tasks have valid unique order values/)
  })

  it('offers the order repair when orders are missing', async () => {
    storeBoard.columns.todo.push(
      { id: 'a', title: 'Queued A', updatedAt: 1 },
      { id: 'b', title: 'Queued B', updatedAt: 2 },
    )
    const results = await checkTaskPositionIntegrity()
    if (results.outcome !== 'observed') throw new Error('expected observations')
    expect(results.observations[0].status).toBe('warning')
    expect(results.observations[0].incident?.resolution).toMatchObject({ type: 'repair', actionId: 'reorder-columns' })
    expect(results.observations[0].summary).toMatch(/missing/)
  })

  it('warns when duplicate orders exist within a column', async () => {
    storeBoard.columns.todo.push(
      { id: 'a', title: 'Queued A', order: 0, updatedAt: 1 },
      { id: 'b', title: 'Queued B', order: 0, updatedAt: 2 },
    )
    const results = await checkTaskPositionIntegrity()
    if (results.outcome !== 'observed') throw new Error('expected observations')
    expect(results.observations[0].status).toBe('warning')
    expect(results.observations[0].summary).toMatch(/duplicate/)
  })

  it('does not reorder during diagnostics', async () => {
    const older: StoreTask = { id: 'older', title: 'Older', updatedAt: 100 }
    const newer: StoreTask = { id: 'newer', title: 'Newer', updatedAt: 200 }
    storeBoard.columns.todo.push(older, newer)

    const results = await checkTaskPositionIntegrity()
    if (results.outcome !== 'observed') throw new Error('expected observations')
    expect(results.observations[0].status).toBe('warning')
    expect(newer.order).toBeUndefined()
    expect(older.order).toBeUndefined()
  })

  it('repair handler reassigns order zero-indexed by updatedAt desc', async () => {
    const older: StoreTask = { id: 'older', title: 'Older', updatedAt: 100 }
    const newer: StoreTask = { id: 'newer', title: 'Newer', updatedAt: 200 }
    storeBoard.columns.todo.push(older, newer)

    const repair = taskOrderRepair()
    const plan = await repair.plan({ type: 'all_actionable', reportId: 'report-1' })
    expect(plan).toHaveLength(1)
    const applied = await repair.apply(plan)
    expect(applied[0].status).toBe('applied')
    expect(newer.order).toBe(0)
    expect(older.order).toBe(1)
  })
})

// ─── Registration smoke test ──────────────────────────────────────────────

describe('plugin registration', () => {
  it('registers all owned health checks on activate', async () => {
    const tasksPlugin = (await import('../../../plugins/tasks')).default
    const registeredIds: string[] = []
    const registeredActionIds: string[] = []
    const noop = mock()
    const noopAsync = mock(async () => {})
    const ctx: Record<string, unknown> = {
      pluginId: 'tasks',
      runtime: {
        agents: { list: mock(async () => mockKnownAgents.map(id => ({ id, name: id }))) },
      },
      registerRoute: noop, registerExecTool: noop, registerNav: noop,
      registerSlot: noop, registerSkill: noop, registerWorkflow: noop,
      registerNodeType: noop, registerNotificationChannel: noop,
      registerHealthCheck: (def: { id: string }) => { registeredIds.push(def.id); return `tasks.${def.id}` },
      registerHealthRepairAction: (def: { id: string }) => { registeredActionIds.push(def.id); return `tasks.${def.id}` },
      watchFiles: noop,
      getSettings: () => ({}),
      updateSettings: noop,
      activity: { log: noop, audit: noop },
      hooks: { register: () => () => {}, has: () => false, invoke: noopAsync },
      search: {
        registerContentType: noop, registerFileBackedContentType: noop,
        index: noopAsync, remove: noopAsync, transform: noopAsync,
        query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'unavailable' as const } })),
      },
      storage: {},
      events: { on: noop, emit: noop, off: noop },
    }
    await tasksPlugin.activate(ctx as unknown as Parameters<typeof tasksPlugin.activate>[0])

    expect(registeredIds).toContain('taskboard')
    expect(registeredIds).toContain('task-consistency')
    expect(registeredIds).toContain('order-integrity')
    expect(registeredIds).toContain('session-death-incidents')
    expect(registeredActionIds).toEqual(['clear-done-depends-on', 'reorder-columns'])
  })
})
