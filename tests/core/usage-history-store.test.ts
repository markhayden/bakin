/**
 * Usage-history store — durable per-(session, day, model) token aggregates in
 * ~/.bakin/usage.db. The dedup guarantee is structural: replaceSessionUsage is
 * an absolute recompute (delete-by-session + insert), never accumulation.
 */
import { describe, it, expect, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-usage-store-${Date.now()}-${randomUUID()}`)

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

import {
  replaceSessionUsage,
  getScanState,
  usageByAgentSince,
  usageByDaySince,
  usageByAgentDaySince,
  usageByAgentModelDaySince,
  readUsageHistorySince,
  UsageHistoryStoreReadError,
  type SessionDayUsage,
} from '../../packages/core/src/usage-history/store'
import { closeAllDbs, openNamedDb } from '../../packages/core/src/storage/db'

afterAll(() => {
  closeAllDbs()
  rmSync(testDir, { recursive: true, force: true })
})

const DAY1 = '2026-07-01'
const DAY2 = '2026-07-02'
const T1 = Date.parse('2026-07-01T10:00:00Z')
const T2 = Date.parse('2026-07-02T10:00:00Z')

function row(overrides: Partial<SessionDayUsage> = {}): SessionDayUsage {
  return {
    day: DAY1,
    model: 'gpt-5.4',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 10,
    cacheWriteTokens: 5,
    totalTokens: 165,
    costUsdMicros: 1_500,
    costedMessages: 2,
    messageCount: 2,
    firstTs: T1,
    lastTs: T1 + 60_000,
    ...overrides,
  }
}

describe('usage-history store', () => {
  it('replaceSessionUsage persists rows readable through rollups', () => {
    const ok = replaceSessionUsage('s1', 'basil', [row()], { mtimeMs: 111, size: 222 })
    expect(ok).toBe(true)

    const byAgent = usageByAgentSince(DAY1)
    expect(byAgent).toHaveLength(1)
    expect(byAgent[0]).toMatchObject({
      agent: 'basil',
      tokens: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, total: 165 },
      costUsdMicros: 1_500,
      costedMessages: 2,
      messageCount: 2,
    })

    const byDay = usageByDaySince(DAY1)
    expect(byDay).toHaveLength(1)
    expect(byDay[0].day).toBe(DAY1)
    expect(byDay[0].tokens.total).toBe(165)
  })

  it('N repeated identical replaces never double-count', () => {
    for (let i = 0; i < 5; i++) {
      replaceSessionUsage('s1', 'basil', [row()], { mtimeMs: 111, size: 222 })
    }
    const byAgent = usageByAgentSince(DAY1)
    expect(byAgent).toHaveLength(1)
    expect(byAgent[0].tokens.total).toBe(165)
    expect(byAgent[0].costUsdMicros).toBe(1_500)
  })

  it('shrunk recompute removes stale day rows for that session', () => {
    replaceSessionUsage(
      's2',
      'clover',
      [row(), row({ day: DAY2, firstTs: T2, lastTs: T2 + 1000 })],
      { mtimeMs: 1, size: 1 },
    )
    expect(usageByDaySince(DAY1).map((d) => d.day).sort()).toEqual([DAY1, DAY2])

    // Rewritten/compacted file now only covers DAY2.
    replaceSessionUsage('s2', 'clover', [row({ day: DAY2, firstTs: T2, lastTs: T2 + 1000 })], {
      mtimeMs: 2,
      size: 2,
    })
    const clover = usageByAgentSince(DAY1).find((a) => a.agent === 'clover')
    expect(clover?.tokens.total).toBe(165)
    const day1 = usageByDaySince(DAY1).find((d) => d.day === DAY1)
    // basil's s1 row still owns DAY1; clover's stale DAY1 row is gone.
    expect(day1?.tokens.total).toBe(165)
  })

  it('models bucket separately within one session and day', () => {
    replaceSessionUsage(
      's3',
      'basil',
      [row({ model: 'gpt-5.4', totalTokens: 10, inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
       row({ model: 'claude-fable-5', totalTokens: 20, inputTokens: 20, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })],
      { mtimeMs: 1, size: 1 },
    )
    const basil = usageByAgentSince(DAY1).find((a) => a.agent === 'basil')
    // s1 (165) + s3 (30) aggregate across models transparently.
    expect(basil?.tokens.total).toBe(195)
  })

  it('cost is NULL-honest: zero costed messages → null, never 0', () => {
    replaceSessionUsage(
      's4',
      'nocost',
      [row({ costUsdMicros: null, costedMessages: 0 })],
      { mtimeMs: 1, size: 1 },
    )
    const agent = usageByAgentSince(DAY1).find((a) => a.agent === 'nocost')
    expect(agent?.costUsdMicros).toBeNull()
    expect(agent?.costedMessages).toBe(0)
    expect(agent?.messageCount).toBe(2)
  })

  it('partial cost coverage sums reported micros and counts coverage', () => {
    replaceSessionUsage(
      's5',
      'partial',
      [row({ costUsdMicros: 900, costedMessages: 1, messageCount: 3 }),
       row({ day: DAY2, costUsdMicros: null, costedMessages: 0, messageCount: 2, firstTs: T2, lastTs: T2 })],
      { mtimeMs: 1, size: 1 },
    )
    const agent = usageByAgentSince(DAY1).find((a) => a.agent === 'partial')
    expect(agent?.costUsdMicros).toBe(900)
    expect(agent?.costedMessages).toBe(1)
    expect(agent?.messageCount).toBe(5)
  })

  it('sinceDay filters by lexicographic day key', () => {
    const only2 = usageByDaySince(DAY2)
    expect(only2.every((d) => d.day >= DAY2)).toBe(true)
    expect(only2.find((d) => d.day === DAY1)).toBeUndefined()
  })

  it('scan state round-trips and updates on replace', () => {
    expect(getScanState('missing', 'basil')).toBeNull()
    expect(getScanState('s1', 'basil')).toEqual({ mtimeMs: 111, size: 222 })
    replaceSessionUsage('s1', 'basil', [row()], { mtimeMs: 999, size: 888 })
    expect(getScanState('s1', 'basil')).toEqual({ mtimeMs: 999, size: 888 })
  })

  it('keeps identical runtime session ids isolated by agent', () => {
    replaceSessionUsage('shared-session', 'alpha', [row({ totalTokens: 10 })], {
      mtimeMs: 10,
      size: 100,
    })
    replaceSessionUsage('shared-session', 'beta', [row({ totalTokens: 20 })], {
      mtimeMs: 20,
      size: 200,
    })

    const byAgent = usageByAgentSince(DAY1)
    expect(byAgent.find((entry) => entry.agent === 'alpha')?.tokens.total).toBe(10)
    expect(byAgent.find((entry) => entry.agent === 'beta')?.tokens.total).toBe(20)
    expect(getScanState('shared-session', 'alpha')).toEqual({ mtimeMs: 10, size: 100 })
    expect(getScanState('shared-session', 'beta')).toEqual({ mtimeMs: 20, size: 200 })
  })

  it('empty rows still records scan state (session with no assistant messages)', () => {
    const ok = replaceSessionUsage('s6', 'quiet', [], { mtimeMs: 7, size: 7 })
    expect(ok).toBe(true)
    expect(getScanState('s6', 'quiet')).toEqual({ mtimeMs: 7, size: 7 })
    expect(usageByAgentSince(DAY1).find((a) => a.agent === 'quiet')).toBeUndefined()
  })

  it('survives close/reopen (migration idempotence, data durable)', () => {
    closeAllDbs()
    const byAgent = usageByAgentSince(DAY1)
    expect(byAgent.find((a) => a.agent === 'basil')?.tokens.total).toBe(195)
  })

})

describe('usageByAgentDaySince (#385)', () => {
  it('preserves the agent×day cross-tab with per-cell sums', () => {
    replaceSessionUsage(
      'x1',
      'pixel',
      [row({ totalTokens: 100 }), row({ day: DAY2, totalTokens: 700, firstTs: T2, lastTs: T2 })],
      { mtimeMs: 1, size: 1 },
    )
    // second session, same agent, same day — must sum into the same cell
    replaceSessionUsage('x2', 'pixel', [row({ totalTokens: 40 })], { mtimeMs: 1, size: 1 })
    replaceSessionUsage('x3', 'scout', [row({ totalTokens: 9, costUsdMicros: null, costedMessages: 0 })], {
      mtimeMs: 1,
      size: 1,
    })

    const cells = usageByAgentDaySince(DAY1)
    const cell = (agent: string, day: string) => cells.find((c) => c.agent === agent && c.day === day)

    expect(cell('pixel', DAY1)?.tokens.total).toBe(140)
    expect(cell('pixel', DAY2)?.tokens.total).toBe(700)
    expect(cell('scout', DAY1)?.tokens.total).toBe(9)
    // NULL-honest: scout's only row carried no cost
    expect(cell('scout', DAY1)?.costUsdMicros).toBeNull()
    // ascending by day, then agent — stable for chart series assembly
    const keys = cells.map((c) => `${c.day}|${c.agent}`)
    expect(keys).toEqual([...keys].sort())
  })

  it('honors the sinceDay cutoff', () => {
    const only2 = usageByAgentDaySince(DAY2)
    expect(only2.every((c) => c.day >= DAY2)).toBe(true)
    expect(only2.find((c) => c.agent === 'pixel' && c.day === DAY2)).toBeDefined()
  })
})

describe('usageByAgentModelDaySince (cost-control v2)', () => {
  it('splits the agent×day cells by model, keeping the empty-model bucket', () => {
    replaceSessionUsage(
      'm1',
      'lane-agent',
      [
        row({ model: 'anthropic/claude-sonnet-4-6', totalTokens: 100, costUsdMicros: 500 }),
        row({ model: 'gpt-5.5-codex', totalTokens: 900, costUsdMicros: null, costedMessages: 0 }),
        row({ model: '', totalTokens: 7, costUsdMicros: null, costedMessages: 0 }),
      ],
      { mtimeMs: 1, size: 1 },
    )
    // second session, same agent+day+model — must sum into the same cell
    replaceSessionUsage('m2', 'lane-agent', [row({ model: 'anthropic/claude-sonnet-4-6', totalTokens: 40, costUsdMicros: 100 })], { mtimeMs: 1, size: 1 })

    const cells = usageByAgentModelDaySince(DAY1).filter((c) => c.agent === 'lane-agent')
    const cell = (model: string) => cells.find((c) => c.model === model && c.day === DAY1)

    expect(cell('anthropic/claude-sonnet-4-6')?.tokens.total).toBe(140)
    expect(cell('anthropic/claude-sonnet-4-6')?.costUsdMicros).toBe(600)
    expect(cell('gpt-5.5-codex')?.tokens.total).toBe(900)
    expect(cell('gpt-5.5-codex')?.costUsdMicros).toBeNull() // NULL-honest
    expect(cell('')?.tokens.total).toBe(7) // unknown model stays its own bucket

    // re-aggregating by (agent, day) must match the modelless cross-tab
    const modelless = usageByAgentDaySince(DAY1).find((c) => c.agent === 'lane-agent' && c.day === DAY1)
    const summed = cells.filter((c) => c.day === DAY1).reduce((n, c) => n + c.tokens.total, 0)
    expect(modelless?.tokens.total).toBe(summed)
  })

  it('honors the sinceDay cutoff', () => {
    replaceSessionUsage('m3', 'lane-agent2', [row({ day: DAY2, model: 'x/y', totalTokens: 3, firstTs: T2, lastTs: T2 })], { mtimeMs: 1, size: 1 })
    const only2 = usageByAgentModelDaySince(DAY2)
    expect(only2.every((c) => c.day >= DAY2)).toBe(true)
    expect(only2.find((c) => c.agent === 'lane-agent' && c.day === DAY1)).toBeUndefined()
  })
})

describe('usage-history v1 migration', () => {
  it('preserves legacy rows and scan state while adopting agent-scoped keys', () => {
    closeAllDbs()
    const storePath = join(testDir, 'usage.db')
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${storePath}${suffix}`, { force: true })

    const legacy = openNamedDb('usage', () => storePath)
    legacy.applyMigrations('usage-history', [{
      version: 1,
      up: (handle) => {
        handle.exec(
          `CREATE TABLE session_usage_days (
             session_id TEXT NOT NULL,
             day TEXT NOT NULL,
             model TEXT NOT NULL DEFAULT '',
             agent TEXT NOT NULL,
             input_tokens INTEGER NOT NULL DEFAULT 0,
             output_tokens INTEGER NOT NULL DEFAULT 0,
             cache_read_tokens INTEGER NOT NULL DEFAULT 0,
             cache_write_tokens INTEGER NOT NULL DEFAULT 0,
             total_tokens INTEGER NOT NULL DEFAULT 0,
             cost_usd_micros INTEGER,
             costed_messages INTEGER NOT NULL DEFAULT 0,
             message_count INTEGER NOT NULL DEFAULT 0,
             first_ts INTEGER NOT NULL,
             last_ts INTEGER NOT NULL,
             PRIMARY KEY (session_id, day, model)
           )`,
        )
        handle.exec(
          `CREATE TABLE session_scan_state (
             session_id TEXT PRIMARY KEY,
             agent TEXT NOT NULL,
             mtime_ms INTEGER NOT NULL,
             size INTEGER NOT NULL,
             scanned_at INTEGER NOT NULL
           )`,
        )
      },
    }])
    const legacyDb = legacy.db()
    legacyDb.prepare(
      `INSERT INTO session_usage_days
         (session_id, day, model, agent, input_tokens, output_tokens, cache_read_tokens,
          cache_write_tokens, total_tokens, cost_usd_micros, costed_messages, message_count,
          first_ts, last_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('legacy-shared', DAY1, 'm1', 'legacy-agent', 31, 0, 0, 0, 31, null, 0, 1, T1, T1)
    legacyDb.prepare(
      `INSERT INTO session_scan_state (session_id, agent, mtime_ms, size, scanned_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('legacy-shared', 'legacy-agent', 31, 310, T1)
    closeAllDbs()

    expect(usageByAgentSince(DAY1).find((entry) => entry.agent === 'legacy-agent')?.tokens.total).toBe(31)
    expect(getScanState('legacy-shared', 'legacy-agent')).toEqual({ mtimeMs: 31, size: 310 })

    replaceSessionUsage('legacy-shared', 'new-agent', [row({ totalTokens: 47 })], {
      mtimeMs: 47,
      size: 470,
    })
    const byAgent = usageByAgentSince(DAY1)
    expect(byAgent.find((entry) => entry.agent === 'legacy-agent')?.tokens.total).toBe(31)
    expect(byAgent.find((entry) => entry.agent === 'new-agent')?.tokens.total).toBe(47)
  })
})

describe('strict usage-history reads', () => {
  it('surfaces store failures instead of returning empty complete-looking rows', () => {
    closeAllDbs()
    const storePath = join(testDir, 'usage.db')
    rmSync(storePath, { force: true })
    mkdirSync(storePath)

    expect(() => readUsageHistorySince(DAY1)).toThrow(UsageHistoryStoreReadError)

    rmSync(storePath, { recursive: true, force: true })
  })
})
