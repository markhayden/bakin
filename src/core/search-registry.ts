/**
 * Search Registry — singleton that manages plugin content type registrations
 * and provides SearchAPI instances for each plugin.
 *
 * Uses globalThis to survive Next.js webpack re-evaluation.
 */
import type {
  SearchAPI,
  SearchContentTypeDefinition,
  SearchIndexDefinition,
  SearchQueryParams,
  SearchResponse,
  SearchResult,
  SearchTransformOp,
} from '../../packages/core/src/plugin-types'
import * as antfly from './antfly'
import { broadcast } from './sse'
import { createLogger } from './logger'
import { getSettings } from './settings'
import { resolveEmbedder } from './embedder-resolver'

const log = createLogger('search-registry')

// ---------------------------------------------------------------------------
// Registry singleton (globalThis-backed)
// ---------------------------------------------------------------------------
interface RegistryState {
  /** Map of full table name → content type definition */
  contentTypes: Map<string, SearchContentTypeDefinition & { pluginId: string }>
  /** Map of pluginId → full table name */
  pluginTables: Map<string, string>
  /** Whether tables have been created during this startup */
  tablesCreated: boolean
}

const _g = globalThis as typeof globalThis & {
  __bakinSearchRegistry?: RegistryState
}

function getRegistry(): RegistryState {
  if (!_g.__bakinSearchRegistry) {
    _g.__bakinSearchRegistry = {
      contentTypes: new Map(),
      pluginTables: new Map(),
      tablesCreated: false,
    }
  }
  return _g.__bakinSearchRegistry
}

// ---------------------------------------------------------------------------
// Table name resolution
// ---------------------------------------------------------------------------
const TABLE_PREFIX = 'bakin_'

function fullTableName(table: string): string {
  return table.startsWith(TABLE_PREFIX) ? table : `${TABLE_PREFIX}${table}`
}

// ---------------------------------------------------------------------------
// Table creation from schema
// ---------------------------------------------------------------------------

function schemaFieldToAntflyType(field: SearchContentTypeDefinition['schema'][string]): string[] {
  switch (field.type) {
    case 'text': return ['text']
    case 'keyword': return ['keyword']
    case 'number': return ['keyword'] // stored as keyword for filtering
    case 'boolean': return ['keyword']
    case 'datetime': return ['keyword']
    case 'array': return ['keyword']
    default: return ['keyword']
  }
}

function buildAntflySchema(def: SearchContentTypeDefinition): { default_type: string; document_schemas: Record<string, { schema: Record<string, unknown> }> } {
  const properties: Record<string, unknown> = {}
  for (const [fieldName, fieldDef] of Object.entries(def.schema)) {
    properties[fieldName] = {
      type: 'string',
      'x-antfly-types': schemaFieldToAntflyType(fieldDef),
    }
  }

  return {
    default_type: def.table,
    document_schemas: {
      [def.table]: {
        schema: {
          type: 'object',
          properties,
          'x-antfly-include-in-all': def.searchableFields,
        },
      },
    },
  }
}

/**
 * Compute the effective list of vector indexes for a content type. When
 * `def.indexes` is set, returns it as-is. Otherwise synthesizes a single
 * default index named `embeddings` from the top-level `embeddingTemplate`
 * — this preserves backward compatibility with every content type
 * registered before multi-index support existed, and keeps their Antfly
 * table schemas stable across the upgrade.
 */
function getEffectiveIndexes(def: SearchContentTypeDefinition): SearchIndexDefinition[] {
  if (def.indexes && def.indexes.length > 0) {
    return def.indexes
  }
  return [
    {
      name: 'embeddings',
      embedderRef: 'default',
      embeddingTemplate: def.embeddingTemplate,
      chunker: def.chunker,
    },
  ]
}

function buildAntflyIndexes(def: SearchContentTypeDefinition): Record<string, Record<string, unknown>> {
  const settings = getSettings()
  const indexes: Record<string, Record<string, unknown>> = {
    search: {
      name: 'search',
      type: 'full_text',
    },
  }

  for (const idx of getEffectiveIndexes(def)) {
    const embedder = resolveEmbedder(idx.embedderRef, settings)
    const entry: Record<string, unknown> = {
      name: idx.name,
      type: 'embeddings',
      template: idx.embeddingTemplate,
      embedder: { provider: embedder.provider, model: embedder.model },
    }
    if (idx.chunker?.enabled) {
      entry.chunk_size = idx.chunker.targetTokens ?? settings.antfly.chunking.defaultTargetTokens
      entry.chunk_overlap = idx.chunker.overlapTokens ?? settings.antfly.chunking.defaultOverlapTokens
    }
    indexes[idx.name] = entry
  }

  return indexes
}

