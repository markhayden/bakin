/**
 * Antfly wire types — hand-derived from openapi.yaml + live verification
 * against antflydb/antfly @ 6538c0774 (tasks/evidence-search-rebuild.md).
 *
 * Deliberately NOT the generated @antfly/sdk: the adapter speaks raw HTTP
 * with exactly the shapes it uses, and the conformance + workaround-
 * regression suites (run against real binaries) are the contract check.
 * Every shape here was probe-verified; wire facts:
 *   - Query responses are ALWAYS wrapped: `{ responses: [ ... ] }`.
 *   - Hits carry `_id` (not `key`), `_source`, `_score`, `_index_scores`.
 *   - `_index_scores` keys are NEUTRAL leg/index names (`full_text`, ...).
 *   - `filter_query` filters BOTH the full-text and semantic lanes.
 *   - `order_by`/`search_after`/`join` are UNSUPPORTED on the Zig engine.
 *   - `sync_level: 'aknn'` was removed; `full_index` is the strong level.
 */

export interface WireBatchRequest {
  inserts?: Record<string, Record<string, unknown>>
  deletes?: string[]
  sync_level?: 'full_index' | 'enrichments'
}

export interface WireBatchResponse {
  inserted: number
  deleted: number
  transformed: number
}

/** Query-AST node (MatchQuery / MatchPhraseQuery / NumericRange / boolean / match_all). */
export type WireQueryNode = Record<string, unknown>

export interface WireMergeConfig {
  strategy?: 'rrf' | 'rsf'
  rank_constant?: number
  window_size?: number
  weights?: Record<string, number>
}

export interface WireQueryRequest {
  table?: string
  full_text_search?: WireQueryNode
  filter_query?: WireQueryNode
  semantic_search?: string
  indexes?: string[]
  merge_config?: WireMergeConfig
  limit?: number
  offset?: number
  /** rc.18+: cooperative server-side execution deadline; expiry → HTTP 504. */
  timeout_ms?: number
  count?: boolean
  aggregations?: Record<string, unknown>
  reranker?: Record<string, unknown>
  fields?: string[]
}

export interface WireHit {
  _id: string
  _score: number
  _index_scores: Record<string, number> | null
  _source: Record<string, unknown> | null
  _sort: unknown
}

export interface WireQueryResponse {
  hits: {
    /** rc.18+: ES-style object with the CORPUS-TRUE count; was a page-scoped number. */
    total: number | { value: number; relation?: string }
    hits: WireHit[]
    max_score: number
  } | null
  aggregations: Record<string, { buckets?: Array<{ key: string | number | boolean; doc_count: number }> }> | null
  took: number
  status: number
  error: string | null
  table: string
}

export interface WireQueryEnvelope {
  responses: WireQueryResponse[]
}

export interface WireIndexConfig {
  name: string
  type: 'full_text' | 'embeddings'
  template?: string
  dimension?: number
  embedder?: { provider: string; model: string; multimodal?: boolean }
  chunker?: { provider: string; model: string; text: { target_tokens: number; overlap_tokens: number } }
}

export interface WireTableCreateRequest {
  num_shards?: number
  // No inline `indexes`: 0.2.0 accepts them at table-create (200, stored,
  // echoed) but NEVER starts their enrichment worker — a silent no-op
  // (evidence file, upstream draft 2). Embeddings legs are created via
  // paths.index() after the table exists.
}

/** GET /db/v1/tables/{t}/indexes element. */
export interface WireIndexStatusEntry {
  config: { name: string; type: string }
  status: {
    index_type: string
    rebuilding: boolean
    total_indexed: number
    backfill_active: boolean
    backfill_state: string
    doc_count: number
    worker_failed?: boolean
    fatal_error_count?: number
    last_error?: string
    /** Live enrichment/embed pipeline counters (embeddings legs only). */
    enrichment_runtime?: {
      pending_sequence_count: number
      retrying?: boolean
      worker_failed?: boolean
      fatal_error_count?: number
      active_embed_batch_items?: number
    }
  } | null
}

export interface WireTableInfo {
  name: string
  indexes?: Record<string, { name: string; type: string }>
  storage_status?: { disk_usage: number }
}

export const paths = {
  status: () => '/db/v1/status',
  tables: () => '/db/v1/tables',
  table: (t: string) => `/db/v1/tables/${encodeURIComponent(t)}`,
  batch: (t: string) => `/db/v1/tables/${encodeURIComponent(t)}/batch`,
  query: (t: string) => `/db/v1/tables/${encodeURIComponent(t)}/query`,
  indexes: (t: string) => `/db/v1/tables/${encodeURIComponent(t)}/indexes`,
  // Per-index create — the ONLY path that wires enrichment on 0.2.0 (the
  // name rides the URL; bare POST …/indexes is 405).
  index: (t: string, name: string) => `/db/v1/tables/${encodeURIComponent(t)}/indexes/${encodeURIComponent(name)}`,
  document: (t: string, key: string) => `/db/v1/tables/${encodeURIComponent(t)}/documents/${encodeURIComponent(key)}`,
  // rc.18 moved bulk key scans from /lookup (now 405) to /documents —
  // same NDJSON contract; bodyless scans are legal since 0.2.0.
  lookup: (t: string) => `/db/v1/tables/${encodeURIComponent(t)}/documents`,
} as const
