/**
 * Search Registry core — the globalThis-backed singleton state, table
 * provisioning, per-plugin table resolution, and the shared query/result
 * mappers. The feature surfaces (search-plugin-api, search-reindex,
 * search-query) build on this; `search-registry.ts` re-exports everything as
 * the stable public barrel.
 *
 * Uses globalThis so every reach into this module shares one registry.
 */
import type {
  FileBackedContentTypeDefinition,
  SearchContentTypeDefinition,
  SearchIndexDefinition,
  SearchQueryParams,
  SearchResponse,
  SearchResult,
} from '../../packages/core/src/plugin-types'
import type {
  AggregationRequest,
  Filter,
  FacetCount,
  Query,
  SearchAdapter,
  SearchHit,
  TableConfig,
} from '@bakin/core/adapters/search'
import { createLogger } from './logger'
import { getAppServices } from './app-services'

const log = createLogger('search-registry-core')

// ---------------------------------------------------------------------------
// Registry singleton (globalThis-backed)
// ---------------------------------------------------------------------------
export interface RegistryState {
  /** Map of full table name → content type definition */
  contentTypes: Map<string, SearchContentTypeDefinition & { pluginId: string }>
  /** Map of pluginId → full table name */
  pluginTables: Map<string, string>
  /** File-backed watcher hook disposers by full table name. */
  fileBackedWiring: Map<string, { pluginId: string; dispose: () => void }>
  /** Whether tables have been created during this startup */
  tablesCreated: boolean
  /**
   * File-backed registrations awaiting their first startup reconcile.
   * Reconciles are deferred until after `createRegisteredTables()` so
   * the underlying search tables exist before we try to scan them.
   * Drained by `runPendingReconciles()`.
   */
  pendingReconciles: Array<{
    pluginId: string
    def: FileBackedContentTypeDefinition
  }>
}

const _g = globalThis as typeof globalThis & {
  __bakinSearchRegistry?: RegistryState
}

export function getRegistry(): RegistryState {
  if (!_g.__bakinSearchRegistry) {
    _g.__bakinSearchRegistry = {
      contentTypes: new Map(),
      pluginTables: new Map(),
      fileBackedWiring: new Map(),
      tablesCreated: false,
      pendingReconciles: [],
    }
  }
  return _g.__bakinSearchRegistry
}

export function getSearchAdapter(): SearchAdapter {
  return getAppServices().search
}

// ---------------------------------------------------------------------------
// Table name resolution
// ---------------------------------------------------------------------------
export const TABLE_PREFIX = 'bakin_'

export function fullTableName(table: string): string {
  return table.startsWith(TABLE_PREFIX) ? table : `${TABLE_PREFIX}${table}`
}

export function removePendingReconciles(pluginId: string, tableName?: string): number {
  const registry = getRegistry()
  let removed = 0
  const keep = registry.pendingReconciles.filter((item) => {
    const matchesPlugin = item.pluginId === pluginId
    const matchesTable = tableName === undefined || fullTableName(item.def.table) === tableName
    const shouldRemove = matchesPlugin && matchesTable
    if (shouldRemove) removed++
    return !shouldRemove
  })
  registry.pendingReconciles.length = 0
  registry.pendingReconciles.push(...keep)
  return removed
}

export function disposeFileBackedWiring(tableName: string): void {
  const registry = getRegistry()
  const wiring = registry.fileBackedWiring.get(tableName)
  if (!wiring) return
  registry.fileBackedWiring.delete(tableName)
  try {
    wiring.dispose()
  } catch (err) {
    log.warn('File-backed watcher cleanup failed', err, { tableName, pluginId: wiring.pluginId })
  }
}

function forgetContentType(tableName: string, def?: { pluginId: string }): boolean {
  const registry = getRegistry()
  const existing = def ?? registry.contentTypes.get(tableName)
  const removed = registry.contentTypes.delete(tableName)
  disposeFileBackedWiring(tableName)
  if (existing) {
    removePendingReconciles(existing.pluginId, tableName)
    if (registry.pluginTables.get(existing.pluginId) === tableName) {
      registry.pluginTables.delete(existing.pluginId)
    }
  }
  return removed
}

// ---------------------------------------------------------------------------
// Table creation from schema
// ---------------------------------------------------------------------------

