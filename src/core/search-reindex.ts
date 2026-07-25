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
import { getSettings } from './settings'

export async function getSearchHealth(): Promise<SearchHealthSnapshot> {
  const registry = getRegistry()
  const search = getSearchAdapter()

  // `enabled` reflects the SETTING; engine liveness is `engineReachable`.
  // These were conflated until rc.22 — an unreachable engine reported
  // "search disabled, no tables registered", which told an operator with a
  // crash-looping engine that nothing was even configured (Margo's-box
  // incident, 2026-07-21). Unreachable now still lists every registry
  // table from local state, with null docCount and empty legs.
  if (!getSettings().search.settings.enabled) {
    return { enabled: false, engineReachable: false, tables: [] }
  }

  const isAvailable = await search.available()
  if (!isAvailable) {
    const journal = outboxStats()
    const tables: SearchHealthTable[] = []
    for (const [tableName, def] of registry.contentTypes) {
      const state = tableStatus(tableName)
      const lastAcked = lastAckedAtForTable(tableName)
      const lastRebuildAt = state?.updatedAt ?? null
      tables.push({
        logical: tableName,
        physical: state?.physical ?? resolvePhysicalTable(tableName),
        schemaVersion: state?.schemaVersion ?? def.schemaVersion ?? 1,
        state: state?.state ?? 'active',
        phase: state?.phase ?? null,
        pluginId: def.pluginId,
        docCount: null,
        lastIndexedAt: lastAcked !== null || lastRebuildAt !== null
          ? Math.max(lastAcked ?? 0, lastRebuildAt ?? 0)
          : null,
        lastRebuildAt,
        journalPending: pendingCountForTable(tableName),
        legs: [],
        healthy: false,
      })
    }
    return {
      enabled: true,
      engineReachable: false,
      outbox: {
        pending: journal.pending,
        quarantined: journal.quarantined,
        oldestPendingAt: journal.oldestPendingEnqueuedAt,
      },
      tables,
    }
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
    engineReachable: true,
    outbox: {
      pending: journal.pending,
      quarantined: journal.quarantined,
      oldestPendingAt: journal.oldestPendingEnqueuedAt,
    },
    tables,
  }
}
