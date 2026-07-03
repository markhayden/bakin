/**
 * Search outbox — the durable write journal that replaces boot-time index
 * inference (spec D5, tasks/plan-search-rebuild.md A3).
 *
 * Every index/remove/transform is a synchronous SQLite enqueue first; a
 * drain pump lands rows in the search adapter and acks. The engine being
 * down just means rows wait. Boot resumes the drain — no scans, no mtime
 * comparison, ever.
 *
 * Lives in its own store (`~/.bakin/search.db` via the named-db core) —
 * NEVER the execution ledger, which is coordination-facts-only.
 *
 * Coalescing: UNIQUE(logical_table, key), last-write-wins. The table holds
 * at most one row per live document. `search_acked` remembers the last
 * successfully written content hash per key, which replaces every
 * content-hash/dedupe-cache scheme the plugins grew (team scan-dedupe,
 * memory indexed-cache).
 */
import { join } from 'path'
import { createHash } from 'crypto'
import { openNamedDb, type Db } from '../storage/db'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'
import { isEngineUnavailable, isMissingTable } from '../adapters/search/errors'
import type { SearchAdapter, Document } from '../adapters/search'

const log = createLogger('search-outbox')

export interface SearchTransformOp {
  op: '$set' | '$inc' | '$push'
  field?: string
  value: unknown
}

export interface OutboxDrainTarget {
  adapter: SearchAdapter
  /**
   * Logical→physical table mapping, resolved AT DRAIN TIME (blue/green
   * dual-write returns two targets; identity mapping returns [logical]).
   * Every target must succeed for the row to ack.
   */
  resolveTargets: (logicalTable: string) => string[]
}

export interface DrainReport {
  processed: number
  failedTransient: number
  failedPermanent: number
}

export interface OutboxStats {
  pending: number
  inflight: number
  quarantined: number
  oldestPendingEnqueuedAt: number | null
}

const MODULE = 'search-outbox'
const CLAIM_BATCH = 64
const QUARANTINE_AFTER_ATTEMPTS = 5
/** 1s → 5s → 30s → 2m → 10m → 30m cap. */
const BACKOFF_MS = [1_000, 5_000, 30_000, 120_000, 600_000, 1_800_000]

const store = openNamedDb('search', () => join(getContentDir(), 'search.db'))

const MIGRATIONS = [
  {
    version: 1,
    up: (db: Db) => {
      db.exec(
        `CREATE TABLE search_outbox (
           id                 INTEGER PRIMARY KEY AUTOINCREMENT,
           logical_table      TEXT NOT NULL,
           key                TEXT NOT NULL,
           op                 TEXT NOT NULL CHECK (op IN ('index','remove','transform')),
           payload            TEXT,
           payload_hash       TEXT,
           attempts           INTEGER NOT NULL DEFAULT 0,
           transient_attempts INTEGER NOT NULL DEFAULT 0,
           next_attempt_at    INTEGER NOT NULL DEFAULT 0,
           status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','inflight','quarantined')),
           last_error         TEXT,
           enqueued_at        INTEGER NOT NULL,
           UNIQUE (logical_table, key)
         )`,
      )
      db.exec('CREATE INDEX idx_search_outbox_drain ON search_outbox (status, next_attempt_at)')
      db.exec(
        `CREATE TABLE search_acked (
           logical_table TEXT NOT NULL,
           key           TEXT NOT NULL,
           payload_hash  TEXT NOT NULL,
           acked_at      INTEGER NOT NULL,
           PRIMARY KEY (logical_table, key)
         )`,
      )
    },
  },
]

function db(): Db {
  store.applyMigrations(MODULE, MIGRATIONS)
  return store.db()
}

