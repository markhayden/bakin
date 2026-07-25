import type { AdapterInitOpts } from '../shared'
import type {
  BatchResult,
  Document,
  IndexItem,
  Query,
  QueryResult,
  ScanOpts,
  ScannedDocument,
  SearchAdapterCapabilities,
  SearchEngineStatus,
  TableConfig,
  TableInfo,
  TableLegHealth,
  TableStats,
  TransformFn,
} from './concepts'

export interface SearchAdapter {
  readonly name: string
  readonly version: string
  readonly requiredCoreVersion: string

  initialize(opts?: AdapterInitOpts): Promise<void>
  shutdown(): Promise<void>
  available(): Promise<boolean>

  /** What this adapter can build/serve, in capability terms (D17). */
  capabilities(): SearchAdapterCapabilities

  /**
   * OPTIONAL: engine-process introspection (pid/CPU/wedge signatures) for
   * the doctor's burn watchdog. Absent or resolving null = the adapter (or
   * its current mode, e.g. an externally managed guest engine) cannot
   * measure — consumers feature-detect, never assume.
   */
  engineStatus?(): Promise<SearchEngineStatus | null>

  /**
   * OPTIONAL: gracefully restart the supervised engine (doctor repair for
   * a wedged engine). Must throw with a clear message when the engine is
   * not this adapter's to restart (guest mode).
   */
  restartEngine?(): Promise<void>

  /**
   * Hash over adapter settings that change the PHYSICAL index layout
   * (embedder models, dimensions). Core folds it into each table's
   * blue/green config fingerprint so a model swap migrates tables without
   * any plugin edit. Must be stable across restarts for identical settings.
   */
  mappingFingerprint(): string

  tables: {
    /** Doctor/status/introspection only — never called on the boot path. */
    list(): Promise<TableInfo[]>
    create(name: string, config: TableConfig): Promise<void>
    drop(name: string): Promise<void>
    stats(name: string): Promise<TableStats | null>
    /** Per-leg health — drives blue/green convergence checks + telemetry. */
    health(name: string): Promise<TableLegHealth[]>
  }

  documents: {
    index(table: string, key: string, doc: Document): Promise<void>
    /**
     * `sync: false` = async indexing (backfills: the blue/green converge
     * poll owns completion; synchronous full-index on big chunks times out
     * behind one embed queue). Default true = read-your-writes for drains.
     */
    batchIndex(table: string, items: IndexItem[], opts?: { sync?: boolean }): Promise<BatchResult>
    remove(table: string, key: string): Promise<void>
    batchRemove(table: string, keys: string[]): Promise<number>
    transform(table: string, key: string, fn: TransformFn): Promise<void>
    /**
     * Exact fetch by document key; null when absent. Doc keys are NOT
     * indexed as searchable text, so a text query can never substitute
     * for this — bakin_exec_search_lookup shipped broken on that trick.
     */
    get(table: string, key: string): Promise<Document | null>
  }

  query(table: string, q: Query): Promise<QueryResult>
  multiQuery(queries: Array<{ table: string; query: Query }>): Promise<QueryResult[]>
  scan(table: string, opts?: ScanOpts): AsyncIterable<ScannedDocument>
}

export type SearchAdapterSetupCheckStatus = 'ok' | 'missing' | 'broken' | 'warn' | 'error'
export type SearchAdapterSetupInstallStatus = 'installed' | 'skipped' | 'failed' | 'noop'

export interface SearchAdapterSetupCheckResult {
  name: string
  status: SearchAdapterSetupCheckStatus
  message: string
  remediation?: string
  details?: Record<string, unknown>
}

export interface SearchAdapterSetupInstallResult {
  name: string
  status: SearchAdapterSetupInstallStatus
  message: string
  error?: unknown
  durationMs: number
}

export interface SearchAdapterSetupOptions {
  interactive: boolean
  autoApprove: boolean
  json: boolean
  askYesNo?: (question: string, defaultValue: boolean) => Promise<boolean>
}

export interface SearchAdapterSetupComponent {
  readonly name: string
  check(): Promise<SearchAdapterSetupCheckResult>
  install(opts: SearchAdapterSetupOptions): Promise<SearchAdapterSetupInstallResult>
}

export interface SearchAdapterSetup {
  readonly dependency: SearchAdapterSetupComponent
  readonly models?: SearchAdapterSetupComponent
  /**
   * Stop the engine, wipe its DERIVED data (indexes — never models or
   * source content), and start it clean. Optional: adapters whose engine
   * Bakin does not supervise (guest mode) omit it or fail honestly.
   * Callers follow with a repair reindex to regenerate tables.
   */
  resetEngineData?(): Promise<SearchAdapterSetupInstallResult>
}

export type {
  AggregationRequest,
  BatchResult,
  Document,
  FacetCount,
  Filter,
  IndexItem,
  Query,
  QueryDiagnostics,
  QueryResult,
  ScanOpts,
  ScannedDocument,
  ScoreBreakdown,
  SearchAdapterCapabilities,
  SearchEngineStatus,
  SearchFieldConfig,
  SearchHit,
  SearchIndexConfig,
  SearchLegCapability,
  SortSpec,
  TableConfig,
  TableHealth,
  TableInfo,
  TableLegConfig,
  TableLegHealth,
  TableStats,
  TransformFn,
} from './concepts'
