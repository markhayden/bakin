import type { QueryHit, QueryRequest, QueryResult as AntflyQueryResult } from '@antfly/sdk'
import type {
  Filter,
  Query,
  QueryDiagnostics,
  QueryResult,
  SearchHit,
  SearchIndexConfig,
  TableConfig,
} from '@bakin/core/adapters/search'
import type { AntflySettings } from './defaults'

/**
 * Bakin ⇄ Antfly shape translation: SearchQuery → QueryRequest, Bakin
 * TableConfig → Antfly schema/indexes, and Antfly responses → QueryResult.
 * Pure functions — no client, no IO.
 */

export function buildQueryRequest(table: string, q: Query, settings: AntflySettings): QueryRequest {
  const strategy = resolveStrategy(q.strategy, settings)
  const text = typeof q.text === 'string' ? q.text : ''
  const trimmedText = text.trim()
  const filterConjuncts = buildFilterConjuncts(q.filters)
  const aggregations = buildAggregations(q)
  const isMatchAllText = trimmedText === '*'
  const shouldMatchAll = isMatchAllText
    || (trimmedText.length === 0 && (filterConjuncts.must.length > 0 || filterConjuncts.mustNot.length > 0 || aggregations != null))
  const effectiveStrategy = shouldMatchAll ? 'full_text_only' : strategy
  const request: QueryRequest = {
    table,
    limit: q.limit ?? settings.search.defaultLimit,
  }
  // `offset` is full-text-only per the antfly v0.2 contract — semantic +
  // offset > 0 is a hard 400 ("invalid query request", live-verified at rc.9),
  // so only attach it when the resolved strategy is full-text-only.
  if (q.offset != null && effectiveStrategy === 'full_text_only') {
    request.offset = q.offset
  }

  let textLeg: Record<string, unknown> | undefined
  if (shouldMatchAll) {
    // Bakin uses `q: '*'` and blank filtered/faceted queries for list/count
    // flows. Antfly's AST has an explicit MatchAllQuery; do not field-scope
    // `*` into a literal MatchQuery, and do not ask semantic search to embed it.
    textLeg = { match_all: {} }
  } else if (trimmedText.length > 0 && effectiveStrategy !== 'semantic_only') {
    // The full-text leg MUST be field-scoped. A bare `{query: text}` resolves
    // against a default/_all field that antfly does not populate, so it matches
    // NOTHING (BM25 always 0, the keyword leg silently dead). Build a
    // disjunction of per-field MatchQuery clauses over the content type's
    // searchable fields; fall back to the bare query-string shape only when
    // fields are unknown.
    const searchableFields = readStringArray(q.adapterOptions?.searchableFields)
    textLeg = (searchableFields && searchableFields.length > 0)
      ? buildFieldScopedFullTextSearch(text, searchableFields)
      : { query: text }
  }

  // Filters ride INSIDE the full-text AST as boolean conjuncts. The dedicated
  // `filter_query` request field silently zeroes the hits path at this pin
  // (rc.9, live-verified: identical requests return the right count via
  // `count: true` but zero hits) — the AST form returns correct filtered hits.
  // Semantic-leg hits cannot be filtered server-side at all; the adapter
  // post-filters those (see hitMatchesFilters).
  const combinedLeg = combineFullTextLeg(textLeg, filterConjuncts)
  if (combinedLeg) {
    request.full_text_search = combinedLeg as QueryRequest['full_text_search']
  }

  if (trimmedText.length > 0 && !isMatchAllText && effectiveStrategy !== 'full_text_only') {
    // v0.2: `indexes` is the list of vector indexes for semantic search and
    // is only meaningful alongside `semantic_search`.
    request.semantic_search = text
    request.indexes = resolveIndexNames(q)
    // Per-index fusion weights (e.g. favor a multimodal table's visual index
    // over its noisier text-embedding index). antfly fuses per-bucket by
    // default; merge_config.weights keys each index by name in the RRF.
    const indexWeights = readNumberRecord(q.adapterOptions?.indexWeights)
    if (indexWeights) {
      request.merge_config = { strategy: 'rrf', weights: indexWeights } as unknown as QueryRequest['merge_config']
    }
  }

  if (aggregations) request.aggregations = aggregations as QueryRequest['aggregations']

  const reranker = buildRerankerConfig(q, settings)
  if (reranker) request.reranker = reranker as QueryRequest['reranker']

  // limit: 0 means "count/aggregate only" everywhere in Bakin. At this pin a
  // plain limit-0 query returns total 0 and NULL aggregation buckets; the
  // documented count mechanism returns the true total AND full-corpus buckets
  // (live-verified: 652 vs 0 on the same body). count is incompatible with a
  // reranker (server 400s), which is fine — a count has nothing to rerank.
  if (q.limit === 0) {
    ;(request as Record<string, unknown>).count = true
    delete request.reranker
  }

  return request
}

