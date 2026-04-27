/**
 * Memory TTL pruner — daily delete of stale turn/audit rows.
 *
 * The indexer's write-time filter keeps new rows fresh; this scan catches
 * rows that were already indexed and have now aged out. Runs every 24h by
 * default, once at startup (after the migration + backfill settle) and
 * then on a timer. Only turn and audit are pruned — other tiers are bounded
 * by their own source-file count and don't need a retention window.
 *
 * Scan-and-delete is O(table) but the `bakin_memory` table is small (≤100k
 * rows even with debug data) and the scan runs at ~20k docs/sec over the
 * Antfly HTTP API, so a full pass costs a few seconds once per day.
 */
import { createLogger } from '../../../src/core/logger'
import { getSearchAdapter } from '../../../src/core/search-registry'

const log = createLogger('memory:ttl-prune')

const TABLE = 'bakin_memory'
const DAY_MS = 86_400_000
const BATCH_SIZE = 100

export interface TtlConfig {
  /** Delete turn rows with updated_at older than N days. 0/undefined disables. */
  turnRetentionDays?: number
  /** Delete audit rows with updated_at older than N days. 0/undefined disables. */
  auditRetentionDays?: number
}

export interface PruneStats {
  turn: number
  audit: number
  scanned: number
  tookMs: number
}

/**
 * Run a single prune pass. Returns counts of deleted rows by tier.
 * Safe to call multiple times — idempotent.
 */
export async function pruneExpired(config: TtlConfig): Promise<PruneStats> {
  const started = Date.now()
  const stats: PruneStats = { turn: 0, audit: 0, scanned: 0, tookMs: 0 }

  const search = getSearchAdapter()
  if (!await search.available()) {
    stats.tookMs = Date.now() - started
    return stats
  }

  const now = Date.now()
  const cutoffs: Record<string, number> = {}
  if (config.turnRetentionDays && config.turnRetentionDays > 0) {
    cutoffs.turn = now - config.turnRetentionDays * DAY_MS
  }
  if (config.auditRetentionDays && config.auditRetentionDays > 0) {
    cutoffs.audit = now - config.auditRetentionDays * DAY_MS
  }
  if (Object.keys(cutoffs).length === 0) {
    stats.tookMs = Date.now() - started
    return stats
  }

  const toDelete: string[] = []
  for await (const { key, document: doc } of search.scan(TABLE)) {
    stats.scanned += 1
    const tier = typeof doc.tier === 'string' ? doc.tier : ''
    const cutoff = cutoffs[tier]
    if (cutoff === undefined) continue
    const updatedAt = typeof doc.updated_at === 'number' ? doc.updated_at : 0
    if (updatedAt >= cutoff) continue
    toDelete.push(key)
    if (tier === 'turn') stats.turn += 1
    else if (tier === 'audit') stats.audit += 1
    if (toDelete.length >= BATCH_SIZE) {
      await search.documents.batchRemove(TABLE, toDelete.splice(0))
    }
  }
  if (toDelete.length > 0) {
    await search.documents.batchRemove(TABLE, toDelete)
  }

  stats.tookMs = Date.now() - started
  const logData = { ...stats } as Record<string, unknown>
  if (stats.turn || stats.audit) {
    log.info('ttl prune deleted expired rows', logData)
  } else {
    log.debug('ttl prune — nothing to delete', logData)
  }
  return stats
}

// ─── Timer ───────────────────────────────────────────────────────────────────

const _g = globalThis as typeof globalThis & {
  __bakinMemoryTtlTimer?: ReturnType<typeof setInterval> | null
}

const DEFAULT_INTERVAL_MS = DAY_MS

/** Start the daily prune timer. Idempotent — a second call is a no-op. */
export function startTtlTimer(config: TtlConfig, intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (_g.__bakinMemoryTtlTimer) return
  _g.__bakinMemoryTtlTimer = setInterval(() => {
    pruneExpired(config).catch((err) => {
      log.warn('scheduled ttl prune failed', {
        err: err instanceof Error ? err.message : String(err),
      })
    })
  }, intervalMs)
  log.info('memory ttl prune scheduled', {
    intervalHours: intervalMs / (60 * 60 * 1000),
    turnRetentionDays: config.turnRetentionDays ?? null,
    auditRetentionDays: config.auditRetentionDays ?? null,
  })
}

export function stopTtlTimer(): void {
  if (_g.__bakinMemoryTtlTimer) {
    clearInterval(_g.__bakinMemoryTtlTimer)
    _g.__bakinMemoryTtlTimer = null
  }
}
