/**
 * Bakin ⇄ Antfly shape translation for the antfly-main wire contract.
 * Pure functions — no client, no IO. Every decision cites live evidence
 * (tasks/evidence-search-rebuild.md).
 *
 * Differences vs the rc.9-era query-translation.ts this replaces:
 *   - Filters ride `filter_query` (fixed upstream; filters BOTH lanes —
 *     the filter-in-AST workaround and the client-side semantic post-
 *     filter are gone).
 *   - Responses unwrap the `responses[]` envelope; hit key is `_id`.
 *   - `scoreBreakdown` passes through `_index_scores` verbatim — keys are
 *     already neutral leg names (D17: no key normalization needed).
 *   - Tables are created from capability LEGS (D9); the legacy indexes[]
 *     path is honored during the transition and dies at F4.
 *   - `sync_level: 'full_index'` on writes (aknn was removed upstream).
 *
 * Still-standing engine constraints (probe-verified, keep):
 *   - `order_by` unsupported on the Zig engine → never sent.
 *   - totals are page-scoped → `count: true` twin for true totals.
 *   - `semantic + offset>0` hard-400s → offset only on FTS-only queries.
 */
import type {
  Filter,
  Query,
  QueryResult,
  SearchIndexConfig,
  TableConfig,
  TableLegConfig,
  TableLegHealth,
} from '@bakin/core/adapters/search'
import type { AntflySettings } from './defaults'
import type {
  WireBatchRequest,
  WireIndexConfig,
  WireIndexStatusEntry,
  WireMergeConfig,
  WireQueryEnvelope,
  WireQueryNode,
  WireQueryRequest,
  WireTableCreateRequest,
} from './wire'

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

type Strategy = 'rrf' | 'semantic_only' | 'full_text_only'

function resolveStrategy(requested: Query['strategy'], settings: AntflySettings): Strategy {
  if (requested === 'fts') return 'full_text_only'
  if (requested === 'vector') return 'semantic_only'
  if (requested === 'hybrid') return 'rrf'
  const configured = settings.search.strategy
  if (configured === 'semantic_only' || configured === 'full_text_only') return configured
  return 'rrf'
}

/**
 * Field-scoped full-text node. A bare `{query}` works on main (the `_all`
 * bug is fixed) but field scoping keeps relevance under our control.
 */
function fullTextNode(text: string, fields: string[] | null): WireQueryNode {
  if (!fields || fields.length === 0) return { query: text }
  if (fields.length === 1) return { match: text, field: fields[0] }
  return { should: { disjuncts: fields.map((field) => ({ match: text, field })) } }
}

function equalityNode(field: string, value: unknown): WireQueryNode | null {
  if (typeof value === 'number') {
    return { min: value, max: value, inclusive_min: true, inclusive_max: true, field }
  }
  if (typeof value === 'boolean') {
    return { bool: value, field }
  }
  if (typeof value === 'string') {
    return { match_phrase: value, field }
  }
  return null
}

function rangeNode(field: string, op: 'gt' | 'gte' | 'lt' | 'lte', value: unknown): WireQueryNode | null {
  if (typeof value !== 'number') return null
  if (op === 'gt') return { min: value, inclusive_min: false, field }
  if (op === 'gte') return { min: value, inclusive_min: true, field }
  if (op === 'lt') return { max: value, inclusive_max: false, field }
  return { max: value, inclusive_max: true, field }
}

/**
 * Bakin filters → ONE `filter_query` AST node (boolean conjunction).
 * Applies to BOTH lanes server-side (probe-verified on main).
 */
export function buildFilterQuery(filters: Filter[] | undefined): WireQueryNode | undefined {
  const must: WireQueryNode[] = []
  const mustNot: WireQueryNode[] = []
  for (const filter of filters ?? []) {
    if (filter.op === 'eq') {
      const node = equalityNode(filter.field, filter.value)
      if (node) must.push(node)
    } else if (filter.op === 'neq') {
      const node = equalityNode(filter.field, filter.value)
      if (node) mustNot.push(node)
    } else if (filter.op === 'in') {
      const values = Array.isArray(filter.value) ? filter.value : [filter.value]
      const nodes = values.map((v) => equalityNode(filter.field, v)).filter((n): n is WireQueryNode => n !== null)
      if (nodes.length === 1) must.push(nodes[0])
      else if (nodes.length > 1) must.push({ should: { disjuncts: nodes } })
    } else if (filter.op === 'contains') {
      if (typeof filter.value === 'string') must.push({ match: filter.value, field: filter.field })
    } else {
      const node = rangeNode(filter.field, filter.op, filter.value)
      if (node) must.push(node)
    }
  }
  if (must.length === 0 && mustNot.length === 0) return undefined
  if (must.length === 1 && mustNot.length === 0) return must[0]
  const node: WireQueryNode = {}
  if (must.length > 0) node.must = { conjuncts: must }
  if (mustNot.length > 0) node.must_not = { disjuncts: mustNot }
  return node
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const strings = value.filter((v): v is string => typeof v === 'string')
  return strings.length > 0 ? strings : null
}

