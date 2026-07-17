/**
 * Execution ledger — coordination facts for exactly-once task execution.
 *
 * Four tables, one rule: the UNIQUE constraint IS the lock. A duplicate
 * fire/claim/completion doesn't race a flag — it fails an INSERT, and the
 * caller suppresses + audits.
 *
 *   runs        one live run per task (partial unique index); boot_id for
 *               the startup sweep; heartbeat_at feeds watchdog liveness
 *   cron_fires  a (job, run) fires exactly once; claim BEFORE task creation;
 *               disposition: pending → created | skipped (seeded = migrated)
 *   completions a task completes exactly once per open lifetime
 *   idempotency durable result cache for money ops (no TTL)
 *
 * Coordination facts only — never content. Markdown/JSON owns what a task
 * IS; this ledger answers "may this happen / did this happen".
 *
 * All verbs throw LedgerUnavailableError when the db cannot be opened or
 * written — callers must FAIL CLOSED (refuse the operation), never fall
 * back to an unguarded path.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../logger'
import { getBakinPaths } from '../content-dir'
import { applyMigrations, getDb, withTx, StorageUnavailableError, type Db } from '../storage/db'
import { normalizeRunCostUsdMicros, normalizeRunTokenEvidence, type RunUsageKind } from './token-evidence'

const log = createLogger('execution-ledger')

export { StorageUnavailableError as LedgerUnavailableError }

const MODULE = 'execution'

const MIGRATIONS = [
  {
    version: 1,
    up: (db: Db) => {
      // exec_key is the live-run lock scope: the task id for regular tasks,
      // `${taskId}:${stepId}` for workflow steps — parallel step agents on
      // one task are legitimate concurrent runs. seq stays per-TASK (shared
      // counter across steps) to exactly preserve the legacy threadId
      // semantics of .dispatch-state.json's dispatchSeq.
      db.exec(
        `CREATE TABLE runs (
           run_id        TEXT PRIMARY KEY,
           task_id       TEXT NOT NULL,
           exec_key      TEXT NOT NULL,
           seq           INTEGER NOT NULL,
           agent         TEXT NOT NULL,
           status        TEXT NOT NULL CHECK (status IN ('running','settled','superseded','lost')),
           boot_id       TEXT NOT NULL,
           started_at    INTEGER NOT NULL,
           heartbeat_at  INTEGER NOT NULL,
           settled_at    INTEGER,
           settle_reason TEXT,
           UNIQUE (task_id, seq)
         )`,
      )
      db.exec('CREATE UNIQUE INDEX runs_one_live_per_key ON runs(exec_key) WHERE status = \'running\'')
      db.exec('CREATE INDEX runs_by_task ON runs(task_id)')
      db.exec(
        `CREATE TABLE seq_watermarks (
           task_id TEXT PRIMARY KEY,
           seq     INTEGER NOT NULL
         )`,
      )
      // One-time correctness seed: legacy per-task dispatch seqs from
      // .dispatch-state.json become watermarks so freshly minted threadIds
      // (task:<id>:d<seq>) can never collide with previously used provider
      // sessions. Reading an app-owned file from here is deliberate — the
      // migration is the only place with a strict run-once-before-any-mint
      // ordering guarantee.
      try {
        const stateFile = join(getBakinPaths().home, '.dispatch-state.json')
        if (existsSync(stateFile)) {
          const parsed = JSON.parse(readFileSync(stateFile, 'utf-8')) as { dispatchSeq?: Record<string, unknown> }
          const insert = db.prepare('INSERT OR REPLACE INTO seq_watermarks (task_id, seq) VALUES (?, ?)')
          let seeded = 0
          for (const [taskId, seq] of Object.entries(parsed.dispatchSeq ?? {})) {
            if (typeof seq === 'number' && Number.isFinite(seq) && seq > 0) {
              insert.run(taskId, Math.floor(seq))
              seeded++
            }
          }
          if (seeded > 0) log.info('Seeded seq watermarks from legacy dispatch state', { seeded })
        }
      } catch (err) {
        // A malformed legacy file must not brick the ledger — but losing the
        // watermarks risks threadId reuse, so say it loudly.
        log.error('Failed to seed seq watermarks from .dispatch-state.json', err)
      }
      db.exec(
        `CREATE TABLE cron_fires (
           job_id      TEXT NOT NULL,
           run_id      TEXT NOT NULL,
           fired_at    INTEGER NOT NULL, -- the run's logical time (may be old: reconciler catch-up)
           claimed_at  INTEGER NOT NULL, -- when WE claimed it — healer staleness keys on this
           task_id     TEXT,
           disposition TEXT NOT NULL DEFAULT 'pending'
                       CHECK (disposition IN ('pending','created','skipped','seeded')),
           PRIMARY KEY (job_id, run_id)
         )`,
      )
      db.exec(
        `CREATE TABLE completions (
           task_id      TEXT PRIMARY KEY,
           run_id       TEXT,
           agent        TEXT NOT NULL,
           channel      TEXT,
           completed_at INTEGER NOT NULL
         )`,
      )
      db.exec(
        `CREATE TABLE idempotency (
           key         TEXT PRIMARY KEY,
           kind        TEXT NOT NULL,
           result_json TEXT NOT NULL,
           created_at  INTEGER NOT NULL
         )`,
      )
    },
  },
  {
    // Persist WHY a fire was skipped (overlap / paused / skip-count / auto-paused)
    // so the per-schedule run history can show it without log-spelunking. The
    // disposition stays the coordination fact; skip_reason is the human label.
    version: 2,
    up: (db: Db) => {
      db.exec('ALTER TABLE cron_fires ADD COLUMN skip_reason TEXT')
    },
  },
  {
    // Per-run cost attribution. One row per settled run (run_id is the same
    // key dispatch settles on). A billing fact, not content: token counts +
    // an estimated micro-dollar cost (null when the model has no catalog
    // pricing or the runtime reported no usage). first-write-wins on the
    // PK, so a transport retry of the same run can't double-count.
    version: 3,
    up: (db: Db) => {
      db.exec(
        `CREATE TABLE run_costs (
           run_id           TEXT PRIMARY KEY,
           task_id          TEXT,
           agent            TEXT NOT NULL,
           model            TEXT,
           input_tokens     INTEGER,
           output_tokens    INTEGER,
           total_tokens     INTEGER,
           cost_usd_micros  INTEGER,
           occurred_at      INTEGER NOT NULL
         )`,
      )
      db.exec('CREATE INDEX run_costs_by_agent_time ON run_costs(agent, occurred_at)')
      db.exec('CREATE INDEX run_costs_by_time ON run_costs(occurred_at)')
    },
  },
  {
    // Cache-token attribution (#357): how much of a turn's input was served
    // from provider cache vs re-billed. Pre-migration rows stay NULL —
    // "unknown", never a fabricated zero.
    version: 4,
    up: (db: Db) => {
      db.exec('ALTER TABLE run_costs ADD COLUMN cache_read_tokens INTEGER')
      db.exec('ALTER TABLE run_costs ADD COLUMN cache_write_tokens INTEGER')
    },
  },
  {
    // Cost-control v2 (#464): billing attribution. `provider` denormalizes
    // the model id's provider segment so spend rolls up per provider in one
    // GROUP BY; `lane` records how the turn was billed ('metered' — API-key
    // dollars — vs 'subscription' — plan-quota tokens). Backfill derives
    // provider from `provider/model`-shaped ids only; bare ids resolve at
    // read time and lane stays NULL on legacy rows ("unknown", readers treat
    // as metered — never a fabricated value).
    version: 5,
    up: (db: Db) => {
      db.exec('ALTER TABLE run_costs ADD COLUMN provider TEXT')
      db.exec('ALTER TABLE run_costs ADD COLUMN lane TEXT')
      db.exec("UPDATE run_costs SET provider = substr(model, 1, instr(model, '/') - 1) WHERE model IS NOT NULL AND instr(model, '/') > 1")
    },
  },
  {
    // Budget incidents (cost-control v2, #464): one durable row per breach
    // of a cap rule per window. The UNIQUE constraint IS the alert debounce —
    // it replaced the in-memory audited-windows set, which forgot on restart.
    // scope_id is '' (never NULL) for global rules: SQLite treats NULLs as
    // distinct in UNIQUE, which would break the idempotent open. `win` avoids
    // the WINDOW keyword. Coordination facts only.
    version: 6,
    up: (db: Db) => {
      db.exec(
        `CREATE TABLE budget_incidents (
           id              INTEGER PRIMARY KEY AUTOINCREMENT,
           scope           TEXT NOT NULL,
           scope_id        TEXT NOT NULL DEFAULT '',
           lane            TEXT NOT NULL,
           win             TEXT NOT NULL,
           window_start_ms INTEGER NOT NULL,
           kind            TEXT NOT NULL,
           unit            TEXT NOT NULL,
           cap_value       INTEGER NOT NULL,
           spent_value     INTEGER NOT NULL,
           at_cap          TEXT NOT NULL DEFAULT 'defer',
           opened_at       INTEGER NOT NULL,
           status          TEXT NOT NULL DEFAULT 'open',
           resolved_at     INTEGER,
           resolution      TEXT,
           UNIQUE(scope, scope_id, lane, win, window_start_ms, kind)
         )`,
      )
      db.exec("CREATE INDEX budget_incidents_live ON budget_incidents(status) WHERE status IN ('open','acknowledged')")
    },
  },
  {
    // Token coverage applies only to token-bearing interactions. Image/media
    // turns intentionally have no token total and must not make an agent's
    // otherwise complete token evidence look partial. Legacy image rows are
    // recognizable by their durable run-id prefix; every other legacy row
    // keeps the historical token-bearing meaning. Component-only rows can be
    // repaired exactly, so recover their total during the same migration.
    version: 7,
    up: (db: Db) => {
      db.exec("ALTER TABLE run_costs ADD COLUMN usage_kind TEXT NOT NULL DEFAULT 'tokens' CHECK (usage_kind IN ('tokens','media'))")
      db.exec("UPDATE run_costs SET usage_kind = 'media' WHERE run_id LIKE 'image:%'")
      db.exec(
        `UPDATE run_costs
            SET total_tokens = COALESCE(input_tokens, 0)
                             + COALESCE(output_tokens, 0)
                             + COALESCE(cache_read_tokens, 0)
                             + COALESCE(cache_write_tokens, 0)
          WHERE usage_kind = 'tokens'
            AND total_tokens IS NULL
            AND input_tokens IS NOT NULL
            AND output_tokens IS NOT NULL
            AND typeof(input_tokens) = 'integer' AND input_tokens BETWEEN 0 AND 9007199254740991
            AND typeof(output_tokens) = 'integer' AND output_tokens BETWEEN 0 AND 9007199254740991
            AND (cache_read_tokens IS NULL OR (typeof(cache_read_tokens) = 'integer' AND cache_read_tokens BETWEEN 0 AND 9007199254740991))
            AND (cache_write_tokens IS NULL OR (typeof(cache_write_tokens) = 'integer' AND cache_write_tokens BETWEEN 0 AND 9007199254740991))
            AND COALESCE(input_tokens, 0)
              + COALESCE(output_tokens, 0)
              + COALESCE(cache_read_tokens, 0)
              + COALESCE(cache_write_tokens, 0) <= 9007199254740991`,
      )
      db.exec(
        `UPDATE run_costs SET total_tokens = NULL
          WHERE usage_kind = 'tokens'
            AND total_tokens IS NOT NULL
            AND (
              (input_tokens IS NOT NULL AND (typeof(input_tokens) != 'integer' OR input_tokens < 0 OR input_tokens > 9007199254740991))
              OR (output_tokens IS NOT NULL AND (typeof(output_tokens) != 'integer' OR output_tokens < 0 OR output_tokens > 9007199254740991))
              OR (cache_read_tokens IS NOT NULL AND (typeof(cache_read_tokens) != 'integer' OR cache_read_tokens < 0 OR cache_read_tokens > 9007199254740991))
              OR (cache_write_tokens IS NOT NULL AND (typeof(cache_write_tokens) != 'integer' OR cache_write_tokens < 0 OR cache_write_tokens > 9007199254740991))
              OR (
                input_tokens IS NOT NULL
                AND output_tokens IS NOT NULL
                AND typeof(input_tokens) = 'integer'
                AND typeof(output_tokens) = 'integer'
                AND input_tokens BETWEEN 0 AND 9007199254740991
                AND output_tokens BETWEEN 0 AND 9007199254740991
                AND input_tokens + output_tokens > total_tokens
              )
            )`,
      )
      for (const column of ['input_tokens', 'output_tokens', 'total_tokens', 'cache_read_tokens', 'cache_write_tokens']) {
        db.exec(
          `UPDATE run_costs SET ${column} = NULL
            WHERE usage_kind = 'tokens'
              AND ${column} IS NOT NULL
              AND (typeof(${column}) != 'integer' OR ${column} < 0 OR ${column} > 9007199254740991)`,
        )
      }
      db.exec(
        `UPDATE run_costs SET cost_usd_micros = NULL
          WHERE cost_usd_micros IS NOT NULL
            AND (typeof(cost_usd_micros) != 'integer' OR cost_usd_micros < 0 OR cost_usd_micros > 9007199254740991)`,
      )
      db.exec(
        `UPDATE run_costs
            SET input_tokens = NULL,
                output_tokens = NULL,
                total_tokens = NULL,
                cache_read_tokens = NULL,
                cache_write_tokens = NULL
          WHERE usage_kind = 'media'`,
      )
    },
  },
  {
    // Work-class attribution (the routing + spend dimension). The ONLY safe
    // historical backfill is the unique `chat:%:title` prefix → auto-title.
    // `turn:` was the shared synthetic id for relays AND generic operator
    // sends with no stored discriminator — mapping it would mislabel history,
    // so it stays honestly NULL ("unclassified (pre-migration)"), as do
    // dispatch-era `task:` rows (their class was computed then discarded) and
    // media rows (work classes are a token-turn concept).
    version: 8,
    up: (db: Db) => {
      db.exec('ALTER TABLE run_costs ADD COLUMN work_class TEXT')
      db.exec('ALTER TABLE run_costs ADD COLUMN route_source TEXT')
      db.exec("UPDATE run_costs SET work_class = 'auto-title' WHERE run_id LIKE 'chat:%:title'")
    },
  },
]

/** Open the db with this module's schema applied. Every verb goes through here. */
function ledger(): Db {
  const db = getDb()
  applyMigrations(MODULE, MIGRATIONS)
  return db
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? ''
  const message = err instanceof Error ? err.message : String(err)
  return code.startsWith('SQLITE_CONSTRAINT') || /UNIQUE constraint failed/i.test(message)
}

