/**
 * run_costs provider/lane migration (cost-control v2 T1): pre-migration rows
 * get provider backfilled from `provider/model`-shaped ids in SQL; bare or
 * NULL models stay NULL (resolved at read time); lane stays NULL ("unknown",
 * treated as metered by readers — never a fabricated value).
 *
 * Seeds a v4-era db by hand (schema_migrations rows + v4 run_costs shape)
 * BEFORE the ledger module opens it, so the new migration's backfill runs
 * against genuinely legacy rows.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { Database } from 'bun:sqlite'

const testDir = join(tmpdir(), `bakin-test-ledger-rc-mig-${Date.now()}-${randomUUID()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    logs: join(testDir, 'logs'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const loggerMock = () => ({
  createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }),
})
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

import { listRunCostsSince } from '../../src/core/execution-ledger'
import { closeDb } from '../../packages/core/src/storage/db'

const T0 = 1_700_000_000_000

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  // Hand-build the v4-era store: migration bookkeeping says v1–v4 applied,
  // run_costs exists in its v4 shape, three legacy rows inserted. Only
  // run-cost verbs run in this test, so the other v1–v4 tables are omitted.
  const raw = new Database(join(testDir, 'bakin.db'))
  raw.exec(
    `CREATE TABLE schema_migrations (
       module     TEXT NOT NULL,
       version    INTEGER NOT NULL,
       applied_at INTEGER NOT NULL,
       PRIMARY KEY (module, version)
     )`,
  )
  for (const version of [1, 2, 3, 4]) {
    raw.prepare('INSERT INTO schema_migrations (module, version, applied_at) VALUES (?, ?, ?)').run('execution', version, T0)
  }
  raw.exec(
    `CREATE TABLE run_costs (
       run_id           TEXT PRIMARY KEY,
       task_id          TEXT,
       agent            TEXT NOT NULL,
       model            TEXT,
       input_tokens     INTEGER,
       output_tokens    INTEGER,
       total_tokens     INTEGER,
       cache_read_tokens INTEGER,
       cache_write_tokens INTEGER,
       cost_usd_micros  INTEGER,
       occurred_at      INTEGER NOT NULL
     )`,
  )
  const insert = raw.prepare(
    'INSERT INTO run_costs (run_id, task_id, agent, model, total_tokens, cost_usd_micros, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  insert.run('task:leg1:d1', 'leg1', 'pixel', 'anthropic/claude-sonnet-4-6', 1200, 6000, T0)
  insert.run('task:leg2:d1', 'leg2', 'rolo', 'bare-model-id', 600, 4500, T0 + 1)
  insert.run('task:leg3:d1', 'leg3', 'main', null, null, null, T0 + 2)
  raw.close()
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('run_costs provider/lane migration', () => {
  it('backfills provider from provider/model ids and leaves bare/NULL models and lane NULL', () => {
    // First verb call opens the store and applies the new migration.
    const rows = listRunCostsSince(T0 - 1)
    const byRun = new Map(rows.map((r) => [r.runId, r]))

    expect(byRun.get('task:leg1:d1')?.provider).toBe('anthropic')
    expect(byRun.get('task:leg2:d1')?.provider).toBeNull() // bare id — resolved at read time, never guessed in SQL
    expect(byRun.get('task:leg3:d1')?.provider).toBeNull()

    for (const runId of ['task:leg1:d1', 'task:leg2:d1', 'task:leg3:d1']) {
      expect(byRun.get(runId)?.lane).toBeNull() // pre-migration lane is unknown, never fabricated
    }
  })
})
