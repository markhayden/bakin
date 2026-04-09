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
  POSITION_GAP,
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
  it('succeeds and assigns correct position', async () => {
    const task = await createTask('Human Override Task', 'backlog')
    expect(getTaskWithColumn(task.id)?.column).toBe('backlog')

    // Human channel bypasses transition guard (backlog → done not allowed for agents)
    await moveTask(task.id, 'done', 'backlog', 'human')

    const result = getTaskWithColumn(task.id)
    expect(result?.column).toBe('done')

    const taskData = getTask(task.id)
    expect(taskData?.position).toBe(POSITION_GAP) // first in done column
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
  it('maintains positions through transitions', async () => {
    const task = await createTask('Agent Task', 'todo')
    const initialPos = getTask(task.id)?.position
    expect(initialPos).toBe(POSITION_GAP)

    // Move to inProgress
    await moveTask(task.id, 'inProgress', 'todo', 'mcp')
    const ipTask = getTask(task.id)
    expect(ipTask?.position).toBe(POSITION_GAP) // first in inProgress

    // Add log entry (required for done)
    await addTaskLog(task.id, 'agent', 'Work complete')

    // Move to done
    await moveTask(task.id, 'done', 'inProgress', 'mcp')
    const doneTask = getTask(task.id)
    expect(doneTask?.position).toBe(POSITION_GAP) // first in done
    expect(getTaskWithColumn(task.id)?.column).toBe('done')
  })
})

describe('integration: create 5 tasks, reorder, verify positions', () => {
  it('reorder assigns clean POSITION_GAP positions', async () => {
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

    // Verify clean positions
    const positions = board2.columns.todo.map(t => t.position!)
    expect(positions).toEqual([
      POSITION_GAP, POSITION_GAP * 2, POSITION_GAP * 3, POSITION_GAP * 4, POSITION_GAP * 5,
    ])
  })
})

describe('integration: move between columns preserves other positions', () => {
  it('non-moved tasks keep their positions', async () => {
    const t1 = await createTask('Stay 1', 'todo')
    const t2 = await createTask('Moving', 'todo')
    const t3 = await createTask('Stay 2', 'todo')

    const beforePositions = {
      t1: getTask(t1.id)?.position,
      t3: getTask(t3.id)?.position,
    }

    // Move t2 to inProgress (human channel to avoid needing agent assignment)
    await moveTask(t2.id, 'inProgress', 'todo', 'human')

    // t1 and t3 keep their positions
    expect(getTask(t1.id)?.position).toBe(beforePositions.t1)
    expect(getTask(t3.id)?.position).toBe(beforePositions.t3)

    // t2 gets a new position in inProgress
    expect(getTask(t2.id)?.position).toBe(POSITION_GAP) // first in inProgress
    expect(getTaskWithColumn(t2.id)?.column).toBe('inProgress')
  })
})

describe('integration: move with afterTaskId preserves drop position', () => {
  it('card lands between specified neighbors in inProgress', async () => {
    const t1 = await createTask('First', 'inProgress')
    const t2 = await createTask('Second', 'inProgress')
    const t3 = await createTask('Third', 'inProgress')
    const mover = await createTask('Mover', 'todo')

    // Move mover between t1 and t2 in inProgress (human channel)
    await moveTask(mover.id, 'inProgress', 'todo', 'human', t1.id, t2.id)

    const board = readTaskboard()
    const ipTitles = board.columns.inProgress.map(t => t.title)
    expect(ipTitles).toEqual(['First', 'Mover', 'Second', 'Third'])
  })

  it('card lands between specified neighbors in backlog', async () => {
    const bl1 = await createTask('BL-First', 'backlog')
    const bl2 = await createTask('BL-Second', 'backlog')
    const mover = await createTask('Mover', 'todo')

    await moveTask(mover.id, 'backlog', 'todo', 'human', bl1.id, bl2.id)

    const board = readTaskboard()
    const titles = board.columns.backlog.map(t => t.title)
    expect(titles).toEqual(['BL-First', 'Mover', 'BL-Second'])
  })

  it('blockTask with position params lands at correct position', async () => {
    const bk1 = await createTask('Blocked-1', 'todo')
    await blockTask(bk1.id, 'reason 1')
    const bk2 = await createTask('Blocked-2', 'todo')
    await blockTask(bk2.id, 'reason 2')

    const mover = await createTask('New-Block', 'todo')
    // Move to blocked, positioned after bk1
    await moveTask(mover.id, 'blocked', 'todo', 'human', bk1.id, bk2.id)

    const board = readTaskboard()
    const titles = board.columns.blocked.map(t => t.title)
    expect(titles).toEqual(['Blocked-1', 'New-Block', 'Blocked-2'])
  })
})
