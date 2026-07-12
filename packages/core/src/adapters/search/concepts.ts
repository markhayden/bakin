import type { RuntimeMetadata } from '../runtime/concepts'

export type Document = Record<string, unknown>

export interface TableInfo {
  name: string
  config?: TableConfig
  documentCount?: number
}

export interface TableConfig {
  fields: Record<string, SearchFieldConfig>
  /** Legacy index declarations — the registry still emits these (adapters map them to legs); plugins migrate to `legs` per-table (assets at T11). */
  indexes?: SearchIndexConfig[]
  /**
   * Capability-level search legs (D17). Content types declare WHAT they need
   * (full-text over these fields, a text-embedding leg, a media-embedding
   * leg); the adapter maps each leg to its own engine/model specifics. Leg
   * `name` is the stable key that query results echo in `scoreBreakdown`.
   */
  legs?: TableLegConfig[]
  facets?: string[]
  adapterOptions?: Record<string, unknown>
}

/** What a search adapter can build/serve, in capability terms (D17). */
export type SearchLegCapability = 'full-text' | 'text-embedding' | 'media-embedding'

export interface SearchAdapterCapabilities {
  legs: SearchLegCapability[]
  rerank: boolean
  facets: boolean
  /** Atomic partial document update without a full re-embed. */
  transform: boolean
}

export interface TableLegConfig {
  /** Stable leg name — the `scoreBreakdown` key for this leg's scores. */
  name: string
  capability: SearchLegCapability
  /** Source fields for full-text scoping / embedding-template inputs. */
  fields: string[]
  /** Text template for embedding input (adapter interpolates). */
  template?: string
  /** Document field holding a URL to media bytes (media-embedding legs). */
  mediaUrlField?: string
  /** Fusion weight relative to sibling legs (default 1). */
  weight?: number
  chunker?: {
    enabled: boolean
    targetTokens?: number
    overlapTokens?: number
  }
}

/** Per-leg index health — drives blue/green convergence + doctor/telemetry. */
export interface TableLegHealth {
  leg: string
  state: 'ready' | 'building' | 'error'
  indexedCount: number
  /** Numeric backlog for this leg (docs queued), when the engine reports one. */
  pendingCount?: number
  error?: string
}

export interface SearchFieldConfig {
  type: 'text' | 'keyword' | 'number' | 'boolean' | 'datetime' | 'array'
  required?: boolean
}

export interface SearchIndexConfig {
  name: string
  fields: string[]
  kind?: 'text' | 'vector' | 'hybrid'
  embedderRef?: string
  /** Text template for embedding input. Provider-specific helper syntax belongs in adapters. */
  template?: string
  /** Document field containing a URL to media bytes for visual/multimodal embedding input. */
  mediaUrlField?: string
  chunker?: {
    enabled: boolean
    targetTokens?: number
    overlapTokens?: number
  }
  metadata?: RuntimeMetadata
}

export interface TableStats {
  table: string
  documents: number
  bytes?: number
  updatedAt?: string
}

export interface TableHealth {
  table: string
  status: 'ok' | 'warn' | 'error'
  message?: string
  details?: RuntimeMetadata
}

export interface IndexItem {
  key: string
  doc: Document
}

export interface BatchResult {
  indexed: number
  failed: Array<{ key: string; error: string }>
}

export type TransformFn = (doc: Document) => Document | Promise<Document>

export interface Query {
  text?: string
  vector?: number[]
  filters?: Filter[]
  facets?: string[]
  aggregations?: AggregationRequest[]
  sort?: SortSpec
  limit?: number
  offset?: number
  strategy?: 'auto' | 'fts' | 'vector' | 'hybrid'
  rerank?: boolean
  /**
   * Cooperative execution deadline for this query in milliseconds. Adapters
   * pass it to the engine where supported and enforce it client-side with a
   * small grace; a miss degrades the query (drop the semantic lane) or, when
   * even that can't answer in time, fails it — it never stalls the caller
   * past the deadline. Reported via `QueryDiagnostics.budget`.
   */
  deadlineMs?: number
  adapterOptions?: Record<string, unknown>
}

export interface Filter {
  field: string
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains'
  value: unknown
}

export interface AggregationRequest {
  name: string
  type: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'histogram'
  field: string
  interval?: string | number
}

export interface SortSpec {
  field: string
  direction: 'asc' | 'desc'
}

export interface QueryResult {
  hits: SearchHit[]
  total?: number
  facets?: Record<string, FacetCount[]>
  aggregations?: Record<string, unknown>
  diagnostics?: QueryDiagnostics
}

export interface SearchHit {
  key: string
  document: Document
  score: number
  scoreBreakdown?: ScoreBreakdown
  highlights?: Record<string, string[]>
}

/**
 * Per-leg scores keyed by the leg names the table declared (plus adapter
 * extras like `rerank`). Generic by design (D17): the debug UI renders
 * whatever legs appear here — no engine-specific key sniffing upstream.
 * (Structurally supersedes the old fixed `fts`/`vector`/`hybrid` keys.)
 */
export type ScoreBreakdown = Record<string, number>

export interface FacetCount {
  value: string | number | boolean
  count: number
}

export interface QueryDiagnostics {
  strategy: 'fts' | 'vector' | 'hybrid' | 'none'
  durationMs?: number
  /**
   * Set when the query could not complete inside its deadline (D11 —
   * honest degrade, never silent): 'degraded' = answered without the
   * semantic lane, 'omitted' = could not answer at all (zero hits).
   */
  budget?: 'degraded' | 'omitted'
  adapter?: RuntimeMetadata
}

export interface ScanOpts {
  limit?: number
  cursor?: string
  /**
   * Adapter-projected document fields to return with each key. Adapters that
   * support server-side projection may return only keys when this is omitted.
   */
  fields?: string[]
}

export interface ScannedDocument {
  key: string
  document: Document
}
