import { AntflyClient, matchAll } from '@antfly/sdk'
import type { QueryHit, QueryRequest, QueryResult as AntflyQueryResult } from '@antfly/sdk'
import type {
  AdapterHealthCheckDefinition,
  AdapterInitOpts,
  AdapterLogger,
} from '@bakin/core/adapters/shared'
import type {
  BatchResult,
  Document,
  IndexItem,
  Query,
  QueryDiagnostics,
  QueryResult,
  ScannedDocument,
  SearchAdapter,
  SearchHit,
  SearchIndexConfig,
  TableConfig,
  TableHealth,
  TableInfo,
  TableStats,
  TransformFn,
} from '@bakin/core/adapters/search'
import type { AntflySearchAdapterOptions } from './index'
import { startAntflyServer, stopAntflyServer } from './server'

interface AntflySettings {
  enabled: boolean
  url: string
  auth?: { username: string; password: string }
  search: {
    strategy: 'rrf' | 'semantic_only' | 'full_text_only'
    defaultLimit: number
    reranker: {
      enabled: boolean
      provider: string
      model: string
      threshold?: number
    }
  }
  embedders: Record<string, { provider: string; model: string }>
  chunking: {
    defaultTargetTokens: number
    defaultOverlapTokens: number
  }
}

interface AntflyIndexHealthEntry {
  name: string
  type: string
  totalIndexed: number
  walBacklog: number
  error?: string
  rebuilding: boolean
  backfillProgress?: number
}

const DEFAULT_SETTINGS: AntflySettings = {
  enabled: true,
  url: 'http://localhost:8080/api/v1',
  search: {
    strategy: 'rrf',
    defaultLimit: 20,
    reranker: {
      enabled: true,
      provider: 'termite',
      model: 'mixedbread-ai/mxbai-rerank-base-v1',
      threshold: 0,
    },
  },
  embedders: {
    default: { provider: 'termite', model: 'BAAI/bge-small-en-v1.5' },
    visual: { provider: 'termite', model: 'openai/clip-vit-base-patch32' },
  },
  chunking: {
    defaultTargetTokens: 200,
    defaultOverlapTokens: 25,
  },
}

const noopLogger: AdapterLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