/** Map unexpected sqlite/io failures to the fail-closed error type. */
function guard<T>(op: string, fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof StorageUnavailableError) throw err
    if (isUniqueViolation(err)) throw err // handled by the verb that expects it
    log.error(`ledger op failed: ${op}`, err)
    throw new StorageUnavailableError(`ledger op failed: ${op}`, err)
  }
}

// ---------------------------------------------------------------------------
// runs
// ---------------------------------------------------------------------------

export interface RunRow {
  runId: string
  taskId: string
  execKey: string
  seq: number
  agent: string
  status: 'running' | 'settled' | 'superseded' | 'lost'
  bootId: string
  startedAt: number
  heartbeatAt: number
  settledAt: number | null
  settleReason: string | null
}

interface RawRunRow {
  run_id: string
  task_id: string
  exec_key: string
  seq: number
  agent: string
  status: RunRow['status']
  boot_id: string
  started_at: number
  heartbeat_at: number
  settled_at: number | null
  settle_reason: string | null
}

function toRunRow(raw: RawRunRow): RunRow {
  return {
    runId: raw.run_id,
    taskId: raw.task_id,
    execKey: raw.exec_key,
    seq: raw.seq,
    agent: raw.agent,
    status: raw.status,
    bootId: raw.boot_id,
    startedAt: raw.started_at,
    heartbeatAt: raw.heartbeat_at,
    settledAt: raw.settled_at,
    settleReason: raw.settle_reason,
  }
}