/**
 * Ensure one table exists. Throws on creation failure so callers can
 * surface the error rather than silently treating it like "already
 * existed". `antfly.createTable` itself swallows errors and returns
 * `false`, so we re-list to disambiguate "skipped, already there" from
 * "tried and failed". This is critical because the most common failure
 * mode (missing embedder model) presents as a silent zero-doc reindex.
 */
async function ensureTable(def: SearchContentTypeDefinition, existingNames?: Set<string>): Promise<'created' | 'exists'> {
  const tableName = fullTableName(def.table)

  if (existingNames?.has(tableName)) return 'exists'

  const created = await antfly.createTable(tableName, {
    description: `Bakin ${def.table} — auto-created by search registry`,
    schema: buildAntflySchema(def),
    indexes: buildAntflyIndexes(def),
    num_shards: 1,
  })
  if (created) {
    log.info(`Search table created: ${tableName}`)
    return 'created'
  }

  // createTable returned false — either the table already existed or the
  // create itself failed and got swallowed. Re-list and verify.
  const after = await antfly.listTables()
  if (after.some(t => t.name === tableName)) return 'exists'
  throw new Error(`Antfly rejected create for ${tableName} — see antfly warn logs (likely missing embedder model)`)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EnsureTablesResult {
  created: number
  failures: Array<{ table: string; pluginId: string; error: string }>
}

/**
 * Ensure every registered content type has a corresponding Antfly table.
 * Idempotent — re-lists Antfly tables on every call so it self-heals when
 * Antfly is wiped, restarted, or otherwise drifts from Bakin's registry.
 *
 * Returns both the count of tables created and any per-table failures so
 * callers (notably the `/api/reindex` handler) can surface real errors
 * instead of reporting `indexed: 0` for tables that never got created.
 */
export async function ensureRegisteredTables(): Promise<EnsureTablesResult> {
  const registry = getRegistry()
  if (!antfly.enabled()) {
    registry.tablesCreated = true
    return { created: 0, failures: [] }
  }

  const existingTables = await antfly.listTables()
  const existingNames = new Set(existingTables.map(t => t.name))

  let created = 0
  const failures: Array<{ table: string; pluginId: string; error: string }> = []
  for (const [tableName, def] of registry.contentTypes) {
    if (existingNames.has(tableName)) continue
    try {
      const status = await ensureTable(def, existingNames)
      if (status === 'created') created++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`Failed to create table for ${def.table}`, err)
      failures.push({ table: tableName, pluginId: def.pluginId, error: msg })
    }
  }

  registry.tablesCreated = true
  return { created, failures }
}

/**
 * Create tables for all registered content types.
 * Called during server startup after all plugins have activated.
 */
export async function createRegisteredTables(): Promise<void> {
  const registry = getRegistry()
  if (registry.tablesCreated) return
  const { created, failures } = await ensureRegisteredTables()
  log.info(`Search tables ready: ${registry.contentTypes.size} content types (${created} created)`)
  if (failures.length > 0) {
    log.error(`Search table creation failures: ${failures.length}`, { failures })
  }
}

/**
 * Get all registered content types (for reindex, health, etc.).
 */
export function getContentTypes(): Map<string, SearchContentTypeDefinition & { pluginId: string }> {
  return getRegistry().contentTypes
}

/**
 * Get the full table name for a plugin.
 */
export function getPluginTable(pluginId: string): string | undefined {
  return getRegistry().pluginTables.get(pluginId)
}

/**
 * Get the effective vector index names for a table. Used by query callers
 * to know which indexes to target when running semantic search. Returns
 * ['embeddings'] for tables with no registration (e.g. unknown or legacy
 * tables) so queries degrade gracefully rather than targeting nothing.
 */
export function getIndexNames(tableName: string): string[] {
  const def = getRegistry().contentTypes.get(tableName)
  if (!def) return ['embeddings']
  return getEffectiveIndexes(def).map(i => i.name)
}

