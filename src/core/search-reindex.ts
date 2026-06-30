/**
 * Search reindex + health — re-runs each content type's reindex() generator
 * into its table, and reports per-table enrichment/index health. Builds on
 * search-registry-core; surfaced through the search-registry barrel.
 */
import type {
  SearchContentTypeDefinition,
  SearchHealthSnapshot,
} from '../../packages/core/src/plugin-types'
import type { TableHealth } from '@bakin/core/adapters/search'
import { broadcast } from './sse'
import { createLogger } from './logger'
import { cleanupTableOrphans } from './search-cleanup'
import {
  ensureRegisteredTables,
  fullTableName,
  getRegistry,
  getSearchAdapter,
} from './search-registry-core'

const log = createLogger('search-reindex')

export interface ReindexTableResult {
  table: string
  pluginId: string
  indexed: number
  error?: string
  enrichment?: SearchEnrichmentHealth
  verified?: number
  verifyDiscrepancy?: number
}

export interface SearchEnrichmentHealth {
  indexes: Array<{
    name: string
    type: string
    totalIndexed: number
    walBacklog: number
    error?: string
    rebuilding: boolean
    backfillProgress?: number
  }>
  healthy: boolean
}

function searchEnrichmentFromTableHealth(health: TableHealth | null): SearchEnrichmentHealth | undefined {
  const details = health?.details as Partial<SearchEnrichmentHealth> | undefined
  if (!details || !Array.isArray(details.indexes)) return undefined
  return {
    indexes: details.indexes,
    healthy: typeof details.healthy === 'boolean' ? details.healthy : health?.status === 'ok',
  }
}

/**
 * Reindex all (or one) registered content types by running their reindex() generators.
 * Returns per-table counts.
 *
 * Self-heals: ensures every registered table actually exists in the
 * search backend before iterating. If the backend was wiped or restarted
 * since Bakin last ran createRegisteredTables, this transparently
 * recreates the missing tables instead of silently writing to nothing.
 *
 * Broadcasts two channels of events:
 *   - Per-table: reindex.start / reindex.progress / reindex.complete
 *     (drives the Health page tiles)
 *   - Aggregate: reindex.batch_start / reindex.batch_pulse / reindex.batch_complete
 *     (drives a single Live Activity entry instead of one per table)
 */
