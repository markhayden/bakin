/**
 * Orphan sweep — the doctor-scheduled deep-consistency backstop (D5).
 *
 * The primary consistency path is write-time: every mutation journals
 * through the outbox. This sweep catches the rare leftovers (deletes that
 * happened while Bakin was down, lost fs events) by checking each indexed
 * key against its content type's `verifyExists()`. It NEVER runs at boot —
 * the doctor invokes it on its own cadence, and `bakin reindex` remains
 * the explicit full repair.
 */
import { createLogger } from './logger'
import { getAppServices } from './app-services'
import { getContentTypes, resolvePhysicalTable } from './search-registry-core'

const log = createLogger('search-orphan-sweep')

const _g = globalThis as typeof globalThis & {
  __bakinOrphanSweepRunning?: boolean
}

export interface OrphanSweepStats {
  table: string
  scanned: number
  orphans: number
  errors: number
}

/**
 * Sweep ONE table: remove documents whose source no longer exists
 * (`def.verifyExists(key)` is false). No-op for types that can't verify.
 */
export async function sweepTableOrphans(
  tableName: string,
  def: { verifyExists?: (key: string) => Promise<boolean> },
): Promise<OrphanSweepStats> {
  const stats: OrphanSweepStats = { table: tableName, scanned: 0, orphans: 0, errors: 0 }
  if (typeof def.verifyExists !== 'function') return stats
  const verifyExists = def.verifyExists
  const search = getAppServices().search
  if (!await search.available()) return stats

  // A type whose registry row hasn't been ensured yet has no physical
  // table — scanning the logical name 404s. Skip quietly; the sweep runs
  // hourly and catches it next round.
  const { tableStatus } = await import('@bakin/core/search/tables')
  if (!tableStatus(tableName)) return stats

  const physical = resolvePhysicalTable(tableName)
  const orphanKeys: string[] = []
  for await (const { key } of search.scan(physical)) {
    stats.scanned++
    try {
      if (!await verifyExists(key)) {
        orphanKeys.push(key)
        stats.orphans++
      }
    } catch {
      stats.errors++
    }
    if (orphanKeys.length >= 100) {
      await search.documents.batchRemove(physical, orphanKeys.splice(0))
    }
  }
  if (orphanKeys.length > 0) {
    await search.documents.batchRemove(physical, orphanKeys)
  }
  if (stats.orphans > 0) {
    log.info(`Orphan sweep: ${tableName} — removed ${stats.orphans} orphan(s) of ${stats.scanned} scanned`)
  }
  return stats
}

/**
 * Sweep orphaned REGISTRY ROWS: `search_tables` entries whose logical
 * table has no live content-type registrant. These leak when a plugin is
 * removed without purge (pre-fix `purgeContentType` never deleted the
 * row) and would otherwise be resurrected as zombie engine tables by the
 * next rebuild pass. Drops the engine physicals (active + any migration
 * green), the registry row, and any journal rows. Returns the removed
 * logical names.
 */
export async function sweepOrphanRegistryRows(): Promise<string[]> {
  const search = getAppServices().search
  if (!await search.available()) return []
  const { listTableStates, removeTableRegistration, retireTablePhysical } = await import('@bakin/core/search/tables')
  const { purgeTable } = await import('@bakin/core/search/outbox')
  const registered = getContentTypes()
  const removed: string[] = []
  for (const row of listTableStates()) {
    if (registered.has(row.logical)) continue
    log.warn(`Orphan registry row: ${row.logical} has no live registrant — purging`, {
      physical: row.physical,
      migratingTo: row.migratingTo,
    })
    for (const physical of removeTableRegistration(row.logical)) {
      // Cold drop (antfly#386): tombstone; the dwell sweep does the DELETE.
      retireTablePhysical(physical)
    }
    purgeTable(row.logical)
    removed.push(row.logical)
  }
  return removed
}

/** Sweep every registered content type. Single-flight per process. */
export async function runOrphanSweep(): Promise<OrphanSweepStats[]> {
  if (_g.__bakinOrphanSweepRunning) {
    log.info('Orphan sweep already running — skipping')
    return []
  }
  _g.__bakinOrphanSweepRunning = true
  const allStats: OrphanSweepStats[] = []
  try {
    const search = getAppServices().search
    if (!await search.available()) return []
    for (const [tableName, def] of getContentTypes()) {
      try {
        allStats.push(await sweepTableOrphans(tableName, def))
      } catch (err) {
        log.error(`Orphan sweep failed for ${tableName}`, err)
        allStats.push({ table: tableName, scanned: 0, orphans: 0, errors: 1 })
      }
    }
    return allStats
  } finally {
    _g.__bakinOrphanSweepRunning = false
  }
}
