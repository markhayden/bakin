/**
 * Thin HTTP SearchAdapter for antfly main — the entire client is: translate
 * (pure) + fetch + typed errors. No process supervision (service.ts owns
 * lifecycle), no reconcile hooks, no warm state. Wire facts live in wire.ts
 * and tasks/evidence-search-rebuild.md.
 */
import { createHash } from 'crypto'
import { createLogger } from '@bakin/core/logger'
import {
  SearchEngineUnavailableError,
  SearchRequestRejectedError,
} from '@bakin/core/adapters/search/errors'
import type {
  BatchResult,
  Document,
  IndexItem,
  Query,
  QueryResult,
  ScanOpts,
  ScannedDocument,
  SearchAdapter,
  SearchAdapterCapabilities,
  TableConfig,
  TableInfo,
  TableLegHealth,
  TableStats,
  TransformFn,
} from '@bakin/core/adapters/search'
import type { AntflySettings } from './defaults'
import {
  buildBatchDeletes,
  buildBatchInserts,
  buildQueryRequest,
  buildTableProvisioning,
  embedderUsable,
  mapIndexStatuses,
  mapQueryResponse,
} from './translate'
import { paths, type WireBatchResponse, type WireIndexStatusEntry, type WireQueryEnvelope, type WireQueryRequest } from './wire'

const log = createLogger('antfly-client')

const QUERY_TIMEOUT_MS = 15_000
/** Client-side grace past a query's cooperative deadline (see runQuery). */
const DEADLINE_GRACE_MS = 500
/** Below this remaining budget the fts-only degrade retry can't help. */
const MIN_RETRY_BUDGET_MS = 100
/** Scan fallback is a canary/availability safety net, not a full query engine. */
const SCAN_FALLBACK_MAX_ROWS = 250
const SCAN_FALLBACK_MAX_MS = 750
const WRITE_TIMEOUT_MS = 30_000
const AVAILABLE_TTL_MS = 3_000

export interface AntflyClientOpts {
  /** Injectable for unit tests. */
  fetchImpl?: typeof fetch
}

export class AntflySearchClient implements SearchAdapter {
  readonly name = 'antfly'
  readonly version = '2.0.0'
  readonly requiredCoreVersion = '>=0.1.0'

  private readonly settings: AntflySettings
  private readonly fetchImpl: typeof fetch
  private availableCache: { value: boolean; at: number } | null = null