function readNumberRecord(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  )
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

export function buildQueryRequest(table: string, q: Query, settings: AntflySettings): WireQueryRequest {
  const strategy = resolveStrategy(q.strategy, settings)
  const text = (q.text ?? '').trim()
  const filterQuery = buildFilterQuery(q.filters)
  const aggregations = buildAggregations(q)
  const isMatchAll = text === '*'
  const listFlow = text.length === 0 && (filterQuery !== undefined || aggregations !== undefined)
  const effectiveStrategy: Strategy = isMatchAll || listFlow ? 'full_text_only' : strategy

  const request: WireQueryRequest = {
    table,
    limit: q.limit ?? settings.search.defaultLimit,
  }

  if (isMatchAll || listFlow) {
    request.full_text_search = { match_all: {} }
  } else if (text.length > 0 && effectiveStrategy !== 'semantic_only') {
    request.full_text_search = fullTextNode(text, readStringArray(q.adapterOptions?.searchableFields))
  }

  if (filterQuery) request.filter_query = filterQuery

  // The semantic leg needs concrete vector indexes to search — naming none
  // (or a table that has none) is a hard 400. The registry passes the
  // table's embedding-leg names via adapterOptions.indexes; without them
  // the query is naturally FTS-only. No server introspection needed.
  const semanticIndexes = readStringArray(q.adapterOptions?.indexes)
  if (text.length > 0 && !isMatchAll && effectiveStrategy !== 'full_text_only' && semanticIndexes) {
    request.semantic_search = text
    request.indexes = semanticIndexes
    const weights = readNumberRecord(q.adapterOptions?.indexWeights)
    const strategyName = settings.search.fusionStrategy === 'rsf' ? 'rsf' : 'rrf'
    const merge: WireMergeConfig = { strategy: strategyName }
    if (weights) merge.weights = weights
    request.merge_config = merge
  }

  // offset is FTS-only: semantic + offset>0 is a hard 400 (unchanged on main).
  if (q.offset != null && q.offset > 0 && request.semantic_search === undefined) {
    request.offset = q.offset
  }

  if (aggregations) request.aggregations = aggregations

  if (q.rerank && settings.search.reranker.model) {
    request.reranker = {
      provider: settings.search.reranker.provider,
      model: settings.search.reranker.model,
      ...(typeof q.adapterOptions?.rerankField === 'string' ? { field: q.adapterOptions.rerankField } : {}),
    }
  }

  // limit 0 = count/aggregate-only. count:true returns the TRUE total and
  // full-corpus buckets; a reranker cannot ride a count (server 400).
  if (q.limit === 0) {
    request.count = true
    delete request.reranker
  }

  return request
}

function buildAggregations(q: Query): Record<string, unknown> | undefined {
  const aggs: Record<string, unknown> = {}
  for (const facet of q.facets ?? []) {
    aggs[facet] = { terms: { field: facet, size: 50 } }
  }
  for (const agg of q.aggregations ?? []) {
    if (agg.type === 'count') {
      aggs[agg.name] = { terms: { field: agg.field, size: 100 } }
    }
  }
  return Object.keys(aggs).length > 0 ? aggs : undefined
}

/**
 * Companion count request for true totals: same query, count-only.
 * Needed for faceted/semantic flows — totals are page-scoped otherwise.
 */
export function toCountRequest(request: WireQueryRequest): WireQueryRequest {
  const count: WireQueryRequest = { ...request, count: true }
  delete count.reranker
  delete count.offset
  return count
}

