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
 *   - totals are corpus-true `{value, relation}` objects (rc.18; the old
 *     page-scoped count-twin is gone).
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

/** Bakin filters → must/must_not clause lists (shared by both builders below). */
function filterClauses(filters: Filter[] | undefined): { must: WireQueryNode[]; mustNot: WireQueryNode[] } {
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
  return { must, mustNot }
}

/**
 * Bakin filters → the `filter_query` node. On 0.2.0 filter_query filters
 * BOTH the full-text and semantic lanes (every clause shape — match_phrase
 * keyword equality incl. hyphenated values, should-disjunct INs, numeric
 * ranges, must_not exclusions, and the semantic/hybrid no-leak property —
 * live-probed 2026-08-31; tasks/evidence-antfly-0.2.0.md).
 *
 * A pure-negation node matches NOTHING on the engine, so exclusion-only
 * filters get a match_all base conjunct.
 */
export function buildFilterQuery(filters: Filter[] | undefined): WireQueryNode | undefined {
  const { must, mustNot } = filterClauses(filters)
  if (must.length === 0 && mustNot.length === 0) return undefined
  if (must.length === 1 && mustNot.length === 0) return must[0]
  const node: WireQueryNode = {}
  if (mustNot.length > 0) {
    node.must = { conjuncts: must.length > 0 ? must : [{ match_all: {} }] }
    node.must_not = { disjuncts: mustNot }
  } else {
    node.must = { conjuncts: must }
  }
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
  const hasFilters = (q.filters?.length ?? 0) > 0
  const aggregations = buildAggregations(q)
  const isMatchAll = text === '*'
  const listFlow = text.length === 0 && (hasFilters || aggregations !== undefined)
  // Filters no longer force the FTS-only lane: on 0.2.0 `filter_query`
  // constrains the semantic and hybrid lanes too (no-leak probed — an
  // agent-filtered hybrid search cannot merge another agent's rows), so
  // filtered searches keep semantic recall.
  const effectiveStrategy: Strategy = isMatchAll || listFlow ? 'full_text_only' : strategy

  const request: WireQueryRequest = {
    table,
    limit: q.limit ?? settings.search.defaultLimit,
  }
  if (q.deadlineMs !== undefined && q.deadlineMs > 0) {
    // rc.18 cooperative server-side deadline (expiry → 504). The client
    // enforces deadline + grace as its abort timeout — see client.query.
    request.timeout_ms = Math.round(q.deadlineMs)
  }

  if (isMatchAll || listFlow) {
    request.full_text_search = { match_all: {} }
  } else if (text.length > 0 && effectiveStrategy !== 'semantic_only') {
    request.full_text_search = fullTextNode(text, readStringArray(q.adapterOptions?.searchableFields))
  }

  if (hasFilters) {
    const filterQuery = buildFilterQuery(q.filters)
    if (filterQuery) request.filter_query = filterQuery
  }

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
  // FLAT AggregationRequest shape ({type, field, size}) — the published
  // rc.17 contract. The nested {terms:{...}} wrapper only exists on newer
  // main; flat parses on both (live-verified 2026-07-03: nested 400s the
  // whole query on rc.17, including faceted asset searches).
  const aggs: Record<string, unknown> = {}
  for (const facet of q.facets ?? []) {
    aggs[facet] = { type: 'terms', field: facet, size: 50 }
  }
  for (const agg of q.aggregations ?? []) {
    if (agg.type === 'count') {
      aggs[agg.name] = { type: 'terms', field: agg.field, size: 100 }
    }
  }
  return Object.keys(aggs).length > 0 ? aggs : undefined
}

/** rc.18 totals are `{value, relation}` objects (corpus-true); tolerate the old number. */
function normalizeTotal(total: number | { value: number; relation?: string } | undefined): number | undefined {
  if (total === undefined || total === null) return undefined
  return typeof total === 'number' ? total : total.value
}