/**
 * Compute the effective list of vector indexes for a content type. When
 * `def.indexes` is set, returns it as-is. Otherwise synthesizes a single
 * default index named `embeddings` from the top-level `embeddingTemplate`
 * — this keeps older content type definitions on stable search table
 * schemas even when they do not declare explicit indexes.
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

function buildTableConfig(def: SearchContentTypeDefinition): TableConfig {
  return {
    fields: def.schema,
    indexes: getEffectiveIndexes(def).map((idx) => ({
      name: idx.name,
      kind: 'vector',
      fields: def.searchableFields,
      embedderRef: idx.embedderRef,
      template: idx.embeddingTemplate,
      mediaUrlField: idx.mediaUrlField,
      chunker: idx.chunker,
    })),
    adapterOptions: {
      defaultType: def.table,
      description: `Bakin ${def.table} - auto-created by search registry`,
      searchableFields: def.searchableFields,
      facets: def.facets,
      ttl: def.ttl,
      ttlField: def.ttlField,
      numShards: 1,
    },
  }
}

/**
 * Ensure one table exists. Throws on creation failure so callers can
 * surface the error rather than silently treating it like "already
 * existed". The adapter owns provider-specific create semantics, so we
 * re-list after create to disambiguate "skipped, already there" from
 * "tried and failed".
 */
async function ensureTable(search: SearchAdapter, def: SearchContentTypeDefinition, existingNames?: Set<string>): Promise<'created' | 'exists'> {
  const tableName = fullTableName(def.table)

  if (existingNames?.has(tableName)) return 'exists'

  await search.tables.create(tableName, buildTableConfig(def))
  const after = await search.tables.list()
  if (after.some(t => t.name === tableName)) return 'created'
  throw new Error(`Search adapter rejected create for ${tableName}`)
}

// ---------------------------------------------------------------------------
// Table provisioning
// ---------------------------------------------------------------------------

export interface EnsureTablesResult {
  created: number
  failures: Array<{ table: string; pluginId: string; error: string }>
}

/**
 * Ensure every registered content type has a corresponding search table.
 * Idempotent — re-lists adapter tables on every call so it self-heals when
 * the search backend is wiped, restarted, or otherwise drifts from Bakin's registry.
 *
 * Returns both the count of tables created and any per-table failures so
 * callers (notably the `/api/reindex` handler) can surface real errors
 * instead of reporting `indexed: 0` for tables that never got created.
 */
export async function ensureRegisteredTables(): Promise<EnsureTablesResult> {
  const registry = getRegistry()
  const search = getSearchAdapter()
  if (!await search.available()) {
    registry.tablesCreated = true
    return { created: 0, failures: [] }
  }

  const existingTables = await search.tables.list()
  const existingNames = new Set(existingTables.map(t => t.name))

  let created = 0
  const failures: Array<{ table: string; pluginId: string; error: string }> = []
  for (const [tableName, def] of registry.contentTypes) {
    if (existingNames.has(tableName)) continue
    try {
      const status = await ensureTable(search, def, existingNames)
      if (status === 'created') created++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`Failed to create table for ${def.table}`, err)
      failures.push({ table: tableName, pluginId: def.pluginId, error: msg })
    }
  }

  // Only mark the registry as fully provisioned when every table created
  // cleanly. If any failed, leave the flag false so the next call retries
  // them rather than short-circuiting on the cached "done" signal.
  if (failures.length === 0) {
    registry.tablesCreated = true
  }
  return { created, failures }
}

/**
 * Create tables for all registered content types.
 * Called during server startup after all plugins have activated.
 */
export async function createRegisteredTables(): Promise<EnsureTablesResult> {
  const registry = getRegistry()
  if (registry.tablesCreated) return { created: 0, failures: [] }
  const { created, failures } = await ensureRegisteredTables()
  log.info(`Search tables ready: ${registry.contentTypes.size} content types (${created} created)`)
  if (failures.length > 0) {
    log.error(`Search table creation failures: ${failures.length}`, { failures })
  }
  return { created, failures }
}

/**
 * Get all registered content types (for reindex, health, etc.).
 */
export function getContentTypes(): Map<string, SearchContentTypeDefinition & { pluginId: string }> {
  return getRegistry().contentTypes
}

/**
 * Purge a single content type — drop the underlying search table (atomic
 * delete-all) and remove the in-memory registration. Used by
 * `bakin plugins remove` (#119) to tear down a plugin's index entries
 * before deleting the plugin itself.
 *
 * Accepts either the bare content-type name (`memory`) or the prefixed
 * full table name (`bakin_memory`). Returns the row count present at
 * purge time (best-effort via search adapter table stats; 0 when stats are unavailable
 * or the search adapter is unavailable).
 *
 * No-op + returns 0 when the search adapter is unavailable — the in-memory registration
 * still gets cleared so the plugin can re-register on next install.
 */
