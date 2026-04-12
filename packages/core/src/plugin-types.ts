/**
 * Plugin system type definitions for Bakin.
 * All plugin interfaces are defined here — no behavioral changes.
 */

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
export interface StorageAdapter {
  read(path: string): string | null
  write(path: string, content: string): void
  append(path: string, content: string): void
  exists(path: string): boolean
  readAll(): Record<string, string>
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
export interface EventBus {
  emit(event: string, data?: Record<string, unknown>): void
  on(pattern: string, handler: (event: string, data: Record<string, unknown>) => void): () => void
  once(pattern: string, handler: (event: string, data: Record<string, unknown>) => void): () => void
}

// ---------------------------------------------------------------------------
// Navigation + Routes + UI Slots
// ---------------------------------------------------------------------------
export interface NavItem {
  id: string
  label: string
  icon: string // lucide icon name
  href: string
  order?: number
  children?: NavItem[]
}

export interface APIRoute {
  path: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  handler: (req: Request, ctx: PluginContext) => Response | Promise<Response>
  description?: string
  params?: string
}

export interface UISlotRegistration {
  slot: string
  component: React.ComponentType<Record<string, unknown>>
  order?: number
}

export interface ContentFile {
  path: string // relative to content/
}

// ---------------------------------------------------------------------------
// Execution Tools (scripts exposed as MCP tools)
// ---------------------------------------------------------------------------

/** Result returned by execution tool handlers */
export interface ExecToolResult {
  ok: boolean
  error?: string
  details?: unknown
  [key: string]: unknown
}

/** Definition for a registerable execution tool */
/** Context available to exec tool handlers — provides access to plugin services */
export interface PluginToolContext {
  storage: StorageAdapter
  events: EventBus
  pluginId: string
  hooks: HookAPI
  activity: ActivityAPI
  getSettings<T = Record<string, unknown>>(): T
}

export interface ExecToolDefinition {
  name: string
  description: string
  label?: string // Short human-readable action phrase for activity feed (e.g., "Created a task")
  activityDuplicate?: boolean // true = handler already emits a meaningful activity event; auto-audit can be hidden
  parameters: Record<string, unknown> // Zod schema shape
  handler: (params: Record<string, unknown>, agent: string, ctx?: PluginToolContext) => Promise<ExecToolResult>
  source?: string // 'core' | 'plugin:<id>' — set automatically on registration
}

// ---------------------------------------------------------------------------
// Skill Definitions (multi-source)
// ---------------------------------------------------------------------------

/** A skill that can be registered by plugins or loaded from disk */
export interface SkillDefinition {
  name: string
  instructions: string
  output_schema?: Record<string, unknown>
  source?: string // 'built-in' | 'user' | 'plugin:<id>' — set automatically
}

// ---------------------------------------------------------------------------
// Plugin Context (provided to activate())
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Activity API (structured logging for plugins)
// ---------------------------------------------------------------------------
export interface ActivityAPI {
  /** Log a human-readable message to the live activity feed */
  log(agent: string, message: string, opts?: { taskId?: string; category?: string }): void
  /** Log a structured audit event */
  audit(event: string, agent: string, data?: Record<string, unknown>): void
}

// ---------------------------------------------------------------------------
// Plugin Context (provided to activate())
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Hook API (cross-plugin communication)
// ---------------------------------------------------------------------------
export interface HookAPI {
  /** Register a handler for a named hook. Returns unsubscribe function. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(name: string, handler: (data: any) => any): () => void
  /** Check if any handlers are registered for a hook. */
  has(name: string): boolean
  /** Invoke a hook and return its result (RPC-style). */
  invoke<R>(name: string, data: unknown): Promise<R | undefined>
}

export interface PluginContext {
  storage: StorageAdapter
  events: EventBus
  pluginId: string
  registerNav(items: NavItem[]): void
  registerRoute(route: APIRoute): void
  registerSlot(registration: UISlotRegistration): void
  registerExecTool(tool: ExecToolDefinition): void
  registerSkill(skill: SkillDefinition): void
  watchFiles(patterns: string[]): void
  /** Read this plugin's persisted settings */
  getSettings<T = Record<string, unknown>>(): T
  /** Merge a partial update into this plugin's settings and persist */
  updateSettings(patch: Record<string, unknown>): void
  /** Structured activity logging */
  activity: ActivityAPI
  /** Cross-plugin hook registration */
  hooks: HookAPI
  /** Antfly-backed search — register content types, index, query */
  search: SearchAPI
}

// ---------------------------------------------------------------------------
// Search API (Antfly-backed vector + full-text search)
// ---------------------------------------------------------------------------

/** Field type for search content type schemas */
export interface SearchSchemaField {
  type: 'text' | 'keyword' | 'number' | 'boolean' | 'datetime' | 'array'
}

/**
 * One vector index on a search table. A content type can declare multiple
 * indexes to embed the same document into several vector spaces — e.g. a
 * text index using BGE and a visual index using CLIP on the assets table.
 * Each index has its own embedder (resolved via embedderRef), template,
 * and optional chunker config.
 */
export interface SearchIndexDefinition {
  /** Index name as stored in Antfly. Must be stable across restarts. */
  name: string
  /** Ref into settings.antfly.embedders — 'default', 'visual', or custom. */
  embedderRef: string
  /** Handlebars template for this index's embedding input. */
  embeddingTemplate: string
  /** Per-index chunker config, overrides any table-level default. */
  chunker?: {
    enabled: boolean
    targetTokens?: number
    overlapTokens?: number
  }
}

/** Definition for a searchable content type registered by a plugin */
export interface SearchContentTypeDefinition {
  /** Table name — auto-prefixed with `bakin_`. E.g., 'tasks' → 'bakin_tasks' */
  table: string
  /** Schema for the document fields */
  schema: Record<string, SearchSchemaField>
  /** Fields to include in full-text search */
  searchableFields: string[]
  /**
   * Handlebars template for embedding generation. Used when `indexes` is
   * not provided — the registry synthesizes a single default index named
   * `embeddings` with this template and the default embedder.
   */
  embeddingTemplate: string
  /**
   * Optional per-index definitions. When provided, overrides
   * `embeddingTemplate` and creates one embedding index per entry with
   * its own embedder. Used by content types that want multimodal indexing
   * (e.g. assets with both a text index and a visual index).
   */
  indexes?: SearchIndexDefinition[]
  /** Fields to expose as aggregatable facets */
  facets?: string[]
  /**
   * Document field to use as input for the cross-encoder reranker. When
   * set, queries against this content type attach Antfly's reranker
   * (configured in settings.antfly.search.reranker) and score the
   * query-document pair using the value at this field. When unset,
   * queries skip reranking for this content type — Antfly requires a
   * `field` or `template` in the reranker config, and passing an
   * unconfigured reranker produces a 400 from the server.
   */
  rerankField?: string
  /** TTL duration (Go format: '24h', '7d', '30d') */
  ttl?: string
  /** TTL field (defaults to 'created_at') */
  ttlField?: string
  /** Chunking config for long documents — used by the synthesized default index. */
  chunker?: {
    enabled: boolean
    targetTokens?: number
    overlapTokens?: number
  }
  /**
   * Backfill function — called during full/per-table reindex.
   * Must yield ALL documents for this content type from source.
   */
  reindex: () => AsyncGenerator<{ key: string; doc: Record<string, unknown> }>
  /**
   * Existence check — called during orphan cleanup.
   * Returns true if the source document for this key still exists.
   */
  verifyExists: (key: string) => Promise<boolean>
}

/** Parameters for a search query */
export interface SearchQueryParams {
  /** Search query string */
  q: string
  /** Structured keyword filters */
  filters?: Record<string, string | boolean | number>
  /** Facets to include in aggregations */
  facets?: string[]
  /** Max results */
  limit?: number
  /** Result offset for pagination */
  offset?: number
  /**
   * Whether to run the cross-encoder reranker on results. Defaults to
   * true when the reranker is enabled in settings. Set false for latency-
   * sensitive paths (facet-only queries, ID lookups, bulk scans) where
   * the extra ~100-500ms isn't worth it.
   */
  rerank?: boolean
  /**
   * Raw Antfly aggregations passed through unchanged to QueryRequest.
   * Use for date histograms, range buckets, stats aggregations, or any
   * other shape beyond the term-facet convenience in `facets`. Merged
   * with facet-derived aggregations (these win on key collision).
   * See Antfly API docs for the aggregation schema.
   */
  aggregations?: Record<string, unknown>
}

/** A single search result */
export interface SearchResult {
  id: string
  table: string
  score: number
  fields: Record<string, unknown>
  /** Cross-encoder reranker score (present when a reranker was used). */
  rerankScore?: number
}

/** Search response from a query */
export interface SearchResponse {
  results: SearchResult[]
  /**
   * Mapped term-facet aggregations — keyed by facet field, each a list
   * of { value, count }. Populated from `params.facets` for convenience.
   */
  aggregations?: Record<string, Array<{ value: string; count: number }>>
  /**
   * Raw aggregation response from Antfly, unmodified. Populated whenever
   * the underlying query returned aggregations — use this for non-term
   * shapes like date_histogram, range, stats, etc.
   */
  rawAggregations?: Record<string, unknown>
  meta: {
    query: string
    total: number
    took_ms: number
    source: 'antfly' | 'fallback'
  }
}

/** Atomic transform operation (update fields without re-embedding) */
export interface SearchTransformOp {
  op: '$set' | '$inc' | '$push'
  field?: string
  value: unknown
}

/** Search API provided to plugins via ctx.search */
export interface SearchAPI {
  /**
   * Register a content type this plugin will index.
   * Must be called during activate(). Creates the Antfly table if needed.
   */
  registerContentType(def: SearchContentTypeDefinition): void