/** Canonical JSON (sorted keys, recursive) so hash dedupe ignores key order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

function hashPayload(doc: Document): string {
  return createHash('sha256').update(stableStringify(doc)).digest('hex')
}

interface OutboxRow {
  id: number
  logical_table: string
  key: string
  op: 'index' | 'remove' | 'transform'
  payload: string | null
  payload_hash: string | null
  attempts: number
  transient_attempts: number
  status: string
}

function getRow(logicalTable: string, key: string): OutboxRow | null {
  return db()
    .prepare<OutboxRow, [string, string]>('SELECT * FROM search_outbox WHERE logical_table = ? AND key = ?')
    .get(logicalTable, key) ?? null
}

function upsertRow(logicalTable: string, key: string, op: OutboxRow['op'], payload: string | null, payloadHash: string | null): void {
  db()
    .prepare(
      `INSERT INTO search_outbox (logical_table, key, op, payload, payload_hash, attempts, transient_attempts, next_attempt_at, status, last_error, enqueued_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, 'pending', NULL, ?)
       ON CONFLICT (logical_table, key) DO UPDATE SET
         op = excluded.op,
         payload = excluded.payload,
         payload_hash = excluded.payload_hash,
         attempts = 0,
         transient_attempts = 0,
         next_attempt_at = 0,
         status = 'pending',
         last_error = NULL,
         enqueued_at = excluded.enqueued_at`,
    )
    .run(logicalTable, key, op, payload, payloadHash, Date.now())
}

/** Journal an index write. Resolves once the row is durable. */
export function enqueueIndex(logicalTable: string, key: string, doc: Document): void {
  const hash = hashPayload(doc)
  const existing = getRow(logicalTable, key)
  if (!existing) {
    const acked = db()
      .prepare<{ payload_hash: string }, [string, string]>(
        'SELECT payload_hash FROM search_acked WHERE logical_table = ? AND key = ?',
      )
      .get(logicalTable, key)
    // Same content already in the engine and nothing in flight → no-op.
    // This one mechanism replaces every per-plugin boot dedupe cache.
    if (acked && acked.payload_hash === hash) return
  }
  upsertRow(logicalTable, key, 'index', JSON.stringify(doc), hash)
}

/** Journal a removal. Replaces any pending write for the key. */
export function enqueueRemove(logicalTable: string, key: string): void {
  upsertRow(logicalTable, key, 'remove', null, null)
}

/** Apply transform ops to a document (shared by merge-at-enqueue + drain). */
export function applyTransformOps(doc: Document, ops: SearchTransformOp[]): Document {
  const next: Document = { ...doc }
  for (const op of ops) {
    if (!op.field) continue
    if (op.op === '$set') {
      next[op.field] = op.value
    } else if (op.op === '$inc') {
      const current = typeof next[op.field] === 'number' ? (next[op.field] as number) : 0
      const delta = typeof op.value === 'number' ? op.value : 0
      next[op.field] = current + delta
    } else if (op.op === '$push') {
      const current = Array.isArray(next[op.field]) ? (next[op.field] as unknown[]) : []
      next[op.field] = [...current, op.value]
    }
  }
  return next
}

/**
 * Journal a partial update. Merges into a pending index payload when one
 * exists (stays one row); appends to a pending transform; is dropped on a
 * pending remove (the doc is going away).
 */
export function enqueueTransform(logicalTable: string, key: string, ops: SearchTransformOp[]): void {
  if (ops.length === 0) return
  const existing = getRow(logicalTable, key)
  if (existing?.op === 'remove' && existing.status !== 'quarantined') return
  if (existing?.op === 'index' && existing.payload) {
    const merged = applyTransformOps(JSON.parse(existing.payload) as Document, ops)
    upsertRow(logicalTable, key, 'index', JSON.stringify(merged), hashPayload(merged))
    return
  }
  if (existing?.op === 'transform' && existing.payload && existing.status !== 'quarantined') {
    const mergedOps = [...(JSON.parse(existing.payload) as SearchTransformOp[]), ...ops]
    upsertRow(logicalTable, key, 'transform', JSON.stringify(mergedOps), null)
    return
  }
  upsertRow(logicalTable, key, 'transform', JSON.stringify(ops), null)
}