/**
 * Get the rerank field for a table, or undefined if the content type did
 * not declare one. Callers that pass this to queryTable will have the
 * cross-encoder reranker attached only when a field is set.
 */
export function getRerankField(tableName: string): string | undefined {
  return getRegistry().contentTypes.get(tableName)?.rerankField
}

/**
 * Build a SearchAPI instance scoped to a specific plugin.
 * This is what gets injected as ctx.search in PluginContext.
 */
export function buildSearchAPI(pluginId: string): SearchAPI {
  const registry = getRegistry()

  return {
    registerContentType(def: SearchContentTypeDefinition): void {
      const tableName = fullTableName(def.table)
      registry.contentTypes.set(tableName, { ...def, pluginId })
      registry.pluginTables.set(pluginId, tableName)
      log.info(`Content type registered: ${tableName} (plugin: ${pluginId})`)
    },

    async index(key: string, doc: Record<string, unknown>): Promise<void> {
      const tableName = registry.pluginTables.get(pluginId)
      if (!tableName) {
        log.warn(`Plugin ${pluginId} called search.index() but has no registered content type`)
        return
      }
      await antfly.indexDocument(tableName, key, doc)
    },

    async remove(key: string): Promise<void> {
      const tableName = registry.pluginTables.get(pluginId)
      if (!tableName) return
      await antfly.removeDocument(tableName, key)
    },

    async transform(key: string, operations: SearchTransformOp[]): Promise<void> {
      const tableName = registry.pluginTables.get(pluginId)
      if (!tableName) return

      // Build a flat field update from transform ops
      const fields: Record<string, unknown> = {}
      for (const op of operations) {
        if (op.op === '$set' && op.field) {
          fields[op.field] = op.value
        }
        // $inc and $push would need server-side support — for now, treat as $set
        if (op.op === '$inc' && op.field) {
          fields[op.field] = op.value
        }
        if (op.op === '$push' && op.field) {
          fields[op.field] = op.value
        }
      }
      await antfly.transformDocument(tableName, key, fields)
    },

    async query(params: SearchQueryParams): Promise<SearchResponse> {
      const tableName = registry.pluginTables.get(pluginId)
      if (!tableName || !antfly.enabled()) {
        return {
          results: [],
          meta: { query: params.q, total: 0, took_ms: 0, source: 'fallback' },
        }
      }

      // Build aggregations from facets (term buckets) and merge with any
      // raw aggregations the caller passed directly. Caller-provided
      // aggregations win on key collision.
      const facetAggs: Record<string, unknown> = {}
      for (const f of params.facets ?? []) {
        facetAggs[f] = { type: 'terms', field: f, size: 50 }
      }
      const mergedAggs = { ...facetAggs, ...(params.aggregations ?? {}) }
      const aggregations: Record<string, unknown> | undefined =
        Object.keys(mergedAggs).length > 0 ? mergedAggs : undefined

      const result = await antfly.queryTable(tableName, params.q, {
        limit: params.limit,
        offset: params.offset,
        filters: params.filters,
        aggregations,
        indexes: getIndexNames(tableName),
        rerank: params.rerank,
        rerankField: getRerankField(tableName),
      })

      // Map aggregation results to our format
      let mappedAggs: Record<string, Array<{ value: string; count: number }>> | undefined
      if (result.aggregations) {
        mappedAggs = {}
        for (const [key, agg] of Object.entries(result.aggregations)) {
          const aggObj = agg as { buckets?: Array<{ key: string; doc_count: number }> }
          if (aggObj?.buckets) {
            mappedAggs[key] = aggObj.buckets.map(b => ({
              value: String(b.key),
              count: b.doc_count,
            }))
          }
        }
      }

      return {
        results: result.results as SearchResult[],
        aggregations: mappedAggs,
        rawAggregations: result.aggregations as Record<string, unknown> | undefined,
        meta: {
          query: params.q,
          total: result.total,
          took_ms: result.took,
          source: 'antfly',
        },
      }
    },
  }
}

