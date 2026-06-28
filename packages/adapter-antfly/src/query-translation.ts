import type { QueryHit, QueryRequest, QueryResult as AntflyQueryResult } from '@antfly/sdk'
import type {
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
  const request: QueryRequest = {
    table,
    limit: q.limit ?? settings.search.defaultLimit,
    offset: q.offset,
  }

  if (q.text && strategy !== 'semantic_only') {
    // The full-text leg MUST be field-scoped. A bare `{query: text}` resolves
    // against a default/_all field that antfly does not populate, so it matches
    // NOTHING (BM25 always 0, the keyword leg silently dead). Build a
    // bool/should of per-field matches over the content type's searchable
    // fields instead; fall back to the bare shape only when fields are unknown.
    const searchableFields = readStringArray(q.adapterOptions?.searchableFields)
    if (searchableFields && searchableFields.length > 0) {
      request.full_text_search = {
        bool: { should: searchableFields.map((field) => ({ match: { field, text: q.text } })) },
      } as unknown as QueryRequest['full_text_search']
    } else {
      request.full_text_search = { query: q.text } as QueryRequest['full_text_search']
    }
  }
  if (q.text && strategy !== 'full_text_only') {
    // v0.2: `indexes` is the list of vector indexes for semantic search and
    // is only meaningful alongside `semantic_search`.
    request.semantic_search = q.text
    request.indexes = resolveIndexNames(q)
    // Per-index fusion weights (e.g. favor a multimodal table's visual index
    // over its noisier text-embedding index). antfly fuses per-bucket by
    // default; merge_config.weights keys each index by name in the RRF.
    const indexWeights = readNumberRecord(q.adapterOptions?.indexWeights)
    if (indexWeights) {
      request.merge_config = { strategy: 'rrf', weights: indexWeights } as unknown as QueryRequest['merge_config']
    }
  }
  const filterQuery = buildFilterQuery(q)
  if (filterQuery) request.filter_query = { query: filterQuery } as QueryRequest['filter_query']

  const aggregations = buildAggregations(q)
  if (aggregations) request.aggregations = aggregations as QueryRequest['aggregations']

  const reranker = buildRerankerConfig(q, settings)
  if (reranker) request.reranker = reranker as QueryRequest['reranker']

  return request
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

function buildFilterQuery(q: Query): string | null {
  if (!q.filters || q.filters.length === 0) return null
  const parts = q.filters.map((filter) => {
    if (filter.op === 'eq') return `+${filter.field}:${filter.value}`
    if (filter.op === 'in' && Array.isArray(filter.value)) return `+${filter.field}:(${filter.value.join(' OR ')})`
    return `+${filter.field}:${filter.value}`
  })
  return parts.join(' ')
}

function buildAggregations(q: Query): Record<string, unknown> | undefined {
  const aggregations: Record<string, unknown> = {}
  for (const field of q.facets ?? []) {
    aggregations[field] = { type: 'terms', field, size: 50 }
  }
  for (const aggregation of q.aggregations ?? []) {
    aggregations[aggregation.name] = {
      type: aggregation.type === 'histogram' ? 'date_histogram' : aggregation.type,
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
