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

let mockAutoFix = false
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({ doctor: { autoFixSkill: mockAutoFix } }),
  resetSettingsCache: () => {},
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

// Hook registry remains available for plugin activation tests, but task
// metadata checks read the shared task-store service directly.
mock.module('../../../src/lib/plugin-registry', () => ({
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
} from '../../../plugins/tasks/lib/health-checks'

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  storeBoard = emptyStoreBoard()
  mockAutoFix = false
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
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/2 tasks in Bakin task JSON store/)
  })

  it('returns ok with zero tasks when the store is empty', () => {
    const results = checkTaskboard()
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/0 tasks/)
  })
})

// ─── checkTaskConsistency ─────────────────────────────────────────────────

describe('checkTaskConsistency', () => {
  it('reports ok when the Bakin task store is available and empty', async () => {
    const results = await checkTaskConsistency(testDir)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/0 in-progress, 0 done/)
  })

  it('reports ok when no inProgress / done tasks exist', async () => {
    const results = await checkTaskConsistency(testDir)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/0 in-progress, 0 done/)
  })

  it('flags an in-progress task assigned to an unknown agent', async () => {
    storeBoard.columns.inProgress.push({ id: 't1', title: 'Build something', agent: 'ghost', log: [{}] })
    // Heartbeat exists so we don't ALSO flag heartbeat
    mkdirSync(pathJoin(testDir, 'heartbeats'), { recursive: true })
    writeFileSync(pathJoin(testDir, 'heartbeats', 'ghost.json'), '{}')

    const results = await checkTaskConsistency(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('unknown agent "ghost"'))).toBe(true)
  })

  it('flags an in-progress task with no heartbeat file', async () => {
    storeBoard.columns.inProgress.push({ id: 't2', title: 'Heartbeatless work', agent: 'patch', log: [{}] })
    const results = await checkTaskConsistency(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('no heartbeat file'))).toBe(true)
  })

  it('flags an in-progress task with zero log entries', async () => {
    storeBoard.columns.inProgress.push({ id: 't3', title: 'No logs', agent: 'patch', log: [] })
    mkdirSync(pathJoin(testDir, 'heartbeats'), { recursive: true })
    writeFileSync(pathJoin(testDir, 'heartbeats', 'patch.json'), '{}')
    const results = await checkTaskConsistency(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('zero log entries'))).toBe(true)
  })

  it('flags an agent overloaded with > 3 concurrent in-progress tasks', async () => {
    mkdirSync(pathJoin(testDir, 'heartbeats'), { recursive: true })
    writeFileSync(pathJoin(testDir, 'heartbeats', 'patch.json'), '{}')
    storeBoard.columns.inProgress.push(...Array.from({ length: 4 }, (_, i) => ({
      id: `t${i}`, title: `Task ${i}`, agent: 'patch', log: [{}],
    })))
    const results = await checkTaskConsistency(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('overloaded'))).toBe(true)
  })

  it('warns about orphaned dependsOn on a done task without autoFix', async () => {
    storeBoard.columns.done.push({ id: 'd1', title: 'Stale dep', dependsOn: 'old-task' })
    const results = await checkTaskConsistency(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('orphaned dependsOn') && r.autoFixable)).toBe(true)
  })

  it('clears orphaned dependsOn in autoFix mode', async () => {
    mockAutoFix = true
    storeBoard.columns.done.push({ id: 'd2', title: 'Auto-clear', dependsOn: 'orphan' })
    const results = await checkTaskConsistency(testDir)
    expect(results.some(r => r.status === 'fixed' && r.message.includes('Cleared orphaned dependsOn'))).toBe(true)
    expect(clearedDependencies).toContain('d2')
  })

  it('falls back to a warn when clearDependency hook throws under autoFix', async () => {
    mockAutoFix = true
    clearDependencyShouldThrow = true
    storeBoard.columns.done.push({ id: 'd3', title: 'Failed clear', dependsOn: 'orphan' })
    const results = await checkTaskConsistency(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('failed to clear'))).toBe(true)
  })
})

// ─── checkTaskPositionIntegrity ───────────────────────────────────────────

describe('checkTaskPositionIntegrity', () => {
  it('reports ok when no tasks exist', async () => {
    const results = await checkTaskPositionIntegrity()
    expect(results).toHaveLength(1)
    expect(results[0].check).toBe('order-integrity')
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/No tasks to check/)
  })

  it('reports ok when all tasks have unique orders', async () => {
    storeBoard.columns.todo.push(
      { id: 'a', title: 'Queued A', order: 0, updatedAt: 1 },
      { id: 'b', title: 'Queued B', order: 1, updatedAt: 2 },
    )
    storeBoard.columns.inProgress.push({ id: 'c', title: 'Running C', order: 0, updatedAt: 3 })
    const results = await checkTaskPositionIntegrity()
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/All 3 tasks have valid unique order values/)
  })

  it('warns when orders are missing without autoFix', async () => {
    storeBoard.columns.todo.push(
      { id: 'a', title: 'Queued A', updatedAt: 1 },
      { id: 'b', title: 'Queued B', updatedAt: 2 },
    )
    const results = await checkTaskPositionIntegrity()
    expect(results[0].status).toBe('warn')
    expect(results[0].autoFixable).toBe(true)
    expect(results[0].message).toMatch(/missing/)
  })

  it('warns when duplicate orders exist within a column', async () => {
    storeBoard.columns.todo.push(
      { id: 'a', title: 'Queued A', order: 0, updatedAt: 1 },
      { id: 'b', title: 'Queued B', order: 0, updatedAt: 2 },
    )
    const results = await checkTaskPositionIntegrity()
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/duplicates/)
  })

  it('auto-fixes by reassigning order zero-indexed by updatedAt desc', async () => {
    mockAutoFix = true
    const older: StoreTask = { id: 'older', title: 'Older', updatedAt: 100 }
    const newer: StoreTask = { id: 'newer', title: 'Newer', updatedAt: 200 }
    storeBoard.columns.todo.push(older, newer)

    const results = await checkTaskPositionIntegrity()
    expect(results[0].status).toBe('fixed')
    expect(newer.order).toBe(0)
    expect(older.order).toBe(1)
  })
})

// ─── Registration smoke test ──────────────────────────────────────────────

describe('plugin registration', () => {
  it('registers all owned health checks on activate', async () => {
    const tasksPlugin = (await import('../../../plugins/tasks')).default
    const registeredIds: string[] = []
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
      watchFiles: noop,
      getSettings: () => ({}),
      updateSettings: noop,
      activity: { log: noop, audit: noop },
      hooks: { register: () => () => {}, has: () => false, invoke: noopAsync },
      search: {
        registerContentType: noop, registerFileBackedContentType: noop,
        index: noopAsync, remove: noopAsync, transform: noopAsync,
        query: mock(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'fallback' as const } })),
      },
      storage: {},
      events: { on: noop, emit: noop, off: noop },
    }
    await tasksPlugin.activate(ctx as unknown as Parameters<typeof tasksPlugin.activate>[0])

    expect(registeredIds).toContain('taskboard')
    expect(registeredIds).toContain('task-consistency')
    expect(registeredIds).toContain('order-integrity')
  })
})
