/**
 * The antfly SearchAdapter: lifecycle wrapper around the stateless HTTP
 * client (client.ts) + the OS-supervised service (service.ts).
 *
 * initialize() = merge settings → provision the service (launchd/systemd
 * unit byte-compare; strict child in ephemeral environments; guest mode
 * untouched) → build the client. Provisioning failures never throw out of
 * initialize — search degrades honestly (available() false, outbox queues,
 * doctor reports) instead of blocking boot.
 *
 * shutdown() stops ONLY a strict child. OS-supervised instances stay warm
 * across Bakin restarts by design — that's the entire point of D3.
 */
import type { AdapterInitOpts } from '@bakin/core/adapters/shared'
import { createLogger } from '@bakin/core/logger'
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
  TransformFn,
} from '@bakin/core/adapters/search'
import { SearchEngineUnavailableError } from '@bakin/core/adapters/search/errors'
import { AntflySearchClient } from './client'
import { mergeSettings, type AntflySettings } from './defaults'
import { createEngineStatusProbe } from './engine-status'
import { defaultServiceIo, getServiceAccess, childPid, detectServiceMode, ensureProvisioned, restartService, startService, stopChild, type ServiceIo } from './service'

const log = createLogger('antfly-adapter')

export interface AntflyAdapterOptions {
  settings?: Record<string, unknown>
  serviceIo?: ServiceIo
}

export class AntflyAdapter implements SearchAdapter {
  readonly name = 'antfly'
  readonly version = '2.0.0'
  readonly requiredCoreVersion = '>=0.1.0'

  private settings: AntflySettings
  private client: AntflySearchClient
  private readonly io: ServiceIo
  private initialized = false

  constructor(options: AntflyAdapterOptions = {}) {
    this.settings = mergeSettings(options.settings)
    this.io = options.serviceIo ?? defaultServiceIo()
    this.client = this.createClient()
    this.engineProbe = createEngineStatusProbe(() => this.settings, this.io)
  }

  private createClient(): AntflySearchClient {
    const settings = this.settings
    const client: AntflySearchClient = new AntflySearchClient(settings, { requestGuard: () => {
      if (client !== this.client) throw new SearchEngineUnavailableError('Search configuration changed; retry the operation.')
      if (!settings.enabled) throw new SearchEngineUnavailableError('Search is disabled.')
      let access: ReturnType<typeof getServiceAccess>
      try { access = getServiceAccess(settings, this.io) } catch (err) {
        throw new SearchEngineUnavailableError('Cannot verify search service access.', err)
      }
      if (!access.allowed) throw new SearchEngineUnavailableError(access.detail)
      if (access.mode !== 'guest' && !this.initialized) throw new SearchEngineUnavailableError('Search initialization did not succeed. Repair the service and restart Bakin.')
      if (access.mode === 'child' && !childPid()) throw new SearchEngineUnavailableError('Search child is not running.')
    } })
    return client
  }

  async initialize(opts?: AdapterInitOpts): Promise<void> {
    this.initialized = false
    if (opts?.settings) this.settings = mergeSettings(opts.settings)
    this.client = this.createClient()
    if (!this.settings.enabled) return
    try {
      const result = await ensureProvisioned(this.settings, this.io)
      if (result.action.startsWith('refused-')) {
        log.warn('Search unavailable for this home', { action: result.action, detail: result.detail })
        return
      }
      if (result.mode === 'child') {
        await startService(this.settings, this.io)
      }
      this.initialized = true
      log.info('antfly service ensured', { mode: result.mode, action: result.action })
    } catch (err) {
      log.error('antfly service provisioning failed — search degrades until repaired', err instanceof Error ? err : undefined)
    }
  }

  async shutdown(): Promise<void> {
    this.initialized = false
    if (detectServiceMode(this.settings, this.io) === 'child') stopChild()
  }

  available(): Promise<boolean> {
    if (!this.settings.enabled) return Promise.resolve(false)
    return this.client.available()
  }

  capabilities() {
    return this.client.capabilities()
  }

  mappingFingerprint(): string {
    return this.client.mappingFingerprint()
  }

  // Engine-process introspection for the doctor's burn watchdog. One probe
  // per adapter — it holds the previous CPU sample + log offset, so each
  // call reports the rate/signals since the last one.
  private engineProbe: ReturnType<typeof createEngineStatusProbe>

  engineStatus() {
    if (!this.settings.enabled) return Promise.resolve(null)
    return this.engineProbe()
  }

  /** Graceful supervised restart (doctor repair for a wedged engine). */
  restartEngine(): Promise<void> {
    return restartService(this.settings, this.io)
  }

  tables = {
    list: () => this.client.tables.list(),
    create: (name: string, config: TableConfig) => this.client.tables.create(name, config),
    drop: (name: string) => this.client.tables.drop(name),
    stats: (name: string) => this.client.tables.stats(name),
    health: (name: string) => this.client.tables.health(name),
  }

  documents = {
    index: (table: string, key: string, doc: Document) => this.client.documents.index(table, key, doc),
    batchIndex: (table: string, items: IndexItem[], opts?: { sync?: boolean }): Promise<BatchResult> => this.client.documents.batchIndex(table, items, opts),
    remove: (table: string, key: string) => this.client.documents.remove(table, key),
    batchRemove: (table: string, keys: string[]) => this.client.documents.batchRemove(table, keys),
    transform: (table: string, key: string, fn: TransformFn) => this.client.documents.transform(table, key, fn),
    get: (table: string, key: string) => this.client.documents.get(table, key),
  }

  query(table: string, q: Query): Promise<QueryResult> {
    return this.client.query(table, q)
  }

  // Delegation MUST cover every optional contract member: consumers
  // feature-detect (`typeof search.rerank === 'function'`), so a member
  // missing HERE silently disables the feature even though the client
  // implements it — exactly how the merged-top-K rerank shipped dark
  // (#846 field find, 2026-09-19).
  rerank(query: string, texts: string[]): Promise<number[] | null> {
    return this.client.rerank(query, texts)
  }

  multiQuery(queries: Array<{ table: string; query: Query }>): Promise<QueryResult[]> {
    return this.client.multiQuery(queries)
  }

  scan(table: string, opts?: ScanOpts): AsyncIterable<ScannedDocument> {
    return this.client.scan(table, opts)
  }

}
