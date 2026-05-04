/**
 * Search Registry — singleton that manages plugin content type registrations
 * and provides SearchAPI instances for each plugin.
 *
 * Uses globalThis so every reach into this module shares one registry.
 */
import type {
  APIRoute,
  FileBackedContentTypeDefinition,
  SearchAPI,
  SearchContentTypeDefinition,
  SearchHealthSnapshot,
  SearchIndexDefinition,
  SearchQueryParams,
  SearchResponse,
  SearchResult,
  SearchTransformOp,
} from '../../packages/core/src/plugin-types'
import type {
  AggregationRequest,
  Filter,
  FacetCount,
  Query,
  SearchAdapter,
  SearchHit,
  TableConfig,
  TableHealth,
} from '@bakin/core/adapters/search'
import { broadcast } from './sse'
import { createLogger } from './logger'
import { registerSyncHook, registerUnlinkHook } from './watcher'
import { getContentDir } from './content-dir'
import { getAppServices } from './app-services'
import {
  findMatchingMapper,
  matchesAnyPattern,
  performStartupReconcile,
  MTIME_FIELD,
} from './search-reconcile'
import { statSync } from 'fs'
import { join } from 'path'

const log = createLogger('search-registry')

// ---------------------------------------------------------------------------
// Registry singleton (globalThis-backed)
// ---------------------------------------------------------------------------
interface RegistryState {
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

function getRegistry(): RegistryState {
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
const TABLE_PREFIX = 'bakin_'

function fullTableName(table: string): string {
  return table.startsWith(TABLE_PREFIX) ? table : `${TABLE_PREFIX}${table}`
}

function removePendingReconciles(pluginId: string, tableName?: string): number {
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

function disposeFileBackedWiring(tableName: string): void {
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
// Public API
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
 * Get the full table name for a plugin. Returns null when the plugin has
 * no registered content type. Throws when a plugin has registered multiple
 * content types — the API/MCP layers assume 1:1 plugin→table, and the spec
 * §5.1d decision reinforces that. This is a defensive guard; no plugin
 * ships more than one content type today.
 */
export function getTableForPlugin(pluginId: string): string | null {
  const matches: string[] = []
  for (const [tableName, def] of getRegistry().contentTypes) {
    if (def.pluginId === pluginId) matches.push(tableName)
  }
  if (matches.length === 0) return null
  if (matches.length > 1) {
    throw new Error(
      `Plugin "${pluginId}" has ${matches.length} registered content types (${matches.join(', ')}); expected 1. ` +
        `The /search and MCP plugin-param routing assumes a single table per plugin.`,
    )
  }
  return matches[0]
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

/**
 * Options for building a plugin-scoped SearchAPI.
 */
export interface BuildSearchAPIOptions {
  /**
   * Callback invoked when a plugin registers a content type, used to
   * auto-wire a `GET /search` route on the plugin's router without the
   * plugin writing any boilerplate. When omitted (tests, catch-all
   * dispatch, etc.), no route is registered — the caller must surface
   * search some other way.
   */
  registerRoute?: (route: APIRoute) => void
  /**
   * Skip the side effects of `registerFileBackedContentType` — watcher
   * sync/unlink hooks and pending startup reconcile. The primary register
   * (content type + auto /search route) still runs. Used by the Next.js
   * catch-all route where the real custom-server activation already wired
   * watchers; re-wiring them here would double-fire on every file change.
   */
  skipFileBackedWiring?: boolean
}

/**
 * Build a SearchAPI instance scoped to a specific plugin.
 * This is what gets injected as ctx.search in PluginContext.
 *
 * When `opts.registerRoute` is provided, `registerContentType` (and
 * therefore `registerFileBackedContentType`, which wraps it) will
 * additionally auto-register a `GET /search` route that pipes through
 * the same `api.query()` the plugin would have hand-written itself.
 * This is the blessed path — plugins get a searchable HTTP endpoint for
 * free by calling a single registration API.
 */
export function buildSearchAPI(pluginId: string, opts?: BuildSearchAPIOptions): SearchAPI {
  const registry = getRegistry()

  let searchRouteRegistered = false
  const maybeAutoRegisterSearchRoute = () => {
    if (searchRouteRegistered) return
    if (!opts?.registerRoute) return
    searchRouteRegistered = true
    opts.registerRoute({
      path: '/search',
      method: 'GET',
      description: `Search ${pluginId}`,
      handler: async (req: Request) => {
        const url = new URL(req.url, 'http://localhost')
        const q = url.searchParams.get('q')
        if (!q) return Response.json({ error: 'Missing ?q= parameter' }, { status: 400 })
        const result = await api.query({
          q,
          limit: Number(url.searchParams.get('limit')) || undefined,
          offset: Number(url.searchParams.get('offset')) || undefined,
          facets: url.searchParams.get('facets')?.split(',').filter(Boolean),
        })
        return Response.json(result)
      },
    })
  }

  const api: SearchAPI = {
    registerContentType(def: SearchContentTypeDefinition): void {
      const tableName = fullTableName(def.table)
      const existing = registry.contentTypes.get(tableName)
      if (existing && existing.pluginId !== pluginId) {
        throw new Error(
          `Search content type table "${tableName}" is already registered by plugin "${existing.pluginId}"; ` +
          `plugin "${pluginId}" cannot take ownership.`,
        )
      }
      registry.contentTypes.set(tableName, { ...def, pluginId })
      registry.pluginTables.set(pluginId, tableName)
      log.info(`Content type registered: ${tableName} (plugin: ${pluginId})`)
      maybeAutoRegisterSearchRoute()
    },

    registerFileBackedContentType(def: FileBackedContentTypeDefinition): void {
      const tableName = fullTableName(def.table)

      // A plugin can re-register the same content type during dev hot reload.
      // Replace the previous hook pair before wiring the new one so file
      // changes do not fan out through stale plugin closures.
      disposeFileBackedWiring(tableName)
      removePendingReconciles(pluginId, tableName)

      // Standard registration first — gives us the table, schema, and reindex
      // generator. Everything below layers watcher hooks + reconcile on top.
      api.registerContentType(def)
      if (opts?.skipFileBackedWiring) return

      const includePatterns = def.filePatterns.map(p => p.pattern)
      const excludePatterns = def.excludePatterns ?? []

      const matchesScope = (rel: string): boolean => {
        if (excludePatterns.length > 0 && matchesAnyPattern(rel, excludePatterns)) return false
        return matchesAnyPattern(rel, includePatterns)
      }

      const unregisterSync = registerSyncHook(async (rel, content) => {
        if (!matchesScope(rel)) return
        try {
          if (def.onSync) {
            await def.onSync(rel, content)
            return
          }
          const mapper = findMatchingMapper(rel, def.filePatterns)
          if (!mapper) return
          const key = mapper.fileToId(rel)
          if (key === null) return
          const doc = await mapper.fileToDoc(rel, content)
          if (doc === null) return
          let mtimeMs = Date.now()
          try {
            mtimeMs = statSync(join(getContentDir(), rel)).mtimeMs
          } catch {
            // file may have been removed between watcher emit and our stat;
            // fall back to "now" so the index entry is at least monotonic.
          }
          await api.index(key, { ...doc, [MTIME_FIELD]: mtimeMs })
        } catch (err) {
          log.warn('File-backed sync hook failed', err, { table: tableName, rel })
        }
      })

      const unregisterUnlink = registerUnlinkHook(async (rel) => {
        if (!matchesScope(rel)) return
        try {
          if (def.onUnlink) {
            await def.onUnlink(rel)
            return
          }
          const mapper = findMatchingMapper(rel, def.filePatterns)
          if (!mapper) return
          const key = mapper.fileToId(rel)
          if (key === null) return
          await api.remove(key)
        } catch (err) {
          log.warn('File-backed unlink hook failed', err, { table: tableName, rel })
        }
      })

      registry.fileBackedWiring.set(tableName, {
        pluginId,
        dispose: () => {
          unregisterSync?.()
          unregisterUnlink?.()
        },
      })

      // Schedule startup reconcile. We can't run it inline because the
      // Search table doesn't exist yet — `createRegisteredTables` runs
      // after all plugins activate. The reconcile is enqueued and drained
      // by `runPendingReconciles()` in server.ts after table creation.
      if (def.buildOnStartup !== false) {
        getRegistry().pendingReconciles.push({ pluginId, def })
      }
    },

    async index(key: string, doc: Record<string, unknown>): Promise<void> {
      const tableName = registry.pluginTables.get(pluginId)
      if (!tableName) {
        log.warn(`Plugin ${pluginId} called search.index() but has no registered content type`)
        return
      }
      await getSearchAdapter().documents.index(tableName, key, doc)
    },

    async remove(key: string): Promise<void> {
      const tableName = registry.pluginTables.get(pluginId)
      if (!tableName) return
      await getSearchAdapter().documents.remove(tableName, key)
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
      await getSearchAdapter().documents.transform(tableName, key, (doc) => ({ ...doc, ...fields }))
    },

    async query(params: SearchQueryParams): Promise<SearchResponse> {
      const tableName = registry.pluginTables.get(pluginId)
      const search = getSearchAdapter()
      if (!tableName || !await search.available()) {
        return {
          results: [],
          meta: { query: params.q, total: 0, took_ms: 0, source: 'fallback' },
        }
      }

      const result = await search.query(tableName, {
        text: params.q,
        limit: params.limit,
        offset: params.offset,
        filters: filtersFromRecord(params.filters),
        facets: params.facets,
        aggregations: aggregationsFromRecord(params.aggregations),
        strategy: mapSearchStrategy(params.strategy),
        rerank: params.rerank,
        adapterOptions: {
          indexes: getIndexNames(tableName),
          rerankField: getRerankField(tableName),
        },
      })

      return {
        results: result.hits.map((hit) => adapterHitToPluginResult(hit, tableName)),
        aggregations: mapFacetCounts(result.facets),
        rawAggregations: result.aggregations,
        meta: {
          query: params.q,
          total: result.total ?? result.hits.length,
          took_ms: result.diagnostics?.durationMs ?? 0,
          source: 'search',
        },
      }
    },

    health(): Promise<SearchHealthSnapshot> {
      return getSearchHealth()
    },

    maintenance: {
      available(): Promise<boolean> {
        return getSearchAdapter().available()
      },

      async *scan(): AsyncIterable<{ key: string; document: Record<string, unknown> }> {
        const tableName = registry.pluginTables.get(pluginId)
        const search = getSearchAdapter()
        if (!tableName || !await search.available()) return
        for await (const entry of search.scan(tableName)) {
          yield entry
        }
      },

      async batchRemove(keys: string[]): Promise<number> {
        if (keys.length === 0) return 0
        const tableName = registry.pluginTables.get(pluginId)
        const search = getSearchAdapter()
        if (!tableName || !await search.available()) return 0
        return search.documents.batchRemove(tableName, keys)
      },

      async resetContentType(): Promise<void> {
        const tableName = registry.pluginTables.get(pluginId)
        if (!tableName) return
        const search = getSearchAdapter()
        if (!await search.available()) return
        try {
          await search.tables.drop(tableName)
        } catch (err) {
          log.warn('Plugin search table reset drop failed; recreating table anyway', err, { pluginId, tableName })
        }
        await ensureRegisteredTables()
      },
    },
  }

  return api
}

/**
 * Drain pending startup reconciles. Called from server.ts after
 * `createRegisteredTables()` so the underlying search tables exist
 * before the reconcile tries to scan them. Failures are logged and
 * swallowed so one bad reconcile doesn't block the rest.
 */
async function runPendingReconcilesMatching(predicate: (item: RegistryState['pendingReconciles'][number]) => boolean): Promise<void> {
  const registry = getRegistry()
  if (registry.pendingReconciles.length === 0) return
  if (!await getSearchAdapter().available()) {
    const keep = registry.pendingReconciles.filter((item) => !predicate(item))
    registry.pendingReconciles.length = 0
    registry.pendingReconciles.push(...keep)
    return
  }
  const contentDir = getContentDir()
  const items: RegistryState['pendingReconciles'] = []
  const keep: RegistryState['pendingReconciles'] = []
  for (const item of registry.pendingReconciles) {
    if (predicate(item)) items.push(item)
    else keep.push(item)
  }
  registry.pendingReconciles.length = 0
  registry.pendingReconciles.push(...keep)
  for (const { pluginId, def } of items) {
    try {
      const api = buildSearchAPI(pluginId)
      await performStartupReconcile(def, contentDir, {
        index: (key, doc) => api.index(key, doc),
        remove: (key) => api.remove(key),
        scanIndex: async function* (tableName) {
          for await (const { key, document } of getSearchAdapter().scan(tableName)) {
            const mtime = typeof document[MTIME_FIELD] === 'number'
              ? document[MTIME_FIELD]
              : Number(document[MTIME_FIELD] ?? 0)
            yield { key, mtimeMs: Number.isFinite(mtime) ? mtime : 0 }
          }
        },
      })
    } catch (err) {
      log.error('Startup reconcile failed', err, { pluginId, table: def.table })
    }
  }
}

export async function runPendingReconciles(): Promise<void> {
  await runPendingReconcilesMatching(() => true)
}

export async function runPendingReconcilesForPlugin(pluginId: string): Promise<void> {
  await runPendingReconcilesMatching((item) => item.pluginId === pluginId)
}

export async function ensurePluginSearchReady(pluginId: string): Promise<void> {
  const { failures } = await ensureRegisteredTables()
  const pluginFailures = failures.filter((failure) => failure.pluginId === pluginId)
  if (pluginFailures.length > 0) {
    log.warn('Plugin search table readiness failed', { pluginId, failures: pluginFailures })
  }
  await runPendingReconcilesForPlugin(pluginId)
}

/**
 * Reindex all (or one) registered content types by running their reindex() generators.
 * Returns per-table counts.
 *
 * Self-heals: ensures every registered table actually exists in the
 * search backend before iterating. If the backend was wiped or restarted
 * since Bakin last ran createRegisteredTables, this transparently
 * recreates the missing tables instead of silently writing to nothing.
 *
 * Broadcasts two channels of events:
 *   - Per-table: reindex.start / reindex.progress / reindex.complete
 *     (drives the Health page tiles)
 *   - Aggregate: reindex.batch_start / reindex.batch_pulse / reindex.batch_complete
 *     (drives a single Live Activity entry instead of one per table)
 */
export interface ReindexTableResult {
  table: string
  pluginId: string
  indexed: number
  error?: string
  enrichment?: SearchEnrichmentHealth
  verified?: number
  verifyDiscrepancy?: number
}

export interface SearchEnrichmentHealth {
  indexes: Array<{
    name: string
    type: string
    totalIndexed: number
    walBacklog: number
    error?: string
    rebuilding: boolean
    backfillProgress?: number
  }>
  healthy: boolean
}

export async function reindexContentTypes(opts?: {
  table?: string
  rebuild?: boolean
  verify?: boolean
}): Promise<ReindexTableResult[]> {
  const registry = getRegistry()
  const search = getSearchAdapter()
  const results: ReindexTableResult[] = []

  // Self-heal: make sure tables exist in the search backend before we try
  // to write to them. Cheap when nothing's missing (one list call);
  // critical when the backend was wiped externally. Per-table failures
  // surface as reindex results below so the API caller sees the real
  // reason instead of a misleading `indexed: 0`.
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
          await search.tables.rebuildIndexes(tableName)
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
              count += (await search.documents.batchIndex(tableName, batch)).indexed
              batch.length = 0
              broadcast({ type: 'reindex.progress', table: tableName, pluginId: def.pluginId, indexed: count })
            }
          }
          if (batch.length > 0) {
            count += (await search.documents.batchIndex(tableName, batch)).indexed
            broadcast({ type: 'reindex.progress', table: tableName, pluginId: def.pluginId, indexed: count })
          }
        }

        broadcast({ type: 'reindex.complete', table: tableName, pluginId: def.pluginId, indexed: count })

        // Enrichment audit — poll index health after all batches complete.
        // Best-effort: never fails the reindex, just surfaces what the adapter reports.
        const result: ReindexTableResult = { table: tableName, pluginId: def.pluginId, indexed: count }
        try {
          const health = searchEnrichmentFromTableHealth(await search.tables.getHealth(tableName))
          if (health) {
            result.enrichment = health
            if (!health.healthy) {
              for (const idx of health.indexes) {
                if (idx.error) {
                  log.error(`Enrichment error in ${tableName}/${idx.name}: ${idx.error}`)
                }
                if (idx.walBacklog > 0) {
                  log.warn(`Enrichment pending in ${tableName}/${idx.name}: ${idx.walBacklog} docs in WAL`)
                }
              }
            }
          }
        } catch (err) {
          log.warn(`Enrichment audit failed for ${tableName}`, err)
        }

        // Verify pass — opt-in re-query to check how many docs are actually findable.
        if (opts?.verify && count > 0) {
          try {
            const stats = await search.tables.stats(tableName)
            const docCount = stats?.documents ?? 0
            result.verified = docCount
            result.verifyDiscrepancy = count - docCount
            if (result.verifyDiscrepancy !== 0) {
              log.error(`Verify discrepancy in ${tableName}: indexed ${count} but ${docCount} findable (delta: ${result.verifyDiscrepancy})`)
            }
          } catch (err) {
            log.warn(`Verify pass failed for ${tableName}`, err)
          }
        }

        results.push(result)
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
  const search = getSearchAdapter()
  if (!await search.available()) {
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
        return { results: [], meta: { query: q, total: 0, took_ms: 0, source: 'search' } }
      }
      return crossTableSearch(q, { ...opts, table: resolved.replace(TABLE_PREFIX, '') })
    }

    const result = await search.query(tableName, {
      text: q,
      limit,
      offset: opts?.offset,
      filters: filtersFromRecord(opts?.filters),
      facets: opts?.facets ?? def.facets,
      adapterOptions: {
        indexes: getIndexNames(tableName),
        rerankField: getRerankField(tableName),
      },
    })

    return {
      results: result.hits.map((hit) => ({ ...adapterHitToPluginResult(hit, tableName), _table: tableName })),
      aggregations: mapFacetCounts(result.facets),
      rawAggregations: result.aggregations,
      meta: { query: q, total: result.total ?? result.hits.length, took_ms: result.diagnostics?.durationMs ?? 0, source: 'search' },
    }
  }

