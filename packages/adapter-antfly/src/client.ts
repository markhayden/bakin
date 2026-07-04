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
import type { AdapterHealthCheckDefinition } from '@bakin/core/adapters/shared'
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
  buildTableCreate,
  mapIndexStatuses,
  mapQueryResponse,
  toCountRequest,
} from './translate'
import { paths, type WireBatchResponse, type WireIndexStatusEntry, type WireQueryEnvelope, type WireQueryRequest } from './wire'

const log = createLogger('antfly-client')

const QUERY_TIMEOUT_MS = 15_000
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

  getHealthChecks(): AdapterHealthCheckDefinition[] {
    return []
  }

  capabilities(): SearchAdapterCapabilities {
    return { legs: ['full-text', 'text-embedding', 'media-embedding'], rerank: true, facets: true, transform: true }
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
    create: async (name: string, config: TableConfig): Promise<void> => {
      await this.request('POST', paths.table(name), buildTableCreate(config, this.settings))
    },
    drop: async (name: string): Promise<void> => {
      await this.request('DELETE', paths.table(name))
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
      if (err instanceof SearchRequestRejectedError) return null // 404: no such table
      throw err
    }
  }

  documents = {
    index: async (table: string, key: string, doc: Document): Promise<void> => {
      await this.request('POST', paths.batch(table), buildBatchInserts([{ key, doc }]))
    },
    batchIndex: async (table: string, items: IndexItem[], opts?: { sync?: boolean }): Promise<BatchResult> => {
      if (items.length === 0) return { indexed: 0, failed: [] }
      const result = await this.requestJson<WireBatchResponse>('POST', paths.batch(table), buildBatchInserts(items, opts))
      return { indexed: result?.inserted ?? items.length, failed: [] }
    },
    remove: async (table: string, key: string): Promise<void> => {
      await this.request('POST', paths.batch(table), buildBatchDeletes([key]))
    },
    batchRemove: async (table: string, keys: string[]): Promise<number> => {
      if (keys.length === 0) return 0
      const result = await this.requestJson<WireBatchResponse>('POST', paths.batch(table), buildBatchDeletes(keys))
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
      await this.request('POST', paths.batch(table), buildBatchInserts([{ key, doc: next }]))
    },
  }

  async query(table: string, q: Query): Promise<QueryResult> {
    const request = buildQueryRequest(table, q, this.settings)
    const wantsTrueTotals = !request.count && (request.aggregations !== undefined || request.semantic_search !== undefined)
    let main: WireQueryEnvelope | null
    let degraded = false
    try {
      main = await this.runQuery(table, request)
    } catch (err) {
      // D11's sanctioned degrade, implemented client-side: while a large
      // embeddings backfill saturates the inference queue, the QUERY's own
      // embed job starves and the whole request times out. Retry once
      // FTS-only and LABEL it — visible in diagnostics, never silent.
      const timedOut = err instanceof SearchEngineUnavailableError && /timed out|TimeoutError/i.test(err.message)
      if (!timedOut || request.semantic_search === undefined) throw err
      const ftsOnly = buildQueryRequest(table, { ...q, strategy: 'fts' }, this.settings)
      main = await this.runQuery(table, ftsOnly)
      degraded = true
    }
    const count = wantsTrueTotals && !degraded
      ? await this.runQuery(table, toCountRequest(request)).catch(() => null)
      : null
    const result = mapQueryResponse(main, table)
    if (degraded) {
      result.diagnostics = {
        ...(result.diagnostics ?? { strategy: 'fts' }),
        strategy: 'fts',
        adapter: { ...(result.diagnostics?.adapter ?? {}), degraded: 'semantic-embed-timeout' },
      }
    }
    if (count) {
      const countResult = mapQueryResponse(count, table)
      result.total = countResult.total
      if (countResult.facets) result.facets = countResult.facets
    }
    return result
  }

  private runQuery(table: string, request: WireQueryRequest): Promise<WireQueryEnvelope | null> {
    return this.requestJson<WireQueryEnvelope>('POST', paths.query(table), request, QUERY_TIMEOUT_MS)
  }

  async multiQuery(queries: Array<{ table: string; query: Query }>): Promise<QueryResult[]> {
    // Per-table failures are ISOLATED: one sick table (empty embeddings
    // index mid-backfill 500s, a wedged shard) contributes zero hits with
    // a diagnostic instead of zeroing the whole cross-table search — the
    // exact failure observed at the rc.17 cutover with Promise.all.
    const run = async (entry: { table: string; query: Query }): Promise<QueryResult> => {
      try {
        return await this.query(entry.table, entry.query)
      } catch (err) {
        log.warn('multiQuery table failed — contributing zero hits', {
          table: entry.table,
          err: err instanceof Error ? err.message : String(err),
        })
        return { hits: [], total: 0, diagnostics: { strategy: 'none', adapter: { error: err instanceof Error ? err.message : String(err) } } }
      }
    }
    // Parallel by default; sequential only when something reranks (the
    // reranker serializes on one Metal queue — concurrent reranked queries
    // back up behind each other anyway).
    if (queries.some((entry) => entry.query.rerank)) {
      const results: QueryResult[] = []
      for (const entry of queries) results.push(await run(entry))
      return results
    }
    return Promise.all(queries.map(run))
  }

  async *scan(table: string, opts?: ScanOpts): AsyncIterable<ScannedDocument> {
    // The lookup endpoint requires a body — `{}` scans all keys.
    const body = opts?.fields?.length ? { fields: opts.fields } : {}
    const response = await this.request('POST', paths.lookup(table), body)
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
      // Live servers emit `key`; older docs said `_key` — accept both.
      const key = (row.key ?? row._key) as string | undefined
      if (typeof key !== 'string') {
        warnedKeyless = true
        continue
      }
      const { key: _k, _key: _k2, ...fields } = row
      yield { key, document: fields }
    }
    if (warnedKeyless) {
      // One notice per scan, not per row (silently dropping keyless rows
      // would shrink dedupe/TTL scans invisibly).
      log.warn('scan returned rows without a key field — skipped', { table })
    }
  }

}
