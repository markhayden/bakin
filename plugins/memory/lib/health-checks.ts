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
import type { HealthCheckResult, SearchHealthSnapshot } from '../../../packages/core/src/plugin-types'
import { healthOk as ok, healthWarn as warn, healthError as error } from '@makinbakin/sdk/utils'

// ─── Result constructors (inlined; matches workflows precedent) ─────────────


// ─── Search tables: registered content types have stats / non-empty docs ──

/**
 * Verify registered content types have readable table stats.
 * Returns no rows when search is disabled or unreachable.
 */
export async function checkSearchTables(
  readSearchHealth?: () => Promise<SearchHealthSnapshot>,
): Promise<HealthCheckResult[]> {
  const settings = getSettings()
  if (!settings.search.settings.enabled) return []

  try {
    if (!readSearchHealth) {
      return [warn('search-tables', 'Search health API unavailable — cannot inspect registered content type stats')]
    }

    const health = await readSearchHealth()

    if (!health.enabled) return []

    const results: HealthCheckResult[] = []

    if (health.tables.length === 0) {
      results.push(warn('search-tables', 'Search enabled but no content types registered — plugins may not have activated'))
      return results
    }

    let failedTables = 0

    for (const t of health.tables) {
      if (t.docCount === null) {
        failedTables++
        results.push(warn('search-tables', `Table "${t.logical}" (${t.pluginId}) — doc count unavailable, but table is registered${t.healthy ? ' and legs look healthy' : ''}`))
        continue
      }

      if (t.docCount === 0) {
        if (t.pluginId === 'schedule') {
          results.push(ok('search-tables', `Table "${t.logical}" (${t.pluginId}) has 0 persisted documents; schedule jobs are indexed at runtime`))
        } else {
          results.push(ok('search-tables', `Table "${t.logical}" (${t.pluginId}) has 0 documents — rebuild via POST /api/reindex?table=${t.logical}`))
        }
      }
    }

    if (results.length === 0) {
      const totals = health.tables
        .map(t => t.docCount)
        .filter((n): n is number => n !== null)

      if (totals.length > 0) {
        const total = totals.reduce((sum, n) => sum + n, 0)
        results.push(ok('search-tables', `${health.tables.length} tables, ${total} total documents indexed`))
      } else if (failedTables > 0) {
        results.push(warn('search-tables', `${health.tables.length} tables registered; ${failedTables} table stats unavailable, but registry metadata is readable`))
      } else {
        results.push(ok('search-tables', `${health.tables.length} tables registered; table metadata readable (document counts unavailable from current search adapter API)`))
      }
    }

    return results
  } catch (err) {
    return [error('search-tables', `Failed to check search tables: ${err}`)]
  }
}