const TRANSIENT_BATCH_ERROR_PATTERNS = [
  'still initializing',
  'not found on store',
  'shard is still initializing',
  'fetch failed',
  'ECONNREFUSED',
  'ECONNRESET',
  'socket hang up',
]

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class AntflySearchAdapter implements SearchAdapter {
  readonly name = 'antfly'
  readonly version = '0.1.0'
  readonly requiredCoreVersion = '^1.0.0'

  private client: AntflyClient | null = null
  private settings: AntflySettings
  private logger: AdapterLogger = noopLogger
  private embedderHashAtInit = ''

  constructor(options: AntflySearchAdapterOptions = {}) {
    this.settings = mergeSettings(options.settings)
  }

  async initialize(opts?: AdapterInitOpts): Promise<void> {
    this.logger = opts?.logger ?? noopLogger
    this.settings = mergeSettings(opts?.settings ?? (this.settings as unknown as Record<string, unknown>))

    if (!this.settings.enabled) {
      this.logger.info('Antfly disabled - running in file-only mode')
      this.client = null
      this.embedderHashAtInit = this.embedderHash()
      return
    }

    const serverAvailable = await startAntflyServer(this.settings, this.logger)
    if (!serverAvailable) {
      this.client = null
      this.embedderHashAtInit = this.embedderHash()
      this.logger.warn('Antfly server unavailable - running in file-only mode')
      return
    }

    const config: ConstructorParameters<typeof AntflyClient>[0] = {
      baseUrl: this.settings.url,
    }
    if (this.settings.auth) {
      config.auth = {
        type: 'basic',
        username: this.settings.auth.username,
        password: this.settings.auth.password,
      }
    }

    const client = new AntflyClient(config)
    try {
      const status = await this.waitForOperationalClient(client)
      this.client = client
      this.embedderHashAtInit = this.embedderHash()
      this.logger.info('Antfly connected', { url: this.settings.url, health: status?.health })
    } catch (err) {
      this.client = null
      this.logger.error('Failed to connect to Antfly - falling back to file-only mode', err)
    }
  }

  private async waitForOperationalClient(client: AntflyClient, timeoutMs = 15000): Promise<{ health?: unknown }> {
    const startedAt = Date.now()
    let lastError: unknown

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const status = await client.getStatus()
        await client.tables.list()
        return status as { health?: unknown }
      } catch (err) {
        lastError = err
        await sleep(500)
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Antfly did not become operational before timeout')
  }

  async shutdown(): Promise<void> {
    this.client = null
    stopAntflyServer(this.logger)
  }

  async available(): Promise<boolean> {
    return this.settings.enabled && this.client !== null
  }

  getHealthChecks(): AdapterHealthCheckDefinition[] {
    return [{
      id: 'availability',
      name: 'Antfly availability',
      run: async () => [{
        check: 'antfly.availability',
        status: await this.available() ? 'ok' : 'warn',
        message: await this.available() ? 'Antfly adapter is available' : 'Antfly adapter is unavailable',
        autoFixable: false,
      }],
    }]
  }

  tables = {
    list: async (): Promise<TableInfo[]> => {
      const client = this.client
      if (!client) return []
      try {
        return (await client.tables.list()).map((table) => ({ name: table.name }))
      } catch {
        return []
      }
    },

    create: async (name: string, config: TableConfig): Promise<void> => {
      const client = this.client
      if (!client) return
      const tables = await client.tables.list()
      if (tables.some((table) => table.name === name)) return

      const antflyConfig = this.buildTableConfig(name, config)
      await client.tables.create(name, {
        num_shards: readNumber(config.adapterOptions?.numShards, 1),
        description: readString(config.adapterOptions?.description),
        schema: antflyConfig.schema,
        indexes: antflyConfig.indexes,
      } as Record<string, unknown>)
      this.logger.info(`Table created: ${name}`)
    },

    drop: async (name: string): Promise<void> => {
      const client = this.client
      if (!client) return
      try {
        await client.tables.drop(name)
      } catch (err) {
        this.logger.warn(`Table drop failed for ${name}`, err)
      }
    },

    stats: async (name: string): Promise<TableStats | null> => {
      const client = this.client
      if (!client) return null
      try {
        const queryResult = await client.tables.query(name, { full_text_search: matchAll(), limit: 0 } as unknown as QueryRequest)
        const documents = (queryResult as unknown as { responses: Array<{ hits: { total: number } }> })
          .responses?.[0]?.hits?.total ?? 0
        return { table: name, documents }
      } catch {
        return null
      }
    },

    getHealth: async (name: string): Promise<TableHealth | null> => {
      const indexHealth = await this.getIndexHealth(name)
      if (!indexHealth) return null
      return {
        table: name,
        status: indexHealth.healthy ? 'ok' : 'warn',
        details: indexHealth,
      }
    },

    rebuildIndexes: async (name: string): Promise<void> => {
      const client = this.client
      if (!client) return
      const indexStatuses = await client.indexes.list(name)
      for (const [indexName, indexInfo] of Object.entries(indexStatuses)) {
        const config = 'config' in indexInfo ? indexInfo.config : null
        if (!config || typeof config !== 'object') continue
        try {
          await client.indexes.drop(name, indexName)
          await client.indexes.create(name, config as Parameters<typeof client.indexes.create>[1])
          this.logger.info(`Rebuilt index ${indexName} on ${name}`)
        } catch (err) {
          this.logger.warn(`Failed to rebuild index ${indexName} on ${name}`, err)
        }
      }
    },
  }

  documents = {
    index: async (table: string, key: string, doc: Document): Promise<void> => {
      const client = this.client
      if (!client || !this.settings.enabled) return
      try {
        await this.retryTransientBatch(() => client.tables.batch(table, { inserts: { [key]: doc } }))
      } catch (err) {
        this.logger.warn('Antfly index failed', { error: err, table, key })
      }
    },

    batchIndex: async (table: string, items: IndexItem[]): Promise<BatchResult> => {
      const client = this.client
      if (!client || !this.settings.enabled) return { indexed: 0, failed: [] }
      const inserts: Record<string, Document> = {}
      for (const item of items) inserts[item.key] = item.doc
      try {
        const result = await this.retryTransientBatch(() => client.tables.batch(table, { inserts }))
        return { indexed: result?.inserted ?? items.length, failed: [] }
      } catch (err) {
        this.logger.warn('Antfly batch index failed', { error: err, table, count: items.length })
        return {
          indexed: 0,
          failed: items.map((item) => ({ key: item.key, error: stringifyError(err) })),
        }
      }
    },

    remove: async (table: string, key: string): Promise<void> => {
      const client = this.client
      if (!client || !this.settings.enabled) return
      try {
        await this.retryTransientBatch(() => client.tables.batch(table, { deletes: [key] }))
      } catch (err) {
        this.logger.warn('Antfly delete failed', { error: err, table, key })
      }
    },

    batchRemove: async (table: string, keys: string[]): Promise<number> => {
      const client = this.client
      if (!client || !this.settings.enabled) return 0
      try {
        const result = await this.retryTransientBatch(() => client.tables.batch(table, { deletes: keys }))
        return result?.deleted ?? keys.length
      } catch (err) {
        this.logger.warn('Antfly batch delete failed', { error: err, table, count: keys.length })
        return 0
      }
    },

    transform: async (table: string, key: string, fn: TransformFn): Promise<void> => {
      const client = this.client
      if (!client || !this.settings.enabled) return
      try {
        const patch = await fn({})
        await this.retryTransientBatch(() => client.tables.batch(table, { inserts: { [key]: patch } }))
      } catch (err) {
        this.logger.warn('Antfly transform failed', { error: err, table, key })
      }
    },
  }

  async query(table: string, q: Query): Promise<QueryResult> {
    const client = this.client
    if (!client || !this.settings.enabled) return emptyQueryResult(q)

    const strategy = this.resolveStrategy(q.strategy)
    const limit = q.limit ?? this.settings.search.defaultLimit
    const request: QueryRequest = {
      table,
      limit,
      offset: q.offset,
      indexes: strategy === 'full_text_only' ? [] : this.resolveIndexNames(q),
    }

    if (q.text && strategy !== 'semantic_only') {
      request.full_text_search = { query: q.text } as QueryRequest['full_text_search']
    }
    if (q.text && strategy !== 'full_text_only') {
      request.semantic_search = q.text
    }
    const filterQuery = this.buildFilterQuery(q)
    if (filterQuery) request.filter_query = { query: filterQuery } as QueryRequest['filter_query']

    const aggregations = this.buildAggregations(q)
    if (aggregations) request.aggregations = aggregations as QueryRequest['aggregations']

    const reranker = this.buildRerankerConfig(q)
    if (reranker) request.reranker = reranker as QueryRequest['reranker']

    try {
      const result = await client.tables.query(table, request)
      const response = result?.responses?.[0]
      if (!response) return emptyQueryResult(q)
      return this.mapResponse(response, table)
    } catch (err) {
      this.logger.error('Antfly query failed', { error: err, table })
      return emptyQueryResult(q)
    }
  }

  async multiQuery(queries: Array<{ table: string; query: Query }>): Promise<QueryResult[]> {
    const client = this.client
    if (!client || !this.settings.enabled) return queries.map(({ query }) => emptyQueryResult(query))
    if (queries.length === 0) return []

    const requests: QueryRequest[] = queries.map(({ table, query }) => {
      const strategy = this.resolveStrategy(query.strategy)
      const req: QueryRequest = {
        table,
        limit: query.limit ?? this.settings.search.defaultLimit,
        offset: query.offset,
        indexes: strategy === 'full_text_only' ? [] : this.resolveIndexNames(query),
      }
      if (query.text && strategy !== 'semantic_only') {
        req.full_text_search = { query: query.text } as QueryRequest['full_text_search']
      }
      if (query.text && strategy !== 'full_text_only') {
        req.semantic_search = query.text
      }
      const filterQuery = this.buildFilterQuery(query)
      if (filterQuery) req.filter_query = { query: filterQuery } as QueryRequest['filter_query']
      const aggregations = this.buildAggregations(query)
      if (aggregations) req.aggregations = aggregations as QueryRequest['aggregations']
      const reranker = this.buildRerankerConfig(query)
      if (reranker) req.reranker = reranker as QueryRequest['reranker']
      return req
    })

    try {
      const result = await client.multiquery(requests)
      return queries.map(({ table, query }, index) => {
        const response = result?.responses?.[index]
        return response ? this.mapResponse(response, table) : emptyQueryResult(query)
      })
    } catch (err) {
      this.logger.error('Antfly multiquery failed', err)
      return queries.map(({ query }) => emptyQueryResult(query))
    }
  }

  async *scan(table: string): AsyncIterable<ScannedDocument> {
    const client = this.client
    if (!client || !this.settings.enabled) return
    for await (const doc of client.tables.scan(table)) {
      const { _key, ...fields } = doc as Record<string, unknown>
      if (typeof _key === 'string') yield { key: _key, document: fields }
    }
  }

  embedder = {
    hasChanged: async (): Promise<boolean> => this.embedderHashAtInit !== this.embedderHash(),
    rebuildAll: async () => {
      const tables = await this.tables.list()
      const errors: string[] = []
      for (const table of tables) {
        try {
          await this.tables.rebuildIndexes(table.name)
        } catch (err) {
          errors.push(`${table.name}: ${stringifyError(err)}`)
        }
      }
      return { tables: tables.length, documents: 0, errors }
    },
  }

  private buildTableConfig(table: string, config: TableConfig): {
    schema: Record<string, unknown>
    indexes: Record<string, unknown>
  } {
    const defaultType = readString(config.adapterOptions?.defaultType) ?? table
    const properties: Record<string, unknown> = {}
    for (const [fieldName, fieldDef] of Object.entries(config.fields)) {
      properties[fieldName] = {
        type: 'string',
        'x-antfly-types': this.schemaFieldToAntflyType(fieldDef.type),
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
      const embedder = this.resolveEmbedder(idx.embedderRef ?? 'default')
      const entry: Record<string, unknown> = {
        name: idx.name,
        type: 'embeddings',
        template: this.indexTemplate(idx),
        embedder: { provider: embedder.provider, model: embedder.model },
      }
      if (idx.chunker?.enabled) {
        entry.chunk_size = idx.chunker.targetTokens ?? this.settings.chunking.defaultTargetTokens
        entry.chunk_overlap = idx.chunker.overlapTokens ?? this.settings.chunking.defaultOverlapTokens
      }
      indexes[idx.name] = entry
    }

    return { schema, indexes }
  }

  private indexTemplate(idx: SearchIndexConfig): string {
    const mediaUrlField = readString(idx.mediaUrlField)
    if (mediaUrlField) return `{{#if ${mediaUrlField}}}{{remoteMedia url=${mediaUrlField}}}{{/if}}`
    return idx.template ?? idx.fields.map((field) => `{{${field}}}`).join(' ')
  }

  private schemaFieldToAntflyType(type: string): string[] {
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

  private resolveEmbedder(ref: string): { provider: string; model: string } {
    const match = this.settings.embedders[ref]
    if (!match) {
      const available = Object.keys(this.settings.embedders).join(', ')
      throw new Error(`Unknown embedder ref "${ref}". Available refs: ${available}`)
    }
    return match
  }

  private buildFilterQuery(q: Query): string | null {
    if (!q.filters || q.filters.length === 0) return null
    const parts = q.filters.map((filter) => {
      if (filter.op === 'eq') return `+${filter.field}:${filter.value}`
      if (filter.op === 'in' && Array.isArray(filter.value)) return `+${filter.field}:(${filter.value.join(' OR ')})`
      return `+${filter.field}:${filter.value}`
    })
    return parts.join(' ')
  }

  private buildAggregations(q: Query): Record<string, unknown> | undefined {
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

  private buildRerankerConfig(q: Query): Record<string, unknown> | undefined {
    if (q.rerank === false) return undefined
    const field = readString(q.adapterOptions?.rerankField)
    if (!field) return undefined
    const cfg = this.settings.search.reranker
    if (!cfg?.enabled) return undefined
    return {
      provider: cfg.provider,
      model: cfg.model,
      field,
      ...(typeof cfg.threshold === 'number' ? { threshold: cfg.threshold } : {}),
    }
  }

  private resolveStrategy(strategy: Query['strategy']): AntflySettings['search']['strategy'] {
    switch (strategy) {
      case 'fts': return 'full_text_only'
      case 'vector': return 'semantic_only'
      case 'hybrid': return 'rrf'
      case 'auto':
      case undefined:
        return this.settings.search.strategy
    }
  }

  private resolveIndexNames(q: Query): string[] {
    return readStringArray(q.adapterOptions?.indexes) ?? ['embeddings']
  }

  private mapResponse(response: AntflyQueryResult, table: string): QueryResult {
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

  private async getIndexHealth(table: string): Promise<{ indexes: AntflyIndexHealthEntry[]; healthy: boolean } | null> {
    const client = this.client
    if (!client) return null
    try {
      const indexStatuses = await client.indexes.list(table)
      const indexes: AntflyIndexHealthEntry[] = []
      let healthy = true
      for (const [indexName, indexInfo] of Object.entries(indexStatuses)) {
        const config = 'config' in indexInfo ? indexInfo.config : null
        const status = 'status' in indexInfo ? indexInfo.status : null
        const s = (status ?? {}) as Record<string, unknown>
        const entry: AntflyIndexHealthEntry = {
          name: indexName,
          type: (config as Record<string, unknown>)?.type as string ?? 'unknown',
          totalIndexed: (s.total_indexed as number) ?? 0,
          walBacklog: (s.wal_backlog as number) ?? 0,
          rebuilding: (s.rebuilding as boolean) ?? false,
        }
        if (s.error) {
          entry.error = String(s.error)
          healthy = false
        }
        if (entry.walBacklog > 0) healthy = false
        if (typeof s.backfill_progress === 'number') entry.backfillProgress = s.backfill_progress
        indexes.push(entry)
      }
      return { indexes, healthy }
    } catch (err) {
      this.logger.warn(`Failed to get index health for ${table}`, err)
      return null
    }
  }

  private async retryTransientBatch<T>(fn: () => Promise<T>): Promise<T> {
    const maxRetries = 5
    let lastErr: unknown
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastErr = err
        if (!isTransientBatchError(err) || attempt === maxRetries - 1) throw err
        await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempt)))
      }
    }
    throw lastErr
  }

  private embedderHash(): string {
    return Object.entries(this.settings.embedders)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, cfg]) => `${name}:${cfg.provider}:${cfg.model}`)
      .join('|')
  }
}

function mergeSettings(raw: Record<string, unknown> | undefined): AntflySettings {
  const input = (raw ?? {}) as Partial<AntflySettings>
  return {
    ...DEFAULT_SETTINGS,
    ...input,
    search: {
      ...DEFAULT_SETTINGS.search,
      ...(input.search ?? {}),
      reranker: {
        ...DEFAULT_SETTINGS.search.reranker,
        ...(input.search?.reranker ?? {}),
      },
    },
    embedders: {
      ...DEFAULT_SETTINGS.embedders,
      ...(input.embedders ?? {}),
    },
    chunking: {
      ...DEFAULT_SETTINGS.chunking,
      ...(input.chunking ?? {}),
    },
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

function emptyQueryResult(q: Query): QueryResult {
  return {
    hits: [],
    total: 0,
    diagnostics: { strategy: q.strategy === 'fts' ? 'fts' : q.strategy === 'vector' ? 'vector' : 'none', durationMs: 0 },
  }
}

function isTransientBatchError(err: unknown): boolean {
  const msg = stringifyError(err)
  return TRANSIENT_BATCH_ERROR_PATTERNS.some((pattern) => msg.includes(pattern))
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined
}