  /** Index or update a document. Fire-and-forget. */
  index(key: string, doc: Record<string, unknown>): Promise<void>

  /** Remove a document from the index. */
  remove(key: string): Promise<void>

  /** Atomic field update without re-embedding. For metadata-only changes. */
  transform(key: string, operations: SearchTransformOp[]): Promise<void>

  /** Search this plugin's content type. */
  query(params: SearchQueryParams): Promise<SearchResponse>
}

// ---------------------------------------------------------------------------
// Settings Schema
// ---------------------------------------------------------------------------
export interface SettingsField {
  key: string
  type: 'string' | 'number' | 'boolean' | 'select'
  label: string
  description?: string
  options?: { value: string; label: string }[]
  default?: unknown
}

export interface PluginSettingsSchema {
  fields: SettingsField[]
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------
export interface BakinPlugin {
  id: string
  name: string
  version: string
  activate(ctx: PluginContext): void | Promise<void>
  /** Called after ALL plugins have been activated */
  onReady?(): void | Promise<void>
  /** Called during graceful shutdown (reverse activation order) */
  onShutdown?(): void | Promise<void>
  /** Called when this plugin's settings are updated */
  onSettingsChange?(settings: Record<string, unknown>): void | Promise<void>
  /** Declarative settings schema for auto-generated settings UI */
  settingsSchema?: PluginSettingsSchema
  navItems?: NavItem[]
  contentFiles?: ContentFile[]
}

/** @deprecated Use BakinPlugin */
export type MCPlugin = BakinPlugin

// ---------------------------------------------------------------------------
// Plugin Manifest (bakin-plugin.json)
// ---------------------------------------------------------------------------
export interface PluginManifest {
  id: string
  name: string
  version: string
  bakin: string
  description: string
  entry: { server: string; client?: string }
  contentFiles?: string[]
  secrets?: string[]
  tests?: string
  dependencies?: string[]
  permissions?: string[]
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export interface PluginEntry {
  path: string
  enabled?: boolean // defaults to true
}

export interface BakinConfig {
  plugins: PluginEntry[]
  theme?: Record<string, string>
  storage?: {
    contentDir?: string
  }
}

/** @deprecated Use BakinConfig */
export type MCConfig = BakinConfig
