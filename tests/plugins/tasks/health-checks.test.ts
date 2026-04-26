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
const openClawDir = pathJoin(testDir, 'openclaw')
const flowsDir = pathJoin(openClawDir, 'flows')
const dbPath = pathJoin(flowsDir, 'registry.sqlite')

process.env.OPENCLAW_HOME = openClawDir
process.env.BAKIN_HOME = testDir

import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

mkdirSync(flowsDir, { recursive: true })

// ─── Mocks (mandatory test-isolation per CLAUDE.md) ────────────────────────

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  isUsingBakinHome: () => true,
}))
mock.module('@bakin/core/openclaw-home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../packages/core/src/openclaw-home', () => ({
  getOpenClawHome: () => openClawDir,
  getOpenClawPath: (...parts: string[]) => join(openClawDir, ...parts),
  resetOpenClawHome: () => {},
}))

let mockAutoFix = false
mock.module('../../../src/core/settings', () => ({
  getSettings: () => ({ doctor: { autoFixSkill: mockAutoFix } }),
  resetSettingsCache: () => {},
}))

let mockKnownAgents: string[] = ['main', 'patch', 'pixel']
mock.module('../../../packages/core/src/openclaw-config', () => ({
  getAgentIds: () => mockKnownAgents,
  readOpenClawConfig: () => ({ agents: { list: mockKnownAgents.map(id => ({ id })) } }),
  resetOpenClawConfigCache: () => {},
  getAgentList: () => mockKnownAgents.map(id => ({ id })),
  findAgentById: (id: string) => mockKnownAgents.includes(id) ? { id } : null,
}))

