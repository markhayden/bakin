import type { RuntimeMetadata } from '../runtime/concepts'

export type Document = Record<string, unknown>

export interface TableInfo {
  name: string
  config?: TableConfig
  documentCount?: number
}

export interface TableConfig {
  fields: Record<string, SearchFieldConfig>
  indexes?: SearchIndexConfig[]
  adapterOptions?: Record<string, unknown>
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

export interface IndexOpts {
  refresh?: boolean
  source?: string
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

export interface ScoreBreakdown {
  fts?: number
  vector?: number
  hybrid?: number
  rerank?: number
}

export interface FacetCount {
  value: string | number | boolean
  count: number
}

export interface QueryDiagnostics {
  strategy: 'fts' | 'vector' | 'hybrid' | 'none'
  durationMs?: number
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

export interface RebuildReport {
  tables: number
  documents: number
  errors: string[]
}
