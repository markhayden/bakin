/**
 * Cross-table search — queries one or all registered content types and merges
 * results. Builds on search-registry-core; surfaced through the search-registry
 * barrel.
 */
import type { SearchResponse } from '../../packages/core/src/plugin-types'
import { getSettings } from './settings'
import { recordUsage } from './usage'
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
  resolvePhysicalTable,
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
  /** Restrict cross-table search to these content types (bare or full table names). */
  types?: string[]
}): Promise<SearchResponse> {
  // Telemetry rides the shared usage recorder — never a parallel store.
  const startedAt = Date.now()
  try {
    const response = await crossTableSearchInner(q, opts)
    recordUsage({
      kind: 'rest',
      activityClass: 'user',
      name: 'search.query',
      agent: null,
      durationMs: Date.now() - startedAt,
      status: response.meta.source === 'unavailable' ? 'error' : 'ok',
      meta: { scope: opts?.table ?? 'all' },
    })
    return response
  } catch (err) {
    recordUsage({ kind: 'rest', activityClass: 'user', name: 'search.query', agent: null, durationMs: Date.now() - startedAt, status: 'error' })
    throw err
  }
}

async function crossTableSearchInner(q: string, opts?: {
  table?: string
  limit?: number
  offset?: number
  filters?: Record<string, string | boolean | number>
  facets?: string[]
  types?: string[]
}): Promise<SearchResponse> {
  const search = getSearchAdapter()
  if (!await search.available()) {
    // Honest degradation (D11): the HTTP boundary maps this marker to a
    // 503 search_unavailable; server-side callers see structured empties.
    return { results: [], meta: { query: q, total: 0, took_ms: 0, source: 'unavailable' } }
  }

  const registry = getRegistry()
  const limit = opts?.limit ?? 20
  const deadlineMs = queryBudgetMs()

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
      return crossTableSearchInner(q, { ...opts, table: resolved.replace(TABLE_PREFIX, '') })
    }

    const result = await search.query(resolvePhysicalTable(tableName), {
      text: q,
      limit,
      deadlineMs,
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
      meta: {
        query: q,
        total: result.total ?? result.hits.length,
        took_ms: result.diagnostics?.durationMs ?? 0,
        source: 'search',
        ...(result.diagnostics?.budget ? { partial: true } : {}),
        tables: [tableMeta(tableName, result)],
      },
    }
  }

  // Cross-table search via multiQuery, optionally restricted by type (req 6:
  // the ⌘K chips + /api/search?types=a,b). Types match bare or full names.
  const wanted = opts?.types?.length
    ? new Set(opts.types.map((t) => fullTableName(t.replace(TABLE_PREFIX, ''))))
    : null
  const tables = Array.from(registry.contentTypes.keys()).filter((t) => !wanted || wanted.has(t))
  if (tables.length === 0) {
    return { results: [], meta: { query: q, total: 0, took_ms: 0, source: 'search' } }
  }

  // Ask each table for up to the FULL page window (limit + offset), not
  // limit/tables. The merge below already takes the global top-N by score, so
  // a per-table cap of 1 (the old ceil(limit/tables)) forced "best hit from
  // every table" instead of "best N overall" — diluting a query that's only
  // relevant to one table with one weak hit from each of the others. A table
  // can contribute at most the whole page window to the merged top, so
  // limit + offset is the correct, sufficient candidate pool.
  const offset = Math.max(0, opts?.offset ?? 0)
  const perTableLimit = limit + offset
  const facets = opts?.facets
  const results = await search.multiQuery(tables.map((table) => ({
    // Logical→physical at dispatch time; correlation back to the logical
    // table stays positional, so display names never leak physicals.
    table: resolvePhysicalTable(table),
    query: {
      text: q,
      limit: perTableLimit,
      deadlineMs,
      // NEVER per-table rerank on the fan-out (#846): N concurrent rerank
      // calls hit the engine's admission cap (10-way = 502 storm, measured).
      // Cross-table ranking is fixed below with ONE merged-top-K rerank.
      rerank: false,
      filters: filtersFromRecord(opts?.filters),
      // Facets merge across tables below; only request them when asked.
      ...(facets && facets.length > 0 ? { facets } : {}),
      adapterOptions: {
        indexes: getIndexNames(table),
        rerankField: getRerankField(table),
        searchableFields: getSearchableFields(table),
        indexWeights: getIndexWeights(table),
      },
    },
  })))
  // NOTE: per-table scores come from each table's own fusion config, so this
  // comparison is approximate. The merged-top-K cross-encoder pass below is
  // what actually calibrates ACROSS tables (#846) — one batched adapter
  // rerank call (~116ms flat), first page only, honest degrade to fusion
  // order when the adapter can't serve it.
  const merged = results.flatMap((result, index) => result.hits.map((hit) => adapterHitToPluginResult(hit, tables[index])))
    .sort((a, b) => b.score - a.score)
  if (offset === 0 && merged.length > 1 && typeof search.rerank === 'function') {
    const head = merged.slice(0, CROSS_TABLE_RERANK_TOP_K)
    const scores = await search.rerank(q, head.map(rerankTextForHit)).catch(() => null)
    if (scores && scores.length === head.length) {
      const reranked = head
        .map((hit, i) => ({ ...hit, rerankScore: scores[i]! }))
        .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0))
      merged.splice(0, head.length, ...reranked)
    }
  }
  const hits = merged.slice(offset, offset + limit)
  const tableMetas = results.map((result, index) => tableMeta(tables[index]!, result))
  const partial = tableMetas.some((t) => t.budget !== undefined)
  return {
    results: hits,
    ...(facets && facets.length > 0 ? { aggregations: mapFacetCounts(mergeFacetCounts(results)) } : {}),
    meta: {
      query: q,
      total: results.reduce((sum, result) => sum + (result.total ?? result.hits.length), 0),
      took_ms: Math.max(0, ...results.map((result) => result.diagnostics?.durationMs ?? 0)),
      source: 'search',
      ...(partial ? { partial: true } : {}),
      tables: tableMetas,
    },
  }
}