function ackSuccess(row: OutboxRow): void {
  store.withTx(() => {
    db().prepare('DELETE FROM search_outbox WHERE id = ?').run(row.id)
    if (row.op === 'index' && row.payload_hash) {
      db()
        .prepare(
          `INSERT INTO search_acked (logical_table, key, payload_hash, acked_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (logical_table, key) DO UPDATE SET
             payload_hash = excluded.payload_hash,
             acked_at = excluded.acked_at`,
        )
        .run(row.logical_table, row.key, row.payload_hash, Date.now())
    } else {
      // remove: content gone; transform: engine content no longer matches any
      // recorded hash — drop the ack so future identical re-index isn't skipped.
      db().prepare('DELETE FROM search_acked WHERE logical_table = ? AND key = ?').run(row.logical_table, row.key)
    }
  })
}

function backoffAt(failures: number): number {
  return Date.now() + BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1]
}

function markTransient(row: OutboxRow, message: string): void {
  db()
    .prepare(
      `UPDATE search_outbox SET status = 'pending', transient_attempts = transient_attempts + 1,
         next_attempt_at = ?, last_error = ? WHERE id = ?`,
    )
    .run(backoffAt(row.transient_attempts + 1), message, row.id)
}

function markPermanent(row: OutboxRow, message: string): void {
  const attempts = row.attempts + 1
  const quarantine = attempts >= QUARANTINE_AFTER_ATTEMPTS
  if (quarantine) {
    log.warn('outbox row quarantined', { table: row.logical_table, key: row.key, attempts, error: message })
  }
  db()
    .prepare(
      `UPDATE search_outbox SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?`,
    )
    .run(quarantine ? 'quarantined' : 'pending', attempts, quarantine ? 0 : backoffAt(attempts), message, row.id)
}

/**
 * One drain cycle: reset stale inflight rows (crash recovery — single
 * process, so any inflight row at cycle start is orphaned), claim a batch,
 * land it, ack/park each row. Returns a report for the loop/telemetry.
 */
export async function drainOnce(target: OutboxDrainTarget, opts?: { ignoreBackoff?: boolean }): Promise<DrainReport> {
  const report: DrainReport = { processed: 0, failedTransient: 0, failedPermanent: 0 }
  const now = Date.now()

  db().prepare("UPDATE search_outbox SET status = 'pending' WHERE status = 'inflight'").run()

  const rows = db()
    .prepare<OutboxRow, [number, number]>(
      `SELECT * FROM search_outbox WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT ?`,
    )
    .all(opts?.ignoreBackoff ? Number.MAX_SAFE_INTEGER : now, CLAIM_BATCH)
  if (rows.length === 0) return report

  const claim = db().prepare("UPDATE search_outbox SET status = 'inflight' WHERE id = ?")
  for (const row of rows) claim.run(row.id)

  // Group index/remove rows per logical table for batch calls; transforms
  // run per-row (they read-modify-write on the engine side).
  const byTable = new Map<string, OutboxRow[]>()
  for (const row of rows) {
    const group = byTable.get(row.logical_table) ?? []
    group.push(row)
    byTable.set(row.logical_table, group)
  }

  for (const [logical, group] of byTable) {
    const targets = target.resolveTargets(logical)
    const indexRows = group.filter((r) => r.op === 'index')
    const removeRows = group.filter((r) => r.op === 'remove')
    const transformRows = group.filter((r) => r.op === 'transform')

    if (indexRows.length > 0) {
      const items = indexRows.map((r) => ({ key: r.key, doc: JSON.parse(r.payload ?? '{}') as Document }))
      const failedKeys = new Map<string, string>()
      let batchError: unknown = null
      for (const physical of targets) {
        try {
          const result = await target.adapter.documents.batchIndex(physical, items)
          for (const f of result.failed) failedKeys.set(f.key, f.error)
        } catch (err) {
          batchError = err
          break
        }
      }
      for (const row of indexRows) {
        if (batchError) {
          if (isEngineUnavailable(batchError) || isMissingTable(batchError)) {
            markTransient(row, (batchError as Error).message)
            report.failedTransient++
          } else {
            markPermanent(row, batchError instanceof Error ? batchError.message : String(batchError))
            report.failedPermanent++
          }
        } else if (failedKeys.has(row.key)) {
          markPermanent(row, failedKeys.get(row.key) ?? 'batch item failed')
          report.failedPermanent++
        } else {
          ackSuccess(row)
          report.processed++
        }
      }
    }

    if (removeRows.length > 0) {
      try {
        for (const physical of targets) {
          await target.adapter.documents.batchRemove(physical, removeRows.map((r) => r.key))
        }
        for (const row of removeRows) {
          ackSuccess(row)
          report.processed++
        }
      } catch (err) {
        for (const row of removeRows) {
          if (isEngineUnavailable(err) || isMissingTable(err)) {
            markTransient(row, (err as Error).message)
            report.failedTransient++
          } else {
            markPermanent(row, err instanceof Error ? err.message : String(err))
            report.failedPermanent++
          }
        }
      }
    }

    for (const row of transformRows) {
      const ops = JSON.parse(row.payload ?? '[]') as SearchTransformOp[]
      try {
        for (const physical of targets) {
          await target.adapter.documents.transform(physical, row.key, (doc) => applyTransformOps(doc, ops))
        }
        ackSuccess(row)
        report.processed++
      } catch (err) {
        if (isEngineUnavailable(err) || isMissingTable(err)) {
          markTransient(row, (err as Error).message)
          report.failedTransient++
        } else {
          markPermanent(row, err instanceof Error ? err.message : String(err))
          report.failedPermanent++
        }
      }
    }
  }

  return report
}

