/**
 * Memory-plugin-owned doctor check.
 *
 * Migrated out of src/core/doctor.ts (#139 C5) — verifies registered
 * search tables have stats / non-empty doc counts. Runs only when
 * search is enabled and connected; otherwise returns no rows.
 *
 * Memory plugin owns search infrastructure (per CLAUDE.md: "Memory
 * plugin owns the unified bakin_memory table"), so search-table
 * health belongs here.
 *
 * Registered in plugins/memory/index.ts activate() via
 * ctx.registerHealthCheck. runDiagnostics() picks it up through the
 * plugin-check loop in src/core/doctor.ts's runPluginHealthChecks().
 */
import { getSettings } from '../../../src/core/settings'
import type { HealthCheckResult } from '../../../packages/core/src/plugin-types'

// ─── Result constructors (inlined; matches workflows precedent) ─────────────

function ok(check: string, message: string): HealthCheckResult {
  return { check, status: 'ok', message, autoFixable: false }
}
function warn(check: string, message: string, autoFixable = false): HealthCheckResult {
  return { check, status: 'warn', message, autoFixable }
}
function error(check: string, message: string): HealthCheckResult {
  return { check, status: 'error', message, autoFixable: false }
}

// ─── Search tables: registered content types have stats / non-empty docs ──

/**
 * Verify registered content types have readable table stats.
 * Returns no rows when search is disabled or unreachable.
 */
export async function checkSearchTables(): Promise<HealthCheckResult[]> {
  const settings = getSettings()
  if (!settings.antfly.enabled) return []

  try {
    const { getSearchHealth } = await import('../../../src/core/search-registry')
    const health = await getSearchHealth()

    if (!health.enabled) return []

    const results: HealthCheckResult[] = []

    if (health.tables.length === 0) {
      results.push(warn('search-tables', 'Search enabled but no content types registered — plugins may not have activated'))
      return results
    }

    let failedTables = 0

    for (const t of health.tables) {
      if (!t.stats) {
        failedTables++
        results.push(warn('search-tables', `Table "${t.table}" (${t.pluginId}) — stats unavailable, but table is registered${t.healthy ? ' and indexes look healthy' : ''}`))
        continue
      }

      const statRecord = t.stats as Record<string, unknown>
      const rawNumDocs = Number(statRecord.documents ?? statRecord.num_docs)
      if (Number.isFinite(rawNumDocs)) {
        if (rawNumDocs === 0) {
          if (t.pluginId === 'schedule') {
            results.push(ok('search-tables', `Table "${t.table}" (${t.pluginId}) has 0 persisted documents; schedule jobs are indexed at runtime`))
          } else {
            results.push(ok('search-tables', `Table "${t.table}" (${t.pluginId}) has 0 documents — reindex via POST /api/reindex?table=${t.table}`))
          }
        }
        continue
      }

      const storage = (t.stats as Record<string, unknown>).storage_status as Record<string, unknown> | undefined
      if (storage?.empty === true) {
        results.push(ok('search-tables', `Table "${t.table}" (${t.pluginId}) appears empty — reindex via POST /api/reindex?table=${t.table}`))
      }
    }

    if (results.length === 0) {
      const totals = health.tables
        .map(t => Number((t.stats as Record<string, unknown>)?.num_docs))
        .filter(n => Number.isFinite(n))

      if (totals.length > 0) {
        const total = totals.reduce((sum, n) => sum + n, 0)
        results.push(ok('search-tables', `${health.tables.length} tables, ${total} total documents indexed`))
      } else if (failedTables > 0) {
        results.push(warn('search-tables', `${health.tables.length} tables registered; ${failedTables} table stats unavailable, but registry metadata is readable`))
      } else {
        results.push(ok('search-tables', `${health.tables.length} tables registered; table metadata readable (document counts unavailable from current Antfly API)`))
      }
    }

    return results
  } catch (err) {
    return [error('search-tables', `Failed to check search tables: ${err}`)]
  }
}