/** Per-table wall budget from settings (SD2); tables fan out in parallel. */
function queryBudgetMs(): number {
  try {
    const configured = getSettings().search.settings.search?.queryBudgetMs
    if (typeof configured === 'number' && configured > 0) return configured
  } catch {
    // settings unavailable (early boot, tests) — use the spec default
  }
  return 2000
}

type TableQueryResult = { hits: unknown[]; diagnostics?: { durationMs?: number; budget?: 'degraded' | 'omitted' } }

/** Merged candidates handed to the one cross-encoder pass — flat-cost up to
 *  ~20 on the batched endpoint (evidence file), a page beyond the default. */
const CROSS_TABLE_RERANK_TOP_K = 20
/** Per-text bound: rerank quality saturates well below this; keeps the one
 *  batched request small no matter what a doc body holds. */
const RERANK_TEXT_MAX_CHARS = 500

/** The text the cross-encoder reads for a merged hit: its table's declared
 *  rerankField when present, else the first non-empty string field. */
function rerankTextForHit(hit: { table: string; id: string; fields: Record<string, unknown> }): string {
  const field = getRerankField(hit.table)
  const declared = field ? hit.fields[field] : undefined
  if (typeof declared === 'string' && declared.length > 0) return declared.slice(0, RERANK_TEXT_MAX_CHARS)
  for (const value of Object.values(hit.fields)) {
    if (typeof value === 'string' && value.length > 0) return value.slice(0, RERANK_TEXT_MAX_CHARS)
  }
  return hit.id
}

function tableMeta(table: string, result: TableQueryResult): NonNullable<SearchResponse['meta']['tables']>[number] {
  return {
    table,
    hits: result.hits.length,
    took_ms: result.diagnostics?.durationMs ?? 0,
    ...(result.diagnostics?.budget ? { budget: result.diagnostics.budget } : {}),
  }
}

type AdapterFacets = NonNullable<Awaited<ReturnType<ReturnType<typeof getSearchAdapter>['query']>>['facets']>

/** Sum per-table facet buckets into one cross-table facet map. */
function mergeFacetCounts(results: Array<{ facets?: AdapterFacets }>): AdapterFacets | undefined {
  const merged = new Map<string, Map<string | number | boolean, number>>()
  for (const result of results) {
    for (const [field, counts] of Object.entries(result.facets ?? {})) {
      const bucket = merged.get(field) ?? new Map<string | number | boolean, number>()
      for (const { value, count } of counts) {
        bucket.set(value, (bucket.get(value) ?? 0) + count)
      }
      merged.set(field, bucket)
    }
  }
  if (merged.size === 0) return undefined
  const out: AdapterFacets = {}
  for (const [field, bucket] of merged) {
    out[field] = Array.from(bucket.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
  }
  return out
}