/**
 * Reindex all (or one) registered content types by running their reindex() generators.
 * Returns per-table counts.
 *
 * Self-heals: ensures every registered table actually exists on Antfly
 * before iterating. If Antfly was wiped or restarted since Bakin last
 * ran createRegisteredTables, this transparently recreates the missing
 * tables instead of silently writing to nothing.
 *
 * Broadcasts two channels of events:
 *   - Per-table: reindex.start / reindex.progress / reindex.complete
 *     (drives the Health page tiles)
 *   - Aggregate: reindex.batch_start / reindex.batch_pulse / reindex.batch_complete
 *     (drives a single Live Activity entry instead of one per table)
 */
export async function reindexContentTypes(opts?: {
  table?: string
  rebuild?: boolean
}): Promise<Array<{ table: string; pluginId: string; indexed: number; error?: string }>> {
  const registry = getRegistry()
  const results: Array<{ table: string; pluginId: string; indexed: number; error?: string }> = []

  // Self-heal: make sure tables exist on Antfly before we try to write to
  // them. Cheap when nothing's missing (one list call); critical when
  // Antfly was wiped externally. Per-table failures are surfaced as
  // reindex results below so the API caller sees the real reason instead
  // of a misleading `indexed: 0`.
  const failedTables = new Map<string, string>()
  try {
    const ensured = await ensureRegisteredTables()
    if (ensured.created > 0) log.info(`Reindex auto-created ${ensured.created} missing table(s)`)
    for (const f of ensured.failures) failedTables.set(f.table, f.error)
  } catch (err) {
    log.warn('ensureRegisteredTables failed before reindex', err)
  }

  // Build the list of tables we'll actually process so the aggregate
  // events can include accurate totals.
  const tablesToProcess: Array<[string, SearchContentTypeDefinition & { pluginId: string }]> = []
  for (const [tableName, def] of registry.contentTypes) {
    if (opts?.table && tableName !== fullTableName(opts.table) && opts.table !== def.table && opts.table !== def.pluginId) {
      continue
    }
    tablesToProcess.push([tableName, def])
  }

  const startedAt = Date.now()
  let totalIndexed = 0
  let tablesDone = 0

  broadcast({
    type: 'reindex.batch_start',
    tables: tablesToProcess.length,
    scope: opts?.table ?? 'all',
  })

  // Periodic pulse so long-running reindexes show life in the activity
  // feed without spamming once per table. 60s cadence — short reindexes
  // finish before the first pulse and only emit start + complete.
  const PULSE_MS = 60_000
  const pulseTimer = setInterval(() => {
    broadcast({
      type: 'reindex.batch_pulse',
      tables_done: tablesDone,
      tables_total: tablesToProcess.length,
      indexed: totalIndexed,
      elapsed_ms: Date.now() - startedAt,
    })
  }, PULSE_MS)

  try {
    for (const [tableName, def] of tablesToProcess) {
      // If ensureRegisteredTables couldn't create this table, skip the
      // reindex generator entirely and surface the actual reason instead
      // of writing 0 docs to a non-existent table.
      const ensureError = failedTables.get(tableName)
      if (ensureError) {
        results.push({ table: tableName, pluginId: def.pluginId, indexed: 0, error: ensureError })
        broadcast({ type: 'reindex.complete', table: tableName, pluginId: def.pluginId, indexed: 0, error: ensureError })
        tablesDone++
        continue
      }
      try {
        // Rebuild indexes if requested
        if (opts?.rebuild) {
          await antfly.rebuildIndexes(tableName)
          log.info(`Rebuilt indexes for ${tableName}`)
        }

        // Run the reindex generator
        let count = 0
        if (def.reindex) {
          broadcast({ type: 'reindex.start', table: tableName, pluginId: def.pluginId })

          const BATCH_SIZE = 50
          const batch: Array<{ key: string; doc: Record<string, unknown> }> = []
          for await (const { key, doc } of def.reindex()) {
            batch.push({ key, doc: doc as Record<string, unknown> })
            if (batch.length >= BATCH_SIZE) {
              const batchMap: Record<string, Record<string, unknown>> = {}
              for (const b of batch) batchMap[b.key] = b.doc
              count += await antfly.batchIndex(tableName, batchMap)
              batch.length = 0
              broadcast({ type: 'reindex.progress', table: tableName, pluginId: def.pluginId, indexed: count })
            }
          }
          if (batch.length > 0) {
            const batchMap: Record<string, Record<string, unknown>> = {}
            for (const b of batch) batchMap[b.key] = b.doc
            count += await antfly.batchIndex(tableName, batchMap)
            broadcast({ type: 'reindex.progress', table: tableName, pluginId: def.pluginId, indexed: count })
          }
        }

        broadcast({ type: 'reindex.complete', table: tableName, pluginId: def.pluginId, indexed: count })
        results.push({ table: tableName, pluginId: def.pluginId, indexed: count })
        totalIndexed += count
      } catch (err) {
        results.push({ table: tableName, pluginId: def.pluginId, indexed: 0, error: String(err) })
        log.error(`Reindex failed for ${tableName}`, err)
      }
      tablesDone++
    }
  } finally {
    clearInterval(pulseTimer)
  }

  broadcast({
    type: 'reindex.batch_complete',
    tables: tablesToProcess.length,
    indexed: totalIndexed,
    elapsed_ms: Date.now() - startedAt,
  })

  return results
}

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
  if (!antfly.enabled()) {
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
        return { results: [], meta: { query: q, total: 0, took_ms: 0, source: 'antfly' } }
      }
      return crossTableSearch(q, { ...opts, table: resolved.replace(TABLE_PREFIX, '') })
    }

    const aggregations: Record<string, unknown> | undefined = (opts?.facets ?? def.facets)?.length
      ? Object.fromEntries(
          (opts?.facets ?? def.facets ?? []).map(f => [f, { type: 'terms', field: f, size: 50 }])
        )
      : undefined

    const result = await antfly.queryTable(tableName, q, {
      limit,
      offset: opts?.offset,
      filters: opts?.filters,
      aggregations,
      indexes: getIndexNames(tableName),
      rerankField: getRerankField(tableName),
    })

    return {
      results: result.results.map(r => ({ ...r, _table: tableName })),
      aggregations: mapAggregations(result.aggregations),
      meta: { query: q, total: result.total, took_ms: result.took, source: 'antfly' },
    }
  }

  // Cross-table search via multiQuery
  const tables = Array.from(registry.contentTypes.keys())
  if (tables.length === 0) {
    return { results: [], meta: { query: q, total: 0, took_ms: 0, source: 'antfly' } }
  }

  const indexesByTable: Record<string, string[]> = {}
  const rerankFieldByTable: Record<string, string> = {}
  for (const t of tables) {
    indexesByTable[t] = getIndexNames(t)
    const field = getRerankField(t)
    if (field) rerankFieldByTable[t] = field
  }

  const result = await antfly.multiQuery(q, tables, { limit, indexesByTable, rerankFieldByTable })
  return {
    results: result.results.slice(0, limit),
    meta: { query: q, total: result.total, took_ms: result.took, source: 'antfly' },
  }
}

