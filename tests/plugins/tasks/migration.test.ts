/**
 * Tests for tasks plugin migration (position backfill) and doctor check.
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

const POSITION_GAP = 1_000_000

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

function getTaskPosition(flowId: string): number | undefined {
  const db = new Database(dbPath)
  const row = db.prepare(`SELECT json_extract(state_json, '$.position') as pos FROM flow_runs WHERE flow_id = ?`).get(flowId) as { pos: number | null } | undefined
  db.close()
  return row?.pos ?? undefined
}

initTestDb()

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Migration tests
// ---------------------------------------------------------------------------

describe('position backfill migration', () => {
  beforeEach(() => clearTestDb())

  it('assigns positions to existing tasks', async () => {
    const now = Date.now()
    insertTask('t1', 'queued', { title: 'Task 1' }, now - 2000) // oldest
    insertTask('t2', 'queued', { title: 'Task 2' }, now - 1000)
    insertTask('t3', 'queued', { title: 'Task 3' }, now)         // newest

    const { up } = await import('../../../plugins/tasks/migrations/2.1.0')
    await up()

    // All tasks should have positions
    expect(getTaskPosition('t1')).toBeDefined()
    expect(getTaskPosition('t2')).toBeDefined()
    expect(getTaskPosition('t3')).toBeDefined()
  })

  it('preserves column grouping — independent sequences per column', async () => {
    const now = Date.now()
    insertTask('todo-1', 'queued', { title: 'Todo 1' }, now)
    insertTask('ip-1', 'running', { title: 'In Progress 1' }, now)

    const { up } = await import('../../../plugins/tasks/migrations/2.1.0')
    await up()

    // Each column starts its own position sequence
    expect(getTaskPosition('todo-1')).toBe(POSITION_GAP)
    expect(getTaskPosition('ip-1')).toBe(POSITION_GAP)
  })

  it('preserves existing order — updated_at DESC becomes position order', async () => {
    const now = Date.now()
    // t3 is newest (highest updated_at) → should get lowest position (first in list)
    insertTask('t1', 'queued', { title: 'Oldest' }, now - 2000)
    insertTask('t2', 'queued', { title: 'Middle' }, now - 1000)
    insertTask('t3', 'queued', { title: 'Newest' }, now)

    const { up } = await import('../../../plugins/tasks/migrations/2.1.0')
    await up()

    const p1 = getTaskPosition('t1')!
    const p2 = getTaskPosition('t2')!
    const p3 = getTaskPosition('t3')!

    // Sorted by updated_at DESC: t3, t2, t1 → positions 1M, 2M, 3M
    expect(p3).toBe(POSITION_GAP)
    expect(p2).toBe(POSITION_GAP * 2)
    expect(p1).toBe(POSITION_GAP * 3)
  })

  it('is idempotent — running twice produces same result', async () => {
    const now = Date.now()
    insertTask('t1', 'queued', { title: 'Task 1' }, now)

    const { up } = await import('../../../plugins/tasks/migrations/2.1.0')
    await up()
    const firstPos = getTaskPosition('t1')

    await up()
    const secondPos = getTaskPosition('t1')

    expect(firstPos).toBe(secondPos)
  })

  it('handles empty database gracefully', async () => {
    const { up } = await import('../../../plugins/tasks/migrations/2.1.0')
    await expect(up()).resolves.toBeUndefined()
  })

  it('handles tasks across all column types', async () => {
    const now = Date.now()
    insertTask('backlog-1', 'queued', { title: 'BL', column: 'backlog' }, now)
    insertTask('todo-1', 'queued', { title: 'TD' }, now)
    insertTask('ip-1', 'running', { title: 'IP' }, now)
    insertTask('review-1', 'waiting', { title: 'RV' }, now)
    insertTask('blocked-1', 'waiting', { title: 'BK' }, now, 'blocked')
    insertTask('done-1', 'succeeded', { title: 'DN' }, now)
    insertTask('archived-1', 'succeeded', { title: 'AR', archived: true }, now)

    const { up } = await import('../../../plugins/tasks/migrations/2.1.0')
    await up()

    // Every task gets a position
    for (const id of ['backlog-1', 'todo-1', 'ip-1', 'review-1', 'blocked-1', 'done-1', 'archived-1']) {
      expect(getTaskPosition(id)).toBeDefined()
      expect(getTaskPosition(id)).toBeGreaterThan(0)
    }
  })
})
