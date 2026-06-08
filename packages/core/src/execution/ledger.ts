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
    })
  })
}