mock.module('../../../src/core/main-agent', () => ({
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

// flow-store mock — the migrated checks don't import it directly (they go
// through the tasks.readTaskboard / tasks.clearDependency hooks), but the
// per-directory test isolation rule requires every plugins/tasks/* test
// to declare a flow-store mock so a careless future import can't leak
// SQLite writes into the real ~/.openclaw/ tree. Also: the plugin-
// registration smoke at the bottom of this file imports the full tasks
// plugin via `await import('../../../plugins/tasks')`, which pulls in
// every flow-store export — keep the surface complete.
mock.module('../../../plugins/tasks/lib/flow-store', () => ({
  readTaskboard: () => null,
  getAllTasks: () => ({ columns: { todo: [], inProgress: [], done: [] } }),
  getTask: () => null,
  createTask: () => undefined,
  deleteTask: () => undefined,
  assignTask: () => undefined,
  addTaskLog: () => undefined,
  blockTask: () => undefined,
  updateTask: () => undefined,
  moveTask: () => undefined,
  setDependency: () => undefined,
  clearDependency: () => undefined,
  reorderTasks: () => undefined,
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

// Hook registry — task-consistency uses tasks.readTaskboard +
// tasks.clearDependency. Tests inject the desired board shape per case.
type BoardShape = {
  inProgress: Array<{ id: string; title: string; agent?: string; dependsOn?: string; log?: unknown[] }>
  done: Array<{ id: string; title: string; agent?: string; dependsOn?: string; log?: unknown[] }>
  todo: unknown[]
  blocked: unknown[]
}
let mockBoard: { columns: BoardShape } | null = null
const clearedDependencies: string[] = []
let clearDependencyShouldThrow = false
mock.module('../../../src/lib/plugin-registry', () => ({
  getHookRegistry: () => ({
    invoke: async (name: string, data: Record<string, unknown>) => {
      if (name === 'tasks.readTaskboard') return mockBoard
      if (name === 'tasks.clearDependency') {
        if (clearDependencyShouldThrow) throw new Error('cleardep failed')
        clearedDependencies.push(data.taskId as string)
        return undefined
      }
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

// ─── SQLite test fixture ──────────────────────────────────────────────────

function initTestDb() {
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS flow_runs (
      flow_id TEXT PRIMARY KEY,
      shape TEXT,
      sync_mode TEXT DEFAULT 'managed',
      owner_key TEXT NOT NULL,
      requester_origin_json TEXT,
      controller_id TEXT,
      revision INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      notify_policy TEXT DEFAULT 'silent',
      goal TEXT,
      current_step TEXT,
      blocked_task_id TEXT,
      blocked_summary TEXT,
      state_json TEXT,
      wait_json TEXT,
      cancel_requested_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      ended_at INTEGER
    )
  `)
  db.close()
}

function clearTestDb() {
  if (!existsSync(dbPath)) return
  const db = new Database(dbPath)
  db.exec(`DELETE FROM flow_runs`)
  db.close()
}

/** Remove .sqlite + WAL + SHM sidecars so a subsequent open is fresh. */
function removeDbAndSidecars() {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(dbPath + suffix, { force: true })
  }
}

function insertFlowRow(args: {
  flowId: string
  status: 'queued' | 'running' | 'waiting' | 'succeeded'
  state: Record<string, unknown>
  blockedTaskId?: string
  updatedAt?: number
}) {
  const db = new Database(dbPath)
  db.prepare(`INSERT INTO flow_runs (flow_id, owner_key, status, state_json, blocked_task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(
      args.flowId,
      'bakin:task:' + args.flowId,
      args.status,
      JSON.stringify(args.state),
      args.blockedTaskId ?? null,
      Date.now(),
      args.updatedAt ?? Date.now(),
    )
  db.close()
}

initTestDb()

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  clearTestDb()
  mockAutoFix = false
  mockKnownAgents = ['main', 'patch', 'pixel']
  mockBoard = null
  clearedDependencies.length = 0
  clearDependencyShouldThrow = false
})

// ─── checkTaskboard ────────────────────────────────────────────────────────

describe('checkTaskboard', () => {
  it('warns when the SQLite file does not exist', () => {
    removeDbAndSidecars()
    const results = checkTaskboard()
    expect(results).toHaveLength(1)
    expect(results[0].check).toBe('taskboard')
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/database not found/)
    initTestDb() // restore for subsequent tests
  })

  it('reports ok with the Bakin-owned task count', () => {
    insertFlowRow({ flowId: 't1', status: 'running', state: {} })
    insertFlowRow({ flowId: 't2', status: 'queued', state: {} })
    const results = checkTaskboard()
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/2 tasks in flow_runs/)
  })

  it('returns ok with zero tasks when the table is empty', () => {
    const results = checkTaskboard()
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/0 tasks/)
  })
})

// ─── checkTaskConsistency ─────────────────────────────────────────────────

describe('checkTaskConsistency', () => {
  it('warns when no taskboard hook is registered', async () => {
    mockBoard = null
    const results = await checkTaskConsistency(testDir)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/Taskboard not available/)
  })

  it('reports ok when no inProgress / done tasks exist', async () => {
    mockBoard = { columns: { inProgress: [], done: [], todo: [], blocked: [] } }
    const results = await checkTaskConsistency(testDir)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/0 in-progress, 0 done/)
  })

  it('flags an in-progress task assigned to an unknown agent', async () => {
    mockBoard = {
      columns: {
        inProgress: [{ id: 't1', title: 'Build something', agent: 'ghost', log: [{}] }],
        done: [],
        todo: [],
        blocked: [],
      },
    }
    // Heartbeat exists so we don't ALSO flag heartbeat
    mkdirSync(pathJoin(testDir, 'heartbeats'), { recursive: true })
    writeFileSync(pathJoin(testDir, 'heartbeats', 'ghost.json'), '{}')

    const results = await checkTaskConsistency(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('unknown agent "ghost"'))).toBe(true)
  })

  it('flags an in-progress task with no heartbeat file', async () => {
    mockBoard = {
      columns: {
        inProgress: [{ id: 't2', title: 'Heartbeatless work', agent: 'patch', log: [{}] }],
        done: [],
        todo: [],
        blocked: [],
      },
    }
    const results = await checkTaskConsistency(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('no heartbeat file'))).toBe(true)
  })

  it('flags an in-progress task with zero log entries', async () => {
    mockBoard = {
      columns: {
        inProgress: [{ id: 't3', title: 'No logs', agent: 'patch', log: [] }],
        done: [],
        todo: [],
        blocked: [],
      },
    }
    mkdirSync(pathJoin(testDir, 'heartbeats'), { recursive: true })
    writeFileSync(pathJoin(testDir, 'heartbeats', 'patch.json'), '{}')
    const results = await checkTaskConsistency(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('zero log entries'))).toBe(true)
  })

  it('flags an agent overloaded with > 3 concurrent in-progress tasks', async () => {
    mkdirSync(pathJoin(testDir, 'heartbeats'), { recursive: true })
    writeFileSync(pathJoin(testDir, 'heartbeats', 'patch.json'), '{}')
    mockBoard = {
      columns: {
        inProgress: Array.from({ length: 4 }, (_, i) => ({
          id: `t${i}`, title: `Task ${i}`, agent: 'patch', log: [{}],
        })),
        done: [],
        todo: [],
        blocked: [],
      },
    }
    const results = await checkTaskConsistency(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('overloaded'))).toBe(true)
  })

  it('warns about orphaned dependsOn on a done task without autoFix', async () => {
    mockBoard = {
      columns: {
        inProgress: [],
        done: [{ id: 'd1', title: 'Stale dep', dependsOn: 'old-task' }],
        todo: [],
        blocked: [],
      },
    }
    const results = await checkTaskConsistency(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('orphaned dependsOn') && r.autoFixable)).toBe(true)
  })

  it('clears orphaned dependsOn in autoFix mode', async () => {
    mockAutoFix = true
    mockBoard = {
      columns: {
        inProgress: [],
        done: [{ id: 'd2', title: 'Auto-clear', dependsOn: 'orphan' }],
        todo: [],
        blocked: [],
      },
    }
    const results = await checkTaskConsistency(testDir)
    expect(results.some(r => r.status === 'fixed' && r.message.includes('Cleared orphaned dependsOn'))).toBe(true)
    expect(clearedDependencies).toContain('d2')
  })

  it('falls back to a warn when clearDependency hook throws under autoFix', async () => {
    mockAutoFix = true
    clearDependencyShouldThrow = true
    mockBoard = {
      columns: {
        inProgress: [],
        done: [{ id: 'd3', title: 'Failed clear', dependsOn: 'orphan' }],
        todo: [],
        blocked: [],
      },
    }
    const results = await checkTaskConsistency(testDir)
    expect(results.some(r => r.status === 'warn' && r.message.includes('failed to clear'))).toBe(true)
  })
})

// ─── checkTaskPositionIntegrity ───────────────────────────────────────────

describe('checkTaskPositionIntegrity', () => {
  it('reports ok when no database exists', () => {
    removeDbAndSidecars()
    const results = checkTaskPositionIntegrity()
    expect(results).toHaveLength(1)
    expect(results[0].check).toBe('order-integrity')
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/No task database found/)
    initTestDb()
  })

  it('reports ok when no tasks exist', () => {
    const results = checkTaskPositionIntegrity()
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/No tasks to check/)
  })

  it('reports ok when all tasks have unique orders', () => {
    insertFlowRow({ flowId: 'a', status: 'queued', state: { order: 0 }, updatedAt: 1 })
    insertFlowRow({ flowId: 'b', status: 'queued', state: { order: 1 }, updatedAt: 2 })
    insertFlowRow({ flowId: 'c', status: 'running', state: { order: 0 }, updatedAt: 3 })
    const results = checkTaskPositionIntegrity()
    expect(results[0].status).toBe('ok')
    expect(results[0].message).toMatch(/All 3 tasks have valid unique order values/)
  })

  it('warns when orders are missing without autoFix', () => {
    insertFlowRow({ flowId: 'a', status: 'queued', state: {}, updatedAt: 1 })
    insertFlowRow({ flowId: 'b', status: 'queued', state: {}, updatedAt: 2 })
    const results = checkTaskPositionIntegrity()
    expect(results[0].status).toBe('warn')
    expect(results[0].autoFixable).toBe(true)
    expect(results[0].message).toMatch(/missing/)
  })

  it('warns when duplicate orders exist within a column', () => {
    insertFlowRow({ flowId: 'a', status: 'queued', state: { order: 0 }, updatedAt: 1 })
    insertFlowRow({ flowId: 'b', status: 'queued', state: { order: 0 }, updatedAt: 2 })
    const results = checkTaskPositionIntegrity()
    expect(results[0].status).toBe('warn')
    expect(results[0].message).toMatch(/duplicates/)
  })

  it('auto-fixes by reassigning order zero-indexed by updated_at desc', () => {
    mockAutoFix = true
    insertFlowRow({ flowId: 'older', status: 'queued', state: {}, updatedAt: 100 })
    insertFlowRow({ flowId: 'newer', status: 'queued', state: {}, updatedAt: 200 })

    const results = checkTaskPositionIntegrity()
    expect(results[0].status).toBe('fixed')

    // Verify the assignment in SQLite
    const db = new Database(dbPath)
    const rows = db.prepare(`SELECT flow_id, state_json FROM flow_runs ORDER BY updated_at DESC`).all() as Array<{ flow_id: string; state_json: string }>
    db.close()
    const newer = rows.find(r => r.flow_id === 'newer')!
    const older = rows.find(r => r.flow_id === 'older')!
    expect(JSON.parse(newer.state_json).order).toBe(0)
    expect(JSON.parse(older.state_json).order).toBe(1)
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