export interface RunClaim {
  runId: string
  taskId: string
  /** Live-run lock scope. Defaults to taskId; workflow steps pass `${taskId}:${stepId}`. */
  execKey?: string
  seq: number
  agent: string
  bootId: string
  now?: number
}

export type ClaimRunResult = { claimed: true } | { claimed: false; liveRunId?: string }

/**
 * Claim the live-run slot for an exec key with an explicit seq. The partial
 * unique index (one status='running' row per exec_key) is the lock — a
 * concurrent or duplicate claim fails the INSERT and returns the live
 * run's id.
 */
export function claimRun(input: RunClaim): ClaimRunResult {
  const db = ledger()
  const now = input.now ?? Date.now()
  const execKey = input.execKey ?? input.taskId
  try {
    db.prepare(
      `INSERT INTO runs (run_id, task_id, exec_key, seq, agent, status, boot_id, started_at, heartbeat_at)
       VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
    ).run(input.runId, input.taskId, execKey, input.seq, input.agent, input.bootId, now, now)
    return { claimed: true }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { claimed: false, liveRunId: getLiveRunByKey(execKey)?.runId }
    }
    return guard(`claimRun(${input.taskId})`, () => {
      throw err
    })
  }
}

export type ClaimNextRunResult =
  | { claimed: true; runId: string; seq: number }
  | { claimed: false; liveRunId?: string }

/**
 * Atomically mint the next per-task seq AND claim the live-run slot — the
 * single verb every dispatch path uses. The transaction makes mint+claim
 * indivisible, and the INSERT's durability is the persist-before-send
 * guarantee: a turn only fires after its run row is on disk.
 */
export function claimNextRun(input: {
  taskId: string
  execKey?: string
  agent: string
  bootId: string
  runIdFor: (seq: number) => string
  now?: number
}): ClaimNextRunResult {
  const execKey = input.execKey ?? input.taskId
  try {
    return withTx(() => {
      const seq = computeNextSeq(input.taskId)
      const runId = input.runIdFor(seq)
      const now = input.now ?? Date.now()
      ledger()
        .prepare(
          `INSERT INTO runs (run_id, task_id, exec_key, seq, agent, status, boot_id, started_at, heartbeat_at)
           VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
        )
        .run(runId, input.taskId, execKey, seq, input.agent, input.bootId, now, now)
      return { claimed: true as const, runId, seq }
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { claimed: false, liveRunId: getLiveRunByKey(execKey)?.runId }
    }
    return guard(`claimNextRun(${input.taskId})`, () => {
      throw err
    })
  }
}

/** Settle a running run (success or classified failure). Returns false if it wasn't running. */
export function settleRun(runId: string, reason: string, now?: number): boolean {
  return guard(`settleRun(${runId})`, () => {
    const result = ledger()
      .prepare(
        `UPDATE runs SET status = 'settled', settled_at = ?, settle_reason = ?
         WHERE run_id = ? AND status = 'running'`,
      )
      .run(now ?? Date.now(), reason, runId)
    return result.changes > 0
  })
}

/** Mark a running run lost (session death, boot sweep). */
export function loseRun(runId: string, reason: string, now?: number): boolean {
  return guard(`loseRun(${runId})`, () => {
    const result = ledger()
      .prepare(
        `UPDATE runs SET status = 'lost', settled_at = ?, settle_reason = ?
         WHERE run_id = ? AND status = 'running'`,
      )
      .run(now ?? Date.now(), reason, runId)
    return result.changes > 0
  })
}

export type SupersedeResult = { superseded: true; runIds: string[] } | { superseded: false }

/**
 * Supersede the task's stale live runs (heartbeat older than `staleBefore`).
 * Transactional — of N racing supersede attempts exactly one wins each row;
 * losers see zero rows and must skip recovery. May supersede multiple rows
 * for workflow tasks (one per stale step agent).
 */
export function supersedeStaleRun(taskId: string, staleBefore: number, now?: number): SupersedeResult {
  return guard(`supersedeStaleRun(${taskId})`, () =>
    withTx(() => {
      const stale = ledger()
        .prepare<RawRunRow, [string, number]>(
          'SELECT * FROM runs WHERE task_id = ? AND status = \'running\' AND heartbeat_at < ?',
        )
        .all(taskId, staleBefore)
      if (stale.length === 0) return { superseded: false } as const
      const update = ledger().prepare(
        `UPDATE runs SET status = 'superseded', settled_at = ?, settle_reason = 'superseded'
         WHERE run_id = ? AND status = 'running'`,
      )
      const settledAt = now ?? Date.now()
      for (const row of stale) update.run(settledAt, row.run_id)
      return { superseded: true, runIds: stale.map((row) => row.run_id) } as const
    }),
  )
}

/**
 * Startup sweep: a crashed process must never leave a claim that blocks
 * re-dispatch. Marks every running row from a previous boot as lost.
 */
export function markPriorBootRunsLost(currentBootId: string, now?: number): number {
  return guard('markPriorBootRunsLost', () => {
    const result = ledger()
      .prepare(
        `UPDATE runs SET status = 'lost', settled_at = ?, settle_reason = 'boot-sweep'
         WHERE status = 'running' AND boot_id != ?`,
      )
      .run(now ?? Date.now(), currentBootId)
    return result.changes
  })
}

export function bumpHeartbeat(runId: string, now?: number): void {
  guard(`bumpHeartbeat(${runId})`, () => {
    ledger()
      .prepare('UPDATE runs SET heartbeat_at = ? WHERE run_id = ? AND status = \'running\'')
      .run(now ?? Date.now(), runId)
  })
}

