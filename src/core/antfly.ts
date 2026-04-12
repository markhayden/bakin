/**
 * Antfly core module for Bakin.
 * Optional vector database integration — Bakin works without it.
 * When enabled, provides dual-write sync and hybrid search across all content.
 *
 * Uses @antfly/sdk AntflyClient for all API interactions.
 */
import { AntflyClient } from '@antfly/sdk'
import { matchAll } from '@antfly/sdk'
import type { QueryRequest, QueryResult, QueryHit } from '@antfly/sdk'
import { createLogger } from './logger'
import { getSettings } from './settings'
import { embeddersHash } from './embedder-resolver'

const log = createLogger('antfly')

// ---------------------------------------------------------------------------
// Singleton client (survives Next.js webpack re-evaluation)
// ---------------------------------------------------------------------------
const _g = globalThis as typeof globalThis & {
  __bakinAntflyClient?: AntflyClient | null
  __bakinAntflyReady?: boolean
  __bakinAntflyEmbedderHash?: string
}

function getClient(): AntflyClient | null { return _g.__bakinAntflyClient ?? null }
function setClient(c: AntflyClient | null) { _g.__bakinAntflyClient = c }

// ---------------------------------------------------------------------------
// Table names — bakin_ prefix for clear namespacing
// ---------------------------------------------------------------------------
export const TABLES = {
  tasks: 'bakin_tasks',
  audit: 'bakin_audit',
  assets: 'bakin_assets',
  projects: 'bakin_projects',
  workflows: 'bakin_workflows',
  schedule: 'bakin_schedule',
  team: 'bakin_team',
} as const

/** Stale beacon_ tables to wipe on startup */
const LEGACY_TABLES = [
  'beacon_tasks',
  'beacon_decisions',
  'beacon_audit',
  'beacon_content',
  'beacon_assets',
]

export type TableKey = keyof typeof TABLES