export async function purgeContentType(name: string): Promise<number> {
  const registry = getRegistry()
  const search = getSearchAdapter()
  const tableName = fullTableName(name)
  const def = registry.contentTypes.get(tableName)

  if (!await search.available()) {
    if (def) forgetContentType(tableName, def)
    return 0
  }

  let removed = 0
  try {
    const stats = await search.tables.stats(tableName)
    removed = stats?.documents ?? 0
  } catch (err) {
    log.warn('purgeContentType: failed to read row count before drop', err, { tableName })
  }

  try {
    await search.tables.drop(tableName)
  } catch (err) {
    log.error('purgeContentType: table drop failed', err, { tableName })
    throw err
  }

  if (def) forgetContentType(tableName, def)

  log.info(`Purged content type ${tableName} (${removed} docs)`)
  return removed
}

/**
 * Remove a plugin's in-memory search registrations and file watcher hooks
 * without dropping the underlying search tables. This is the hot-reload path:
 * the plugin will immediately re-register its content types on activate, and
 * preserving the table avoids destructive dev-loop behavior on every save.
 */
export function unregisterContentTypesByPlugin(pluginId: string): number {
  const registry = getRegistry()
  const ownedTables = [...registry.contentTypes.entries()]
    .filter(([, def]) => def.pluginId === pluginId)
    .map(([tableName, def]) => ({ tableName, def }))

  for (const { tableName, def } of ownedTables) {
    forgetContentType(tableName, def)
  }
  removePendingReconciles(pluginId)
  return ownedTables.length
}

/**
 * Get the full table name a plugin's `/search` route and MCP plugin-param
 * routing resolve to — the plugin's PRIMARY content type. Returns null when the
 * plugin has registered no content type. A plugin with multiple content types
 * (one direct primary + secondary file-backed types, e.g. team) resolves to its
 * primary; it no longer throws (the dispatch layers route to one table per plugin,
 * and secondary file-backed types are indexed directly, not via this path).
 */
export function getTableForPlugin(pluginId: string): string | null {
  return getRegistry().pluginTables.get(pluginId) ?? null
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
 * not declare one. Callers that pass this to the search adapter will have the
 * cross-encoder reranker attached only when a field is set.
 */
export function getRerankField(tableName: string): string | undefined {
  return getRegistry().contentTypes.get(tableName)?.rerankField
}

// ---------------------------------------------------------------------------
// Shared query/result mappers (used by search-plugin-api + search-query)
// ---------------------------------------------------------------------------

export function adapterHitToPluginResult(hit: SearchHit, tableName: string): SearchResult {
  // Surface the per-index score breakdown (BM25 / text-embedding / visual)
  // minus the rerank entry, which has its own field. Powers the debug overlay.
  const { rerank, ...indexScores } = hit.scoreBreakdown ?? {}
  return {
    id: hit.key,
    table: tableName,
    score: hit.score,
    fields: hit.document,
    rerankScore: rerank,
    ...(Object.keys(indexScores).length > 0 ? { indexScores } : {}),
  }
}

export function filtersFromRecord(filters?: Record<string, string | boolean | number>): Filter[] | undefined {
  if (!filters || Object.keys(filters).length === 0) return undefined
  return Object.entries(filters).map(([field, value]) => ({ field, op: 'eq', value }))
}

function normalizeAggregationType(type: string | undefined): AggregationRequest['type'] {
  switch (type) {
    case 'sum':
    case 'avg':
    case 'min':
    case 'max':
    case 'histogram':
      return type
    default:
      return 'count'
  }
}

export function aggregationsFromRecord(input?: Record<string, unknown>): AggregationRequest[] | undefined {
  if (!input || Object.keys(input).length === 0) return undefined
  const aggregations: AggregationRequest[] = []
  for (const [name, raw] of Object.entries(input)) {
    const item = raw as { type?: string; field?: string; interval?: string | number }
    if (!item.field) continue
    aggregations.push({
      name,
      type: item.type === 'date_histogram' ? 'histogram' : normalizeAggregationType(item.type),
      field: item.field,
      ...(item.interval === undefined ? {} : { interval: item.interval }),
    })
  }
  return aggregations.length > 0 ? aggregations : undefined
}

export function mapSearchStrategy(strategy: SearchQueryParams['strategy']): Query['strategy'] {
  switch (strategy) {
    case 'full_text_only': return 'fts'
    case 'semantic_only': return 'vector'
    case 'rrf': return 'hybrid'
    default: return undefined
  }
}

export function mapFacetCounts(facets: Record<string, FacetCount[]> | undefined): SearchResponse['aggregations'] {
  if (!facets) return undefined
  const mapped: NonNullable<SearchResponse['aggregations']> = {}
  for (const [field, counts] of Object.entries(facets)) {
    mapped[field] = counts.map((count) => ({
      value: String(count.value),
      count: count.count,
    }))
  }
  return mapped
}

/**
 * Reset the registry (for testing).
 */
export function resetSearchRegistry(): void {
  _g.__bakinSearchRegistry = undefined
}
