/**
 * Search health snapshot — blue/green table state + per-leg index health +
 * outbox journal depth, read straight from the registry and the adapter's
 * status surfaces (never a query; queries can hang during backfill).
 * Consumed by ctx.search.health(), the health plugin's search-status
 * route, and the doctor.
 *
 * Rebuilds live in search-registry-core (`rebuildRegisteredTables`, the
 * blue/green path behind /api/reindex).
 */
import type { SearchHealthSnapshot, SearchHealthTable } from '../../packages/core/src/plugin-types'
import { tableStatus } from '@bakin/core/search/tables'
import { lastAckedAtForTable, pendingCountForTable } from '@bakin/core/search/outbox'
import { getRegistry, getSearchAdapter, resolvePhysicalTable } from './search-registry-core'
import { outboxStats } from './search-outbox'

export async function getSearchHealth(): Promise<SearchHealthSnapshot> {
  const registry = getRegistry()
  const search = getSearchAdapter()
  const isAvailable = await search.available()

  if (!isAvailable) {
    return { enabled: false, tables: [] }
  }

  const tables: SearchHealthTable[] = []
  for (const [tableName, def] of registry.contentTypes) {
    const state = tableStatus(tableName)
    const physical = state?.physical ?? resolvePhysicalTable(tableName)

    let docCount: number | null = null
    try {
      const stats = await search.tables.stats(physical)
      docCount = stats?.documents ?? null
    } catch { /* stats unavailable */ }

    let legs: SearchHealthTable['legs'] = []
    let healthy = true
    try {
      const legHealth = await search.tables.health(physical)
      legs = legHealth.map((leg) => ({
        name: leg.leg,
        totalIndexed: leg.indexedCount,
        rebuilding: leg.state === 'building',
        ...(leg.pendingCount !== undefined ? { pending: leg.pendingCount } : {}),
        ...(leg.error ? { error: leg.error } : {}),
      }))
      healthy = legHealth.every((leg) => leg.state !== 'error')
    } catch { /* leg health unavailable — default to healthy */ }

    // Freshness: the newest of the last delivered journal write and the
    // last registry transition (create/rebuild seed bypasses the journal).
    const lastAcked = lastAckedAtForTable(tableName)
    const lastRebuildAt = state?.updatedAt ?? null
    tables.push({
      logical: tableName,
      physical,
      schemaVersion: state?.schemaVersion ?? def.schemaVersion ?? 1,
      state: state?.state ?? 'active',
      phase: state?.phase ?? null,
      pluginId: def.pluginId,
      docCount,
      lastIndexedAt: lastAcked !== null || lastRebuildAt !== null
        ? Math.max(lastAcked ?? 0, lastRebuildAt ?? 0)
        : null,
      lastRebuildAt,
      journalPending: pendingCountForTable(tableName),
      legs,
      healthy,
    })
  }

  const journal = outboxStats()
  return {
    enabled: true,
    outbox: {
      pending: journal.pending,
      quarantined: journal.quarantined,
      oldestPendingAt: journal.oldestPendingEnqueuedAt,
    },
    tables,
  }
}