  constructor(settings: AntflySettings, opts?: AntflyClientOpts) {
    this.settings = settings
    this.fetchImpl = opts?.fetchImpl ?? fetch
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.settings.auth) {
      const credentials = `${this.settings.auth.username}:${this.settings.auth.password}`
      headers.Authorization = `Basic ${Buffer.from(credentials).toString('base64')}`
    }
    return headers
  }

  /**
   * One request path, one error taxonomy: network/timeout/5xx →
   * SearchEngineUnavailableError (outbox retries forever), 4xx →
   * SearchRequestRejectedError (counts toward quarantine). The engine has
   * no server-side cancellation, so timeouts ABANDON the request.
   */
  private async request(method: string, path: string, body?: unknown, timeoutMs = WRITE_TIMEOUT_MS): Promise<Response> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.settings.url}${path}`, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw new SearchEngineUnavailableError(
        `antfly unreachable (${method} ${path}): ${err instanceof Error ? err.message : String(err)}`,
        err,
      )
    }
    if (response.status >= 500) {
      const text = await response.text().catch(() => '')
      throw new SearchEngineUnavailableError(`antfly ${response.status} on ${method} ${path}: ${text.slice(0, 300)}`)
    }
    if (response.status >= 400) {
      const text = await response.text().catch(() => '')
      throw new SearchRequestRejectedError(`antfly rejected ${method} ${path} (${response.status}): ${text.slice(0, 300)}`, undefined, response.status)
    }
    return response
  }

  private async requestJson<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    const response = await this.request(method, path, body, timeoutMs)
    const text = await response.text()
    if (text.length === 0) return null as T
    try {
      return JSON.parse(text) as T
    } catch (err) {
      throw new SearchEngineUnavailableError(`antfly returned non-JSON on ${method} ${path}`, err)
    }
  }

  async initialize(): Promise<void> {
    // Lifecycle is service.ts's job (OS-supervised); the client is stateless.
  }

  async shutdown(): Promise<void> {}

  async available(): Promise<boolean> {
    const now = Date.now()
    if (this.availableCache && now - this.availableCache.at < AVAILABLE_TTL_MS) return this.availableCache.value
    let value = false
    try {
      const status = await this.requestJson<{ health?: unknown }>('GET', paths.status(), undefined, 3_000)
      value = status !== null && typeof status === 'object'
    } catch {
      value = false
    }
    this.availableCache = { value, at: now }
    return value
  }

  capabilities(): SearchAdapterCapabilities {
    // Honest capabilities: a leg whose embedder is disabled in settings is
    // NOT offered — table creates skip it (keyword-only degrade) and the
    // doctor compares these legs against what content types declare.
    const legs: SearchAdapterCapabilities['legs'] = ['full-text']
    if (embedderUsable(this.settings.embedders.default)) legs.push('text-embedding')
    // Mirrors embeddingIndexFromLeg's resolution: visual falls back to default.
    if (embedderUsable(this.settings.embedders.visual ?? this.settings.embedders.default)) legs.push('media-embedding')
    return { legs, rerank: true, facets: true, transform: true }
  }

  mappingFingerprint(): string {
    const canonical = Object.entries(this.settings.embedders)
      .map(([ref, e]) => `${ref}:${e.provider}/${e.model}@${e.dimension}${e.multimodal ? '+mm' : ''}`)
      .sort()
      .join('|')
    return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
  }

  tables = {
    list: async (): Promise<TableInfo[]> => {
      const raw = await this.requestJson<unknown>('GET', paths.tables())
      if (Array.isArray(raw)) {
        return raw.map((entry) =>
          typeof entry === 'string' ? { name: entry } : { name: (entry as { name: string }).name },
        )
      }
      if (raw && typeof raw === 'object') {
        return Object.keys(raw as Record<string, unknown>).map((name) => ({ name }))
      }
      return []
    },
    // Creates/drops ride the write gate too: they provision/tear down
    // embedding legs, and concurrent structural ops are part of the same
    // Metal-crash surface as concurrent batch writes (2026-07-22 ladder).
    create: async (name: string, config: TableConfig): Promise<void> => {
      const plan = buildTableProvisioning(config, this.settings)
      await this.serializedWrite(() => this.request('POST', paths.table(name), plan.table))
      // Embeddings legs ride the per-index endpoint — the only create path
      // whose enrichment worker actually starts on 0.2.0 — and MUST land
      // before the first document write (see buildTableProvisioning).
      for (const index of plan.indexes) {
        await this.serializedWrite(() => this.request('POST', paths.index(name, index.name), index))
      }
    },
    drop: async (name: string): Promise<void> => {
      await this.serializedWrite(() => this.request('DELETE', paths.table(name)))
    },
    stats: async (name: string): Promise<TableStats | null> => {
      // Doc count from index status, NEVER a query (queries can hang during backfill).
      const entries = await this.indexStatuses(name)
      if (entries === null) return null
      const fullText = entries.find((e) => e.config.type === 'full_text') ?? entries[0]
      return { table: name, documents: fullText?.status?.doc_count ?? 0 }
    },
    health: async (name: string): Promise<TableLegHealth[]> => {
      const entries = await this.indexStatuses(name)
      return entries === null ? [] : mapIndexStatuses(entries)
    },
  }

  private async indexStatuses(name: string): Promise<WireIndexStatusEntry[] | null> {
    try {
      const raw = await this.requestJson<WireIndexStatusEntry[]>('GET', paths.indexes(name))
      return Array.isArray(raw) ? raw : []
    } catch (err) {
      // ONLY a 404 means "no such table". Any other 4xx (malformed leg,
      // auth, unprocessable) is a distinct failure and must THROW — a null
      // here becomes "Active Search index is missing" in the doctor, which
      // sends the operator to a blue/green rebuild instead of the real fix
      // (Margo's-box incident, 2026-07-21).
      if (err instanceof SearchRequestRejectedError && err.status === 404) return null
      throw err
    }
  }

  /**
   * ONE write in flight, ever, process-wide. Root-caused 2026-07-22 via a
   * minimal shell ladder: THREE parallel batch-write streams into
   * embedding-leg tables CRASH the engine outright
   * (metal-command-buffer-failed, MTLCommandBufferErrorDomain, process
   * exit) — reproducible with plain curl, no Bakin involved. launchd's
   * respawn masked the crash as mysterious "wedging" for a whole night.
   * Serializing writes at the client honors the engine's real concurrency
   * contract; reads are unaffected. Remove when upstream survives
   * concurrent embed-bearing writes (antfly issue pending).
   */
  private writeGate: Promise<unknown> = Promise.resolve()
  private serializedWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeGate.then(fn, fn)
    this.writeGate = next.catch(() => {})
    return next
  }

  documents = {
    index: async (table: string, key: string, doc: Document): Promise<void> => {
      await this.serializedWrite(() => this.request('POST', paths.batch(table), buildBatchInserts([{ key, doc }])))
    },
    batchIndex: async (table: string, items: IndexItem[], opts?: { sync?: boolean }): Promise<BatchResult> => {
      if (items.length === 0) return { indexed: 0, failed: [] }
      const result = await this.serializedWrite(() =>
        this.requestJson<WireBatchResponse>('POST', paths.batch(table), buildBatchInserts(items, opts)))
      return { indexed: result?.inserted ?? items.length, failed: [] }
    },
    remove: async (table: string, key: string): Promise<void> => {
      await this.serializedWrite(() => this.request('POST', paths.batch(table), buildBatchDeletes([key])))
    },
    batchRemove: async (table: string, keys: string[]): Promise<number> => {
      if (keys.length === 0) return 0
      const result = await this.serializedWrite(() =>
        this.requestJson<WireBatchResponse>('POST', paths.batch(table), buildBatchDeletes(keys)))
      return result?.deleted ?? 0
    },
    get: async (table: string, key: string): Promise<Document | null> => {
      try {
        const doc = await this.requestJson<Document>('GET', paths.document(table, key))
        return doc && typeof doc === 'object' ? doc : null
      } catch (err) {
        // ONLY a 404 means "absent". Other 4xx (400/401/403/422) are engine
        // rejections — masking those as null would turn a config/auth
        // regression into silent "Document not found" answers.
        if (err instanceof SearchRequestRejectedError && err.status === 404) return null
        throw err
      }
    },
    transform: async (table: string, key: string, fn: TransformFn): Promise<void> => {
      const current = await this.documents.get(table, key)
      if (!current) return // absent — nothing to transform
      const next = await fn(current)
      await this.serializedWrite(() => this.request('POST', paths.batch(table), buildBatchInserts([{ key, doc: next }])))
    },
  }

  async query(table: string, q: Query): Promise<QueryResult> {
    const started = Date.now()
    const request = buildQueryRequest(table, q, this.settings)
    let main: WireQueryEnvelope | null
    let degraded = false
    try {
      main = await this.runQuery(table, request, q.deadlineMs)
    } catch (err) {
      // D11's sanctioned degrade, implemented client-side: while a large
      // embeddings backfill saturates the inference queue, the QUERY's own
      // embed job starves and the request times out — client-side abort,
      // or the engine's own rc.18 cooperative deadline (504). Retry once
      // FTS-only inside the REMAINING budget and LABEL it — visible in
      // diagnostics, never silent.
      const deadlineMiss = err instanceof SearchEngineUnavailableError
        && /timed out|TimeoutError|antfly 504 /i.test(err.message)
      if (deadlineMiss && request.semantic_search !== undefined) {
        const remaining = (q.deadlineMs ?? QUERY_TIMEOUT_MS) - (Date.now() - started)
        if (remaining < MIN_RETRY_BUDGET_MS) return this.scanFallbackQuery(table, q, err)
        const ftsOnly = buildQueryRequest(table, { ...q, strategy: 'fts', deadlineMs: remaining }, this.settings)
        try {
          main = await this.runQuery(table, ftsOnly, remaining)
          degraded = true
        } catch (ftsErr) {
          return this.scanFallbackQuery(table, { ...q, strategy: 'fts' }, ftsErr)
        }
      } else {
        return this.scanFallbackQuery(table, q, err)
      }
    }
    // rc.18 totals and aggregation buckets are corpus-true on every
    // response — the old page-scoped-totals count twin is gone.
    const result = mapQueryResponse(main, table)
    if (degraded) {
      result.diagnostics = {
        ...(result.diagnostics ?? { strategy: 'fts' }),
        strategy: 'fts',
        budget: 'degraded',
        adapter: { ...(result.diagnostics?.adapter ?? {}), degraded: 'semantic-embed-timeout' },
      }
    }
    return result
  }

  private async scanFallbackQuery(table: string, q: Query, error: unknown): Promise<QueryResult> {
    const text = (q.text ?? '').trim()
    const needle = text === '*' ? '' : text.toLowerCase()
    const requested = q.adapterOptions?.searchableFields
    const fields = Array.isArray(requested) ? requested.filter((f): f is string => typeof f === 'string') : undefined
    const limit = q.limit ?? this.settings.search.defaultLimit
    const maxRows = typeof q.adapterOptions?.scanFallbackMaxRows === 'number'
      ? Math.max(1, Math.min(SCAN_FALLBACK_MAX_ROWS, Math.floor(q.adapterOptions.scanFallbackMaxRows)))
      : SCAN_FALLBACK_MAX_ROWS
    const remaining = q.deadlineMs === undefined ? SCAN_FALLBACK_MAX_MS : q.deadlineMs
    const maxMs = Math.max(1, Math.min(SCAN_FALLBACK_MAX_MS, remaining))
    const stopAt = Date.now() + maxMs
    const hits: QueryResult['hits'] = []
    let seen = 0
    let capped = false
    try {
      // The scan's HTTP request must inherit the remaining budget: with the
      // default write timeout it hung 30s AFTER the main query had already
      // spent the deadline (2026-07-22 — the /api/search spinner's tail).
      for await (const row of this.scan(table, fields && fields.length > 0 ? { fields } : undefined, maxMs + DEADLINE_GRACE_MS)) {
        seen += 1
        const haystack = Object.values(row.document).map((v) => String(v ?? '')).join('\n').toLowerCase()
        if (needle.length === 0 || haystack.includes(needle)) {
          hits.push({ key: row.key, document: row.document, score: needle.length > 0 ? 0.1 : 0 })
          if (hits.length >= limit) break
        }
        if (seen >= maxRows || Date.now() >= stopAt) {
          capped = true
          break
        }
      }
    } catch (scanErr) {
      throw error instanceof Error ? error : scanErr
    }
    return {
      hits,
      total: hits.length,
      diagnostics: {
        strategy: 'fts',
        budget: 'degraded',
        adapter: {
          degraded: 'query-endpoint-unavailable-scan-fallback',
          error: error instanceof Error ? error.message : String(error),
          scanned: seen,
          capped,
        },
      },
    }
  }

  private runQuery(table: string, request: WireQueryRequest, deadlineMs?: number): Promise<WireQueryEnvelope | null> {
    // Client abort = deadline + grace: the server owns the deadline
    // (timeout_ms → 504); the abort only covers an engine that stopped
    // answering entirely.
    const timeout = deadlineMs !== undefined && deadlineMs > 0
      ? Math.round(deadlineMs) + DEADLINE_GRACE_MS
      : QUERY_TIMEOUT_MS
    return this.requestJson<WireQueryEnvelope>('POST', paths.query(table), request, timeout)
  }

  async multiQuery(queries: Array<{ table: string; query: Query }>): Promise<QueryResult[]> {
    // Per-table failures are ISOLATED: one sick table (empty embeddings
    // index mid-backfill 500s, a wedged shard) contributes zero hits with
    // a diagnostic instead of zeroing the whole cross-table search — the
    // exact failure observed at the rc.17 cutover with Promise.all.
    // Failures log ONE aggregated line per fan-out, not one per table: a
    // single degraded query (e.g. the first semantic fan-out after the
    // engine's embed path went cold) used to spam 11 identical warns at
    // every boot. Per-table detail stays in the response diagnostics.
    const failures: Array<{ table: string; err: string }> = []
    const run = async (entry: { table: string; query: Query }): Promise<QueryResult> => {
      try {
        return await this.query(entry.table, entry.query)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        failures.push({ table: entry.table, err: message })
        return { hits: [], total: 0, diagnostics: { strategy: 'none', budget: 'omitted', adapter: { error: message } } }
      }
    }
    // Parallel by default; sequential only when something reranks (the
    // reranker serializes on one Metal queue — concurrent reranked queries
    // back up behind each other anyway). SEQUENTIAL SHARES ONE WALL-CLOCK:
    // per-table deadlines multiplied by table count turned "2s budget" into
    // a 32-second spinner under rebuild load (2026-07-22 — every table
    // burned its own slice back-to-back). The fan-out's budget is the MAX
    // single-table deadline; tables past it are honestly omitted.
    let results: QueryResult[]
    if (queries.some((entry) => entry.query.rerank)) {
      const budgetMs = Math.max(...queries.map((entry) => entry.query.deadlineMs ?? QUERY_TIMEOUT_MS))
      const endAt = Date.now() + budgetMs
      results = []
      for (const entry of queries) {
        const remaining = endAt - Date.now()
        if (remaining < 150) {
          results.push({
            hits: [],
            total: 0,
            diagnostics: { strategy: 'none', budget: 'omitted', adapter: { error: 'fan-out budget exhausted' } },
          })
          continue
        }
        const clamped = entry.query.deadlineMs === undefined || entry.query.deadlineMs > remaining
          ? { ...entry, query: { ...entry.query, deadlineMs: remaining } }
          : entry
        results.push(await run(clamped))
      }
    } else {
      results = await Promise.all(queries.map(run))
    }
    if (failures.length > 0) {
      log.warn(`multiQuery degraded — ${failures.length}/${queries.length} table(s) contributed zero hits`, {
        tables: failures.map((f) => f.table),
        err: failures[0].err,
      })
    }
    return results
  }

  async *scan(table: string, opts?: ScanOpts, timeoutMs?: number): AsyncIterable<ScannedDocument> {
    // Bodyless scans all keys (legal since 0.2.0); a body only narrows fields.
    const body = opts?.fields?.length ? { fields: opts.fields } : undefined
    const response = await this.request('POST', paths.lookup(table), body, timeoutMs)
    const text = await response.text()
    let warnedKeyless = false
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      let row: Record<string, unknown>
      try {
        row = JSON.parse(trimmed) as Record<string, unknown>
      } catch {
        continue
      }
      // rc.18's /documents scan emits `_id`; older engines said `key`/`_key`.
      const key = (row._id ?? row.key ?? row._key) as string | undefined
      if (typeof key !== 'string') {
        warnedKeyless = true
        continue
      }
      const { _id: _k0, key: _k1, _key: _k2, ...fields } = row
      yield { key, document: fields }
    }
    if (warnedKeyless) {
      // One notice per scan, not per row (silently dropping keyless rows
      // would shrink dedupe/TTL scans invisibly).
      log.warn('scan returned rows without a key field — skipped', { table })
    }
  }

}
