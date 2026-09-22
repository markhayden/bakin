/**
 * Ledger v10 migration over a v9-shaped budget_incidents table: the three
 * additive columns land, every existing row gets episode 1 and a minted
 * event id (an already-open incident must be deliverable by the new
 * durable-rows worker, never silently skipped), and legacy 'warn' rows —
 * a kind the evaluator no longer produces — are dropped so they cannot
 * linger as stale "Budget warning" banners. UNIQUE stays untouched.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-ledger-v10-${Date.now()}-${randomUUID()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import { listBudgetIncidents, listMilestones, openBudgetIncident } from '../../src/core/execution-ledger'
import { closeDb } from '../../packages/core/src/storage/db'

const T0 = 1_700_000_000_000

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  const raw = new Database(join(testDir, 'bakin.db'))
  raw.exec(
    `CREATE TABLE schema_migrations (
       module TEXT NOT NULL, version INTEGER NOT NULL, applied_at INTEGER NOT NULL,
       PRIMARY KEY (module, version)
     )`,
  )
  for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    raw.prepare('INSERT INTO schema_migrations (module, version, applied_at) VALUES (?, ?, ?)').run('execution', version, T0)
  }
  // Only the tables v10 touches need to exist for the migration to run.
  raw.exec(
    `CREATE TABLE budget_incidents (
       id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '',
       lane TEXT NOT NULL, win TEXT NOT NULL, window_start_ms INTEGER NOT NULL, kind TEXT NOT NULL,
       unit TEXT NOT NULL, cap_value INTEGER NOT NULL, spent_value INTEGER NOT NULL,
       at_cap TEXT NOT NULL DEFAULT 'defer', opened_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open',
       resolved_at INTEGER, resolution TEXT,
       UNIQUE(scope, scope_id, lane, win, window_start_ms, kind)
     )`,
  )
  raw.exec("CREATE INDEX budget_incidents_live ON budget_incidents(status) WHERE status IN ('open','acknowledged')")
  const insert = raw.prepare(
    `INSERT INTO budget_incidents (scope, scope_id, lane, win, window_start_ms, kind, unit, cap_value, spent_value, at_cap, opened_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insert.run('global', '', 'metered', 'daily', T0, 'cap', 'usd_micros', 10, 11, 'defer', T0, 'open')
  insert.run('global', '', 'metered', 'daily', T0, 'warn', 'usd_micros', 10, 8, 'defer', T0, 'open')
  insert.run('agent', 'pixel', 'metered', 'monthly', T0, 'cap', 'usd_micros', 10, 12, 'pause', T0, 'resolved')
  raw.close()
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('ledger v10 — incident episodes + milestones migration', () => {
  it('existing rows get episode 1 + a minted event id, warn rows are gone, resolved rows keep their state', () => {
    const rows = listBudgetIncidents({})
    expect(rows.map((r) => r.kind)).not.toContain('warn')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.episode).toBe(1)
      expect(row.eventId).toMatch(/^[0-9a-f-]{36}$/)
      expect(row.notifiedAt).toBeNull()
    }
    expect(new Set(rows.map((r) => r.eventId)).size).toBe(2)
    expect(rows.find((r) => r.scopeId === 'pixel')?.status).toBe('resolved')
  })

  it('the migrated table still debounces on the untouched UNIQUE and the milestones table is live', () => {
    const again = openBudgetIncident({
      scope: 'global', lane: 'metered', window: 'daily', windowStartMs: T0, kind: 'cap',
      unit: 'usd_micros', capValue: 10, spentValue: 13, atCap: 'defer', openedAt: T0 + 1,
    })
    expect(again.opened).toBe(false)
    expect(listMilestones({ ruleId: 'none' })).toEqual([])
  })
})