interface FilterConjuncts {
  must: Array<Record<string, unknown>>
  mustNot: Array<Record<string, unknown>>
}

/**
 * Translate Bakin filters into antfly Query-AST nodes. String equality uses
 * MatchPhraseQuery (analyzed — matches the lowercased index terms the way the
 * server itself would); numbers use NumericRangeQuery with min === max; ranges
 * use NumericRangeQuery bounds. All shapes live-verified at rc.9.
 */
function buildFilterConjuncts(filters: Query['filters']): FilterConjuncts {
  const must: Array<Record<string, unknown>> = []
  const mustNot: Array<Record<string, unknown>> = []
  for (const filter of filters ?? []) {
    if (filter.op === 'neq') {
      const node = equalityNode(filter.field, filter.value)
      if (node) mustNot.push(node)
      continue
    }
    const node = filterNode(filter)
    if (node) must.push(node)
  }
  return { must, mustNot }
}

function filterNode(filter: Filter): Record<string, unknown> | null {
  const { field, op, value } = filter
  switch (op) {
    case 'eq':
      return equalityNode(field, value)
    case 'in': {
      if (!Array.isArray(value)) return equalityNode(field, value)
      const disjuncts = value
        .map((entry) => equalityNode(field, entry))
        .filter((node): node is Record<string, unknown> => node !== null)
      if (disjuncts.length === 0) return null
      return disjuncts.length === 1 ? disjuncts[0] : { should: { disjuncts } }
    }
    case 'gt':
      return numericBound(field, value, { min: true, inclusive: false })
    case 'gte':
      return numericBound(field, value, { min: true, inclusive: true })
    case 'lt':
      return numericBound(field, value, { min: false, inclusive: false })
    case 'lte':
      return numericBound(field, value, { min: false, inclusive: true })
    case 'contains':
      return { match: String(value), field }
    default:
      return null
  }
}

function equalityNode(field: string, value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { min: value, max: value, inclusive_min: true, inclusive_max: true, field }
  }
  return { match_phrase: String(value), field }
}

function numericBound(
  field: string,
  value: unknown,
  bound: { min: boolean; inclusive: boolean },
): Record<string, unknown> | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  return bound.min
    ? { min: numeric, inclusive_min: bound.inclusive, field }
    : { max: numeric, inclusive_max: bound.inclusive, field }
}

function combineFullTextLeg(
  textLeg: Record<string, unknown> | undefined,
  filters: FilterConjuncts,
): Record<string, unknown> | undefined {
  if (filters.must.length === 0 && filters.mustNot.length === 0) return textLeg
  // Filters without any text leg (semantic-only strategies) cannot form a
  // full-text conjunction; the adapter post-filters those hits instead.
  if (!textLeg) return undefined
  const combined: Record<string, unknown> = {
    must: { conjuncts: [textLeg, ...filters.must] },
  }
  if (filters.mustNot.length > 0) {
    combined.must_not = { disjuncts: filters.mustNot }
  }
  return combined
}

/**
 * Client-side filter check for hits the server could not filter: at this pin
 * only the full-text leg can carry filters (see buildQueryRequest), so any hit
 * that arrived purely via the semantic leg must be re-checked against the
 * caller's filters. String comparison is case-insensitive to mirror the
 * analyzed index terms.
 */
export function hitMatchesFilters(document: Record<string, unknown>, filters: Query['filters']): boolean {
  for (const filter of filters ?? []) {
    if (!valueMatches(document[filter.field], filter)) return false
  }
  return true
}

function valueMatches(raw: unknown, filter: Filter): boolean {
  switch (filter.op) {
    case 'eq':
      return equalityMatches(raw, filter.value)
    case 'neq':
      return !equalityMatches(raw, filter.value)
    case 'in':
      return Array.isArray(filter.value)
        ? filter.value.some((entry) => equalityMatches(raw, entry))
        : equalityMatches(raw, filter.value)
    case 'contains':
      return typeof raw === 'string' && raw.toLowerCase().includes(String(filter.value).toLowerCase())
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const left = Number(raw)
      const right = Number(filter.value)
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false
      if (filter.op === 'gt') return left > right
      if (filter.op === 'gte') return left >= right
      if (filter.op === 'lt') return left < right
      return left <= right
    }
    default:
      return true
  }
}