export async function reindexContentTypes(opts?: {
  table?: string
  rebuild?: boolean
  verify?: boolean
}): Promise<ReindexTableResult[]> {
  const registry = getRegistry()
  const search = getSearchAdapter()
  const results: ReindexTableResult[] = []

  // Self-heal: make sure tables exist in the search backend before we try
  // to write to them. Cheap when nothing's missing (one list call);
  // critical when the backend was wiped externally. Per-table failures
  // surface as reindex results below so the API caller sees the real
  // reason instead of a misleading `indexed: 0`.
  const failedTables = new Map<string, string>()
  try {
    const ensured = await ensureRegisteredTables()
    if (ensured.created > 0) log.info(`Reindex auto-created ${ensured.created} missing table(s)`)
    for (const f of ensured.failures) failedTables.set(f.table, f.error)
  } catch (err) {
    log.warn('ensureRegisteredTables failed before reindex', err)
  }

  // Build the list of tables we'll actually process so the aggregate
  // events can include accurate totals.
  const tablesToProcess: Array<[string, SearchContentTypeDefinition & { pluginId: string }]> = []
  for (const [tableName, def] of registry.contentTypes) {
    if (opts?.table && tableName !== fullTableName(opts.table) && opts.table !== def.table && opts.table !== def.pluginId) {
      continue
    }
    tablesToProcess.push([tableName, def])
  }

  const startedAt = Date.now()
  let totalIndexed = 0
  let tablesDone = 0

  broadcast({
    type: 'reindex.batch_start',
    tables: tablesToProcess.length,
    scope: opts?.table ?? 'all',
  })

  // Periodic pulse so long-running reindexes show life in the activity
  // feed without spamming once per table. 60s cadence — short reindexes
  // finish before the first pulse and only emit start + complete.
  const PULSE_MS = 60_000
  const pulseTimer = setInterval(() => {
    broadcast({
      type: 'reindex.batch_pulse',
      tables_done: tablesDone,
      tables_total: tablesToProcess.length,
      indexed: totalIndexed,
      elapsed_ms: Date.now() - startedAt,
    })
  }, PULSE_MS)

  try {
    for (const [tableName, def] of tablesToProcess) {
      // If ensureRegisteredTables couldn't create this table, skip the
      // reindex generator entirely and surface the actual reason instead
      // of writing 0 docs to a non-existent table.
      const ensureError = failedTables.get(tableName)
      if (ensureError) {
        results.push({ table: tableName, pluginId: def.pluginId, indexed: 0, error: ensureError })
        broadcast({ type: 'reindex.complete', table: tableName, pluginId: def.pluginId, indexed: 0, error: ensureError })
        tablesDone++
        continue
      }
      try {
        // Rebuild indexes if requested
        if (opts?.rebuild) {
          await search.tables.rebuildIndexes(tableName)
          log.info(`Rebuilt indexes for ${tableName}`)
        }

        // Run the reindex generator
        let count = 0
        if (def.reindex) {
          broadcast({ type: 'reindex.start', table: tableName, pluginId: def.pluginId })

          const BATCH_SIZE = 50
          const batch: Array<{ key: string; doc: Record<string, unknown> }> = []
          for await (const { key, doc } of def.reindex()) {
            batch.push({ key, doc: doc as Record<string, unknown> })
            if (batch.length >= BATCH_SIZE) {
              count += (await search.documents.batchIndex(tableName, batch)).indexed
              batch.length = 0
              broadcast({ type: 'reindex.progress', table: tableName, pluginId: def.pluginId, indexed: count })
            }
          }
          if (batch.length > 0) {
            count += (await search.documents.batchIndex(tableName, batch)).indexed
            broadcast({ type: 'reindex.progress', table: tableName, pluginId: def.pluginId, indexed: count })
          }
        }

        broadcast({ type: 'reindex.complete', table: tableName, pluginId: def.pluginId, indexed: count })

        // Remove docs whose source no longer exists, so a reindex leaves the
        // index in sync with the source instead of accumulating stale orphans
        // (the watcher unlink hook is the primary path; this closes the gap for
        // deletes that the watcher missed — e.g. while the process was down).
        try {
          await cleanupTableOrphans(tableName, def)
        } catch (err) {
          log.warn(`Orphan cleanup during reindex failed for ${tableName}`, err)
        }

        // Enrichment audit — poll index health after all batches complete.
        // Best-effort: never fails the reindex, just surfaces what the adapter reports.
        const result: ReindexTableResult = { table: tableName, pluginId: def.pluginId, indexed: count }
        try {
          const health = searchEnrichmentFromTableHealth(await search.tables.getHealth(tableName))
          if (health) {
            result.enrichment = health
            if (!health.healthy) {
              for (const idx of health.indexes) {
                if (idx.error) {
                  log.error(`Enrichment error in ${tableName}/${idx.name}: ${idx.error}`)
                }
                if (idx.walBacklog > 0) {
                  log.warn(`Enrichment pending in ${tableName}/${idx.name}: ${idx.walBacklog} docs in WAL`)
                }
              }
            }
          }
        } catch (err) {
          log.warn(`Enrichment audit failed for ${tableName}`, err)
        }

        // Verify pass — opt-in re-query to check how many docs are actually findable.
        if (opts?.verify && count > 0) {
          try {
            const stats = await search.tables.stats(tableName)
            const docCount = stats?.documents ?? 0
            result.verified = docCount
            result.verifyDiscrepancy = count - docCount
            if (result.verifyDiscrepancy !== 0) {
              log.error(`Verify discrepancy in ${tableName}: indexed ${count} but ${docCount} findable (delta: ${result.verifyDiscrepancy})`)
            }
          } catch (err) {
            log.warn(`Verify pass failed for ${tableName}`, err)
          }
        }

        results.push(result)
        totalIndexed += count
      } catch (err) {
        results.push({ table: tableName, pluginId: def.pluginId, indexed: 0, error: String(err) })
        log.error(`Reindex failed for ${tableName}`, err)
      }
      tablesDone++
    }
  } finally {
    clearInterval(pulseTimer)
  }

  broadcast({
    type: 'reindex.batch_complete',
    tables: tablesToProcess.length,
    indexed: totalIndexed,
    elapsed_ms: Date.now() - startedAt,
  })

  return results
}

/**
 * Get health/stats for all registered search tables, including per-index
 * enrichment status from getIndexHealth().
 */
export async function getSearchHealth(): Promise<SearchHealthSnapshot> {
  const registry = getRegistry()
  const search = getSearchAdapter()
  const isAvailable = await search.available()

  if (!isAvailable) {
    return { enabled: false, tables: [] }
  }

  const tables: Array<{
    table: string
    pluginId: string
    stats: Record<string, unknown> | null
    indexHealth?: SearchEnrichmentHealth['indexes']
    healthy: boolean
  }> = []

  for (const [tableName, def] of registry.contentTypes) {
    let stats: Record<string, unknown> | null = null
    try {
      stats = await search.tables.stats(tableName) as Record<string, unknown> | null
    } catch { /* stats unavailable */ }

    let indexHealth: SearchEnrichmentHealth['indexes'] | undefined
    let healthy = true
    try {
      const health = searchEnrichmentFromTableHealth(await search.tables.getHealth(tableName))
      if (health) {
        indexHealth = health.indexes
        healthy = health.healthy
      }
    } catch { /* index health unavailable — default to healthy */ }

    tables.push({ table: tableName, pluginId: def.pluginId, stats, indexHealth, healthy })
  }

  return { enabled: true, tables }
}