/** Heartbeat by task — the progress path knows taskId, not runId. */
export function bumpHeartbeatByTask(taskId: string, now?: number): void {
  guard(`bumpHeartbeatByTask(${taskId})`, () => {
    ledger()
      .prepare('UPDATE runs SET heartbeat_at = ? WHERE task_id = ? AND status = \'running\'')
      .run(now ?? Date.now(), taskId)
  })
}

/** First live run for the task (regular tasks have at most one). */
export function getLiveRun(taskId: string): RunRow | null {
  return guard(`getLiveRun(${taskId})`, () => {
    const raw = ledger()
      .prepare<RawRunRow, [string]>('SELECT * FROM runs WHERE task_id = ? AND status = \'running\'')
      .get(taskId)
    return raw ? toRunRow(raw) : null
  })
}

export function getLiveRunByKey(execKey: string): RunRow | null {
  return guard(`getLiveRunByKey(${execKey})`, () => {
    const raw = ledger()
      .prepare<RawRunRow, [string]>('SELECT * FROM runs WHERE exec_key = ? AND status = \'running\'')
      .get(execKey)
    return raw ? toRunRow(raw) : null
  })
}

/** Every dispatch attempt for a task, newest-first — backs the run-history UI. */
export function listRunsByTask(taskId: string, limit = 50): RunRow[] {
  return guard(`listRunsByTask(${taskId})`, () => {
    return ledger()
      .prepare<RawRunRow, [string, number]>(
        'SELECT * FROM runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?',
      )
      .all(taskId, limit)
      .map(toRunRow)
  })
}

/**
 * Every currently-running run across all agents, oldest first — backs the
 * health dashboard's live-now panel (#385). Trustworthy because
 * markPriorBootRunsLost sweeps stale rows from dead boots at startup.
 */
export function listLiveRuns(): RunRow[] {
  return guard('listLiveRuns', () => {
    return ledger()
      .prepare<RawRunRow, []>("SELECT * FROM runs WHERE status = 'running' ORDER BY started_at ASC")
      .all()
      .map(toRunRow)
  })
}

function computeNextSeq(taskId: string): number {
  const row = ledger()
    .prepare<{ max_seq: number | null }, [string, string]>(
      `SELECT MAX(seq) AS max_seq FROM (
         SELECT seq FROM runs WHERE task_id = ?
         UNION ALL
         SELECT seq FROM seq_watermarks WHERE task_id = ?
       )`,
    )
    .get(taskId, taskId)
  return (row?.max_seq ?? 0) + 1
}

/**
 * Next dispatch seq for a task: max(existing runs, seeded watermark) + 1.
 * Transactional so concurrent mints can't collide; the UNIQUE(task_id, seq)
 * constraint backstops it. Prefer claimNextRun, which mints AND claims in
 * one transaction.
 */
export function nextSeq(taskId: string): number {
  return guard(`nextSeq(${taskId})`, () => withTx(() => computeNextSeq(taskId)))
}

/** Highest seq ever used for the task (0 when none) — salvage labeling etc. */
export function currentSeq(taskId: string): number {
  return guard(`currentSeq(${taskId})`, () => computeNextSeq(taskId) - 1)
}

/** Seed a seq floor (migration from .dispatch-state.json). MAX semantics — never regresses. */
export function setSeqWatermark(taskId: string, seq: number): void {
  guard(`setSeqWatermark(${taskId})`, () => {
    ledger()
      .prepare(
        `INSERT INTO seq_watermarks (task_id, seq) VALUES (?, ?)
         ON CONFLICT(task_id) DO UPDATE SET seq = MAX(seq, excluded.seq)`,
      )
      .run(taskId, seq)
  })
}

// ---------------------------------------------------------------------------
// cron_fires
// ---------------------------------------------------------------------------

export interface CronFireRow {
  jobId: string
  runId: string
  firedAt: number
  claimedAt: number
  taskId: string | null
  disposition: 'pending' | 'created' | 'skipped' | 'seeded'
  skipReason: string | null
}

interface RawCronFireRow {
  job_id: string
  run_id: string
  fired_at: number
  claimed_at: number
  task_id: string | null
  disposition: CronFireRow['disposition']
  skip_reason: string | null
}

function toCronFireRow(raw: RawCronFireRow): CronFireRow {
  return {
    jobId: raw.job_id,
    runId: raw.run_id,
    firedAt: raw.fired_at,
    claimedAt: raw.claimed_at,
    taskId: raw.task_id,
    disposition: raw.disposition,
    skipReason: raw.skip_reason ?? null,
  }
}

export type ClaimCronFireResult = { claimed: true } | { claimed: false; existing: CronFireRow | null }

/**
 * Claim a cron fire BEFORE creating its task. The (job_id, run_id) primary
 * key makes a second fire for the same run physically impossible.
 */
export function claimCronFire(
  jobId: string,
  runId: string,
  firedAt?: number,
  disposition: CronFireRow['disposition'] = 'pending',
  now?: number,
): ClaimCronFireResult {
  const db = ledger()
  try {
    db.prepare('INSERT INTO cron_fires (job_id, run_id, fired_at, claimed_at, disposition) VALUES (?, ?, ?, ?, ?)').run(
      jobId,
      runId,
      firedAt ?? Date.now(),
      now ?? Date.now(),
      disposition,
    )
    return { claimed: true }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { claimed: false, existing: getCronFire(jobId, runId) }
    }
    return guard(`claimCronFire(${jobId}, ${runId})`, () => {
      throw err
    })
  }
}

export function getCronFire(jobId: string, runId: string): CronFireRow | null {
  return guard(`getCronFire(${jobId}, ${runId})`, () => {
    const raw = ledger()
      .prepare<RawCronFireRow, [string, string]>('SELECT * FROM cron_fires WHERE job_id = ? AND run_id = ?')
      .get(jobId, runId)
    return raw ? toCronFireRow(raw) : null
  })
}

/** Record the task created under a claimed fire (disposition → created). */
export function attachCronTask(jobId: string, runId: string, taskId: string): void {
  guard(`attachCronTask(${jobId}, ${runId})`, () => {
    ledger()
      .prepare('UPDATE cron_fires SET task_id = ?, disposition = \'created\' WHERE job_id = ? AND run_id = ?')
      .run(taskId, jobId, runId)
  })
}

/** A deliberately skipped fire (paused / skip-N / no-overlap) — consumed, never
 *  healed. `reason` is the human label surfaced in the run history. */
export function markCronFireSkipped(jobId: string, runId: string, reason?: string): void {
  guard(`markCronFireSkipped(${jobId}, ${runId})`, () => {
    ledger()
      .prepare('UPDATE cron_fires SET disposition = \'skipped\', skip_reason = ? WHERE job_id = ? AND run_id = ?')
      .run(reason ?? null, jobId, runId)
  })
}

/** A job's fires, newest logical-fire-time first — backs the run-history UI. */
export function listCronFires(jobId: string, limit = 50): CronFireRow[] {
  return guard(`listCronFires(${jobId})`, () => {
    return ledger()
      .prepare<RawCronFireRow, [string, number]>(
        'SELECT * FROM cron_fires WHERE job_id = ? ORDER BY fired_at DESC LIMIT ?',
      )
      .all(jobId, limit)
      .map(toCronFireRow)
  })
}