function equalityMatches(raw: unknown, expected: unknown): boolean {
  if (raw === null || raw === undefined) return false
  if (Array.isArray(raw)) return raw.some((entry) => equalityMatches(entry, expected))
  if (typeof raw === 'number' || typeof expected === 'number') return Number(raw) === Number(expected)
  // Case-insensitive to mirror the server: match_phrase analyzes BOTH sides
  // (live-verified: 'main'/'Main'/'MAIN' all match a stored 'Main'), so the
  // client check must agree or eq/neq results diverge between the filtered
  // full-text lane and the post-filtered semantic lane.
  return String(raw).toLowerCase() === String(expected).toLowerCase()
}

/**
 * Field-scoped full-text query in the antfly v0.2 Query AST:
 *   single field  → MatchQuery        { match, field }
 *   multiple      → BooleanQuery.should DisjunctionQuery { disjuncts: [...] }
 * The previous `{ bool: { should: [{ match: { field, text } }] } }` shape was
 * invalid on both counts — there is no `bool` wrapper, and `match` is the query
 * STRING (with `field` as a sibling), not an object.
 */
function buildFieldScopedFullTextSearch(text: string, fields: string[]): QueryRequest['full_text_search'] {
  if (fields.length === 1) {
    return { match: text, field: fields[0] } as QueryRequest['full_text_search']
  }
  return {
    should: { disjuncts: fields.map((field) => ({ match: text, field })) },
  } as QueryRequest['full_text_search']
}

/**
 * NOTE: no `schema` is sent at table create. The rc.2 bug that required this
 * (a create-time schema permanently broke query parsing — markhayden/bakin#456
 * item 1) is FIXED at v0.2.0-rc.9: live testing confirmed a table created with
 * a client schema answers FTS + semantic queries identically to a schemaless
 * one. We keep creating schemaless because type inference covers Bakin's needs;
 * if field-level x-antfly-include-in-all control is ever wanted, a schema can
 * now be sent here (or via PUT /schema) without breaking queries.
 */
export function buildTableConfig(table: string, config: TableConfig, settings: AntflySettings): {
  indexes: Record<string, unknown>
} {
  // No full_text entry either: the v0.2 server ignores caller-supplied
  // full-text indexes and always creates its own (full_text_index_v0).
  const indexes: Record<string, unknown> = {}
  for (const idx of config.indexes ?? []) {
    if (idx.kind === 'text') continue
    const embedder = resolveEmbedder(idx.embedderRef ?? 'default', settings)
    const embedderConfig: Record<string, unknown> = { provider: embedder.provider, model: embedder.model }
    // Never carry an inference `url`/`api_url`: Bakin always embeds in-process in
    // the local antfly node (a URL would route over HTTP and wedge the backfill,
    // bakin#456). `multimodal` is the one legit pass-through, for non-registry
    // multimodal models (omitted for registry models like clipclap).
    if (embedder.multimodal !== undefined) embedderConfig.multimodal = embedder.multimodal
    const entry: Record<string, unknown> = {
      name: idx.name,
      type: 'embeddings',
      template: indexTemplate(idx),
      // Declared dims are required for dense indexes at this server version.
      dimension: embedder.dimension,
      embedder: embedderConfig,
    }
    if (idx.chunker?.enabled) {
      // v0.2 nests chunking under ChunkerConfig; 'fixed' is the built-in
      // token-count chunker (no ONNX model required).
      entry.chunker = {
        provider: 'antfly',
        model: 'fixed',
        text: {
          target_tokens: idx.chunker.targetTokens ?? settings.chunking.defaultTargetTokens,
          overlap_tokens: idx.chunker.overlapTokens ?? settings.chunking.defaultOverlapTokens,
        },
      }
    }
    indexes[idx.name] = entry
  }

  return { indexes }
}

function indexTemplate(idx: SearchIndexConfig): string {
  const mediaUrlField = readString(idx.mediaUrlField)
  if (mediaUrlField) return `{{#if ${mediaUrlField}}}{{remoteMedia url=${mediaUrlField}}}{{/if}}`
  return idx.template ?? idx.fields.map((field) => `{{${field}}}`).join(' ')
}