export function mapQueryResponse(envelope: WireQueryEnvelope | null, _table: string): QueryResult {
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
    total: normalizeTotal(response.hits?.total) ?? hits.length,
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

export function buildBatchInserts(items: Array<{ key: string; doc: Record<string, unknown> }>, opts?: { sync?: boolean }): WireBatchRequest {
  const inserts: Record<string, Record<string, unknown>> = {}
  for (const item of items) inserts[item.key] = item.doc
  // sync=false omits sync_level: indexing proceeds async through the
  // engine's catch-up loop (slow on 0.2.0 — ~4 docs/s) and the caller polls
  // leg health for convergence. Sync (default) waits for full_index and
  // rides the fast write-path embed lane; the client gives sync batch
  // writes a generous timeout (SYNC_BATCH_TIMEOUT_MS) because an
  // embed-heavy chunk legitimately takes tens of seconds.
  return opts?.sync === false ? { inserts } : { inserts, sync_level: 'full_index' }
}

export function buildBatchDeletes(keys: string[]): WireBatchRequest {
  return { deletes: keys, sync_level: 'full_index' }
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** An embedder an operator has turned off (or gutted) must produce NO leg
 *  at all. A disabled visual embedder once flowed through as a dimension-0
 *  index spec, which the engine 500s on EVERY create — bricking every
 *  media-capable table on the box (2026-07-21 field incident). */
export function embedderUsable(embedder: { provider?: string; model?: string; dimension?: number } | undefined): boolean {
  if (!embedder) return false
  if (!embedder.provider || embedder.provider === 'disabled' || embedder.provider === 'none') return false
  if (!embedder.model) return false
  return typeof embedder.dimension === 'number' && embedder.dimension > 0
}

function embeddingIndexFromLeg(leg: TableLegConfig, settings: AntflySettings): WireIndexConfig | null {
  const ref = leg.capability === 'media-embedding' ? 'visual' : 'default'
  const embedder = settings.embedders[ref] ?? settings.embedders.default
  if (!embedderUsable(embedder)) return null
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
 * Capability legs → the table-provisioning plan. Full-text legs are omitted:
 * the server always creates its own full_text index. No `schema` is sent —
 * type inference covers Bakin's needs. Never an inference URL (in-process
 * embedding only; a URL routes over HTTP and wedges backfill).
 *
 * Legs whose embedder is disabled/unusable are SKIPPED — the table is
 * created keyword-only for those capabilities (honest degrade, D11)
 * instead of shipping the engine a spec it 500s on.
 *
 * The plan is two-phase by NECESSITY on 0.2.0: inline `indexes` at
 * table-create are silently dead (accepted + stored, enrichment never
 * starts), so embeddings legs go through the per-index endpoint
 * (paths.index) after the table exists. Order matters for a second reason:
 * legs must land BEFORE the first document write — adding an embeddings leg
 * to a populated table wedges it durably on 0.2.0 (both in the evidence
 * file + filed upstream).
 */
export interface TableProvisioningPlan {
  table: WireTableCreateRequest
  indexes: WireIndexConfig[]
}

export function buildTableProvisioning(config: TableConfig, settings: AntflySettings): TableProvisioningPlan {
  const legs: TableLegConfig[] = config.legs
    ?? (config.indexes ?? []).map(legFromLegacyIndex).filter((l): l is TableLegConfig => l !== null)
  const indexes: WireIndexConfig[] = []
  for (const leg of legs) {
    if (leg.capability === 'full-text') continue
    const index = embeddingIndexFromLeg(leg, settings)
    if (index !== null) indexes.push(index)
  }
  return { table: { num_shards: 1 }, indexes }
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** GET /tables/{t}/indexes → per-leg health for the blue/green converge check. */
export function mapIndexStatuses(entries: WireIndexStatusEntry[]): TableLegHealth[] {
  return entries.map((entry) => {
    const status = entry.status
    const runtime = status?.enrichment_runtime
    const failed = status?.worker_failed === true
      || (status?.fatal_error_count ?? 0) > 0
      || runtime?.worker_failed === true
      || (runtime?.fatal_error_count ?? 0) > 0
      || status?.backfill_state === 'failed'
    // The antfly#319 idle-detection override is GONE (2026-08-31): 0.2.0
    // clears rebuilding/backfill_active honestly at idle — proven at scale
    // for both the media-skip and text-skip corpora INCLUDING interrupted
    // rebuilds (gate T7, evidence file), the exact retirement condition the
    // override carried. Raised flags now mean real work. An interrupted
    // backfill leaves a sticky-honest `backfill_state: "degraded"` scar on
    // an otherwise fully functional leg — deliberately mapped ready (not
    // 'failed': repair counters stay clean and queries serve correctly).
    const building = status?.rebuilding === true || status?.backfill_active === true
    return {
      leg: entry.config.name,
      state: failed ? 'error' as const : building ? 'building' as const : 'ready' as const,
      indexedCount: status?.total_indexed ?? 0,
      ...(runtime?.pending_sequence_count !== undefined ? { pendingCount: runtime.pending_sequence_count } : {}),
      ...(failed && status?.last_error ? { error: status.last_error } : {}),
    }
  })
}