  // Cross-table search via multiQuery
  const tables = Array.from(registry.contentTypes.keys())
  if (tables.length === 0) {
    return { results: [], meta: { query: q, total: 0, took_ms: 0, source: 'search' } }
  }

  const perTableLimit = Math.ceil(limit / tables.length)
  const results = await search.multiQuery(tables.map((table) => ({
    table,
    query: {
      text: q,
      limit: perTableLimit,
      filters: filtersFromRecord(opts?.filters),
      adapterOptions: {
        indexes: getIndexNames(table),
        rerankField: getRerankField(table),
      },
    },
  })))
  const hits = results.flatMap((result, index) => result.hits.map((hit) => adapterHitToPluginResult(hit, tables[index])))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  return {
    results: hits,
    meta: {
      query: q,
      total: results.reduce((sum, result) => sum + (result.total ?? result.hits.length), 0),
      took_ms: Math.max(0, ...results.map((result) => result.diagnostics?.durationMs ?? 0)),
      source: 'search',
    },
  }
}

/**
 * Get health/stats for all registered search tables, including per-index
 * enrichment status from getIndexHealth().
 */
export async function getSearchHealth(): Promise<SearchHealthSnapshot> {
  const registry = getRegistry()
  const search = getSearchAdapter()
  const isAvailable = await search.available()

  if (!isAvailable) {
    return { enabled: false, tables: [] }
  }

  const tables: Array<{
    table: string
    pluginId: string
    stats: Record<string, unknown> | null
    indexHealth?: SearchEnrichmentHealth['indexes']
    healthy: boolean
  }> = []

  for (const [tableName, def] of registry.contentTypes) {
    let stats: Record<string, unknown> | null = null
    try {
      stats = await search.tables.stats(tableName) as Record<string, unknown> | null
    } catch { /* stats unavailable */ }

    let indexHealth: SearchEnrichmentHealth['indexes'] | undefined
    let healthy = true
    try {
      const health = searchEnrichmentFromTableHealth(await search.tables.getHealth(tableName))
      if (health) {
        indexHealth = health.indexes
        healthy = health.healthy
      }
    } catch { /* index health unavailable — default to healthy */ }

    tables.push({ table: tableName, pluginId: def.pluginId, stats, indexHealth, healthy })
  }

  return { enabled: true, tables }
}

