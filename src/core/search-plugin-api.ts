/**
 * Plugin-scoped SearchAPI — `buildSearchAPI(pluginId)` is what gets injected as
 * `ctx.search`, plus the startup-reconcile drain. Builds on search-registry-core;
 * surfaced through the search-registry barrel.
 */
import type {
  APIRoute,
  FileBackedContentTypeDefinition,
  SearchAPI,
  SearchContentTypeDefinition,
  SearchHealthSnapshot,
  SearchQueryParams,
  SearchResponse,
  SearchTransformOp,
} from '../../packages/core/src/plugin-types'
import { createLogger } from './logger'
import { registerSyncHook, registerUnlinkHook } from './watcher'
import { getContentDir } from './content-dir'
import {
  findMatchingMapper,
  matchesAnyPattern,
  performStartupReconcile,
  MTIME_FIELD,
} from './search-reconcile'
import { statSync } from 'fs'
import { join } from 'path'
import {
  type RegistryState,
  adapterHitToPluginResult,
  aggregationsFromRecord,
  disposeFileBackedWiring,
  ensureRegisteredTables,
  filtersFromRecord,
  fullTableName,
  getIndexNames,
  getSearchableFields,
  getIndexWeights,
  getRegistry,
  getRerankField,
  getSearchAdapter,
  mapFacetCounts,
  mapSearchStrategy,
  removePendingReconciles,
} from './search-registry-core'
import { getSearchHealth } from './search-reindex'

const log = createLogger('search-plugin-api')

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

  // Register a content type, recording its table as the plugin's PRIMARY when
  // `primary` is true. The primary table is what bare ctx.search.index/remove/
  // transform/query target and what getTableForPlugin (and the /search + MCP
  // routing) resolve to. A plugin has exactly one primary; a second DIRECT
  // registration is an error. File-backed content types register as secondary
  // (primary=false) — they index into their own table explicitly (see the wiring
  // below) and only become the primary as a fallback when a plugin has no direct
  // content type at all (e.g. a purely file-backed plugin).
  const registerContentTypeInternal = (def: SearchContentTypeDefinition, primary: boolean): void => {
    const tableName = fullTableName(def.table)
    const existing = registry.contentTypes.get(tableName)
    if (existing && existing.pluginId !== pluginId) {
      throw new Error(
        `Search content type table "${tableName}" is already registered by plugin "${existing.pluginId}"; ` +
        `plugin "${pluginId}" cannot take ownership.`,
      )
    }
    registry.contentTypes.set(tableName, { ...def, pluginId })
    const currentPrimary = registry.pluginTables.get(pluginId)
    if (primary) {
      if (currentPrimary && currentPrimary !== tableName) {
        throw new Error(
          `Plugin "${pluginId}" already has a primary search content type "${currentPrimary}"; ` +
          `"${tableName}" cannot also be primary. Only file-backed content types may be secondary.`,
        )
      }
      registry.pluginTables.set(pluginId, tableName)
    } else if (!currentPrimary) {
      registry.pluginTables.set(pluginId, tableName)
    }
    log.info(`Content type registered: ${tableName} (plugin: ${pluginId}${primary ? '' : ', secondary'})`)
    maybeAutoRegisterSearchRoute()
  }

  const api: SearchAPI = {
    registerContentType(def: SearchContentTypeDefinition): void {
      registerContentTypeInternal(def, true)
    },

    registerFileBackedContentType(def: FileBackedContentTypeDefinition): void {
      const tableName = fullTableName(def.table)

      // A plugin can re-register the same content type during dev hot reload.
      // Replace the previous hook pair before wiring the new one so file
      // changes do not fan out through stale plugin closures.
      disposeFileBackedWiring(tableName)
      removePendingReconciles(pluginId, tableName)

      // Standard registration first — gives us the table, schema, and reindex
      // generator. Registered as SECONDARY: file-backed types index into their
      // own table (below), never via the plugin's primary resolver.
      registerContentTypeInternal(def, false)
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
          // Index into THIS content type's table directly — not via api.index,
          // which resolves the plugin's primary table (wrong for a secondary
          // file-backed type on a multi-content plugin like team).
          await getSearchAdapter().documents.index(tableName, key, { ...doc, [MTIME_FIELD]: mtimeMs })
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
          await getSearchAdapter().documents.remove(tableName, key)
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
          searchableFields: getSearchableFields(tableName),
          indexWeights: getIndexWeights(tableName),
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
 * Upper bound on a single table's startup reconcile. Generous enough for a
 * legitimately large table's scan + re-index, but finite so a wedged search
 * table can't hang the boot forever. On timeout the reconcile is abandoned and
 * the next watcher event / manual reindex retries it.
 */
const STARTUP_RECONCILE_TIMEOUT_MS = 60_000

/**
 * Resolve `promise`, or reject with a labeled timeout error after `ms`. The
 * underlying work is not cancelled (the adapter call may still be in flight),
 * but the caller stops awaiting it so startup can proceed.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>
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
      // Reconcile into THIS content type's own table directly (a file-backed
      // type may be a secondary on a multi-content plugin; api.index would
      // resolve the plugin's primary table instead).
      const reconcileTable = fullTableName(def.table)
      // Bound the per-table reconcile. The scan + re-index calls go through the
      // search adapter to antfly, which has no internal timeout: a search table
      // wedged at the engine level (e.g. a stuck index lock) makes those calls
      // hang forever. Because this drain runs inline during server startup, one
      // wedged table would otherwise brick the ENTIRE boot (server never opens
      // its port). Race a timeout so a bad table degrades to "search stale for
      // this type" instead — the watcher and manual reindex retry it later.
      await withTimeout(
        performStartupReconcile(def, contentDir, {
          index: (key, doc) => getSearchAdapter().documents.index(reconcileTable, key, doc),
          remove: (key) => getSearchAdapter().documents.remove(reconcileTable, key),
          scanIndex: async function* (tableName) {
            for await (const { key, document } of getSearchAdapter().scan(tableName)) {
              const mtime = typeof document[MTIME_FIELD] === 'number'
                ? document[MTIME_FIELD]
                : Number(document[MTIME_FIELD] ?? 0)
              yield { key, mtimeMs: Number.isFinite(mtime) ? mtime : 0 }
            }
          },
        }),
        STARTUP_RECONCILE_TIMEOUT_MS,
        `startup reconcile for ${reconcileTable}`,
      )
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
