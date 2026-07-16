/**
 * Plugin-scoped SearchAPI — `buildSearchAPI(pluginId)` is what gets injected as
 * `ctx.search`, plus the startup-reconcile drain. Builds on search-registry-core;
 * surfaced through the search-registry barrel.
 */
import type {
  RegisteredAPIRoute,
  FileBackedContentTypeDefinition,
  SearchAPI,
  SearchContentTypeDefinition,
  SearchHealthSnapshot,
  SearchQueryParams,
  SearchResponse,
  SearchScanOptions,
  SearchTransformOp,
} from '../../packages/core/src/plugin-types'
import { createLogger } from './logger'
import { enqueueIndex, enqueueRemove, enqueueTransform, nudgeOutboxPump } from './search-outbox'
import { recordUsage } from './usage'
import { resolvePhysicalTable } from './search-registry-core'
import { registerSyncHook, registerUnlinkHook } from './watcher'
import { findMatchingMapper, matchesAnyPattern } from './search-file-patterns'
import {
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
} from './search-registry-core'
import { getSearchHealth } from './search-reindex'

const log = createLogger('search-plugin-api')

/**
 * Embedding templates use `{{field}}` — a `{field}` single brace embeds as
 * LITERAL text, so every document gets an identical embedding and semantic
 * search for the type is silently dead. Warn (not throw): single braces can
 * legitimately appear in surrounding prose, so this only fires when a
 * template has `{x}` patterns and not a single `{{x}}`.
 */
export function hasSingleBracePlaceholders(template: string): boolean {
  const withoutDouble = template.replace(/\{\{[^{}]+\}\}/g, '')
  return /\{[^{}]+\}/.test(withoutDouble)
}

function warnOnSingleBraceTemplate(pluginId: string, tableName: string, def: SearchContentTypeDefinition): void {
  const templates = [
    def.embeddingTemplate,
    ...(def.indexes ?? []).map((idx) => idx.embeddingTemplate),
  ].filter((t): t is string => typeof t === 'string' && t.length > 0)
  for (const template of templates) {
    if (hasSingleBracePlaceholders(template)) {
      log.warn(
        `embeddingTemplate for "${tableName}" (plugin ${pluginId}) contains single-brace {field} placeholders — ` +
        `the template language is {{field}}; single braces embed as literal text and disable semantic search`,
        { template },
      )
    }
  }
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
  registerRoute?: (route: RegisteredAPIRoute) => void
  /**
   * Skip the side effects of `registerFileBackedContentType` — the watcher
   * sync/unlink hooks (there is no boot reconcile; the durable outbox owns
   * change detection). The primary register (content type + auto /search
   * route) still runs. Used where the real activation already wired
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

  // NOTE: the auto GET /search wiring exists in THREE deliberately separate
  // copies — here (production), packages/sdk/src/testing/index.ts (harness),
  // and tests/plugins/test-helpers.ts (in-repo adapter). Change one, sync all.
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
    warnOnSingleBraceTemplate(pluginId, tableName, def)
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
          if (!mapper?.fileToDoc) return
          const key = mapper.fileToId(rel)
          if (key === null) return
          const doc = await mapper.fileToDoc(rel, content)
          if (doc === null) return
          // Enqueue into THIS content type's table directly — not via
          // api.index, which resolves the plugin's primary table (wrong for
          // a secondary file-backed type on a multi-content plugin like team).
          enqueueIndex(tableName, key, doc)
          await nudgeOutboxPump()
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
          enqueueRemove(tableName, key)
          await nudgeOutboxPump()
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

    },

    async index(key: string, doc: Record<string, unknown>): Promise<void> {
      const tableName = registry.pluginTables.get(pluginId)
      if (!tableName) {
        log.warn(`Plugin ${pluginId} called search.index() but has no registered content type`)
        return
      }
      // Durable outbox first (D5): the enqueue IS the write from the
      // caller's perspective; the pump lands it (immediately when the
      // engine is up, on retry when it isn't).
      enqueueIndex(tableName, key, doc)
      await nudgeOutboxPump()
    },

    async remove(key: string): Promise<void> {
      const tableName = registry.pluginTables.get(pluginId)
      if (!tableName) return
      enqueueRemove(tableName, key)
      await nudgeOutboxPump()
    },

    async transform(key: string, operations: SearchTransformOp[]): Promise<void> {
      const tableName = registry.pluginTables.get(pluginId)
      if (!tableName) return
      // The outbox owns transform semantics now: real $set/$inc/$push
      // (applyTransformOps), merged into any pending write for the key, and
      // applied read-modify-write at drain time.
      enqueueTransform(tableName, key, operations)
      await nudgeOutboxPump()
    },

    async query(params: SearchQueryParams): Promise<SearchResponse> {
      const startedAt = Date.now()
      const record = (status: 'ok' | 'error') => recordUsage({
        kind: 'rest',
        activityClass: 'user',
        name: 'search.query',
        agent: null,
        durationMs: Date.now() - startedAt,
        status,
        meta: { scope: pluginId },
      })
      const tableName = registry.pluginTables.get(pluginId)
      const search = getSearchAdapter()
      if (!tableName || !await search.available()) {
        record('error')
        return {
          results: [],
          meta: { query: params.q, total: 0, took_ms: 0, source: 'unavailable' },
        }
      }

      let result: Awaited<ReturnType<typeof search.query>>
      try {
        result = await search.query(resolvePhysicalTable(tableName), {
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
      } catch (err) {
        record('error')
        throw err
      }
      record('ok')

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

      async *scan(opts?: SearchScanOptions): AsyncIterable<{ key: string; document: Record<string, unknown> }> {
        const tableName = registry.pluginTables.get(pluginId)
        const search = getSearchAdapter()
        if (!tableName || !await search.available()) return
        const physical = resolvePhysicalTable(tableName)
        const entries = opts === undefined ? search.scan(physical) : search.scan(physical, opts)
        for await (const entry of entries) {
          yield entry
        }
      },

      async batchRemove(keys: string[]): Promise<number> {
        if (keys.length === 0) return 0
        const tableName = registry.pluginTables.get(pluginId)
        const search = getSearchAdapter()
        if (!tableName || !await search.available()) return 0
        return search.documents.batchRemove(resolvePhysicalTable(tableName), keys)
      },

    },
  }

  return api
}

/**
 * Make one plugin's search table current after (re)activation (dev hot
 * reload, live install). A matching blue/green registry row is ZERO
 * adapter calls; a changed layout migrates in the background.
 */
export async function ensurePluginSearchReady(pluginId: string): Promise<void> {
  const { failures } = await ensureRegisteredTables()
  const pluginFailures = failures.filter((failure) => failure.pluginId === pluginId)
  if (pluginFailures.length > 0) {
    log.warn('Plugin search table readiness failed', { pluginId, failures: pluginFailures })
  }
}