function adapterHitToPluginResult(hit: SearchHit, tableName: string): SearchResult {
  return {
    id: hit.key,
    table: tableName,
    score: hit.score,
    fields: hit.document,
    rerankScore: hit.scoreBreakdown?.rerank,
  }
}

function filtersFromRecord(filters?: Record<string, string | boolean | number>): Filter[] | undefined {
  if (!filters || Object.keys(filters).length === 0) return undefined
  return Object.entries(filters).map(([field, value]) => ({ field, op: 'eq', value }))
}

function aggregationsFromRecord(input?: Record<string, unknown>): AggregationRequest[] | undefined {
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

function mapSearchStrategy(strategy: SearchQueryParams['strategy']): Query['strategy'] {
  switch (strategy) {
    case 'full_text_only': return 'fts'
    case 'semantic_only': return 'vector'
    case 'rrf': return 'hybrid'
    default: return undefined
  }
}

function mapFacetCounts(facets: Record<string, FacetCount[]> | undefined): SearchResponse['aggregations'] {
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

function searchEnrichmentFromTableHealth(health: TableHealth | null): SearchEnrichmentHealth | undefined {
  const details = health?.details as Partial<SearchEnrichmentHealth> | undefined
  if (!details || !Array.isArray(details.indexes)) return undefined
  return {
    indexes: details.indexes,
    healthy: typeof details.healthy === 'boolean' ? details.healthy : health?.status === 'ok',
  }
}

/**
 * Reset the registry (for testing).
 */
export function resetSearchRegistry(): void {
  _g.__bakinSearchRegistry = undefined
}
