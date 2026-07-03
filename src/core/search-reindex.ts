/**
 * Search health snapshot — per-table stats + per-leg index health, read
 * straight from the adapter's status surfaces (never a query; queries can
 * hang during backfill). Consumed by ctx.search.health(), the health
 * plugin's search-status route, and the doctor.
 *
 * Rebuilds live in search-registry-core (`rebuildRegisteredTables`, the
 * blue/green path behind /api/reindex).
 */
import type { SearchHealthSnapshot, SearchHealthTable } from '../../packages/core/src/plugin-types'
import { getRegistry, getSearchAdapter, resolvePhysicalTable } from './search-registry-core'

export async function getSearchHealth(): Promise<SearchHealthSnapshot> {
  const registry = getRegistry()
  const search = getSearchAdapter()
  const isAvailable = await search.available()

  if (!isAvailable) {
    return { enabled: false, tables: [] }
  }

  const tables: SearchHealthTable[] = []
  for (const [tableName, def] of registry.contentTypes) {
    const physical = resolvePhysicalTable(tableName)

    let stats: Record<string, unknown> | null = null
    try {
      stats = await search.tables.stats(physical) as Record<string, unknown> | null
    } catch { /* stats unavailable */ }

    let indexHealth: SearchHealthTable['indexHealth']
    let healthy = true
    try {
      const legs = await search.tables.health(physical)
      if (legs.length > 0) {
        indexHealth = legs.map((leg) => ({
          name: leg.leg,
          totalIndexed: leg.indexedCount,
          rebuilding: leg.state === 'building',
          ...(leg.error ? { error: leg.error } : {}),
        }))
        healthy = legs.every((leg) => leg.state !== 'error')
      }
    } catch { /* leg health unavailable — default to healthy */ }

    tables.push({ table: tableName, pluginId: def.pluginId, stats, indexHealth, healthy })
  }

  return { enabled: true, tables }
}
