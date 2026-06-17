/**
 * Cross-table search — queries one or all registered content types and merges
 * results. Builds on search-registry-core; surfaced through the search-registry
 * barrel.
 */
import type { SearchResponse } from '../../packages/core/src/plugin-types'
import {
  TABLE_PREFIX,
  adapterHitToPluginResult,
  filtersFromRecord,
  fullTableName,
  getIndexNames,
  getRegistry,
  getRerankField,
  getSearchAdapter,
  mapFacetCounts,
} from './search-registry-core'

/**
 * Cross-table search using multiQuery.
 * Queries all registered content types (or a specific one) and merges results.
 */
export async function crossTableSearch(q: string, opts?: {
  table?: string
  limit?: number
  offset?: number
  filters?: Record<string, string | boolean | number>
  facets?: string[]
}): Promise<SearchResponse> {
  const search = getSearchAdapter()
  if (!await search.available()) {
    return { results: [], meta: { query: q, total: 0, took_ms: 0, source: 'fallback' } }
  }

  const registry = getRegistry()
  const limit = opts?.limit ?? 20

  // Single-table search
  if (opts?.table) {
    const tableName = fullTableName(opts.table)
    const def = registry.contentTypes.get(tableName)
    if (!def) {
      // Try matching by pluginId
      const resolved = registry.pluginTables.get(opts.table)
      if (!resolved) {
        return { results: [], meta: { query: q, total: 0, took_ms: 0, source: 'search' } }
      }
      return crossTableSearch(q, { ...opts, table: resolved.replace(TABLE_PREFIX, '') })
    }

    const result = await search.query(tableName, {
      text: q,
      limit,
      offset: opts?.offset,
      filters: filtersFromRecord(opts?.filters),
      facets: opts?.facets ?? def.facets,
      adapterOptions: {
        indexes: getIndexNames(tableName),
        rerankField: getRerankField(tableName),
      },
    })

    return {
      results: result.hits.map((hit) => ({ ...adapterHitToPluginResult(hit, tableName), _table: tableName })),
      aggregations: mapFacetCounts(result.facets),
      rawAggregations: result.aggregations,
      meta: { query: q, total: result.total ?? result.hits.length, took_ms: result.diagnostics?.durationMs ?? 0, source: 'search' },
    }
  }

  // Cross-table search via multiQuery
  const tables = Array.from(registry.contentTypes.keys())
  if (tables.length === 0) {
    return { results: [], meta: { query: q, total: 0, took_ms: 0, source: 'search' } }
  }

  const perTableLimit = Math.ceil(limit / tables.length)
  const results = await search.multiQuery(tables.map((table) => ({
    table,
    query: {
      text: q,
      limit: perTableLimit,
      filters: filtersFromRecord(opts?.filters),
      adapterOptions: {
        indexes: getIndexNames(table),
        rerankField: getRerankField(table),
      },
    },
  })))
  const hits = results.flatMap((result, index) => result.hits.map((hit) => adapterHitToPluginResult(hit, tables[index])))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  return {
    results: hits,
    meta: {
      query: q,
      total: results.reduce((sum, result) => sum + (result.total ?? result.hits.length), 0),
      took_ms: Math.max(0, ...results.map((result) => result.diagnostics?.durationMs ?? 0)),
      source: 'search',
    },
  }
}
