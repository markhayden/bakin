// Part of the @makinbakin/sdk/types contract — see ./index.ts for the
// module's self-containment + two-tier rationale.
/** One entry in a task's activity log. */
export interface TaskLogEntry {
  timestamp: string
  author: string
  message: string
  data?: Record<string, unknown>
}

/** A task on the Bakin board. */
export interface Task {
  id: string
  title: string
  agent?: string
  /** Requested team (#189); present alongside agent once dispatch resolves. */
  team?: string
  createdBy?: string
  checked: boolean
  column: ColumnId
  date?: string
  blockedReason?: string
  description?: string
  log?: TaskLogEntry[]
  dependsOn?: string
  parentId?: string | null
  workflowId?: string
  scheduleJobId?: string
  projectId?: string
  /** Brand link (#419) — resolved lazily at dispatch, mirrors projectId. */
  brandId?: string
  availableAt?: string
  dueAt?: string
  source?: TaskSource
  order?: number
  createdAt?: string
  updatedAt?: string
}

/** Identifies the plugin/entity that originated a task. */
export interface TaskSource {
  pluginId?: string
  entityType?: string
  entityId?: string
  purpose?: string
}

/** The seven task board columns. */
export interface TaskColumns {
  backlog: Task[]
  inProgress: Task[]
  todo: Task[]
  review: Task[]
  done: Task[]
  blocked: Task[]
  archived: Task[]
}

/** The full task board snapshot (columns + timestamp). */
export interface TaskBoard {
  columns: TaskColumns
  timestamp?: string
}

/** Valid task column identifier (keyof TaskColumns). */
export type ColumnId = keyof TaskColumns

/** Payload for `tasks.create()`. */
export interface TaskCreateInput {
  id?: string
  title: string
  description?: string
  agent?: string
  createdBy?: string
  column?: ColumnId
  date?: string
  workflowId?: string
  projectId?: string
  brandId?: string
  parentId?: string | null
  availableAt?: string
  dueAt?: string
  source?: TaskSource
  skipWorkflowReason?: string
}

/** Patch payload for `tasks.update()`. Nullable fields explicitly clear. */
export interface TaskUpdateInput {
  title?: string
  description?: string
  agent?: string
  createdBy?: string
  checked?: boolean
  column?: ColumnId
  date?: string
  blockedReason?: string
  workflowId?: string
  scheduleJobId?: string
  projectId?: string
  brandId?: string
  parentId?: string | null
  availableAt?: string | null
  dueAt?: string | null
  source?: TaskSource | null
}

