/**
 * Tests for tasks plugin migration (position → order) and doctor check.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ---------------------------------------------------------------------------
// Test directory setup
// ---------------------------------------------------------------------------

const testHome = join(tmpdir(), `bakin-migration-test-${Date.now()}`)
const flowsDir = join(testHome, '.openclaw', 'flows')
const dbPath = join(flowsDir, 'registry.sqlite')

mkdirSync(flowsDir, { recursive: true })

// Redirect openclaw home to test directory
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => testHome }
})

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

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

function insertTask(flowId: string, status: string, stateJson: Record<string, unknown>, updatedAt: number, blockedTaskId?: string) {
  const db = new Database(dbPath)
  db.prepare(`
    INSERT INTO flow_runs (flow_id, owner_key, status, goal, state_json, blocked_task_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    flowId,
    `bakin:task:${flowId}`,
    status,
    (stateJson as { title?: string }).title || flowId,
    JSON.stringify(stateJson),
    blockedTaskId || null,
    updatedAt,
    updatedAt,
  )
  db.close()
}

function getTaskOrder(flowId: string): number | undefined {
  const db = new Database(dbPath)
  const row = db.prepare(`SELECT json_extract(state_json, '$.order') as ord FROM flow_runs WHERE flow_id = ?`).get(flowId) as { ord: number | null } | undefined
  db.close()
  return row?.ord ?? undefined
}

function getTaskState(flowId: string): Record<string, unknown> {
  const db = new Database(dbPath)
  const row = db.prepare(`SELECT state_json FROM flow_runs WHERE flow_id = ?`).get(flowId) as { state_json: string } | undefined
  db.close()
  return row ? JSON.parse(row.state_json) : {}
}

initTestDb()

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Migration tests
// ---------------------------------------------------------------------------

describe('position → order migration', () => {
  beforeEach(() => clearTestDb())

  it('assigns zero-indexed order to existing tasks', async () => {
    const now = Date.now()
    insertTask('t1', 'queued', { title: 'Task 1', position: 1000000 }, now - 2000)
    insertTask('t2', 'queued', { title: 'Task 2', position: 2000000 }, now - 1000)
    insertTask('t3', 'queued', { title: 'Task 3', position: 3000000 }, now)

    const { up } = await import('../../../plugins/tasks/migrations/2.1.0')
    await up()

    // All tasks should have zero-indexed order
    expect(getTaskOrder('t1')).toBe(0)
    expect(getTaskOrder('t2')).toBe(1)
    expect(getTaskOrder('t3')).toBe(2)
  })

  it('preserves column grouping — independent sequences per column', async () => {
    const now = Date.now()
    insertTask('todo-1', 'queued', { title: 'Todo 1', position: 1000000 }, now)
    insertTask('ip-1', 'running', { title: 'In Progress 1', position: 1000000 }, now)

    const { up } = await import('../../../plugins/tasks/migrations/2.1.0')
    await up()

    // Each column starts at 0
    expect(getTaskOrder('todo-1')).toBe(0)
    expect(getTaskOrder('ip-1')).toBe(0)
  })

  it('preserves existing position order during migration', async () => {
    const now = Date.now()
    // Position order: t3 (1M) < t2 (2M) < t1 (3M)
    insertTask('t1', 'queued', { title: 'Highest Pos', position: 3000000 }, now - 2000)
    insertTask('t2', 'queued', { title: 'Middle Pos', position: 2000000 }, now - 1000)
    insertTask('t3', 'queued', { title: 'Lowest Pos', position: 1000000 }, now)

    const { up } = await import('../../../plugins/tasks/migrations/2.1.0')
    await up()

    // Sorted by position ASC: t3(0), t2(1), t1(2)
    expect(getTaskOrder('t3')).toBe(0)
    expect(getTaskOrder('t2')).toBe(1)
    expect(getTaskOrder('t1')).toBe(2)
  })

  it('removes old position field', async () => {
    const now = Date.now()
    insertTask('t1', 'queued', { title: 'Task 1', position: 1000000 }, now)

    const { up } = await import('../../../plugins/tasks/migrations/2.1.0')
    await up()

    const state = getTaskState('t1')
    expect(state.position).toBeUndefined()
    expect(state.order).toBe(0)
  })

  it('is idempotent — running twice produces same result', async () => {
    const now = Date.now()
    insertTask('t1', 'queued', { title: 'Task 1', position: 1000000 }, now)

    const { up } = await import('../../../plugins/tasks/migrations/2.1.0')
    await up()
    const firstOrder = getTaskOrder('t1')

    await up()
    const secondOrder = getTaskOrder('t1')

    expect(firstOrder).toBe(secondOrder)
  })

  it('handles empty database gracefully', async () => {
    const { up } = await import('../../../plugins/tasks/migrations/2.1.0')
    await expect(up()).resolves.toBeUndefined()
  })

  it('handles tasks across all column types', async () => {
    const now = Date.now()
    insertTask('backlog-1', 'queued', { title: 'BL', column: 'backlog', position: 1000000 }, now)
    insertTask('todo-1', 'queued', { title: 'TD', position: 1000000 }, now)
    insertTask('ip-1', 'running', { title: 'IP', position: 1000000 }, now)
    insertTask('review-1', 'waiting', { title: 'RV', position: 1000000 }, now)
    insertTask('blocked-1', 'waiting', { title: 'BK', position: 1000000 }, now, 'blocked')
    insertTask('done-1', 'succeeded', { title: 'DN', position: 1000000 }, now)
    insertTask('archived-1', 'succeeded', { title: 'AR', archived: true, position: 1000000 }, now)

    const { up } = await import('../../../plugins/tasks/migrations/2.1.0')
    await up()

    // Every task gets order 0 (each is the only task in its column)
    for (const id of ['backlog-1', 'todo-1', 'ip-1', 'review-1', 'blocked-1', 'done-1', 'archived-1']) {
      expect(getTaskOrder(id)).toBe(0)
    }
  })

  it('falls back to updated_at DESC when no position exists', async () => {
    const now = Date.now()
    // No position field — should sort by updated_at DESC
    insertTask('t1', 'queued', { title: 'Oldest' }, now - 2000)
    insertTask('t2', 'queued', { title: 'Middle' }, now - 1000)
    insertTask('t3', 'queued', { title: 'Newest' }, now)

    const { up } = await import('../../../plugins/tasks/migrations/2.1.0')
    await up()

    // Sorted by updated_at DESC: t3(0), t2(1), t1(2)
    expect(getTaskOrder('t3')).toBe(0)
    expect(getTaskOrder('t2')).toBe(1)
    expect(getTaskOrder('t1')).toBe(2)
  })
})