export interface SearchResult {
  id: string
  table: string
  score: number
  fields: Record<string, unknown>
  /** Per-index score breakdown (e.g. { search: 0.8, embeddings: 0.6 }) */
  indexScores?: Record<string, number>
  /** Cross-encoder reranker score (present when a reranker was used). */
  rerankScore?: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function embedderHash(settings: ReturnType<typeof getSettings>): string {
  return embeddersHash(settings)
}

function resolveTable(table: string): string {
  return TABLES[table as TableKey] || table
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function enabled(): boolean {
  return getSettings().antfly.enabled
}

export async function initialize(): Promise<void> {
  if (_g.__bakinAntflyReady) return

  const settings = getSettings()
  if (!settings.antfly.enabled) {
    log.info('Antfly disabled — running in file-only mode')
    _g.__bakinAntflyReady = true
    return
  }

  const config: ConstructorParameters<typeof AntflyClient>[0] = {
    baseUrl: settings.antfly.url,
  }
  if (settings.antfly.auth) {
    config.auth = {
      type: 'basic',
      username: settings.antfly.auth.username,
      password: settings.antfly.auth.password,
    }
  }

  const client = new AntflyClient(config)
  setClient(client)

  try {
    const status = await client.getStatus()
    log.info('Antfly connected', { url: settings.antfly.url, health: status?.health })

    // Wipe legacy beacon_* tables
    await wipeLegacyTables(client)

    // Store embedder hash for change detection
    _g.__bakinAntflyEmbedderHash = embedderHash(settings)

    _g.__bakinAntflyReady = true
  } catch (err) {
    log.error('Failed to connect to Antfly — falling back to file-only mode', err)
    setClient(null)
    _g.__bakinAntflyReady = true
  }
}

async function wipeLegacyTables(client: AntflyClient): Promise<void> {
  try {
    const tables = await client.tables.list()
    const existingNames = new Set(tables.map(t => t.name))

    for (const legacy of LEGACY_TABLES) {
      if (existingNames.has(legacy)) {
        try {
          await client.tables.drop(legacy)
          log.info(`Wiped legacy table: ${legacy}`)
        } catch (err) {
          log.warn(`Failed to wipe legacy table ${legacy}`, err)
        }
      }
    }
  } catch {
    // Can't list tables — skip cleanup
  }
}

// ---------------------------------------------------------------------------
// Table Management
// ---------------------------------------------------------------------------

export interface TableConfig {
  description?: string
  schema: {
    default_type: string
    document_schemas: Record<string, {
      schema: Record<string, unknown>
    }>
  }
  indexes: Record<string, Record<string, unknown>>
  num_shards?: number
}

/**
 * List all tables. Returns empty array if client is unavailable.
 */
export async function listTables(): Promise<Array<{ name: string }>> {
  const client = getClient()
  if (!client) return []
  try {
    return await client.tables.list()
  } catch {
    return []
  }
}

/**
 * Create a table if it doesn't already exist.
 * Returns true if the table was created, false if it already existed.
 */
export async function createTable(tableName: string, config: TableConfig): Promise<boolean> {
  const client = getClient()
  if (!client) return false

  try {
    const tables = await client.tables.list()
    if (tables.some(t => t.name === tableName)) return false

    await client.tables.create(tableName, {
      num_shards: config.num_shards ?? 1,
      description: config.description,
      schema: config.schema as Record<string, unknown>,
      indexes: config.indexes as Record<string, unknown>,
    } as Record<string, unknown>)
    log.info(`Table created: ${tableName}`)
    return true
  } catch (err) {
    log.warn(`Failed to create table ${tableName}`, err)
    return false
  }
}

/**
 * Get stats for a table (document count, index status, disk usage).
 */
export async function getTableStats(tableName: string): Promise<Record<string, unknown> | null> {
  const client = getClient()
  if (!client) return null

  try {
    // Get doc count via matchAll query with limit 0
    const queryResult = await client.tables.query(tableName, { full_text_search: matchAll(), limit: 0 } as unknown as QueryRequest)
    const total = (queryResult as unknown as { responses: Array<{ hits: { total: number } }> })
      .responses?.[0]?.hits?.total ?? 0

    // Get table metadata (indexes, schema, storage)
    let info: Record<string, unknown> = {}
    try {
      info = await client.tables.get(tableName) as unknown as Record<string, unknown>
    } catch {
      const tables = await client.tables.list()
      const match = tables.find(t => t.name === tableName)
      if (match) info = match as unknown as Record<string, unknown>
    }

    return { ...info, num_docs: total }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Index (write) — uses batch API via SDK
// ---------------------------------------------------------------------------

/**
 * Index a document to Antfly. Fire-and-forget — never blocks the caller.
 */
export async function indexDocument(
  tableName: string,
  key: string,
  doc: Record<string, unknown>,
): Promise<void> {
  const client = getClient()
  if (!client || !enabled()) return

  try {
    await client.tables.batch(tableName, {
      inserts: { [key]: doc },
    })
  } catch (err) {
    log.warn('Antfly index failed (non-blocking)', err, { table: tableName, key })
  }
}

/**
 * Remove a document from Antfly.
 */
export async function removeDocument(tableName: string, key: string): Promise<void> {
  const client = getClient()
  if (!client || !enabled()) return

  try {
    await client.tables.batch(tableName, {
      deletes: [key],
    })
  } catch (err) {
    log.warn('Antfly delete failed', err, { table: tableName, key })
  }
}

/**
 * Atomic field transform without re-embedding.
 * Uses batch inserts with partial document — Antfly merges fields.
 */
export async function transformDocument(
  tableName: string,
  key: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const client = getClient()
  if (!client || !enabled()) return

  try {
    await client.tables.batch(tableName, {
      inserts: { [key]: fields },
    })
  } catch (err) {
    log.warn('Antfly transform failed', err, { table: tableName, key })
  }
}

/**
 * Batch index multiple documents at once.
 */
export async function batchIndex(
  tableName: string,
  docs: Record<string, Record<string, unknown>>,
): Promise<number> {
  const client = getClient()
  if (!client || !enabled()) return 0

  try {
    const result = await client.tables.batch(tableName, { inserts: docs })
    return result?.inserted ?? Object.keys(docs).length
  } catch (err) {
    log.warn('Antfly batch index failed', err, { table: tableName, count: Object.keys(docs).length })
    return 0
  }
}

/**
 * Batch delete multiple documents at once.
 */
export async function batchRemove(tableName: string, keys: string[]): Promise<number> {
  const client = getClient()
  if (!client || !enabled()) return 0

  try {
    const result = await client.tables.batch(tableName, { deletes: keys })
    return result?.deleted ?? keys.length
  } catch (err) {
    log.warn('Antfly batch delete failed', err, { table: tableName, count: keys.length })
    return 0
  }
}

// ---------------------------------------------------------------------------
// Search (read) — uses SDK query/multiquery
// ---------------------------------------------------------------------------

/**
 * Build the reranker config for a QueryRequest, honoring the per-call
 * `rerank` override and the global `settings.antfly.search.reranker.enabled`
 * switch. Returns undefined when reranking should be skipped.
 *
 * Antfly requires the reranker config to specify either `field` or
 * `template` — otherwise it returns a 400 ("reranker config must specify
 * either field or template"). Bakin passes `field` from the caller
 * (sourced from each content type's `rerankField`). When no field is
 * supplied, reranking is skipped for that query rather than erroring.
 */
function buildRerankerConfig(
  settings: ReturnType<typeof getSettings>,
  rerank: boolean | undefined,
  field: string | undefined,
): Record<string, unknown> | undefined {
  if (rerank === false) return undefined
  if (!field) return undefined
  const cfg = settings.antfly.search.reranker
  if (!cfg?.enabled) return undefined
  const out: Record<string, unknown> = { provider: cfg.provider, model: cfg.model, field }
  if (typeof cfg.threshold === 'number') out.threshold = cfg.threshold
  return out
}

/**
 * Search a single table with hybrid (full-text + semantic) search.
 * `indexes` is the list of vector indexes to query — defaults to a single
 * legacy `['embeddings']` for content types that don't declare multi-index
 * definitions. Multi-index content types (e.g. assets with text + visual)
 * pass the full set here and Antfly merges them via RRF.
 *
 * `rerank` controls cross-encoder reranking per call. Defaults to true when
 * the reranker is enabled in settings; pass false for latency-sensitive
 * queries (facet-only, ID lookups, bulk scans).
 */
export async function queryTable(
  tableName: string,
  query: string,
  options: {
    limit?: number
    offset?: number
    filters?: Record<string, string | boolean | number>
    aggregations?: Record<string, unknown>
    strategy?: 'rrf' | 'semantic_only' | 'full_text_only'
    indexes?: string[]
    rerank?: boolean
    rerankField?: string
  } = {},
): Promise<{ results: SearchResult[]; aggregations?: Record<string, unknown>; took: number; total: number }> {
  const client = getClient()
  if (!client || !enabled()) {
    return { results: [], took: 0, total: 0 }
  }

  const settings = getSettings()
  const strategy = options.strategy ?? settings.antfly.search.strategy
  const limit = options.limit ?? settings.antfly.search.defaultLimit

  // full_text_search implicitly uses the full-text index — only list embedding indexes
  const indexes: string[] = []
  if (strategy !== 'full_text_only') {
    indexes.push(...(options.indexes ?? ['embeddings']))
  }

  const request: QueryRequest = {
    table: tableName,
    limit,
    offset: options.offset,
    indexes,
  }

  // Build query based on strategy
  if (strategy !== 'semantic_only') {
    request.full_text_search = { query } as QueryRequest['full_text_search']
  }
  if (strategy !== 'full_text_only') {
    request.semantic_search = query
  }

  // Build filter query from filters map
  if (options.filters && Object.keys(options.filters).length > 0) {
    const filterParts = Object.entries(options.filters)
      .map(([k, v]) => `+${k}:${v}`)
      .join(' ')
    request.filter_query = { query: filterParts } as QueryRequest['filter_query']
  }

  if (options.aggregations) {
    request.aggregations = options.aggregations as QueryRequest['aggregations']
  }

  const rerankerCfg = buildRerankerConfig(settings, options.rerank, options.rerankField)
  if (rerankerCfg) {
    request.reranker = rerankerCfg as QueryRequest['reranker']
  }

  try {
    const result = await client.tables.query(tableName, request)
    const response = result?.responses?.[0]
    if (!response) return { results: [], took: 0, total: 0 }

    return {
      results: mapHits(response, tableName),
      aggregations: response.aggregations as Record<string, unknown> | undefined,
      took: response.took ?? 0,
      total: response.hits?.total ?? 0,
    }
  } catch (err) {
    log.error('Antfly query failed', err, { table: tableName })
    return { results: [], took: 0, total: 0 }
  }
}

/**
 * Multi-table search in a single request using SDK multiquery.
 * `indexesByTable` lets callers specify the vector indexes to target per
 * table (e.g. {bakin_assets: ['assets_text', 'assets_visual']}). Tables
 * not in the map fall back to a single legacy `['embeddings']` index.
 */
export async function multiQuery(
  query: string,
  tables: string[],
  options: {
    limit?: number
    filters?: Record<string, string | boolean | number>
    aggregations?: Record<string, unknown>
    indexesByTable?: Record<string, string[]>
    rerank?: boolean
    rerankFieldByTable?: Record<string, string>
  } = {},
): Promise<{ results: SearchResult[]; aggregations?: Record<string, unknown>; took: number; total: number }> {
  const client = getClient()
  if (!client || !enabled()) {
    return { results: [], took: 0, total: 0 }
  }

  const settings = getSettings()
  const limit = options.limit ?? settings.antfly.search.defaultLimit
  const perTable = Math.ceil(limit / tables.length)

  const requests: QueryRequest[] = tables.map(tableName => {
    const req: QueryRequest = {
      table: tableName,
      full_text_search: { query } as QueryRequest['full_text_search'],
      semantic_search: query,
      indexes: options.indexesByTable?.[tableName] ?? ['embeddings'],
      limit: perTable,
    }
    if (options.filters && Object.keys(options.filters).length > 0) {
      const filterParts = Object.entries(options.filters)
        .map(([k, v]) => `+${k}:${v}`)
        .join(' ')
      req.filter_query = { query: filterParts } as QueryRequest['filter_query']
    }
    if (options.aggregations) {
      req.aggregations = options.aggregations as QueryRequest['aggregations']
    }
    const rerankerCfg = buildRerankerConfig(
      settings,
      options.rerank,
      options.rerankFieldByTable?.[tableName],
    )
    if (rerankerCfg) {
      req.reranker = rerankerCfg as QueryRequest['reranker']
    }
    return req
  })

  try {
    const result = await client.multiquery(requests)
    const allResults: SearchResult[] = []
    let totalTook = 0
    let totalHits = 0
    const mergedAggs: Record<string, unknown> = {}

    for (let i = 0; i < (result?.responses?.length ?? 0); i++) {
      const response = result!.responses![i]
      const tableName = tables[i]
      allResults.push(...mapHits(response, tableName))
      totalTook = Math.max(totalTook, response.took ?? 0)
      totalHits += response.hits?.total ?? 0
      if (response.aggregations) {
        Object.assign(mergedAggs, response.aggregations)
      }
    }

    return {
      results: allResults.sort((a, b) => b.score - a.score).slice(0, limit),
      aggregations: Object.keys(mergedAggs).length > 0 ? mergedAggs : undefined,
      took: totalTook,
      total: totalHits,
    }
  } catch (err) {
    log.error('Antfly multiquery failed', err)
    return { results: [], took: 0, total: 0 }
  }
}

function mapHits(response: QueryResult, tableName: string): SearchResult[] {
  if (!response?.hits?.hits) return []
  return response.hits.hits.map((hit: QueryHit) => {
    const raw = hit as Record<string, unknown>
    return {
      id: hit._id || '',
      table: tableName,
      score: hit._score || 0,
      fields: hit._source || {},
      indexScores: raw._index_scores as Record<string, number> | undefined,
      rerankScore: raw._rerank_score as number | undefined,
    }
  })
}

// ---------------------------------------------------------------------------
// Table scanning
// ---------------------------------------------------------------------------

/**
 * Scan all keys in a table. Returns an async generator.
 */
export async function* scanTable(
  tableName: string,
): AsyncGenerator<{ key: string; doc: Record<string, unknown> }> {
  const client = getClient()
  if (!client || !enabled()) return

  for await (const doc of client.tables.scan(tableName)) {
    const { _key, ...fields } = doc
    yield { key: _key, doc: fields }
  }
}

// ---------------------------------------------------------------------------
// Index management
// ---------------------------------------------------------------------------

/**
 * Rebuild indexes for a table (drops + re-creates).
 * Triggers full re-embedding for vector indexes.
 */
export async function rebuildIndexes(tableName: string): Promise<boolean> {
  const client = getClient()
  if (!client) return false

  try {
    // Get current index configs, then drop + re-create each
    const indexStatuses = await client.indexes.list(tableName)
    for (const [indexName, indexInfo] of Object.entries(indexStatuses)) {
      const config = 'config' in indexInfo ? indexInfo.config : null
      if (!config || typeof config !== 'object') continue

      try {
        await client.indexes.drop(tableName, indexName)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await client.indexes.create(tableName, config as any)
        log.info(`Rebuilt index ${indexName} on ${tableName}`)
      } catch (err) {
        log.warn(`Failed to rebuild index ${indexName} on ${tableName}`, err)
      }
    }
    return true
  } catch (err) {
    log.error(`Failed to rebuild indexes for ${tableName}`, err)
    return false
  }
}

/**
 * Check if the embedder config has changed since initialization.
 * If so, indexes need to be rebuilt.
 */
export function hasEmbedderChanged(): boolean {
  const settings = getSettings()
  const current = embedderHash(settings)
  return _g.__bakinAntflyEmbedderHash !== current
}

/**
 * Index an audit event.
 */
export async function indexAuditEvent(entry: {
  ts: string
  event: string
  agent: string
  data: Record<string, unknown>
}): Promise<void> {
  await indexDocument(TABLES.audit, `audit-${entry.ts}-${entry.event}`, {
    content: `[${entry.ts}] ${entry.event} by ${entry.agent}: ${JSON.stringify(entry.data)}`,
    event: entry.event,
    agent: entry.agent,
    created_at: entry.ts,
    ...entry.data,
  })
}