function resolveEmbedder(ref: string, settings: AntflySettings): AntflySettings['embedders'][string] {
  const match = settings.embedders[ref]
  if (!match) {
    const available = Object.keys(settings.embedders).join(', ')
    throw new Error(`Unknown embedder ref "${ref}". Available refs: ${available}`)
  }
  return match
}

function buildAggregations(q: Query): Record<string, unknown> | undefined {
  const aggregations: Record<string, unknown> = {}
  for (const field of q.facets ?? []) {
    aggregations[field] = { type: 'terms', field, size: 50 }
  }
  for (const aggregation of q.aggregations ?? []) {
    if (aggregation.type === 'histogram') {
      // Antfly splits the concept: numeric buckets are `histogram` with a
      // float `interval`; named periods are `date_histogram` with
      // `calendar_interval` (minute|hour|day|week|month|quarter|year). The
      // old mapping sent every histogram as date_histogram with a raw
      // `interval`, which is invalid for string intervals per the contract.
      aggregations[aggregation.name] = typeof aggregation.interval === 'string'
        ? { type: 'date_histogram', field: aggregation.field, calendar_interval: aggregation.interval }
        : { type: 'histogram', field: aggregation.field, ...(aggregation.interval === undefined ? {} : { interval: aggregation.interval }) }
      continue
    }
    aggregations[aggregation.name] = {
      type: aggregation.type,
      field: aggregation.field,
      ...(aggregation.interval === undefined ? {} : { interval: aggregation.interval }),
    }
  }
  return Object.keys(aggregations).length > 0 ? aggregations : undefined
}

function buildRerankerConfig(q: Query, settings: AntflySettings): Record<string, unknown> | undefined {
  if (q.rerank === false) return undefined
  const field = readString(q.adapterOptions?.rerankField)
  if (!field) return undefined
  const cfg = settings.search.reranker
  if (!cfg?.enabled) return undefined
  // Constructed explicitly: v0.2 RerankerConfig has no `threshold`, and
  // legacy settings.json files may still carry one — it must not be sent.
  return {
    provider: cfg.provider,
    model: cfg.model,
    field,
  }
}

function resolveStrategy(strategy: Query['strategy'], settings: AntflySettings): AntflySettings['search']['strategy'] {
  switch (strategy) {
    case 'fts': return 'full_text_only'
    case 'vector': return 'semantic_only'
    case 'hybrid': return 'rrf'
    case 'auto':
    case undefined:
      return settings.search.strategy
  }
}

function resolveIndexNames(q: Query): string[] {
  return readStringArray(q.adapterOptions?.indexes) ?? ['embeddings']
}

export function mapResponse(response: AntflyQueryResult, table: string): QueryResult {
  const hits = mapHits(response, table)
  return {
    hits,
    total: response.hits?.total ?? 0,
    facets: mapFacetAggregations(response.aggregations as Record<string, unknown> | undefined),
    aggregations: response.aggregations as Record<string, unknown> | undefined,
    diagnostics: {
      strategy: 'hybrid',
      durationMs: response.took ?? 0,
    } satisfies QueryDiagnostics,
  }
}

function mapHits(response: AntflyQueryResult, table: string): SearchHit[] {
  if (!response?.hits?.hits) return []
  return response.hits.hits.map((hit: QueryHit) => {
    const raw = hit as Record<string, unknown>
    return {
      key: hit._id || '',
      document: hit._source || {},
      score: hit._score || 0,
      scoreBreakdown: {
        ...(raw._index_scores as Record<string, number> | undefined),
        ...(typeof raw._rerank_score === 'number' ? { rerank: raw._rerank_score } : {}),
      },
      highlights: { table: [table] },
    }
  })
}

function mapFacetAggregations(aggs: Record<string, unknown> | undefined): QueryResult['facets'] {
  if (!aggs) return undefined
  const mapped: NonNullable<QueryResult['facets']> = {}
  for (const [key, agg] of Object.entries(aggs)) {
    const aggObj = agg as { buckets?: Array<{ key: string | number | boolean; doc_count: number }> }
    if (aggObj?.buckets) {
      mapped[key] = aggObj.buckets.map((bucket) => ({
        value: bucket.key,
        count: bucket.doc_count,
      }))
    }
  }
  return Object.keys(mapped).length > 0 ? mapped : undefined
}

export function emptyQueryResult(q: Query): QueryResult {
  return {
    hits: [],
    total: 0,
    diagnostics: { strategy: q.strategy === 'fts' ? 'fts' : q.strategy === 'vector' ? 'vector' : 'none', durationMs: 0 },
  }
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}

export function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined
}

export function readNumberRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}
