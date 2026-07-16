/**
 * run_costs usage-kind migration: old image rows are media, every other old
 * row is token-bearing, and component-only token rows recover their total.
 */
import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-ledger-usage-kind-${Date.now()}-${randomUUID()}`)

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

import { listRunCostsSince, runTokensByAgentSince } from '../../src/core/execution-ledger'
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
  for (const version of [1, 2, 3, 4, 5, 6]) {
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
       lane TEXT
     )`,
  )
  const insert = raw.prepare(
    `INSERT INTO run_costs
       (run_id, agent, input_tokens, output_tokens, total_tokens, cost_usd_micros, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  insert.run('turn:component', 'component', 10, 5, null, null, T0)
  insert.run('image:legacy', 'media-only', null, null, 999, 25_000, T0 + 1)
  insert.run('turn:unknown', 'unknown', null, null, null, null, T0 + 2)
  insert.run('turn:negative-component', 'invalid-component', -5, 2, null, null, T0 + 3)
  insert.run('turn:negative-total', 'invalid-total', 5, 2, -7, null, T0 + 4)
  insert.run('turn:negative-cost', 'invalid-cost', 5, 2, 7, -1, T0 + 5)
  insert.run('turn:contradictory-total', 'contradictory-total', 100, 50, 0, null, T0 + 6)
  insert.run('turn:lone-input', 'lone-input', 9, null, null, null, T0 + 7)
  raw.close()
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('run_costs usage-kind migration', () => {
  it('classifies legacy rows and restores only derivable token totals', () => {
    const byRun = new Map(listRunCostsSince(T0).map((row) => [row.runId, row]))
    expect(byRun.get('turn:component')).toMatchObject({ usageKind: 'tokens', totalTokens: 15 })
    expect(byRun.get('image:legacy')).toMatchObject({ usageKind: 'media', totalTokens: null })
    expect(byRun.get('turn:unknown')).toMatchObject({ usageKind: 'tokens', totalTokens: null })
    expect(byRun.get('turn:negative-component')).toMatchObject({ usageKind: 'tokens', totalTokens: null })
    expect(byRun.get('turn:negative-total')).toMatchObject({ usageKind: 'tokens', totalTokens: null })
    expect(byRun.get('turn:negative-cost')).toMatchObject({ usageKind: 'tokens', totalTokens: 7, costUsdMicros: null })
    expect(byRun.get('turn:contradictory-total')).toMatchObject({ usageKind: 'tokens', totalTokens: null })
    expect(byRun.get('turn:lone-input')).toMatchObject({ usageKind: 'tokens', totalTokens: null })

    const byAgent = new Map(runTokensByAgentSince(T0).map((row) => [row.agent, row]))
    expect(byAgent.get('component')).toMatchObject({
      totalTokens: 15,
      runs: 1,
      tokenApplicableRuns: 1,
      tokenMeteredRuns: 1,
    })
    expect(byAgent.get('media-only')).toMatchObject({
      totalTokens: 0,
      runs: 1,
      tokenApplicableRuns: 0,
      tokenMeteredRuns: 0,
    })
    expect(byAgent.get('unknown')).toMatchObject({
      totalTokens: null,
      runs: 1,
      tokenApplicableRuns: 1,
      tokenMeteredRuns: 0,
    })
    expect(byAgent.get('invalid-component')).toMatchObject({
      totalTokens: null,
      tokenApplicableRuns: 1,
      tokenMeteredRuns: 0,
    })
    expect(byAgent.get('invalid-total')).toMatchObject({
      totalTokens: null,
      tokenApplicableRuns: 1,
      tokenMeteredRuns: 0,
    })

    const raw = new Database(join(testDir, 'bakin.db'))
    try {
      expect(() => raw.prepare(
        `INSERT INTO run_costs (run_id, agent, usage_kind, occurred_at)
         VALUES (?, ?, ?, ?)`,
      ).run('turn:invalid-kind', 'invalid', 'other', T0 + 3)).toThrow(/CHECK constraint failed/)
    } finally {
      raw.close()
    }
  })
})
