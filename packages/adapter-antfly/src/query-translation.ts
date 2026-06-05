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
    indexes: strategy === 'full_text_only' ? [] : resolveIndexNames(q),
  }

  if (q.text && strategy !== 'semantic_only') {
    request.full_text_search = { query: q.text } as QueryRequest['full_text_search']
  }
  if (q.text && strategy !== 'full_text_only') {
    request.semantic_search = q.text
  }
  const filterQuery = buildFilterQuery(q)
  if (filterQuery) request.filter_query = { query: filterQuery } as QueryRequest['filter_query']

  const aggregations = buildAggregations(q)
  if (aggregations) request.aggregations = aggregations as QueryRequest['aggregations']

  const reranker = buildRerankerConfig(q, settings)
  if (reranker) request.reranker = reranker as QueryRequest['reranker']

  return request
}

export function buildTableConfig(table: string, config: TableConfig, settings: AntflySettings): {
  schema: Record<string, unknown>
  indexes: Record<string, unknown>
} {
  const defaultType = readString(config.adapterOptions?.defaultType) ?? table
  const properties: Record<string, unknown> = {}
  for (const [fieldName, fieldDef] of Object.entries(config.fields)) {
    properties[fieldName] = {
      type: 'string',
      'x-antfly-types': schemaFieldToAntflyType(fieldDef.type),
    }
  }

  const schema = {
    default_type: defaultType,
    document_schemas: {
      [defaultType]: {
        schema: {
          type: 'object',
          properties,
          'x-antfly-include-in-all': readStringArray(config.adapterOptions?.searchableFields),
        },
      },
    },
  }

  const indexes: Record<string, unknown> = {
    search: { name: 'search', type: 'full_text' },
  }
  for (const idx of config.indexes ?? []) {
    if (idx.kind === 'text') continue
    const embedder = resolveEmbedder(idx.embedderRef ?? 'default', settings)
    const entry: Record<string, unknown> = {
      name: idx.name,
      type: 'embeddings',
      template: indexTemplate(idx),
      embedder: { provider: embedder.provider, model: embedder.model },
    }
    if (idx.chunker?.enabled) {
      entry.chunk_size = idx.chunker.targetTokens ?? settings.chunking.defaultTargetTokens
      entry.chunk_overlap = idx.chunker.overlapTokens ?? settings.chunking.defaultOverlapTokens
    }
    indexes[idx.name] = entry
  }

  return { schema, indexes }
}

function indexTemplate(idx: SearchIndexConfig): string {
  const mediaUrlField = readString(idx.mediaUrlField)
  if (mediaUrlField) return `{{#if ${mediaUrlField}}}{{remoteMedia url=${mediaUrlField}}}{{/if}}`
  return idx.template ?? idx.fields.map((field) => `{{${field}}}`).join(' ')
}

function schemaFieldToAntflyType(type: string): string[] {
  switch (type) {
    case 'text': return ['text']
    case 'keyword': return ['keyword']
    case 'number': return ['keyword']
    case 'boolean': return ['keyword']
    case 'datetime': return ['keyword']
    case 'array': return ['keyword']
    default: return ['keyword']
  }
}

function resolveEmbedder(ref: string, settings: AntflySettings): { provider: string; model: string } {
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
  return {
    provider: cfg.provider,
    model: cfg.model,
    field,
    ...(typeof cfg.threshold === 'number' ? { threshold: cfg.threshold } : {}),
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