export function outboxStats(): OutboxStats {
  const counts = db()
    .prepare<{ status: string; n: number }, []>('SELECT status, COUNT(*) AS n FROM search_outbox GROUP BY status')
    .all()
  const byStatus = new Map(counts.map((c) => [c.status, c.n]))
  const oldest = db()
    .prepare<{ oldest: number | null }, []>("SELECT MIN(enqueued_at) AS oldest FROM search_outbox WHERE status = 'pending'")
    .get()
  return {
    pending: byStatus.get('pending') ?? 0,
    inflight: byStatus.get('inflight') ?? 0,
    quarantined: byStatus.get('quarantined') ?? 0,
    oldestPendingEnqueuedAt: oldest?.oldest ?? null,
  }
}

/** Revive quarantined rows (doctor repair / `bakin search retry`). */
export function retryQuarantined(): number {
  const result = db()
    .prepare("UPDATE search_outbox SET status = 'pending', attempts = 0, next_attempt_at = 0 WHERE status = 'quarantined'")
    .run()
  return result.changes
}

export function listQuarantined(limit = 50): Array<{ logicalTable: string; key: string; lastError: string | null }> {
  return db()
    .prepare<{ logical_table: string; key: string; last_error: string | null }, [number]>(
      "SELECT logical_table, key, last_error FROM search_outbox WHERE status = 'quarantined' ORDER BY id LIMIT ?",
    )
    .all(limit)
    .map((r) => ({ logicalTable: r.logical_table, key: r.key, lastError: r.last_error }))
}

/** Test-only: simulate a crash that left a row inflight. */
export function markInflightForTests(logicalTable: string, key: string): void {
  db().prepare("UPDATE search_outbox SET status = 'inflight' WHERE logical_table = ? AND key = ?").run(logicalTable, key)
}

/**
 * Test-only: wipe both tables. Closes the handle first — tests rm/recreate
 * their temp dirs between cases, and a cached handle over a deleted inode
 * throws disk-I/O errors (the SQLITE_IOERR_VNODE class from CLAUDE.md).
 */
export function resetOutboxForTests(): void {
  store.close()
  db().exec('DELETE FROM search_outbox; DELETE FROM search_acked;')
}
