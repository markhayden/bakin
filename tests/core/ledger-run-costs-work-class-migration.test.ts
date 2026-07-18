/**
 * run_costs work-class migration (v8): the columns land, the only safe
 * historical backfill is `chat:%:title` → auto-title, and everything else
 * stays honestly NULL — `turn:` ids were shared by relays AND generic sends,
 * so mapping them would mislabel history (never guess). New writers must
 * declare their class; route_source is recorded when routing resolves.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-ledger-work-class-${Date.now()}-${randomUUID()}`)

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

import { listRunCostsSince, recordRunCost } from '../../src/core/execution-ledger'
import { closeDb } from '../../packages/core/src/storage/db'

const T0 = 1_700_000_000_000

beforeAll(() => {
  mkdirSync(testDir, { recursive: true })
  const raw = new Database(join(testDir, 'bakin.db'))
  raw.exec(
    `CREATE TABLE schema_migrations (
       module TEXT NOT NULL,
       version INTEGER NOT NULL,
       applied_at INTEGER NOT NULL,
       PRIMARY KEY (module, version)
     )`,
  )
  for (const version of [1, 2, 3, 4, 5, 6, 7]) {
    raw.prepare('INSERT INTO schema_migrations (module, version, applied_at) VALUES (?, ?, ?)')
      .run('execution', version, T0)
  }
  raw.exec(
    `CREATE TABLE run_costs (
       run_id TEXT PRIMARY KEY,
       task_id TEXT,
       agent TEXT NOT NULL,
       model TEXT,
       input_tokens INTEGER,
       output_tokens INTEGER,
       total_tokens INTEGER,
       cache_read_tokens INTEGER,
       cache_write_tokens INTEGER,
       cost_usd_micros INTEGER,
       occurred_at INTEGER NOT NULL,
       provider TEXT,
       lane TEXT,
       usage_kind TEXT NOT NULL DEFAULT 'tokens' CHECK (usage_kind IN ('tokens','media'))
     )`,
  )
  const insert = raw.prepare(
    `INSERT INTO run_costs (run_id, agent, usage_kind, occurred_at) VALUES (?, ?, ?, ?)`,
  )
  insert.run('task:t1:d1', 'worker', 'tokens', T0) // dispatch-era: class unrecorded → NULL
  insert.run('turn:legacy-relay-or-send', 'main', 'tokens', T0 + 1) // ambiguous → NULL
  insert.run('chat:abc123:title', 'main', 'tokens', T0 + 2) // unique prefix → auto-title
  insert.run('image:img1', 'pixel', 'media', T0 + 3) // media → NULL (excluded)
  raw.close()
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('run_costs work-class migration (v8)', () => {
  it('backfills only the safe prefix; ambiguous history stays NULL', () => {
    const byRun = new Map(listRunCostsSince(T0).map((row) => [row.runId, row]))
    expect(byRun.get('task:t1:d1')).toMatchObject({ workClass: null, routeSource: null })
    expect(byRun.get('turn:legacy-relay-or-send')).toMatchObject({ workClass: null, routeSource: null })
    expect(byRun.get('chat:abc123:title')).toMatchObject({ workClass: 'auto-title', routeSource: null })
    expect(byRun.get('image:img1')).toMatchObject({ workClass: null, routeSource: null })
  })

  it('new writers persist their declared class and route source', () => {
    recordRunCost({
      runId: 'task:t2:d1',
      taskId: 't2',
      agent: 'worker',
      model: 'anthropic/claude-haiku-4-5',
      usageKind: 'tokens',
      workClass: 'scheduled',
      routeSource: 'class',
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      occurredAt: T0 + 10,
    })
    recordRunCost({
      runId: `turn:${randomUUID()}`,
      agent: 'main',
      usageKind: 'tokens',
      workClass: 'relay',
      routeSource: null,
      occurredAt: T0 + 11,
    })
    const rows = listRunCostsSince(T0 + 10)
    const dispatch = rows.find((r) => r.runId === 'task:t2:d1')
    expect(dispatch).toMatchObject({ workClass: 'scheduled', routeSource: 'class' })
    const relay = rows.find((r) => r.workClass === 'relay')
    expect(relay).toBeDefined()
    expect(relay?.routeSource).toBeNull()
  })
})
