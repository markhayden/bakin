import type { AdapterHealthCheckDefinition, AdapterInitOpts } from '../shared'
import type {
  BatchResult,
  Document,
  IndexItem,
  IndexOpts,
  Query,
  QueryResult,
  RebuildReport,
  ScanOpts,
  ScannedDocument,
  SearchAdapterCapabilities,
  TableConfig,
  TableHealth,
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
  getHealthChecks(): AdapterHealthCheckDefinition[]

  /**
   * What this adapter can build/serve, in capability terms (D17).
   * Optional ONLY during the engine-room transition (the old adapter
   * predates it) — required at the F4 surface cut.
   */
  capabilities?(): SearchAdapterCapabilities

  /**
   * Hash over adapter settings that change the PHYSICAL index layout
   * (embedder models, dimensions). Core folds it into each table's
   * blue/green config fingerprint so a model swap migrates tables without
   * any plugin edit. Must be stable across restarts for identical settings.
   * Optional during the transition — required at F4.
   */
  mappingFingerprint?(): string

  tables: {
    /** Doctor/status/introspection only — never called on the boot path. */
    list(): Promise<TableInfo[]>
    create(name: string, config: TableConfig): Promise<void>
    drop(name: string): Promise<void>
    stats(name: string): Promise<TableStats | null>
    /**
     * Per-leg health — drives blue/green convergence checks + telemetry.
     * Optional during the transition — required at F4.
     */
    health?(name: string): Promise<TableLegHealth[]>
    /** Legacy single-status health — superseded by `health`; dies at F4. */
    getHealth(name: string): Promise<TableHealth | null>
    /** Legacy embedder-swap rebuild — superseded by blue/green; dies at F4. */
    rebuildIndexes(name: string): Promise<void>
  }

  documents: {
    index(table: string, key: string, doc: Document, opts?: IndexOpts): Promise<void>
    batchIndex(table: string, items: IndexItem[], opts?: IndexOpts): Promise<BatchResult>
    remove(table: string, key: string): Promise<void>
    batchRemove(table: string, keys: string[]): Promise<number>
    transform(table: string, key: string, fn: TransformFn): Promise<void>
  }

  query(table: string, q: Query): Promise<QueryResult>
  multiQuery(queries: Array<{ table: string; query: Query }>): Promise<QueryResult[]>
  scan(table: string, opts?: ScanOpts): AsyncIterable<ScannedDocument>

  embedder: {
    hasChanged(): Promise<boolean>
    rebuildAll(): Promise<RebuildReport>
  }
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
}

export { MTIME_FIELD } from './concepts'

export type {
  AggregationRequest,
  BatchResult,
  Document,
  FacetCount,
  Filter,
  IndexItem,
  IndexOpts,
  Query,
  QueryDiagnostics,
  QueryResult,
  RebuildReport,
  ScanOpts,
  ScannedDocument,
  ScoreBreakdown,
  SearchAdapterCapabilities,
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
