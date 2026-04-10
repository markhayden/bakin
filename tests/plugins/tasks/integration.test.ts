/**
 * Integration tests for tasks plugin — end-to-end flows testing
 * position ordering, two-tier permissions, and state transitions.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ---------------------------------------------------------------------------
// Test directory setup
// ---------------------------------------------------------------------------

const testHome = join(tmpdir(), `bakin-integration-test-${Date.now()}`)
const flowsDir = join(testHome, '.openclaw', 'flows')
const dbPath = join(flowsDir, 'registry.sqlite')

mkdirSync(flowsDir, { recursive: true })

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
  const db = new Database(dbPath)
  db.exec(`DELETE FROM flow_runs`)
  db.close()
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => testHome }
})

vi.mock('../../../plugins/workflows/lib/runtime', () => ({
  cancelInstance: vi.fn(),
}))

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}))

;(globalThis as Record<string, unknown>).__bakinBroadcast = vi.fn()

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  readTaskboard,
  createTask,
  moveTask,
  addTaskLog,
  blockTask,
  reorderTasks,
  getTask,
  getTaskWithColumn,
} from '../../../plugins/tasks/lib/flow-store'

initTestDb()

beforeEach(() => {
  clearTestDb()
  vi.clearAllMocks()
})

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('integration: human drag backlog → done (full bypass)', () => {
  it('succeeds and assigns correct order', async () => {
    const task = await createTask('Human Override Task', 'backlog')
    expect(getTaskWithColumn(task.id)?.column).toBe('backlog')

    // Human channel bypasses transition guard (backlog → done not allowed for agents)
    await moveTask(task.id, 'done', 'backlog', 'human')

    const result = getTaskWithColumn(task.id)
    expect(result?.column).toBe('done')

    const taskData = getTask(task.id)
    expect(taskData?.order).toBe(0) // first in done column
  })
})

describe('integration: agent move backlog → done (rejected)', () => {
  it('rejects invalid transition for agent', async () => {
    const task = await createTask('Agent Blocked Task', 'backlog')

    await expect(moveTask(task.id, 'done', 'backlog', 'mcp')).rejects.toThrow('Invalid transition')

    // Task stays in backlog
    expect(getTaskWithColumn(task.id)?.column).toBe('backlog')
  })
})

describe('integration: agent happy path todo → inProgress → done', () => {
  it('maintains order through transitions', async () => {
    const task = await createTask('Agent Task', 'todo')
    expect(getTask(task.id)?.order).toBe(0)

    // Move to inProgress
    await moveTask(task.id, 'inProgress', 'todo', 'mcp')
    expect(getTask(task.id)?.order).toBe(0) // first in inProgress

    // Add log entry (required for done)
    await addTaskLog(task.id, 'agent', 'Work complete')

    // Move to done
    await moveTask(task.id, 'done', 'inProgress', 'mcp')
    expect(getTask(task.id)?.order).toBe(0) // first in done
    expect(getTaskWithColumn(task.id)?.column).toBe('done')
  })
})

describe('integration: create 5 tasks, reorder, verify order', () => {
  it('reorder assigns clean zero-indexed order values', async () => {
    const tasks = []
    for (let i = 0; i < 5; i++) {
      tasks.push(await createTask(`Task ${i}`, 'todo'))
    }

    // Verify initial order
    const board1 = readTaskboard()
    expect(board1.columns.todo.map(t => t.title)).toEqual([
      'Task 0', 'Task 1', 'Task 2', 'Task 3', 'Task 4',
    ])

    // Reverse order
    const reversedIds = tasks.map(t => t.id).reverse()
    await reorderTasks('todo', reversedIds)

    // Verify new order
    const board2 = readTaskboard()
    expect(board2.columns.todo.map(t => t.title)).toEqual([
      'Task 4', 'Task 3', 'Task 2', 'Task 1', 'Task 0',
    ])

    // Verify zero-indexed order
    const orders = board2.columns.todo.map(t => t.order!)
    expect(orders).toEqual([0, 1, 2, 3, 4])
  })
})

describe('integration: move between columns preserves other order', () => {
  it('non-moved tasks keep their order', async () => {
    const t1 = await createTask('Stay 1', 'todo')
    const t2 = await createTask('Moving', 'todo')
    const t3 = await createTask('Stay 2', 'todo')

    const beforeOrders = {
      t1: getTask(t1.id)?.order,
      t3: getTask(t3.id)?.order,
    }

    // Move t2 to inProgress (human channel to avoid needing agent assignment)
    await moveTask(t2.id, 'inProgress', 'todo', 'human')

    // t1 and t3 keep their order
    expect(getTask(t1.id)?.order).toBe(beforeOrders.t1)
    expect(getTask(t3.id)?.order).toBe(beforeOrders.t3)

    // t2 gets order 0 in inProgress (first task)
    expect(getTask(t2.id)?.order).toBe(0)
    expect(getTaskWithColumn(t2.id)?.column).toBe('inProgress')
  })
})

describe('integration: moveTask always appends, reorder sets final order', () => {
  it('moveTask appends to end of inProgress', async () => {
    const t1 = await createTask('First', 'inProgress')
    const t2 = await createTask('Second', 'inProgress')
    const mover = await createTask('Mover', 'todo')

    await moveTask(mover.id, 'inProgress', 'todo', 'human')

    const board = readTaskboard()
    const ipTitles = board.columns.inProgress.map(t => t.title)
    expect(ipTitles).toEqual(['First', 'Second', 'Mover'])
  })

  it('reorder after move sets correct final order', async () => {
    const t1 = await createTask('First', 'inProgress')
    const t2 = await createTask('Second', 'inProgress')
    const mover = await createTask('Mover', 'todo')

    await moveTask(mover.id, 'inProgress', 'todo', 'human')
    // Reorder to insert mover between t1 and t2
    await reorderTasks('inProgress', [t1.id, mover.id, t2.id])

    const board = readTaskboard()
    const ipTitles = board.columns.inProgress.map(t => t.title)
    expect(ipTitles).toEqual(['First', 'Mover', 'Second'])
    expect(board.columns.inProgress.map(t => t.order)).toEqual([0, 1, 2])
  })

  it('blockTask appends to blocked column', async () => {
    const bk1 = await createTask('Blocked-1', 'todo')
    await blockTask(bk1.id, 'reason 1')
    const bk2 = await createTask('Blocked-2', 'todo')
    await blockTask(bk2.id, 'reason 2')

    const board = readTaskboard()
    const titles = board.columns.blocked.map(t => t.title)
    expect(titles).toEqual(['Blocked-1', 'Blocked-2'])
    expect(board.columns.blocked.map(t => t.order)).toEqual([0, 1])
  })
})
