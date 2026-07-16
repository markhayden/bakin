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
import { AntflySearchClient } from './client'
import { mergeSettings, type AntflySettings } from './defaults'
import { createEngineStatusProbe } from './engine-status'
import { detectServiceMode, ensureProvisioned, restartService, startChild, stopChild } from './service'

const log = createLogger('antfly-adapter')

export interface AntflyAdapterOptions {
  settings?: Record<string, unknown>
}

export class AntflyAdapter implements SearchAdapter {
  readonly name = 'antfly'
  readonly version = '2.0.0'
  readonly requiredCoreVersion = '>=0.1.0'

  private settings: AntflySettings
  private client: AntflySearchClient

  constructor(options: AntflyAdapterOptions = {}) {
    this.settings = mergeSettings(options.settings)
    this.client = new AntflySearchClient(this.settings)
  }

  async initialize(opts?: AdapterInitOpts): Promise<void> {
    if (opts?.settings) {
      this.settings = mergeSettings(opts.settings)
      this.client = new AntflySearchClient(this.settings)
    }
    if (!this.settings.enabled) return
    try {
      const mode = detectServiceMode(this.settings)
      if (mode === 'child') {
        startChild(this.settings)
      } else if (mode !== 'guest') {
        const result = await ensureProvisioned(this.settings)
        log.info('antfly service ensured', { mode: result.mode, action: result.action })
      }
    } catch (err) {
      log.error('antfly service provisioning failed — search degrades until repaired', err instanceof Error ? err : undefined)
    }
  }

  async shutdown(): Promise<void> {
    if (detectServiceMode(this.settings) === 'child') stopChild()
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
  private engineProbe = createEngineStatusProbe(() => this.settings)

  engineStatus() {
    if (!this.settings.enabled) return Promise.resolve(null)
    return this.engineProbe()
  }

  /** Graceful supervised restart (doctor repair for a wedged engine). */
  restartEngine(): Promise<void> {
    return restartService(this.settings)
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

  multiQuery(queries: Array<{ table: string; query: Query }>): Promise<QueryResult[]> {
    return this.client.multiQuery(queries)
  }

  scan(table: string, opts?: ScanOpts): AsyncIterable<ScannedDocument> {
    return this.client.scan(table, opts)
  }

}
