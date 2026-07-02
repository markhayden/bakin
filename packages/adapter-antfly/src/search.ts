import { AntflyClient, InferenceClient } from '@antfly/sdk'
import type { QueryRequest, QueryResult as AntflyQueryResponse } from '@antfly/sdk'
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
  QueryResult,
  ScanOpts,
  ScannedDocument,
  SearchAdapter,
  TableConfig,
  TableHealth,
  TableInfo,
  TableStats,
  TransformFn,
} from '@bakin/core/adapters/search'
import type { AntflySettings } from './defaults'
import { mergeSettings } from './defaults'
import type { AntflySearchAdapterOptions } from './index'
import { checkInferenceModels, requiredModelsForSettings } from './models'
import {
  buildQueryRequest,
  buildTableConfig,
  emptyQueryResult,
  hitMatchesFilters,
  mapResponse,
  readNumber,
  readString,
} from './query-translation'
import { getServerHealthDetail, isAntflyRunning, isLocalDefaultUrl, startAntflyServer, stopAntflyServer } from './server'

interface AntflyIndexHealthEntry {
  name: string
  type: string
  totalIndexed: number
  walBacklog: number
  error?: string
  rebuilding: boolean
  backfillActive?: boolean
  backfillProgress?: number
  backfillState?: string
  replayAppliedSequence?: number
  replayTargetSequence?: number
  replayBacklog?: number
  replayCatchUpRequired?: boolean
  catchUpActive?: boolean
  densePublishPending?: boolean
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

/**
 * Hard ceiling on a single table query. The cross-table /api/search path
 * (search-registry → multiQuery) is sequential by design (bakin#456), so one
 * wedged or pathologically slow query would otherwise stall every remaining
 * table and hang the UI's search request indefinitely. Same no-infinite-
 * patience rule as the operational waits elsewhere on this adapter.
 */
const QUERY_TIMEOUT_DEFAULT_MS = 15_000

function queryTimeoutMs(): number {
  const raw = process.env.BAKIN_ANTFLY_QUERY_TIMEOUT_MS
  if (raw !== undefined) {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return QUERY_TIMEOUT_DEFAULT_MS
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

class QueryTimeoutError extends Error {
  constructor(ms: number) {
    super(`query timed out after ${ms}ms`)
    this.name = 'QueryTimeoutError'
  }
}

/**
 * A count-only twin of a request: true total + full-corpus aggregation
 * buckets. The reranker must not ride along (the server 400s count+rerank,
 * and a count has nothing to rerank).
 */
function companionCountRequest(request: QueryRequest): QueryRequest {
  const clone = { ...request, count: true } as QueryRequest
  delete clone.reranker
  delete clone.offset
  return clone
}

async function raceQueryTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new QueryTimeoutError(ms)), ms)
      }),
    ])
  } catch (err) {
    if (err instanceof QueryTimeoutError) {
      // The losing query promise is still in flight; swallow its eventual
      // rejection so it can't surface as an unhandled rejection later.
      // Abandon (not abort) is deliberate: antfly's HTTP layer runs every
      // request synchronously to completion with no cancellation token
      // (source-verified), so aborting the socket would free nothing
      // server-side — the query finishes either way. Reported upstream.
      promise.catch(() => {})
    }
    throw err
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const READY_INDEX_CACHE_TTL_MS = 5_000

export class AntflySearchAdapter implements SearchAdapter {
  readonly name = 'antfly'
  readonly version = '0.0.1-rc.1'
  readonly requiredCoreVersion = '>=0.0.1-rc.1'

  private client: AntflyClient | null = null
  private settings: AntflySettings
  private logger: AdapterLogger = noopLogger
  private embedderHashAtInit = ''
  // Short-lived cache of currently-ready (existing, not-rebuilding) embeddings
  // index names per table, used to keep a slow/rebuilding index from failing
  // the whole table's query (see filterRequestToReadyIndexes).
  private readyIndexCache = new Map<string, { names: Set<string>; at: number }>()

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

    // Stale-dependency guard, BEFORE spawning anything: the v0.2-protocol
    // SDK is a vendored file: dep, so a checkout that skipped `bun install`
    // still carries the old npm 0.0.14 — whose relative paths against the
    // suffix-less base URL produce a maximally misleading "Failed to parse
    // JSON" against a perfectly healthy server. `tables.scanAll` only
    // exists on the v0.2 SDK; field-verified failure mode (bakin#456 era).
    const probe = new AntflyClient({ baseUrl: this.settings.url }) as unknown as {
      tables?: { scanAll?: unknown }
    }
    if (typeof probe.tables?.scanAll !== 'function') {
      this.client = null
      this.embedderHashAtInit = this.embedderHash()
      this.logger.error(
        'Loaded @antfly/sdk speaks the pre-0.2 protocol - node_modules is stale. Run `bun install` and restart. Falling back to file-only mode.',
      )
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
      this.warmEmbedders()
    } catch (err) {
      // The server started (or was adopted) but its API didn't answer within
      // the wait window — a slow post-restart convergence, not a dead server.
      // Keep the client DEGRADED instead of dropping to file-only for the
      // whole process lifetime: queries fail-empty gracefully, writes retry
      // via retryTransientBatch, and the search bootstrap's backoff ladder
      // re-runs table setup once the server settles. available() still
      // reflects a genuinely dead child through isAntflyRunning().
      this.client = client
      this.embedderHashAtInit = this.embedderHash()
      this.logger.warn(
        'Antfly is up but not yet answering API calls - proceeding degraded; search recovers when it settles',
        { url: this.settings.url, error: err instanceof Error ? err.message : String(err) },
      )
      this.warmEmbedders()
    }
  }

  /**
   * Fire-and-forget cold-start warmup: one throwaway embed per configured
   * local embedder model, so ONNX model load cost is paid here at boot
   * instead of inside a user's first semantic query. Failures are expected
   * for models the current pin can't text-embed (bakin#456) — debug-logged,
   * never fatal.
   */
  private warmEmbedders(): void {
    let inference: InferenceClient
    try {
      const headers: Record<string, string> = {}
      if (this.settings.auth) {
        const credentials = `${this.settings.auth.username}:${this.settings.auth.password}`
        headers.Authorization = `Basic ${Buffer.from(credentials).toString('base64')}`
      }
      inference = new InferenceClient({ baseUrl: this.settings.url, headers })
    } catch (err) {
      this.logger.debug('Embedder warmup skipped - inference client unavailable', { error: err })
      return
    }

    // Only local antfly-provider models load in-process; remote providers
    // (openai, ollama, ...) have no cold-start to pay and aren't served by
    // this instance's /ai/v1 surface.
    const models = new Set(
      Object.values(this.settings.embedders)
        .filter((cfg) => cfg.provider === 'antfly')
        .map((cfg) => cfg.model),
    )
    for (const model of models) {
      inference.embed(model, 'bakin boot warmup').then(
        () => this.logger.debug('Embedder warmed', { model }),
        (err: unknown) => this.logger.debug('Embedder warmup failed', { model, error: stringifyError(err) }),
      )
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
    if (!this.settings.enabled || this.client === null) return false
    // A crashed local instance must not report available: every query would
    // fail-empty, indexing would silently drop writes, and the doctor would
    // say OK while search is dead. isAntflyRunning() tracks both the spawned
    // child (exit handler) and the adopted local listener; external-URL guest
    // servers are the owner's business and stay client-based.
    if (isLocalDefaultUrl(this.settings.url) && !isAntflyRunning()) return false
    return true
  }

  getHealthChecks(): AdapterHealthCheckDefinition[] {
    return [{
      id: 'availability',
      name: 'Antfly availability',
      run: async () => {
        const mode = isLocalDefaultUrl(this.settings.url) ? 'private instance' : 'external server'
        if (await this.available()) {
          // "Connected" is not "healthy": with models missing, indexing and
          // reindexing succeed while every semantic query dies at query-time
          // embedding — a state users hit by skipping the models step
          // mid-recovery. Keep this check amber until it's actually fixed.
          const required = requiredModelsForSettings(this.settings)
          const models = await checkInferenceModels(required)
          if (models.status !== 'ok') {
            const missingNames = new Set(
              ((models.details as { missing?: Array<{ model: string }> } | undefined)?.missing ?? []).map((m) => m.model),
            )
            const missing = required.filter((m) => missingNames.has(m.model))
            const embeddersMissing = missing.some((m) => m.kind === 'embedder')
            const consequence = embeddersMissing
              ? 'semantic search is dead until `bakin install search-models` runs (then `bakin reindex`)'
              : 'reranking is unavailable until `bakin install search-models` runs (indexing and search are unaffected)'
            return [{
              check: 'antfly.availability',
              status: 'warn' as const,
              message: `Antfly adapter is connected (${mode} at ${this.settings.url}) but search models are missing - ${consequence}`,
              autoFixable: false,
            }]
          }
          return [{
            check: 'antfly.availability',
            status: 'ok' as const,
            message: `Antfly adapter is available (${mode} at ${this.settings.url})`,
            autoFixable: false,
          }]
        }

        const detail = !this.settings.enabled
          ? 'search is disabled in settings'
          : await this.describeUnavailability(mode)
        return [{
          check: 'antfly.availability',
          status: 'warn' as const,
          message: `Antfly adapter is unavailable - ${detail}`,
          autoFixable: false,
        }]
      },
    }]
  }

  private async describeUnavailability(mode: string): Promise<string> {
    const health = await getServerHealthDetail(this.settings.url)
    if (health.reachable) {
      return `server is reachable (${mode} at ${this.settings.url}) but the client never became operational - check server logs`
    }
    if (health.legacyServer) {
      return `server at ${this.settings.url} looks like a pre-0.2 antfly (no /readyz) - upgrade it or remove the custom url to use Bakin's own instance`
    }
    return mode === 'private instance'
      ? `server is not running (run \`bakin check search\` / \`bakin install search\`)`
      : `external server at ${this.settings.url} is unreachable`
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

      const antflyConfig = buildTableConfig(name, config, this.settings)
      // No `schema` here — schemaless by choice (see buildTableConfig). The rc.2
      // bug that forced it (markhayden/bakin#456 item 1) is FIXED at v0.2.0-rc.9:
      // a table created WITH a client schema answers FTS + semantic queries
      // identically to a schemaless one (live-verified). We stay schemaless
      // anyway — type inference covers Bakin's needs and it's one less moving part.
      await client.tables.create(name, {
        num_shards: readNumber(config.adapterOptions?.numShards, 1),
        description: readString(config.adapterOptions?.description),
        indexes: antflyConfig.indexes,
      } as Record<string, unknown>)
      this.logger.info(`Table created: ${name}`)
      this.readyIndexCache.delete(name)
    },

    drop: async (name: string): Promise<void> => {
      const client = this.client
      if (!client) return
      try {
        await client.tables.drop(name)
      } catch (err) {
        this.logger.warn(`Table drop failed for ${name}`, err)
      } finally {
        this.readyIndexCache.delete(name)
      }
    },

    stats: async (name: string): Promise<TableStats | null> => {
      const client = this.client
      if (!client) return null
      try {
        // Doc count comes from index status (a plain GET) — never a query:
        // queries against a table with an active embeddings backfill hang
        // indefinitely at this pin (bakin#456 finding 10), which froze the
        // health page for the whole post-reindex backfill window. The
        // server-created full-text index indexes every doc, so its
        // doc_count is the table's document count.
        const indexes = normalizeIndexStatuses(await client.indexes.list(name))
        const fullText = indexes.find((entry) => readIndexType(entry.config) === 'full_text') ?? indexes[0]
        const status = (fullText?.status ?? {}) as Record<string, unknown>
        // Full-text status exposes total_indexed, not doc_count — read both so
        // health/stats don't report zero docs for a populated table.
        const documents = readIndexedCount(status)
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
      const indexes = normalizeIndexStatuses(await client.indexes.list(name))
      for (const entry of indexes) {
        const config = entry.config
        if (!config || typeof config !== 'object') continue
        // The full-text index (full_text_index_v0) is server-managed: antfly
        // auto-creates it on table create and the SDK cannot recreate it
        // (`indexes.create` returns "Failed to create index: undefined"). A
        // rebuild that drops it leaves the table with NO full-text leg and no
        // way to restore it short of recreating the whole table. Skip it —
        // rebuild only the caller-owned embeddings indexes; full-text needs no
        // rebuild (it re-indexes every doc inline).
        if (readIndexType(config) === 'full_text') continue
        try {
          await client.indexes.drop(name, entry.name)
          await client.indexes.create(name, config as Parameters<typeof client.indexes.create>[1])
          this.logger.info(`Rebuilt index ${entry.name} on ${name}`)
        } catch (err) {
          this.logger.warn(`Failed to rebuild index ${entry.name} on ${name}`, err)
        }
      }
      this.readyIndexCache.delete(name)
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

  /**
   * Drop requested semantic indexes that aren't queryable — absent, or
   * rebuilding with zero docs. Naming such an index makes antfly fail the WHOLE
   * request (500), which silently drops the entire table out of search. A
   * rebuilding index that already holds vectors (doc_count > 0) IS queryable
   * and is kept — antfly serves it 200 even though its catch-up residual hasn't
   * finalized, so dropping it would needlessly zero the semantic/visual leg.
   * If nothing queryable remains, remove the semantic leg so a full-text leg
   * (if any) still runs. Cached briefly to avoid an indexes.list round-trip per
   * query.
   */
  private async filterRequestToReadyIndexes(
    table: string,
    request: { indexes?: string[]; semantic_search?: unknown },
  ): Promise<void> {
    const requested = request.indexes
    if (!requested || requested.length === 0) return
    const client = this.client
    if (!client) return

    const now = Date.now()
    let entry = this.readyIndexCache.get(table)
    if (!entry || now - entry.at > READY_INDEX_CACHE_TTL_MS) {
      try {
        const statuses = normalizeIndexStatuses(await client.indexes.list(table))
        const names = new Set<string>()
        for (const s of statuses) {
          const st = (s.status as Record<string, unknown> | null) ?? {}
          const rebuilding = (st.rebuilding as boolean) ?? false
          // "Queryable" is the real readiness signal, not the rebuilding flag.
          // An embeddings index whose catch-up residual hasn't finalized stays
          // rebuilding=true indefinitely (an open antfly convergence bug) yet
          // already holds valid vectors and serves queries correctly (HTTP 200,
          // ranked hits). Excluding it silently zeroes the semantic/visual leg —
          // the user sees no scores. Only an index with ZERO queryable docs
          // (genuinely empty / absent) 500s the whole request, so drop just
          // those. The query path is try/caught + timeout-bounded as a backstop.
          // Use the documented v0.2 field (total_indexed) so a rebuilding index
          // that already holds vectors isn't read as empty and stripped.
          if (!rebuilding || readIndexedCount(st) > 0) names.add(s.name)
        }
        entry = { names, at: now }
        this.readyIndexCache.set(table, entry)
      } catch (err) {
        // Can't determine readiness — leave the request unchanged rather than
        // risk dropping a healthy index.
        this.logger.warn('Antfly index readiness probe failed', { error: err, table })
        return
      }
    }

    const ready = requested.filter((name) => entry.names.has(name))
    if (ready.length === requested.length) return
    if (ready.length === 0) {
      delete request.indexes
      delete (request as { semantic_search?: unknown }).semantic_search
      // merge_config exists to weight the (now-stripped) semantic legs. It is
      // NOT inert on a single-lane request — the server routes any request
      // carrying merge_config through the fusion path — so drop it with them.
      delete (request as { merge_config?: unknown }).merge_config
      this.logger.warn('All requested semantic indexes are rebuilding/absent - serving full-text only', { table, requested })
    } else {
      request.indexes = ready
      this.logger.info('Skipping rebuilding/absent semantic indexes for query', { table, served: ready, requested })
    }
  }

  async query(table: string, q: Query): Promise<QueryResult> {
    const client = this.client
    if (!client || !this.settings.enabled) return emptyQueryResult(q)

    const request = buildQueryRequest(table, q, this.settings)
    await this.filterRequestToReadyIndexes(table, request)
    if (!hasSearchLeg(request)) {
      // Vector-only query whose semantic indexes are all unready: nothing left
      // to execute. Don't send a no-criteria request to antfly (it 500s or
      // match-alls) — return empty deterministically instead.
      return emptyQueryResult(q)
    }

    try {
      // Same no-infinite-patience ceiling as multiQuery: a query against a
      // table with an active embeddings backfill hangs indefinitely at this
      // pin (bakin#456 finding 10), and this path serves the per-plugin
      // /search routes directly.
      return await this.executePrepared(table, q, request, async (req) => {
        const result = await client.tables.query(table, req)
        return result?.responses?.[0]
      }, queryTimeoutMs())
    } catch (err) {
      if (err instanceof QueryTimeoutError) {
        this.logger.warn('Antfly query timed out - returning empty result', { table, timeoutMs: queryTimeoutMs() })
      } else {
        this.logger.error('Antfly query failed', { error: err, table })
      }
      return emptyQueryResult(q)
    }
  }

  /**
   * Run a prepared request, patching over two rc.9 server behaviors
   * (live-verified, reported upstream):
   *
   * 1. `hits.total` and aggregation buckets are PAGE-scoped unless the
   *    request is count-only. When the caller asked for facets, a companion
   *    `count: true` query supplies the true total + full-corpus buckets.
   *    (limit-0 count flows already run count-only — no companion needed.)
   * 2. Filters can only ride the full-text leg (filter_query zeroes the hits
   *    path), so hits that arrived via the semantic leg are re-checked
   *    client-side. A hit with a full_text lane score already passed the
   *    filtered leg server-side and is never dropped.
   */
  private async executePrepared(
    table: string,
    q: Query,
    request: QueryRequest,
    run: (req: QueryRequest) => Promise<AntflyQueryResponse | undefined>,
    timeoutMs: number,
  ): Promise<QueryResult> {
    const isCountOnly = (request as Record<string, unknown>).count === true
    // ACCEPTED TRADE: only faceted queries pay for the companion count.
    // Plain paginated lists (no facets) keep the server's page-scoped total —
    // running a count twin on every list/keystroke query would double load
    // for a number most callers never display. Callers that need a true
    // total on an un-faceted query can request a facet or count explicitly.
    const wantsCorpusAggregations = !isCountOnly && request.aggregations != null

    const companionPromise: Promise<AntflyQueryResponse | undefined> = wantsCorpusAggregations
      ? raceQueryTimeout(run(companionCountRequest(request)), timeoutMs).catch((err) => {
          this.logger.warn('Companion count query failed - facet counts fall back to page scope', { table, error: err })
          return undefined
        })
      : Promise.resolve(undefined)

    const response = await raceQueryTimeout(run(request), timeoutMs)
    const companion = await companionPromise
    if (!response) return emptyQueryResult(q)

    let result = mapResponse(response, table)

    if (q.filters?.length && (request as { semantic_search?: unknown }).semantic_search != null) {
      result = {
        ...result,
        hits: result.hits.filter((hit) =>
          // mapHits spreads antfly's raw _index_scores into scoreBreakdown;
          // `full_text` is the reserved lane name for the FTS leg.
          (hit.scoreBreakdown as Record<string, number> | undefined)?.full_text !== undefined
            || hitMatchesFilters(hit.document, q.filters)),
      }
    }

    if (companion) {
      const corpus = mapResponse(companion, table)
      result = {
        ...result,
        total: corpus.total,
        facets: corpus.facets ?? result.facets,
        aggregations: corpus.aggregations ?? result.aggregations,
      }
    }
    return result
  }

  async multiQuery(queries: Array<{ table: string; query: Query }>): Promise<QueryResult[]> {
    const client = this.client
    if (!client || !this.settings.enabled) return queries.map(({ query }) => emptyQueryResult(query))
    if (queries.length === 0) return []

    // The two rc.2 constraints that forced a fully-sequential fan-out (bakin#456)
    // are fixed at v0.2.0-rc.9 — the NDJSON multiquery endpoint works cross-table
    // and concurrent reranked queries no longer SIGABRT the Metal backend. The
    // ONLY remaining reason to serialize is reranking: it serializes on the Metal
    // queue (~3s/query) and a parallel fan-out of reranked queries backs up to
    // 30s+. So: parallelize when nothing reranks (the off-by-default case, where
    // sequential made an N-table search take N× a single query — the actual
    // cross-table latency bottleneck), and fall back to sequential when any query
    // reranks. Per-query failure isolation is preserved either way.
    const timeoutMs = queryTimeoutMs()

    // Build + ready-filter every request up front so we can pick the strategy.
    const prepared = await Promise.all(queries.map(async ({ table, query }) => {
      const request = buildQueryRequest(table, query, this.settings)
      await this.filterRequestToReadyIndexes(table, request)
      return { table, query, request }
    }))
    const anyRerank = prepared.some((p) => p.request.reranker != null)

    const runOne = async ({ table, query, request }: typeof prepared[number]): Promise<QueryResult> => {
      // A vector-only request whose semantic indexes were all stripped as
      // unready has no executable leg — return empty rather than sending a
      // no-criteria request to antfly. Other tables in the batch still run.
      if (!hasSearchLeg(request)) return emptyQueryResult(query)
      try {
        return await this.executePrepared(table, query, request, (req) => client.query(req), timeoutMs)
      } catch (err) {
        if (err instanceof QueryTimeoutError) {
          // A timed-out table must not stall the others — return empty and keep
          // going. (The abandoned query may still run server-side; mild overlap
          // is the lesser evil vs. an indefinitely hung cross-table search.)
          this.logger.warn('Antfly query timed out - returning empty result', { table, timeoutMs })
        } else {
          this.logger.error('Antfly query failed', { error: err, table })
        }
        return emptyQueryResult(query)
      }
    }

    if (anyRerank) {
      const results: QueryResult[] = []
      for (const p of prepared) results.push(await runOne(p))
      return results
    }
    return Promise.all(prepared.map(runOne))
  }

  async *scan(table: string, opts?: ScanOpts): AsyncIterable<ScannedDocument> {
    const client = this.client
    if (!client || !this.settings.enabled) return
    const request: { fields?: string[]; limit?: number } = {}
    if (opts?.fields?.length) request.fields = opts.fields
    if (opts?.limit !== undefined && Number.isFinite(opts.limit) && opts.limit > 0) {
      request.limit = opts.limit
    }
    const scanRequest = Object.keys(request).length > 0 ? request : undefined
    const rows = scanRequest === undefined ? client.tables.scan(table) : client.tables.scan(table, scanRequest)
    let keylessRows = 0
    for await (const doc of rows) {
      const record = doc as Record<string, unknown>
      const rowKey = typeof record.key === 'string'
        ? record.key
        : typeof record._key === 'string'
          ? record._key
          : ''
      if (!rowKey) {
        // One warn per scan, not per row: silently dropping keyless rows
        // would shrink dedupe/TTL scans invisibly if the server ever renames
        // the key field again (live emits `key`; the SDK docs say `_key`).
        keylessRows += 1
        if (keylessRows === 1) {
          this.logger.warn('Antfly scan returned rows without a key field - skipping them', { table })
        }
        continue
      }
      const fields: Record<string, unknown> = { ...record }
      delete fields.key
      delete fields._key
      yield { key: rowKey, document: fields }
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

  private async getIndexHealth(table: string): Promise<{ indexes: AntflyIndexHealthEntry[]; healthy: boolean } | null> {
    const client = this.client
    if (!client) return null
    try {
      const indexStatuses = normalizeIndexStatuses(await client.indexes.list(table))
      const indexes: AntflyIndexHealthEntry[] = []
      let healthy = true
      for (const { name: indexName, config, status } of indexStatuses) {
        const s = (status ?? {}) as Record<string, unknown>
        const enrichment = (s.enrichment_runtime ?? {}) as Record<string, unknown>
        // The engine reports docs pending enrichment as enrichment_runtime.pending_sequence_count;
        // the older top-level `wal_backlog` is not emitted at this pin (reads undefined), so prefer
        // the real field and fall back for forward/backward compat.
        const pending = Number(enrichment.pending_sequence_count ?? s.wal_backlog ?? 0)
        const replayApplied = readNumber(s.replay_applied_sequence, readNumber(s.dense_replay_applied_sequence, 0))
        const replayTarget = readNumber(s.replay_target_sequence, readNumber(s.dense_replay_target_sequence, 0))
        const replayBacklog = Math.max(0, replayTarget - replayApplied)
        const replayCatchUpRequired = readBoolean(s.replay_catch_up_required) ?? replayBacklog > 0
        const catchUpActive = readBoolean(s.catch_up_active) ?? false
        const densePublishPending = readBoolean(s.dense_publish_pending) ?? false
        const backfillActive = readBoolean(s.backfill_active) ?? false
        const entry: AntflyIndexHealthEntry = {
          name: indexName,
          type: readIndexType(config) ?? 'unknown',
          totalIndexed: (s.total_indexed as number) ?? 0,
          walBacklog: Number.isFinite(pending) ? pending : 0,
          rebuilding: (s.rebuilding as boolean) ?? false,
          backfillActive,
          replayAppliedSequence: replayApplied,
          replayTargetSequence: replayTarget,
          replayBacklog,
          replayCatchUpRequired,
          catchUpActive,
          densePublishPending,
        }
        if (s.error) {
          entry.error = String(s.error)
          healthy = false
        } else if (enrichment.worker_failed === true || Number(enrichment.fatal_error_count ?? 0) > 0) {
          // Real enrichment-failure signals the engine exposes. Without these, a table whose
          // embedder is rejecting docs shows green while semantic search silently misses them.
          entry.error = `enrichment failed (worker_failed=${enrichment.worker_failed === true}, fatal_errors=${Number(enrichment.fatal_error_count ?? 0)})`
          healthy = false
        } else if (s.backfill_state === 'failed') {
          // A dead backfill the server doesn't surface via `error`: semantic
          // search is empty for this index until a rebuild succeeds.
          entry.error = 'embeddings backfill failed - semantic search dead for this index until a rebuild succeeds'
          healthy = false
        }
        if (entry.walBacklog > 0 || backfillActive || replayCatchUpRequired || catchUpActive || densePublishPending) {
          healthy = false
        }
        if (typeof s.backfill_progress === 'number') entry.backfillProgress = s.backfill_progress
        if (typeof s.backfill_state === 'string') entry.backfillState = s.backfill_state
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
      .map(([name, cfg]) => `${name}:${cfg.provider}:${cfg.model}:${cfg.dimension}`)
      .join('|')
  }
}

interface IndexStatusEntry {
  name: string
  config: unknown
  status: unknown
}

/**
 * The v0.2 SDK's indexes.list returns an ARRAY of { config, status } —
 * Object.entries over it yields "0"/"1" as index names, which broke the
 * health page labels and made rebuildIndexes drop nonexistent indexes.
 * Normalize both the array shape and the pre-0.2 name-keyed object shape;
 * the authoritative name is config.name.
 */
function normalizeIndexStatuses(indexStatuses: unknown): IndexStatusEntry[] {
  const entries: Array<[string, unknown]> = Array.isArray(indexStatuses)
    ? indexStatuses.map((entry, i) => [String(i), entry] as [string, unknown])
    : Object.entries((indexStatuses ?? {}) as Record<string, unknown>)
  return entries.map(([key, info]) => {
    const record = (info && typeof info === 'object' ? info : {}) as Record<string, unknown>
    const config = record.config ?? null
    const status = record.status ?? null
    const configName = (config as Record<string, unknown> | null)?.name
    return { name: typeof configName === 'string' ? configName : key, config, status }
  })
}

function readIndexType(config: unknown): string | undefined {
  const type = (config as Record<string, unknown> | null)?.type
  return typeof type === 'string' ? type : undefined
}

/**
 * Document count from an index status, preferring documented v0.2 fields. The
 * embeddings index status exposes `total_indexed` (NOT doc_count); a rebuilding
 * index with total_indexed > 0 must not read as empty and get stripped from
 * semantic search. query_visible_doc_count / doc_count are live-server extras
 * we still honor first when present.
 */
function readIndexedCount(status: Record<string, unknown>): number {
  for (const value of [status.query_visible_doc_count, status.doc_count, status.total_indexed]) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return 0
}

/**
 * True if the request still has at least one executable search leg after
 * readiness filtering — a full-text leg, or a semantic leg WITH ready indexes.
 * A request with neither must not be sent to antfly (it would 500 / match-all).
 */
function hasSearchLeg(request: { full_text_search?: unknown; semantic_search?: unknown; indexes?: unknown }): boolean {
  if (request.full_text_search != null) return true
  return request.semantic_search != null && Array.isArray(request.indexes) && request.indexes.length > 0
}

function isTransientBatchError(err: unknown): boolean {
  const msg = stringifyError(err)
  return TRANSIENT_BATCH_ERROR_PATTERNS.some((pattern) => msg.includes(pattern))
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
