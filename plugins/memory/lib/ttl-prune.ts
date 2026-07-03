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
 * rows even with debug data) and the adapter scan is fast enough that a
 * full pass costs a few seconds once per day.
 */
import { createLogger } from '../../../src/core/logger'
import type { SearchAPI } from '@bakin/core/plugin-types'

const log = createLogger('memory:ttl-prune')

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
export async function pruneExpired(search: SearchAPI, config: TtlConfig): Promise<PruneStats> {
  const started = Date.now()
  const stats: PruneStats = { turn: 0, audit: 0, scanned: 0, tookMs: 0 }

  const maintenance = search.maintenance
  if (!maintenance || !await maintenance.available()) {
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
  for await (const { key, document: doc } of maintenance.scan({ fields: ['tier', 'updated_at'] })) {
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
      await maintenance.batchRemove(toDelete.splice(0))
    }
  }
  if (toDelete.length > 0) {
    await maintenance.batchRemove(toDelete)
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
// First prune runs well after boot, NOT at boot: pruning is a full-table
// scan, boot is exactly when antfly is busiest converging, and write-time
// TTL filtering already keeps expired rows from ever being (re)written.
// Rows aging past their window live at most this long extra — harmless.
export const TTL_FIRST_RUN_DELAY_MS = 60 * 60 * 1000

const timers = _g as typeof _g & {
  __bakinMemoryTtlFirstRun?: ReturnType<typeof setTimeout> | null
}

/** Start the prune timer: first run after a post-boot delay, then daily. Idempotent. */
export function startTtlTimer(search: SearchAPI, config: TtlConfig, intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (timers.__bakinMemoryTtlTimer) return
  const run = () => {
    pruneExpired(search, config).catch((err) => {
      log.warn('scheduled ttl prune failed', {
        err: err instanceof Error ? err.message : String(err),
      })
    })
  }
  timers.__bakinMemoryTtlFirstRun = setTimeout(run, Math.min(TTL_FIRST_RUN_DELAY_MS, intervalMs))
  timers.__bakinMemoryTtlFirstRun.unref?.()
  timers.__bakinMemoryTtlTimer = setInterval(run, intervalMs)
  log.info('memory ttl prune scheduled', {
    intervalHours: intervalMs / (60 * 60 * 1000),
    firstRunInMinutes: Math.min(TTL_FIRST_RUN_DELAY_MS, intervalMs) / 60_000,
    turnRetentionDays: config.turnRetentionDays ?? null,
    auditRetentionDays: config.auditRetentionDays ?? null,
  })
}

export function stopTtlTimer(): void {
  if (timers.__bakinMemoryTtlTimer) {
    clearInterval(timers.__bakinMemoryTtlTimer)
    timers.__bakinMemoryTtlTimer = null
  }
  if (timers.__bakinMemoryTtlFirstRun) {
    clearTimeout(timers.__bakinMemoryTtlFirstRun)
    timers.__bakinMemoryTtlFirstRun = null
  }
}