/**
 * Get health/stats for all registered search tables.
 */
export async function getSearchHealth(): Promise<{
  enabled: boolean
  tables: Array<{ table: string; pluginId: string; stats: Record<string, unknown> | null }>
}> {
  const registry = getRegistry()
  const isEnabled = antfly.enabled()

  if (!isEnabled) {
    return { enabled: false, tables: [] }
  }

  const tables: Array<{ table: string; pluginId: string; stats: Record<string, unknown> | null }> = []
  for (const [tableName, def] of registry.contentTypes) {
    try {
      const stats = await antfly.getTableStats(tableName)
      tables.push({ table: tableName, pluginId: def.pluginId, stats })
    } catch {
      tables.push({ table: tableName, pluginId: def.pluginId, stats: null })
    }
  }

  return { enabled: isEnabled, tables }
}

function mapAggregations(aggs: Record<string, unknown> | undefined): Record<string, Array<{ value: string; count: number }>> | undefined {
  if (!aggs) return undefined
  const mapped: Record<string, Array<{ value: string; count: number }>> = {}
  for (const [key, agg] of Object.entries(aggs)) {
    const aggObj = agg as { buckets?: Array<{ key: string; doc_count: number }> }
    if (aggObj?.buckets) {
      mapped[key] = aggObj.buckets.map(b => ({
        value: String(b.key),
        count: b.doc_count,
      }))
    }
  }
  return mapped
}

/**
 * Reset the registry (for testing).
 */
export function resetSearchRegistry(): void {
  _g.__bakinSearchRegistry = undefined
}
