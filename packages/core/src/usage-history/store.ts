/**
 * Usage-history store — durable per-(agent, session, day, model) token aggregates
 * derived from runtime session transcripts (#359).
 *
 * Lives in its own named store (`~/.bakin/usage.db`) — NEVER the coordination
 * ledger, which is coordination-facts-only. The duplicate-counting guarantee
 * is structural: `replaceSessionUsage` is an absolute recompute of one
 * session's rows (transactional delete + insert), never accumulation, so
 * rescans, retries, and rewritten/compacted transcript files converge to the
 * file's current truth. Rows outlive their source file by design: a deleted
 * session simply stops updating (history is history).
 *
 * Cost is runtime-reported only and NULL-honest: a group with no costed
 * messages sums to null (SQLite SUM over all-NULL), never a fabricated 0.
 */
import { join } from 'path'

import { openNamedDb, type Db } from '../storage/db'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'

const log = createLogger('usage-history-store')

const MODULE = 'usage-history'

const store = openNamedDb('usage', () => join(getContentDir(), 'usage.db'))

const MIGRATIONS = [
  {
    version: 1,
    up: (db: Db) => {
      db.exec(
        `CREATE TABLE session_usage_days (
           session_id         TEXT NOT NULL,
           day                TEXT NOT NULL,
           model              TEXT NOT NULL DEFAULT '',
           agent              TEXT NOT NULL,
           input_tokens       INTEGER NOT NULL DEFAULT 0,
           output_tokens      INTEGER NOT NULL DEFAULT 0,
           cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
           cache_write_tokens INTEGER NOT NULL DEFAULT 0,
           total_tokens       INTEGER NOT NULL DEFAULT 0,
           cost_usd_micros    INTEGER,
           costed_messages    INTEGER NOT NULL DEFAULT 0,
           message_count      INTEGER NOT NULL DEFAULT 0,
           first_ts           INTEGER NOT NULL,
           last_ts            INTEGER NOT NULL,
           PRIMARY KEY (session_id, day, model)
         )`,
      )
      db.exec('CREATE INDEX session_usage_days_by_day ON session_usage_days(day)')
      db.exec('CREATE INDEX session_usage_days_by_agent ON session_usage_days(agent, day)')
      db.exec(
        `CREATE TABLE session_scan_state (
           session_id TEXT PRIMARY KEY,
           agent      TEXT NOT NULL,
           mtime_ms   INTEGER NOT NULL,
           size       INTEGER NOT NULL,
           scanned_at INTEGER NOT NULL
         )`,
      )
    },
  },
  {
    version: 2,
    up: (db: Db) => {
      db.exec(
        `CREATE TABLE session_usage_days_v2 (
           session_id         TEXT NOT NULL,
           day                TEXT NOT NULL,
           model              TEXT NOT NULL DEFAULT '',
           agent              TEXT NOT NULL,
           input_tokens       INTEGER NOT NULL DEFAULT 0,
           output_tokens      INTEGER NOT NULL DEFAULT 0,
           cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
           cache_write_tokens INTEGER NOT NULL DEFAULT 0,
           total_tokens       INTEGER NOT NULL DEFAULT 0,
           cost_usd_micros    INTEGER,
           costed_messages    INTEGER NOT NULL DEFAULT 0,
           message_count      INTEGER NOT NULL DEFAULT 0,
           first_ts           INTEGER NOT NULL,
           last_ts            INTEGER NOT NULL,
           PRIMARY KEY (agent, session_id, day, model)
         )`,
      )
      db.exec(
        `INSERT INTO session_usage_days_v2
           (session_id, day, model, agent, input_tokens, output_tokens, cache_read_tokens,
            cache_write_tokens, total_tokens, cost_usd_micros, costed_messages, message_count,
            first_ts, last_ts)
         SELECT session_id, day, model, agent, input_tokens, output_tokens, cache_read_tokens,
                cache_write_tokens, total_tokens, cost_usd_micros, costed_messages, message_count,
                first_ts, last_ts
           FROM session_usage_days`,
      )
      db.exec(
        `CREATE TABLE session_scan_state_v2 (
           session_id TEXT NOT NULL,
           agent      TEXT NOT NULL,
           mtime_ms   INTEGER NOT NULL,
           size       INTEGER NOT NULL,
           scanned_at INTEGER NOT NULL,
           PRIMARY KEY (agent, session_id)
         )`,
      )
      db.exec(
        `INSERT INTO session_scan_state_v2 (session_id, agent, mtime_ms, size, scanned_at)
         SELECT session_id, agent, mtime_ms, size, scanned_at FROM session_scan_state`,
      )
      db.exec('DROP TABLE session_usage_days')
      db.exec('DROP TABLE session_scan_state')
      db.exec('ALTER TABLE session_usage_days_v2 RENAME TO session_usage_days')
      db.exec('ALTER TABLE session_scan_state_v2 RENAME TO session_scan_state')
      db.exec('CREATE INDEX session_usage_days_by_day ON session_usage_days(day)')
      db.exec('CREATE INDEX session_usage_days_by_agent ON session_usage_days(agent, day)')
    },
  },
]