/**
 * Claims that stayed 'pending' too long: the process died between claim and
 * task creation. The healer re-creates the task UNDER THE SAME CLAIM —
 * rarely-miss, never-duplicate.
 *
 * Staleness keys on claimed_at (when the claim row was inserted), NOT
 * fired_at: the reconciler replays runs hours old, and an in-flight claim
 * for an old run must not look instantly healable to a concurrent pass.
 */
export function findHealableCronClaims(olderThanMs: number, now?: number): CronFireRow[] {
  return guard('findHealableCronClaims', () => {
    const cutoff = (now ?? Date.now()) - olderThanMs
    return ledger()
      .prepare<RawCronFireRow, [number]>(
        'SELECT * FROM cron_fires WHERE disposition = \'pending\' AND claimed_at < ? ORDER BY claimed_at',
      )
      .all(cutoff)
      .map(toCronFireRow)
  })
}

export interface PruneCronFiresOptions {
  /** Rows with fired_at older than now − maxAgeMs are prune candidates. */
  maxAgeMs: number
  /** The newest N rows per job always survive (run-history floor). */
  keepPerJob: number
  /** Hard floor: nothing newer than now − minAgeMs is ever deleted, so a
   *  re-claim inside the catch-up/dedup horizon still collides with its
   *  original row even under a misconfigured maxAgeMs. */
  minAgeMs: number
  now?: number
}

/**
 * Bound cron_fires growth. `pending` rows are untouchable — they are live
 * claims the healer may still consume; only settled dispositions
 * (created/skipped/seeded) past BOTH age bounds and outside the per-job
 * keep window are deleted.
 */
export function pruneCronFires(opts: PruneCronFiresOptions): { pruned: number } {
  return guard('pruneCronFires', () => {
    const now = opts.now ?? Date.now()
    const cutoff = now - Math.max(opts.maxAgeMs, opts.minAgeMs)
    const result = ledger()
      .prepare(
        `DELETE FROM cron_fires
         WHERE disposition != 'pending'
           AND fired_at < ?1
           AND rowid NOT IN (
             SELECT keepers.rowid FROM cron_fires AS keepers
             WHERE keepers.job_id = cron_fires.job_id
             ORDER BY keepers.fired_at DESC
             LIMIT ?2
           )`,
      )
      .run(cutoff, opts.keepPerJob)
    return { pruned: result.changes }
  })
}

// ---------------------------------------------------------------------------
// completions
// ---------------------------------------------------------------------------

export interface CompletionRow {
  taskId: string
  runId: string | null
  agent: string
  channel: string | null
  completedAt: number
}

interface RawCompletionRow {
  task_id: string
  run_id: string | null
  agent: string
  channel: string | null
  completed_at: number
}

function toCompletionRow(raw: RawCompletionRow): CompletionRow {
  return {
    taskId: raw.task_id,
    runId: raw.run_id,
    agent: raw.agent,
    channel: raw.channel,
    completedAt: raw.completed_at,
  }
}

export type RecordCompletionResult = { recorded: true } | { recorded: false; existing: CompletionRow }

/**
 * First completion wins. A second attempt returns the existing row — the
 * caller suppresses every side effect and audits task.completion_suppressed.
 */
export function recordCompletion(
  taskId: string,
  input: { runId?: string; agent: string; channel?: string; now?: number },
): RecordCompletionResult {
  const db = ledger()
  try {
    db.prepare('INSERT INTO completions (task_id, run_id, agent, channel, completed_at) VALUES (?, ?, ?, ?, ?)').run(
      taskId,
      input.runId ?? null,
      input.agent,
      input.channel ?? null,
      input.now ?? Date.now(),
    )
    return { recorded: true }
  } catch (err) {
    if (isUniqueViolation(err)) {
      const existing = getCompletion(taskId)
      if (existing) return { recorded: false, existing }
    }
    return guard(`recordCompletion(${taskId})`, () => {
      throw err
    })
  }
}

export function hasCompletion(taskId: string): boolean {
  return getCompletion(taskId) !== null
}

export function getCompletion(taskId: string): CompletionRow | null {
  return guard(`getCompletion(${taskId})`, () => {
    const raw = ledger()
      .prepare<RawCompletionRow, [string]>('SELECT * FROM completions WHERE task_id = ?')
      .get(taskId)
    return raw ? toCompletionRow(raw) : null
  })
}

/**
 * Completed-task counts per agent since a timestamp — the outcome side of the
 * effort-vs-outcome view (#385). Full scan; the table is one row per
 * completed task, tiny at single-user scale.
 */
export function completionsByAgentSince(sinceMs: number): { agent: string; completions: number }[] {
  return guard('completionsByAgentSince', () => {
    return ledger()
      .prepare<{ agent: string; completions: number }, [number]>(
        'SELECT agent, COUNT(*) AS completions FROM completions WHERE completed_at >= ? GROUP BY agent',
      )
      .all(sinceMs)
  })
}

/** Reopen: the ONLY path that unfreezes a completed task (audited by the caller). */
export function deleteCompletion(taskId: string): boolean {
  return guard(`deleteCompletion(${taskId})`, () => {
    return ledger().prepare('DELETE FROM completions WHERE task_id = ?').run(taskId).changes > 0
  })
}

// ---------------------------------------------------------------------------
// idempotency
// ---------------------------------------------------------------------------

export interface IdempotentResult {
  kind: string
  result: unknown
}

export function getIdempotent(key: string): IdempotentResult | null {
  return guard(`getIdempotent(${key})`, () => {
    const raw = ledger()
      .prepare<{ kind: string; result_json: string }, [string]>(
        'SELECT kind, result_json FROM idempotency WHERE key = ?',
      )
      .get(key)
    if (!raw) return null
    return { kind: raw.kind, result: JSON.parse(raw.result_json) }
  })
}

/** Durable, no TTL, first write wins — a replay can never overwrite the billed result. */
export function putIdempotent(key: string, kind: string, result: unknown, now?: number): void {
  guard(`putIdempotent(${key})`, () => {
    ledger()
      .prepare('INSERT OR IGNORE INTO idempotency (key, kind, result_json, created_at) VALUES (?, ?, ?, ?)')
      .run(key, kind, JSON.stringify(result), now ?? Date.now())
  })
}

// ---------------------------------------------------------------------------
// run costs (per-run billing facts)
// ---------------------------------------------------------------------------

/**
 * How a turn was billed: 'metered' = pay-per-token/image API key (real
 * dollars); 'subscription' = plan-included quota (tokens are the unit; a
 * dollar figure would be fiction).
 */
export type BillingLane = 'metered' | 'subscription'

export type { RunUsageKind } from './token-evidence'