/** CRUD service for tasks, exposed via `ctx.tasks`. */
export interface TaskService {
  create(input: TaskCreateInput): Promise<Task>
  update(id: string, patch: TaskUpdateInput): Promise<Task>
  move(id: string, column: ColumnId): Promise<Task>
  remove(id: string): Promise<void>
  get(id: string): Promise<Task | null>
  list(filter?: { column?: ColumnId; agent?: string; projectId?: string; brandId?: string }): Promise<Task[]>
  appendLog(id: string, entry: TaskLogEntry): Promise<void>
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Field schema entry for a search content type. */
export interface SearchSchemaField {
  type: 'text' | 'keyword' | 'number' | 'boolean' | 'datetime' | 'array'
}

/** Named index definition (embedder + chunker config) for a content type. */
export interface SearchIndexDefinition {
  name: string
  embedderRef: string
  embeddingTemplate?: string
  mediaUrlField?: string
  /**
   * Relative fusion weight for this index in hybrid (RRF) search. Defaults to
   * 1.0 when unset. Used to favor a reliable leg over a noisy one — e.g. a
   * multimodal table can weight its visual (image-embedding) index above a
   * text-embedding index whose auto-generated descriptions add ranking noise.
   * Surfaced to the search adapter as `merge_config.weights`.
   */
  weight?: number
  chunker?: {
    enabled: boolean
    targetTokens?: number
    overlapTokens?: number
  }
}

/** One document emitted by a content-type reindex generator. */
export interface SearchReindexItem {
  key: string
  doc: Record<string, unknown>
}

/** Full content-type definition: schema, indexes, facets, reindex generator. */
export interface SearchContentTypeDefinition {
  table: string
  /**
   * Doc-shape version for this content type. Bumping it triggers a blue/
   * green background migration to a fresh physical table (queries stay on
   * the old one until the new converges).
   */
  schemaVersion: number
  schema: Record<string, SearchSchemaField>
  searchableFields: string[]
  embeddingTemplate: string
  indexes?: SearchIndexDefinition[]
  facets?: string[]
  rerankField?: string
  ttl?: string
  ttlField?: string
  chunker?: {
    enabled: boolean
    targetTokens?: number
    overlapTokens?: number
  }
  reindex: () => AsyncGenerator<SearchReindexItem>
  verifyExists: (key: string) => Promise<boolean>
}

/** File glob + mappers used by file-backed search content types. */
export interface FilePatternMapper {
  pattern: string
  fileToId: (relPath: string) => string | null
  /** Omit when `onSync` owns doc-building for this pattern. */
  fileToDoc?: (relPath: string, content: string) => Promise<Record<string, unknown> | null>
}

/** File-backed content type: indexes documents derived from on-disk files. */
export interface FileBackedContentTypeDefinition extends SearchContentTypeDefinition {
  filePatterns: FilePatternMapper[]
  excludePatterns?: string[]
  onSync?: (relPath: string, content: string) => Promise<void>
  onUnlink?: (relPath: string) => Promise<void>
}

/** Query payload for `search.query()` — filters, facets, paging, strategy. */
export interface SearchQueryParams {
  q: string
  filters?: Record<string, string | boolean | number>
  facets?: string[]
  limit?: number
  offset?: number
  rerank?: boolean
  aggregations?: Record<string, unknown>
  strategy?: 'rrf' | 'semantic_only' | 'full_text_only'
}

/** A single search hit with score and field projection. */
export interface SearchResult {
  id: string
  table: string
  score: number
  fields: Record<string, unknown>
  rerankScore?: number
  /** Per-index score breakdown (e.g. full_text / text-embedding / visual). */
  indexScores?: Record<string, number>
}

/** Per-source outcome for one table inside a cross-table search. */
export interface SearchTableMeta {
  /** Logical table name (e.g. bakin_assets). */
  table: string
  hits: number
  took_ms: number
  /**
   * Present when this table missed its query budget: 'degraded' = answered
   * keyword-only (semantic lane dropped), 'omitted' = contributed nothing.
   */
  budget?: 'degraded' | 'omitted'
}

/** Full search response: results, aggregations, and query metadata. */
export interface SearchResponse {
  results: SearchResult[]
  aggregations?: Record<string, Array<{ value: string; count: number }>>
  rawAggregations?: Record<string, unknown>
  meta: {
    query: string
    total: number
    took_ms: number
    /** 'unavailable' = the engine was down; HTTP boundaries surface it as 503. */
    source: 'search' | 'unavailable'
    /** True when any source degraded or was omitted — surface it, never hide it (D11). */
    partial?: boolean
    /** Per-source outcomes (cross-table searches). */
    tables?: SearchTableMeta[]
  }
}

/** Per-index health within a registered content-type table. */
export interface SearchHealthIndex {
  /** Leg/index name — matches the scoreBreakdown key for this leg. */
  name: string
  totalIndexed: number
  rebuilding: boolean
  /** Numeric backlog for this leg (docs queued for enrichment), when the engine reports one. */
  pending?: number
  error?: string
}

/** Health of a single registered content-type table (blue/green aware). */
export interface SearchHealthTable {
  /** Logical name plugins and queries use (e.g. bakin_assets). */
  logical: string
  /** Versioned physical currently serving queries. */
  physical: string
  schemaVersion: number
  /** 'migrating' = a green table is backfilling; queries stay on `physical`. */
  state: 'active' | 'migrating'
  /** Migration phase when state is 'migrating' (parked = needs attention). */
  phase: string | null
  pluginId: string
  docCount: number | null
  /** Epoch ms of the last delivered index write for this table (journal ack), null when never. */
  lastIndexedAt: number | null
  /** Epoch ms of the last registry transition (create/rebuild/flip), null when unknown. */
  lastRebuildAt: number | null
  /** Pending + inflight journal rows for this table (numeric backlog). */
  journalPending: number
  legs: SearchHealthIndex[]
  healthy: boolean
}

/** Durable write-journal state surfaced with health. */
export interface SearchOutboxHealth {
  pending: number
  quarantined: number
  oldestPendingAt: number | null
}

/** Health snapshot reported by the search adapter (per-table state). */
export interface SearchHealthSnapshot {
  enabled: boolean
  outbox?: SearchOutboxHealth
  tables: SearchHealthTable[]
}

/** Atomic transform operation applied to an indexed document. */
export interface SearchTransformOp {
  op: '$set' | '$inc' | '$push'
  field?: string
  value: unknown
}

/** Options for plugin-scoped search maintenance scans. */
export interface SearchScanOptions {
  /**
   * Document fields to return with each scanned key. Some adapters return only
   * keys unless fields are explicitly requested.
   */
  fields?: string[]
}

/** Search API exposed via `ctx.search` — index, query, transform documents. */
export interface SearchAPI {
  /**
   * Register a content type this plugin will index. Must be called during
   * `activate()`. Creates the search table if needed. Prefer
   * `registerFileBackedContentType` when the source of truth is a file under
   * `~/.bakin/`; use this raw form only for non-filesystem sources.
   */
  registerContentType(def: SearchContentTypeDefinition): void
  /**
   * Register a file-backed content type. Wraps `registerContentType` and wires
   * watcher sync + unlink hooks scoped to the declared file patterns. Writes
   * journal through the durable search outbox — boot performs no reconcile
   * (change detection is the outbox's acked-hash).
   */
  registerFileBackedContentType(def: FileBackedContentTypeDefinition): void
  /** Index or update a document. Fire-and-forget. */
  index(key: string, doc: Record<string, unknown>): Promise<void>
  /** Remove a document from the index. */
  remove(key: string): Promise<void>
  /** Atomic field update without re-embedding. For metadata-only changes. */
  transform(key: string, operations: SearchTransformOp[]): Promise<void>
  /** Search this plugin's content type. */
  query(params: SearchQueryParams): Promise<SearchResponse>
  /** Global search adapter and registered-table health snapshot. */
  health?(): Promise<SearchHealthSnapshot>
    /**
   * Plugin-scoped maintenance operations for indexers that own non-file-backed
   * tables. Intentionally narrower than the raw adapter: callers can only
   * touch their own registered content type.
   */
  maintenance?: SearchMaintenanceAPI
}

/** Plugin-scoped maintenance for indexers owning non-file-backed tables. */
export interface SearchMaintenanceAPI {
  /** Whether the backing search service is reachable. */
  available(): Promise<boolean>
  /** Iterate this plugin's registered content type, optionally projecting document fields. */
  scan(opts?: SearchScanOptions): AsyncIterable<{ key: string; document: Record<string, unknown> }>
  /** Remove several documents from this plugin's registered content type. */
  batchRemove(keys: string[]): Promise<number>
  }

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/** The asset type taxonomy (mirrors ASSET_TYPES in the assets plugin). */
export type AssetTypeName = 'text' | 'images' | 'video' | 'audio' | 'plans' | 'research' | 'pdf' | 'data' | 'other'

/** Per-version generation provenance (matches the manifest's `generation` block). */
export interface AssetGenerationInfo {
  provider: string
  model: string
  surface: string
  /** Honored only on the shim path; native generations omit it (#379). */
  quality?: string
  routeSource: string
  routeReason?: string
  /** Reference/context images that conditioned this generation (#418). */
  references?: Array<{ assetId: string; version: number }>
  /** Brand provenance (#419): brand id + content fingerprint as-used. */
  brandId?: string
  brandFingerprint?: string
}

/** Create a new versioned asset (v1) from a source file. */
export interface AssetCreateInput {
  sourceFilePath: string
  type: AssetTypeName
  agent: string
  taskId: string | null
  slug?: string
  op?: 'generate' | 'upload' | 'import'
  tool?: string | null
  prompt?: string | null
  promptHash?: string | null
  description?: string
  tags?: string[]
  source?: { kind: 'generated' | 'upload' | 'import' | 'clipboard' | 'workspace-file'; path: string | null }
  generation?: AssetGenerationInfo | null
}

/**
 * Append a new version to an existing asset. Note: no `tags` — tags are an
 * asset-level organizational namespace that versioning never touches.
 */
export interface AssetVersionCreateInput {
  sourceFilePath: string
  op?: 'edit' | 'generate' | 'upload' | 'import'
  tool?: string | null
  prompt?: string | null
  promptHash?: string | null
  description?: string
  generation?: AssetGenerationInfo | null
}

/** Render a derived export of a version (keyed/idempotent by surface). */
export interface AssetExportRequest {
  fromVersion?: number
  surface: string
  format: 'jpg' | 'png' | 'webp'
  width: number
  height: number
  quality?: number
}

/** Reference to a versioned asset: its stable id and the version just written. */
export interface VersionedAssetRef {
  assetId: string
  version: number
}

/** Resolved on-disk location of a specific asset version, for reads/serving. */
export interface AssetVersionFileRef {
  absPath: string
  mimeType: string
  version: number
}

/** Current-version summary of an asset, addressed by id. */
export interface AssetSummary {
  assetId: string
  type: AssetTypeName
  agent: string
  taskId: string | null
  created: string
  updated: string
  currentVersion: number
  versionCount: number
  description: string
  tags: string[]
  mimeType: string
  width: number | null
  height: number | null
  size: number
  hasThumb: boolean
}

/**
 * Per-version detail of a versioned asset (mirrors the manifest's version
 * entries — provenance fields are null when the version wasn't produced by a
 * generation tool).
 */
export interface AssetVersionDetail {
  version: number
  /** Version file name inside the asset directory (e.g. `v2.png`). */
  file: string
  width: number | null
  height: number | null
  op: 'generate' | 'edit' | 'upload' | 'import'
  tool: string | null
  prompt: string | null
  promptHash: string | null
  generation: AssetGenerationInfo | null
}

/** Assets API exposed via `ctx.assets` — versioned asset-as-directory surface. */
export interface AssetsAPI {
  createAsset(input: AssetCreateInput): Promise<VersionedAssetRef>
  /** Read an asset's current-version summary by id (type/description/tags/etc.), or null. */
  getAsset(assetId: string): Promise<AssetSummary | null>
  addVersion(assetId: string, input: AssetVersionCreateInput): Promise<VersionedAssetRef>
  addExport(assetId: string, input: AssetExportRequest): Promise<{ name: string; file: string }>
  resolveVersionFile(assetId: string, version?: number): Promise<AssetVersionFileRef | null>
  /** List asset summaries, optionally filtered by type and/or owning task. */
  listAssets(filter?: { type?: AssetTypeName; taskId?: string }): Promise<AssetSummary[]>
  /** Read an asset's version history (current pointer + per-version detail), or null. */
  getAssetVersions(assetId: string): Promise<{ currentVersion: number; versions: AssetVersionDetail[] } | null>
  /**
   * Source-path-keyed upsert: create v1 if no asset tracks `sourcePath`,
   * append a version if its content changed, or no-op if identical
   * (`changed: false`). A path inside the asset store reflects to the asset
   * it already belongs to — never a duplicate.
   */
  upsertFromSource(sourcePath: string, input: AssetCreateInput): Promise<VersionedAssetRef & { changed: boolean }>
  /**
   * Map an absolute path INSIDE the asset store back to its asset identity.
   * `absPath` in the result is always the REAL version file (never the thumb).
   * Null for anything outside the store or store-internal non-version files.
   */
  resolveStoreFile(absPath: string): Promise<(VersionedAssetRef & { absPath: string }) | null>
}

// ---------------------------------------------------------------------------
// Execution tools, skills, health, workflows
// ---------------------------------------------------------------------------

/** A model available in the models catalog (LLM, image, or video). */
export interface AvailableModel {
  id: string
  name: string
  tier: 'budget' | 'standard' | 'premium'
  provider: string
  input?: string
  contextWindow?: number
  local?: boolean
  available?: boolean
  tags?: string[]
  configured?: boolean
  isDefault?: boolean
  fallbackIndex?: number | null
  // ── Enrichment from the curated catalog (plugins/models/data/known-models.ts) ──
  // All optional — unknown models render without them.
  /** Display-ready description shown under the model name. */
  description?: string
  /** Short purpose hint rendered next to the tier badge. */
  bestFor?: string
  /** Display-only cost summary, e.g. '$3 in / $15 out per 1M'. */
  costRange?: string
  /** Display-only context-window string override (e.g. '200K', '1M'). Distinct
   *  from the numeric `contextWindow` which is runtime-sourced. */
  contextWindowDisplay?: string
  /** 'llm' | 'image' | 'video' — gives the UI a reason to cluster differently. */
  kind?: 'llm' | 'image' | 'video'
  /** simple-icons slug for the model's primary brand (usually the provider's). */
  brandIconSlug?: string
  /** Resolved provider metadata — pre-joined server-side so the client doesn't
   *  need a second registry lookup. */
  providerLabel?: string
  providerBrandIconSlug?: string
  providerBrandColor?: string
}

/**
 * Per-agent context/token usage for a runtime session — the wire shape served
 * by the health and team usage panels.
 */
export interface AgentUsage {
  agent: string
  sessionId: string
  sessionStarted: string
  /** Latest timestamp carried by an assistant usage message; absent on older servers. */
  lastMessageAt?: string | null
  model: string
  messages: number
  /**
   * Assistant messages whose runtime usage carried a complete cost total,
   * either explicit or derivable from every positive token component. Absent
   * on older servers, where cost coverage is unknown.
   */
  costedMessages?: number
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  cost: {
    input: number | null
    output: number | null
    cacheRead: number | null
    cacheWrite: number | null
    total: number | null
    source: 'runtime' | 'unavailable'
  }
}
