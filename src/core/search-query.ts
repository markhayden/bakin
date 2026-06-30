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
  getSearchableFields,
  getIndexWeights,
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
        searchableFields: getSearchableFields(tableName),
        indexWeights: getIndexWeights(tableName),
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

  // Ask each table for up to the FULL limit, not limit/tables. The merge below
  // already takes the global top-N by score, so a per-table cap of 1 (the old
  // ceil(limit/tables)) forced "best hit from every table" instead of "best N
  // overall" — diluting a query that's only relevant to one table with one weak
  // hit from each of the others. A table can contribute at most `limit` to the
  // global top-`limit`, so `limit` is the correct, sufficient candidate pool.
  const perTableLimit = limit
  const results = await search.multiQuery(tables.map((table) => ({
    table,
    query: {
      text: q,
      limit: perTableLimit,
      filters: filtersFromRecord(opts?.filters),
      adapterOptions: {
        indexes: getIndexNames(table),
        rerankField: getRerankField(table),
        searchableFields: getSearchableFields(table),
        indexWeights: getIndexWeights(table),
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