export interface RunCostInput {
  runId: string
  /** Null for non-dispatch turns (watchdog/doctor/orchestrator sends). */
  taskId?: string | null
  agent: string
  model?: string
  /** Provider segment of the model id (e.g. 'anthropic'); null when unknown. */
  provider?: string | null
  /** Billing lane; null when the runtime cannot classify it safely. */
  lane?: BillingLane | null
  /**
   * Token-bearing chat/run versus non-token media work. Optional only for
   * compatibility with older internal callers; new writers must be explicit.
   */
  usageKind?: RunUsageKind
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
  /** Provider-cache token counts; null when the runtime reported none. */
  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
  /** Estimated cost; null when the model has no catalog pricing (unmetered). */
  costUsdMicros?: number | null
  /**
   * The work performed (routing + spend dimension) — REQUIRED so every new
   * writer names its class at the call site (compile-time forcing function).
   * Null is reserved for work that has no class (media) — never a default.
   */
  workClass: string | null
  /** How the turn's model was chosen: 'tag:<name>' | 'class' | 'inherit'. */
  routeSource?: string | null
  occurredAt: number
}

function usageKindFor(input: RunCostInput): RunUsageKind {
  if (input.usageKind === undefined) return input.runId.startsWith('image:') ? 'media' : 'tokens'
  if (input.usageKind === 'tokens' || input.usageKind === 'media') return input.usageKind
  throw new TypeError(`invalid run usage kind: ${String(input.usageKind)}`)
}

export interface SpendByAgentRow {
  agent: string
  costUsdMicros: number
  runs: number
}

export interface SpendByModelRow {
  model: string
  costUsdMicros: number
  runs: number
}

/**
 * Record the cost of one settled run. first-write-wins on run_id (a transport
 * retry of the same run can't double-count). Token/cost columns are nullable:
 * an unmetered run (no usage, or a model with no catalog pricing) still gets a
 * row — it counts as a run while its cost remains unknown, never a
 * fabricated zero-dollar result.
 */