function db(): Db {
  store.applyMigrations(MODULE, MIGRATIONS)
  return store.db()
}

/** One (day, model) bucket of a session's recomputed usage. */
export interface SessionDayUsage {
  /** Local calendar day, YYYY-MM-DD. */
  day: string
  /** Model that produced the messages; '' when the message had no model. */
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  /** Runtime-reported cost sum in micro-dollars; null when none reported. */
  costUsdMicros: number | null
  /** Messages that carried runtime-reported cost (coverage numerator). */
  costedMessages: number
  messageCount: number
  firstTs: number
  lastTs: number
}

export interface UsageTokenSums {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface AgentUsageRollup {
  agent: string
  tokens: UsageTokenSums
  costUsdMicros: number | null
  costedMessages: number
  messageCount: number
}

export interface DayUsageRollup {
  day: string
  tokens: UsageTokenSums
  costUsdMicros: number | null
  costedMessages: number
  messageCount: number
}

export class UsageHistoryStoreReadError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'UsageHistoryStoreReadError'
    this.cause = cause
  }
}

/**
 * Local calendar day key (YYYY-MM-DD) for an epoch-ms timestamp. Machine-local
 * timezone by design (single-operator machine — "today" means the operator's
 * today).
 */
export function toLocalDayKey(tsMs: number): string {
  const d = new Date(tsMs)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Absolute recompute of one agent session's usage: delete every row for the
 * composite (agent, session), insert the fresh bucket set, and upsert scan state — one
 * transaction. Returns false (logged) on storage failure; usage history is
 * observability, not coordination, so callers proceed.
 */
export function replaceSessionUsage(
  sessionId: string,
  agent: string,
  rows: SessionDayUsage[],
  stat: { mtimeMs: number; size: number },
): boolean {
  try {
    const handle = db()
    store.withTx(() => {
      handle.prepare('DELETE FROM session_usage_days WHERE agent = ? AND session_id = ?').run(agent, sessionId)
      const insert = handle.prepare(
        `INSERT INTO session_usage_days
           (session_id, day, model, agent, input_tokens, output_tokens, cache_read_tokens,
            cache_write_tokens, total_tokens, cost_usd_micros, costed_messages, message_count,
            first_ts, last_ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const r of rows) {
        insert.run(
          sessionId, r.day, r.model, agent,
          r.inputTokens, r.outputTokens, r.cacheReadTokens, r.cacheWriteTokens, r.totalTokens,
          r.costUsdMicros, r.costedMessages, r.messageCount, r.firstTs, r.lastTs,
        )
      }
      handle.prepare(
        `INSERT INTO session_scan_state (session_id, agent, mtime_ms, size, scanned_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(agent, session_id) DO UPDATE SET
           mtime_ms = excluded.mtime_ms,
           size = excluded.size, scanned_at = excluded.scanned_at`,
      ).run(sessionId, agent, stat.mtimeMs, stat.size, Date.now())
    })
    return true
  } catch (err) {
    log.error('replaceSessionUsage failed', err, { sessionId, agent })
    return false
  }
}

/** Last-scanned file identity for one agent's session, or null if never scanned. */
export function getScanState(sessionId: string, agent: string): { mtimeMs: number; size: number } | null {
  try {
    const row = db()
      .prepare<{ mtime_ms: number; size: number }, [string, string]>(
        'SELECT mtime_ms, size FROM session_scan_state WHERE agent = ? AND session_id = ?',
      )
      .get(agent, sessionId)
    return row ? { mtimeMs: row.mtime_ms, size: row.size } : null
  } catch (err) {
    log.error('getScanState failed', err, { sessionId, agent })
    return null
  }
}

interface RollupRow {
  key: string
  input: number
  output: number
  cache_read: number
  cache_write: number
  total: number
  micros: number | null
  costed: number
  messages: number
}

const ROLLUP_SUMS = `
  COALESCE(SUM(input_tokens), 0)        AS input,
  COALESCE(SUM(output_tokens), 0)       AS output,
  COALESCE(SUM(cache_read_tokens), 0)   AS cache_read,
  COALESCE(SUM(cache_write_tokens), 0)  AS cache_write,
  COALESCE(SUM(total_tokens), 0)        AS total,
  SUM(cost_usd_micros)                  AS micros,
  COALESCE(SUM(costed_messages), 0)     AS costed,
  COALESCE(SUM(message_count), 0)       AS messages`

function toRollup(r: RollupRow): Omit<AgentUsageRollup, 'agent'> {
  return {
    tokens: { input: r.input, output: r.output, cacheRead: r.cache_read, cacheWrite: r.cache_write, total: r.total },
    costUsdMicros: r.micros,
    costedMessages: r.costed,
    messageCount: r.messages,
  }
}

/**
 * Per-agent sums for calendar days >= sinceDay (lexicographic on YYYY-MM-DD).
 * Windows are day-aligned: a window includes every calendar day it touches.
 */
export function usageByAgentSince(sinceDay: string): AgentUsageRollup[] {
  try {
    return db()
      .prepare<RollupRow, [string]>(
        `SELECT agent AS key, ${ROLLUP_SUMS}
           FROM session_usage_days WHERE day >= ? GROUP BY agent ORDER BY total DESC`,
      )
      .all(sinceDay)
      .map((r) => ({ agent: r.key, ...toRollup(r) }))
  } catch (err) {
    log.error('usageByAgentSince failed', err, { sinceDay })
    return []
  }
}

export interface AgentDayUsageRollup {
  agent: string
  day: string
  tokens: UsageTokenSums
  costUsdMicros: number | null
  costedMessages: number
  messageCount: number
}

export interface UsageHistorySnapshot {
  byAgent: AgentUsageRollup[]
  byDay: DayUsageRollup[]
  byAgentDay: AgentDayUsageRollup[]
}

/**
 * Read one internally consistent usage-history snapshot. Unlike the legacy
 * convenience readers below, this strict boundary never converts a storage
 * failure into an empty result that a caller could mistake for zero usage.
 */
export function readUsageHistorySince(sinceDay: string): UsageHistorySnapshot {
  try {
    const handle = db()
    return store.withTx(() => {
      const byAgent = handle
        .prepare<RollupRow, [string]>(
          `SELECT agent AS key, ${ROLLUP_SUMS}
             FROM session_usage_days WHERE day >= ? GROUP BY agent ORDER BY total DESC`,
        )
        .all(sinceDay)
        .map((r) => ({ agent: r.key, ...toRollup(r) }))
      const byDay = handle
        .prepare<RollupRow, [string]>(
          `SELECT day AS key, ${ROLLUP_SUMS}
             FROM session_usage_days WHERE day >= ? GROUP BY day ORDER BY day ASC`,
        )
        .all(sinceDay)
        .map((r) => ({ day: r.key, ...toRollup(r) }))
      const byAgentDay = handle
        .prepare<RollupRow & { agent: string }, [string]>(
          `SELECT agent, day AS key, ${ROLLUP_SUMS}
             FROM session_usage_days WHERE day >= ? GROUP BY agent, day ORDER BY day ASC, agent ASC`,
        )
        .all(sinceDay)
        .map((r) => ({ agent: r.agent, day: r.key, ...toRollup(r) }))
      return { byAgent, byDay, byAgentDay }
    })
  } catch (err) {
    log.error('readUsageHistorySince failed', err, { sinceDay })
    throw new UsageHistoryStoreReadError('Usage history store could not be read.', err)
  }
}

/**
 * Per-(agent, day) cells for calendar days >= sinceDay — the cross-tab behind
 * the per-agent stacked daily chart (#385). Ascending (day, agent) so chart
 * series assemble deterministically.
 */
export function usageByAgentDaySince(sinceDay: string): AgentDayUsageRollup[] {
  try {
    return db()
      .prepare<RollupRow & { agent: string }, [string]>(
        `SELECT agent, day AS key, ${ROLLUP_SUMS}
           FROM session_usage_days WHERE day >= ? GROUP BY agent, day ORDER BY day ASC, agent ASC`,
      )
      .all(sinceDay)
      .map((r) => ({ agent: r.agent, day: r.key, ...toRollup(r) }))
  } catch (err) {
    log.error('usageByAgentDaySince failed', err, { sinceDay })
    return []
  }
}

export interface AgentModelDayUsageRollup {
  agent: string
  day: string
  /** Model id as reported by the runtime transcript; '' when unknown. */
  model: string
  tokens: UsageTokenSums
  costUsdMicros: number | null
  costedMessages: number
  messageCount: number
}

function queryUsageByAgentModelDaySince(sinceDay: string): AgentModelDayUsageRollup[] {
  return db()
    .prepare<RollupRow & { agent: string; model: string }, [string]>(
      `SELECT agent, model, day AS key, ${ROLLUP_SUMS}
         FROM session_usage_days WHERE day >= ? GROUP BY agent, day, model ORDER BY day ASC, agent ASC, model ASC`,
    )
    .all(sinceDay)
    .map((r) => ({ agent: r.agent, day: r.key, model: r.model, ...toRollup(r) }))
}

/**
 * Strict spend-engine boundary for observed usage. Storage failure is
 * explicit so callers cannot mistake an unreadable store for zero usage.
 */
export function readUsageByAgentModelDaySince(sinceDay: string): AgentModelDayUsageRollup[] {
  try {
    return queryUsageByAgentModelDaySince(sinceDay)
  } catch (err) {
    log.error('readUsageByAgentModelDaySince failed', err, { sinceDay })
    throw new UsageHistoryStoreReadError('Usage history store could not be read.', err)
  }
}

/**
 * Per-(agent, day, model) cells for calendar days >= sinceDay — the spend
 * engine's observed-usage input (cost-control v2): the model dimension lets
 * unattributed usage resolve to a provider + billing lane. Unknown models
 * keep their own '' bucket, never merged.
 */
export function usageByAgentModelDaySince(sinceDay: string): AgentModelDayUsageRollup[] {
  try {
    return queryUsageByAgentModelDaySince(sinceDay)
  } catch (err) {
    log.error('usageByAgentModelDaySince failed', err, { sinceDay })
    return []
  }
}

/** Per-day sums for calendar days >= sinceDay, ascending by day. */
export function usageByDaySince(sinceDay: string): DayUsageRollup[] {
  try {
    return db()
      .prepare<RollupRow, [string]>(
        `SELECT day AS key, ${ROLLUP_SUMS}
           FROM session_usage_days WHERE day >= ? GROUP BY day ORDER BY day ASC`,
      )
      .all(sinceDay)
      .map((r) => ({ day: r.key, ...toRollup(r) }))
  } catch (err) {
    log.error('usageByDaySince failed', err, { sinceDay })
    return []
  }
}