export function mapQueryResponse(envelope: WireQueryEnvelope | null, table: string): QueryResult {
  const response = envelope?.responses?.[0]
  if (!response) {
    return { hits: [], total: 0, diagnostics: { strategy: 'none' } }
  }
  const hits = (response.hits?.hits ?? []).map((hit) => ({
    key: hit._id,
    document: hit._source ?? {},
    score: hit._score,
    ...(hit._index_scores ? { scoreBreakdown: hit._index_scores } : {}),
  }))
  const facets: Record<string, Array<{ value: string | number | boolean; count: number }>> = {}
  for (const [name, agg] of Object.entries(response.aggregations ?? {})) {
    if (agg?.buckets) {
      facets[name] = agg.buckets.map((b) => ({ value: b.key, count: b.doc_count }))
    }
  }
  return {
    hits,
    total: response.hits?.total ?? hits.length,
    ...(Object.keys(facets).length > 0 ? { facets } : {}),
    diagnostics: {
      strategy: 'hybrid',
      durationMs: response.took,
      ...(response.error ? { adapter: { error: response.error } } : {}),
    },
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export function buildBatchInserts(items: Array<{ key: string; doc: Record<string, unknown> }>): WireBatchRequest {
  const inserts: Record<string, Record<string, unknown>> = {}
  for (const item of items) inserts[item.key] = item.doc
  return { inserts, sync_level: 'full_index' }
}

export function buildBatchDeletes(keys: string[]): WireBatchRequest {
  return { deletes: keys, sync_level: 'full_index' }
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function embeddingIndexFromLeg(leg: TableLegConfig, settings: AntflySettings): WireIndexConfig {
  const ref = leg.capability === 'media-embedding' ? 'visual' : 'default'
  const embedder = settings.embedders[ref] ?? settings.embedders.default
  const template = leg.mediaUrlField
    ? `{{#if ${leg.mediaUrlField}}}{{remoteMedia url=${leg.mediaUrlField}}}{{/if}}`
    : leg.template ?? leg.fields.map((field) => `{{${field}}}`).join(' ')
  const entry: WireIndexConfig = {
    name: leg.name,
    type: 'embeddings',
    template,
    dimension: embedder.dimension,
    embedder: {
      provider: embedder.provider,
      model: embedder.model,
      ...(embedder.multimodal !== undefined ? { multimodal: embedder.multimodal } : {}),
    },
  }
  if (leg.chunker?.enabled) {
    entry.chunker = {
      provider: 'antfly',
      model: 'fixed',
      text: {
        target_tokens: leg.chunker.targetTokens ?? settings.chunking.defaultTargetTokens,
        overlap_tokens: leg.chunker.overlapTokens ?? settings.chunking.defaultOverlapTokens,
      },
    }
  }
  return entry
}

function legFromLegacyIndex(idx: SearchIndexConfig): TableLegConfig | null {
  if (idx.kind === 'text') return null
  return {
    name: idx.name,
    capability: idx.mediaUrlField ? 'media-embedding' : 'text-embedding',
    fields: idx.fields,
    template: idx.template,
    mediaUrlField: idx.mediaUrlField,
    chunker: idx.chunker,
  }
}

/**
 * Capability legs → antfly index declarations. Full-text legs are omitted:
 * the server always creates its own full_text index. No `schema` is sent —
 * type inference covers Bakin's needs. Never an inference URL (in-process
 * embedding only; a URL routes over HTTP and wedges backfill).
 */
export function buildTableCreate(config: TableConfig, settings: AntflySettings): WireTableCreateRequest {
  const legs: TableLegConfig[] = config.legs
    ?? (config.indexes ?? []).map(legFromLegacyIndex).filter((l): l is TableLegConfig => l !== null)
  const indexes: Record<string, WireIndexConfig> = {}
  for (const leg of legs) {
    if (leg.capability === 'full-text') continue
    indexes[leg.name] = embeddingIndexFromLeg(leg, settings)
  }
  return {
    num_shards: 1,
    ...(Object.keys(indexes).length > 0 ? { indexes } : {}),
  }
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** GET /tables/{t}/indexes → per-leg health for the blue/green converge check. */
export function mapIndexStatuses(entries: WireIndexStatusEntry[]): TableLegHealth[] {
  return entries.map((entry) => {
    const status = entry.status
    const failed = status?.worker_failed === true || (status?.fatal_error_count ?? 0) > 0 || status?.backfill_state === 'failed'
    const building = status?.rebuilding === true || status?.backfill_active === true
    return {
      leg: entry.config.name,
      state: failed ? 'error' as const : building ? 'building' as const : 'ready' as const,
      indexedCount: status?.total_indexed ?? 0,
      ...(failed && status?.last_error ? { error: status.last_error } : {}),
    }
  })
}