export function recordRunCost(input: RunCostInput): void {
  const usageKind = usageKindFor(input)
  const tokens = normalizeRunTokenEvidence(usageKind, {
    input: input.inputTokens,
    output: input.outputTokens,
    total: input.totalTokens,
    cacheRead: input.cacheReadTokens,
    cacheWrite: input.cacheWriteTokens,
  })
  guard(`recordRunCost(${input.runId})`, () => {
    ledger()
      .prepare(
        `INSERT OR IGNORE INTO run_costs
           (run_id, task_id, agent, model, provider, lane, usage_kind, input_tokens, output_tokens, total_tokens, cache_read_tokens, cache_write_tokens, cost_usd_micros, work_class, route_source, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runId,
        input.taskId ?? null,
        input.agent,
        input.model ?? null,
        input.provider ?? null,
        input.lane ?? null,
        usageKind,
        tokens.input,
        tokens.output,
        tokens.total,
        tokens.cacheRead,
        tokens.cacheWrite,
        normalizeRunCostUsdMicros(input.costUsdMicros),
        input.workClass,
        input.routeSource ?? null,
        input.occurredAt,
      )
  })
}

/** Total estimated spend (micro-dollars) in a window, optionally scoped to one agent. */
export function spendTotal(opts: { agent?: string; sinceMs: number; untilMs?: number }): number {
  return guard('spendTotal', () => {
    const clauses = ['occurred_at >= ?']
    const params: (string | number)[] = [opts.sinceMs]
    if (opts.untilMs !== undefined) { clauses.push('occurred_at <= ?'); params.push(opts.untilMs) }
    if (opts.agent !== undefined) { clauses.push('agent = ?'); params.push(opts.agent) }
    const row = ledger()
      .prepare<{ total: number }, (string | number)[]>(
        `SELECT COALESCE(SUM(cost_usd_micros), 0) AS total FROM run_costs WHERE ${clauses.join(' AND ')}`,
      )
      .get(...params)
    return row?.total ?? 0
  })
}

/** Per-agent spend rollup since a timestamp (cost in micro-dollars, run count). */
export function spendByAgent(sinceMs: number): SpendByAgentRow[] {
  return guard('spendByAgent', () => {
    return ledger()
      .prepare<{ agent: string; micros: number; runs: number }, [number]>(
        `SELECT agent, COALESCE(SUM(cost_usd_micros), 0) AS micros, COUNT(*) AS runs
           FROM run_costs WHERE occurred_at >= ? GROUP BY agent`,
      )
      .all(sinceMs)
      .map((r) => ({ agent: r.agent, costUsdMicros: r.micros, runs: r.runs }))
  })
}

/** Per-model spend rollup since a timestamp. Rows with no model are grouped under ''. */
export function spendByModel(sinceMs: number): SpendByModelRow[] {
  return guard('spendByModel', () => {
    return ledger()
      .prepare<{ model: string | null; micros: number; runs: number }, [number]>(
        `SELECT model, COALESCE(SUM(cost_usd_micros), 0) AS micros, COUNT(*) AS runs
           FROM run_costs WHERE occurred_at >= ? GROUP BY model`,
      )
      .all(sinceMs)
      .map((r) => ({ model: r.model ?? '', costUsdMicros: r.micros, runs: r.runs }))
  })
}

export interface RunCostSpendRow {
  runId: string
  agent: string
  model: string | null
  provider: string | null
  lane: BillingLane | null
  usageKind: RunUsageKind
  totalTokens: number | null
  costUsdMicros: number | null
  /** Null = unclassified (pre-migration rows, or classless media work). */
  workClass: string | null
  routeSource: string | null
  occurredAt: number
}

/**
 * Raw cost rows since a timestamp — the spend engine's attributed input. No
 * SQL-side day bucketing (local-day semantics live in ONE place, the
 * TypeScript engine, matching usage-history's toLocalDayKey exactly).
 */
export function listRunCostsSince(sinceMs: number): RunCostSpendRow[] {
  return guard('listRunCostsSince', () => {
    return ledger()
      .prepare<{
        run_id: string; agent: string; model: string | null; provider: string | null
        lane: string | null; usage_kind: string | null; total_tokens: number | null
        cost_usd_micros: number | null; work_class: string | null; route_source: string | null
        occurred_at: number
      }, [number]>(
        `SELECT run_id, agent, model, provider, lane, usage_kind, total_tokens, cost_usd_micros, work_class, route_source, occurred_at
           FROM run_costs WHERE occurred_at >= ?`,
      )
      .all(sinceMs)
      .map((r) => ({
        runId: r.run_id,
        agent: r.agent,
        model: r.model,
        provider: r.provider,
        lane: r.lane === 'metered' || r.lane === 'subscription' ? r.lane : null,
        usageKind: r.usage_kind === 'media' ? 'media' : 'tokens',
        totalTokens: r.total_tokens,
        costUsdMicros: r.cost_usd_micros,
        workClass: r.work_class,
        routeSource: r.route_source,
        occurredAt: r.occurred_at,
      }))
  })
}

// ---------------------------------------------------------------------------
// budget incidents (durable breach records — cost-control v2)
// ---------------------------------------------------------------------------

export type BudgetIncidentKind = 'warn' | 'cap'
export type BudgetIncidentStatus = 'open' | 'acknowledged' | 'resolved'
export type BudgetIncidentResolution = 'raised' | 'acknowledged' | 'window_rollover' | 'killswitch_cleared' | 'rule_removed'

export interface BudgetIncidentInput {
  scope: string
  /** Agent/provider/model id; omit for global (stored as ''). */
  scopeId?: string
  lane: BillingLane
  window: 'daily' | 'monthly'
  windowStartMs: number
  kind: BudgetIncidentKind
  unit: 'usd_micros' | 'tokens'
  capValue: number
  spentValue: number
  /** The rule's enforcement mode at open time ('pause' blocks past rollover). */
  atCap: 'defer' | 'pause'
  openedAt: number
}

export interface BudgetIncidentRow {
  id: number
  scope: string
  scopeId: string
  lane: BillingLane
  window: 'daily' | 'monthly'
  windowStartMs: number
  kind: BudgetIncidentKind
  unit: 'usd_micros' | 'tokens'
  capValue: number
  spentValue: number
  atCap: 'defer' | 'pause'
  openedAt: number
  status: BudgetIncidentStatus
  resolvedAt: number | null
  resolution: BudgetIncidentResolution | null
}

interface RawIncidentRow {
  id: number; scope: string; scope_id: string; lane: string; win: string
  window_start_ms: number; kind: string; unit: string; cap_value: number
  spent_value: number; at_cap: string; opened_at: number; status: string
  resolved_at: number | null; resolution: string | null
}

function toIncidentRow(r: RawIncidentRow): BudgetIncidentRow {
  return {
    id: r.id,
    scope: r.scope,
    scopeId: r.scope_id,
    lane: r.lane as BillingLane,
    window: r.win as 'daily' | 'monthly',
    windowStartMs: r.window_start_ms,
    kind: r.kind as BudgetIncidentKind,
    unit: r.unit as 'usd_micros' | 'tokens',
    capValue: r.cap_value,
    spentValue: r.spent_value,
    atCap: r.at_cap as 'defer' | 'pause',
    openedAt: r.opened_at,
    status: r.status as BudgetIncidentStatus,
    resolvedAt: r.resolved_at,
    resolution: r.resolution as BudgetIncidentResolution | null,
  }
}

const INCIDENT_COLUMNS = 'id, scope, scope_id, lane, win, window_start_ms, kind, unit, cap_value, spent_value, at_cap, opened_at, status, resolved_at, resolution'

/**
 * Open (or find) the incident for a breach. Idempotent per (rule identity,
 * window, kind) via the UNIQUE — `opened: true` means this call created a NEW
 * alertable event (fresh insert, or the reopen of a raise-resolved incident
 * that breached again). live (open/acknowledged) → `opened: false`, no
 * re-alert.
 */
export function openBudgetIncident(input: BudgetIncidentInput): { opened: boolean; id: number } {
  return guard('openBudgetIncident', () => {
    const db = ledger()
    return db.transaction(() => {
      const inserted = db
        .prepare(
          `INSERT INTO budget_incidents (scope, scope_id, lane, win, window_start_ms, kind, unit, cap_value, spent_value, at_cap, opened_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(scope, scope_id, lane, win, window_start_ms, kind) DO NOTHING`,
        )
        .run(input.scope, input.scopeId ?? '', input.lane, input.window, input.windowStartMs, input.kind, input.unit, input.capValue, input.spentValue, input.atCap, input.openedAt)
      const existing = db
        .prepare<RawIncidentRow, (string | number)[]>(
          `SELECT ${INCIDENT_COLUMNS} FROM budget_incidents WHERE scope = ? AND scope_id = ? AND lane = ? AND win = ? AND window_start_ms = ? AND kind = ?`,
        )
        .get(input.scope, input.scopeId ?? '', input.lane, input.window, input.windowStartMs, input.kind)!
      if (inserted.changes > 0) return { opened: true, id: existing.id }
      if (existing.status === 'resolved' && (existing.resolution === 'raised' || existing.resolution === 'window_rollover')) {
        // A breach after a raise (or a fresh breach whose stale row rolled
        // over) is a NEW alertable event. An 'acknowledged'-resolved row
        // (operator dismissed/resumed THIS window's breach) stays suppressed
        // — reopening it would just re-alert the human who explicitly
        // dismissed it (spend-based deferral still applies silently).
        db.prepare(
          `UPDATE budget_incidents SET status = 'open', spent_value = ?, cap_value = ?, at_cap = ?, opened_at = ?, resolved_at = NULL, resolution = NULL WHERE id = ?`,
        ).run(input.spentValue, input.capValue, input.atCap, input.openedAt, existing.id)
        return { opened: true, id: existing.id }
      }
      return { opened: false, id: existing.id }
    })()
  })
}

/** Move an incident to acknowledged (still live) or resolved (cleared). */
export function resolveBudgetIncident(input: {
  id: number
  status: 'acknowledged' | 'resolved'
  resolution: BudgetIncidentResolution
  resolvedAt?: number
}): boolean {
  return guard('resolveBudgetIncident', () => {
    const res = ledger()
      .prepare(`UPDATE budget_incidents SET status = ?, resolution = ?, resolved_at = ? WHERE id = ? AND status != 'resolved'`)
      .run(input.status, input.resolution, input.resolvedAt ?? Date.now(), input.id)
    return res.changes > 0
  })
}

/** Incidents, newest first. `openOnly` = live rows (open + acknowledged). */
export function listBudgetIncidents(opts: { openOnly?: boolean; sinceMs?: number } = {}): BudgetIncidentRow[] {
  return guard('listBudgetIncidents', () => {
    const clauses: string[] = []
    const params: (string | number)[] = []
    if (opts.openOnly) clauses.push(`status IN ('open','acknowledged')`)
    if (opts.sinceMs !== undefined) { clauses.push('opened_at >= ?'); params.push(opts.sinceMs) }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    return ledger()
      .prepare<RawIncidentRow, (string | number)[]>(
        `SELECT ${INCIDENT_COLUMNS} FROM budget_incidents ${where} ORDER BY opened_at DESC, id DESC`,
      )
      .all(...params)
      .map(toIncidentRow)
  })
}

/**
 * Auto-resolve DEFER-mode incidents whose window has rolled over (their
 * enforcement ended with the window). Pause-mode incidents persist until a
 * human resolves them — that is the point of pause. Returns resolved count.
 */
export function resolveExpiredBudgetIncidents(input: {
  dailyWindowStartMs: number
  monthlyWindowStartMs: number
  now: number
}): number {
  return guard('resolveExpiredBudgetIncidents', () => {
    const res = ledger()
      .prepare(
        `UPDATE budget_incidents
            SET status = 'resolved', resolution = 'window_rollover', resolved_at = ?
          WHERE status IN ('open','acknowledged') AND at_cap = 'defer'
            AND ((win = 'daily' AND window_start_ms < ?) OR (win = 'monthly' AND window_start_ms < ?))`,
      )
      .run(input.now, input.dailyWindowStartMs, input.monthlyWindowStartMs)
    return res.changes
  })
}

/** The live cap incident blocking a rule identity (pause-mode gate check). */
export function findOpenCapIncident(key: { scope: string; scopeId?: string; lane: BillingLane }): BudgetIncidentRow | null {
  return guard('findOpenCapIncident', () => {
    const row = ledger()
      .prepare<RawIncidentRow, (string | number)[]>(
        `SELECT ${INCIDENT_COLUMNS} FROM budget_incidents
          WHERE scope = ? AND scope_id = ? AND lane = ? AND kind = 'cap' AND status IN ('open','acknowledged')
          ORDER BY opened_at DESC LIMIT 1`,
      )
      .get(key.scope, key.scopeId ?? '', key.lane)
    return row ? toIncidentRow(row) : null
  })
}

export interface RunCostRow {
  runId: string
  taskId: string | null
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  costUsdMicros: number | null
  occurredAt: number
}

/**
 * Recent DISPATCH runs for one agent, newest first — grounding data for the
 * context-report diagnostics (#357). Filtered to `task:%` run ids so
 * non-dispatch sends (`turn:…` watchdog/doctor/orchestrator, `image:…`)
 * never pollute the per-dispatch token picture.
 */
export function recentRunsByAgent(agent: string, opts: { sinceMs?: number; limit?: number } = {}): RunCostRow[] {
  return guard('recentRunsByAgent', () => {
    const limit = Math.min(Math.max(Math.floor(opts.limit ?? 20), 1), 500)
    const clauses = ["agent = ?", "run_id LIKE 'task:%'"]
    const params: (string | number)[] = [agent]
    if (opts.sinceMs !== undefined) { clauses.push('occurred_at >= ?'); params.push(opts.sinceMs) }
    params.push(limit)
    return ledger()
      .prepare<{
        run_id: string; task_id: string | null; model: string | null
        input_tokens: number | null; output_tokens: number | null; total_tokens: number | null
        cache_read_tokens: number | null; cache_write_tokens: number | null
        cost_usd_micros: number | null; occurred_at: number
      }, (string | number)[]>(
        `SELECT run_id, task_id, model, input_tokens, output_tokens, total_tokens, cache_read_tokens, cache_write_tokens, cost_usd_micros, occurred_at
           FROM run_costs WHERE ${clauses.join(' AND ')}
          ORDER BY occurred_at DESC LIMIT ?`,
      )
      .all(...params)
      .map((r) => ({
        runId: r.run_id,
        taskId: r.task_id,
        model: r.model,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        totalTokens: r.total_tokens,
        cacheReadTokens: r.cache_read_tokens,
        cacheWriteTokens: r.cache_write_tokens,
        costUsdMicros: r.cost_usd_micros,
        occurredAt: r.occurred_at,
      }))
  })
}

export interface AgentTokenRollup {
  agent: string
  /** SUM over token-bearing rows. Compare metered with applicable before treating this as complete. */
  totalTokens: number | null
  /** SUM over nullable columns. Use costedRuns before treating this as complete. */
  costUsdMicros: number | null
  runs: number
  /** Rows for which a token total is meaningful (media work is excluded). */
  tokenApplicableRuns: number
  /** Token-bearing rows whose total token count was reported. */
  tokenMeteredRuns: number
  /** Whether the reported token subtotal fits the safe JavaScript/wire integer range. */
  tokenAggregateRepresentable: boolean
  /** Rows whose tracked cost was reported, including an explicit zero. */
  costedRuns: number
  /** Whether the reported cost subtotal fits the safe JavaScript/wire integer range. */
  costAggregateRepresentable: boolean
}

/**
 * Per-agent token/cost sums since a timestamp — the attributed side of the
 * effort-vs-outcome view (#385). Unlike spendByAgent this keeps token sums
 * and stays NULL-honest on cost.
 */
export function runTokensByAgentSince(sinceMs: number): AgentTokenRollup[] {
  return guard('runTokensByAgentSince', () => {
    return ledger()
      .prepare<{
        agent: string
        tokens: number | null
        micros: number | null
        runs: number
        token_applicable_runs: number
        token_metered_runs: number
        costed_runs: number
      }, [number]>(
        `SELECT agent,
                TOTAL(CASE WHEN usage_kind = 'tokens' THEN total_tokens END) AS tokens,
                TOTAL(cost_usd_micros) AS micros,
                COUNT(*) AS runs,
                SUM(CASE WHEN usage_kind = 'tokens' THEN 1 ELSE 0 END) AS token_applicable_runs,
                SUM(CASE WHEN usage_kind = 'tokens' AND total_tokens IS NOT NULL THEN 1 ELSE 0 END) AS token_metered_runs,
                COUNT(cost_usd_micros) AS costed_runs
           FROM run_costs WHERE occurred_at >= ? GROUP BY agent`,
      )
      .all(sinceMs)
      .map((r) => {
        const tokens = normalizeRunTokenEvidence('tokens', { total: r.tokens }).total
        const micros = normalizeRunCostUsdMicros(r.micros)
        return {
          agent: r.agent,
          totalTokens: r.token_applicable_runs === 0
            ? 0
            : r.token_metered_runs === 0 ? null : tokens,
          costUsdMicros: r.costed_runs === 0 ? null : micros,
          runs: r.runs,
          tokenApplicableRuns: r.token_applicable_runs,
          tokenMeteredRuns: r.token_metered_runs,
          tokenAggregateRepresentable: r.token_metered_runs === 0 || tokens !== null,
          costedRuns: r.costed_runs,
          costAggregateRepresentable: r.costed_runs === 0 || micros !== null,
        }
      })
  })
}

/** One dispatch attempt with its billing facts — the timeline's run spine (#385). */
export interface RunWithCostRow extends RunRow {
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  costUsdMicros: number | null
}

/**
 * Every dispatch attempt for one agent, newest first, joined with its cost
 * row when one was metered (LEFT JOIN — unmetered runs keep null tokens/cost,
 * never fabricated zeros).
 */
export function listRunsByAgent(agent: string, opts: { sinceMs?: number; limit?: number } = {}): RunWithCostRow[] {
  return guard('listRunsByAgent', () => {
    const limit = Math.min(Math.max(Math.floor(opts.limit ?? 50), 1), 200)
    const clauses = ['r.agent = ?']
    const params: (string | number)[] = [agent]
    if (opts.sinceMs !== undefined) { clauses.push('r.started_at >= ?'); params.push(opts.sinceMs) }
    params.push(limit)
    return ledger()
      .prepare<RawRunRow & {
        model: string | null
        input_tokens: number | null
        output_tokens: number | null
        total_tokens: number | null
        cache_read_tokens: number | null
        cache_write_tokens: number | null
        cost_usd_micros: number | null
      }, (string | number)[]>(
        `SELECT r.*, c.model, c.input_tokens, c.output_tokens, c.total_tokens,
                c.cache_read_tokens, c.cache_write_tokens, c.cost_usd_micros
           FROM runs r LEFT JOIN run_costs c ON c.run_id = r.run_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY r.started_at DESC LIMIT ?`,
      )
      .all(...params)
      .map((r) => ({
        ...toRunRow(r),
        model: r.model,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        totalTokens: r.total_tokens,
        cacheReadTokens: r.cache_read_tokens,
        cacheWriteTokens: r.cache_write_tokens,
        costUsdMicros: r.cost_usd_micros,
      }))
  })
}

// ---------------------------------------------------------------------------
// maintenance
// ---------------------------------------------------------------------------

/** Cascade for task purge. cron_fires rows are kept — they dedupe the job, not the task. */
export function purgeTaskRows(taskId: string): void {
  guard(`purgeTaskRows(${taskId})`, () => {
    withTx(() => {
      const db = ledger()
      db.prepare('DELETE FROM runs WHERE task_id = ?').run(taskId)
      db.prepare('DELETE FROM completions WHERE task_id = ?').run(taskId)
      db.prepare('DELETE FROM seq_watermarks WHERE task_id = ?').run(taskId)
      db.prepare('DELETE FROM run_costs WHERE task_id = ?').run(taskId)
    })
  })
}
