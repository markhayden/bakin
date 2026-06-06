import { AntflyClient, matchAll } from '@antfly/sdk'
import type { QueryRequest } from '@antfly/sdk'
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
import {
  buildQueryRequest,
  buildTableConfig,
  emptyQueryResult,
  mapResponse,
  readNumber,
  readString,
} from './query-translation'
import { getServerHealthDetail, isLocalDefaultUrl, startAntflyServer, stopAntflyServer } from './server'

interface AntflyIndexHealthEntry {
  name: string
  type: string
  totalIndexed: number
  walBacklog: number
  error?: string
  rebuilding: boolean
  backfillProgress?: number
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
  readonly version = '0.0.1-rc.1'
  readonly requiredCoreVersion = '>=0.0.1-rc.1'

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
      run: async () => {
        const mode = isLocalDefaultUrl(this.settings.url) ? 'private instance' : 'external server'
        if (await this.available()) {
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
      // No `schema` here — see buildTableConfig / markhayden/bakin#456.
      await client.tables.create(name, {
        num_shards: readNumber(config.adapterOptions?.numShards, 1),
        description: readString(config.adapterOptions?.description),
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

    const request = buildQueryRequest(table, q, this.settings)

    try {
      const result = await client.tables.query(table, request)
      const response = result?.responses?.[0]
      if (!response) return emptyQueryResult(q)
      return mapResponse(response, table)
    } catch (err) {
      this.logger.error('Antfly query failed', { error: err, table })
      return emptyQueryResult(q)
    }
  }

  async multiQuery(queries: Array<{ table: string; query: Query }>): Promise<QueryResult[]> {
    const client = this.client
    if (!client || !this.settings.enabled) return queries.map(({ query }) => emptyQueryResult(query))
    if (queries.length === 0) return []

    // Fan out as SEQUENTIAL single queries. Two v0.2.0-rc.2 constraints
    // (bakin#456): the NDJSON multiquery endpoint rejects its own framing,
    // and concurrent reranked queries crash the embedded Metal inference
    // backend with a command-encoder assertion (SIGABRT, server gone).
    // Sequential single queries are the shape that works; per-query failure
    // isolation comes free.
    const results: QueryResult[] = []
    for (const { table, query } of queries) {
      const request = buildQueryRequest(table, query, this.settings)
      try {
        const response = await client.query(request)
        results.push(response ? mapResponse(response, table) : emptyQueryResult(query))
      } catch (err) {
        this.logger.error('Antfly query failed', { error: err, table })
        results.push(emptyQueryResult(query))
      }
    }
    return results
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
      .map(([name, cfg]) => `${name}:${cfg.provider}:${cfg.model}:${cfg.dimension}`)
      .join('|')
  }
}

function isTransientBatchError(err: unknown): boolean {
  const msg = stringifyError(err)
  return TRANSIENT_BATCH_ERROR_PATTERNS.some((pattern) => msg.includes(pattern))
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
