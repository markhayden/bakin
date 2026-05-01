/**
 * Plugin system type definitions for Bakin.
 * All plugin interfaces are defined here — no behavioral changes.
 */

import type { ZodRawShape, ZodType } from 'zod'
import type { ContractStability, ContractVisibility, DocsExample, SchemaLike, SourceLocation } from './docs'
import type { AgentRuntimeAdapter } from './adapters/runtime'
import type { APIRoute as DeclarativeAPIRoute, PluginContextLite } from './routing/types'

// ---------------------------------------------------------------------------
// Approval actor — identifies who decided a gate (or any reviewable action)
// ---------------------------------------------------------------------------
export interface ApprovalActor {
  id: string
  displayName?: string
  source: 'channel' | 'web' | 'system'
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
export interface StorageAdapter {
  read(path: string): string | null
  write(path: string, content: string): void
  append(path: string, content: string): void
  exists(path: string): boolean
  readAll(): Record<string, string>
  list?(path?: string): string[]
  remove?(path: string): void
  rename?(from: string, to: string): void
  stat?(path: string): {
    path: string
    size: number
    mtimeMs: number
    isFile: boolean
    isDirectory: boolean
  } | null
  readJson?<T = unknown>(path: string): T | null
  writeJson?(path: string, value: unknown): void
  /**
   * Convert a plugin-storage-relative path or glob to the content-dir-relative
   * path seen by file-backed search/watch APIs. Implementations never return
   * absolute host paths.
   */
  searchPath?(path: string): string
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
  alwaysExpanded?: boolean
}

export interface APIRoute {
  path: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  handler: (req: Request, ctx: PluginContext) => Response | Promise<Response>
  summary?: string
  description?: string
  params?: string
  input?: SchemaLike
  output?: SchemaLike
  visibility?: ContractVisibility
  stability?: ContractStability
  examples?: DocsExample[]
  source?: SourceLocation
  permissions?: string[]
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
  runtime: AgentRuntimeAdapter
  tasks: PluginTaskService
  assets: AssetsAPI
  search: SearchAPI
  hooks: HookAPI
  activity: ActivityAPI
  getSettings<T = Record<string, unknown>>(): T
}

export interface ExecToolDefinition {
  name: string
  description: string
  label?: string // Short human-readable action phrase for activity feed (e.g., "Created a task")
  activityDuplicate?: boolean // true = handler already emits a meaningful activity event; auto-audit can be hidden
  parameters: ZodRawShape
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
// Workflow Definition Input (permissive shape — full schema lives in the
// workflows plugin, but core needs the type to expose ctx.registerWorkflow
// without an upward import. The workflows plugin re-validates with Zod.)
// ---------------------------------------------------------------------------
export interface WorkflowDefinitionInput {
  /** Stable workflow id. Falls back to slug(name) when omitted. */
  id?: string
  name: string
  description: string
  version: number
  inputs?: Record<string, unknown>
  steps: unknown[]
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
  register(name: string, handler: (data: any) => any, metadata?: HookRegistrationMetadata): () => void
  /** Run registered handlers as a waterfall and return the final value. */
  call<T>(name: string, data: T): Promise<T>
  /** Run every registered handler and ignore return values. */
  callAll(name: string, data: Record<string, unknown>): Promise<void>
  /** Check if any handlers are registered for a hook. */
  has(name: string): boolean
  /** Invoke a hook and return its result (RPC-style). */
  invoke<R>(name: string, data: unknown): Promise<R | undefined>
}

export interface HookRegistrationMetadata {
  label?: string
  summary: string
  description?: string
  hookKind?: ContractHookKind
  input?: SchemaLike
  output?: SchemaLike
  visibility?: ContractVisibility
  stability?: ContractStability
  examples?: DocsExample[]
}

export type ContractHookKind = 'rpc' | 'event' | 'waterfall'

// ---------------------------------------------------------------------------
// Workflow node-type registration
// ---------------------------------------------------------------------------

/** Field types the workflow canvas knows how to render. */
export type FormFieldType =
  | 'string'
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'agent'
  | 'skill'
  | 'list'

/** One input shown in the node's config drawer. */
export interface FormField {
  name: string
  type: FormFieldType
  required?: boolean
  description?: string
  options?: { value: string; label: string }[]
}

/** Edge connection rules enforced by the canvas editor's onConnect validator. */
export interface EdgeRules {
  /** Max inbound edges allowed; undefined = unlimited. */
  maxInbound?: number
  /** Max outbound edges allowed; undefined = unlimited. 0 = terminal (no outgoing). */
  maxOutbound?: number
}

/**
 * Input shape plugins pass to `ctx.registerNodeType`. The plugin id is
 * prepended to `kind` automatically (`{pluginId}.{kind}`), so two plugins
 * can ship the same unprefixed kind without colliding.
 *
 * The Zod schema validates the full step object (including `id`, `type`,
 * `label`, plus any plugin-specific fields). It is checked against step
 * definitions loaded from YAML and against step bodies built by the canvas
 * editor — one definition, no drift.
 */
export interface PluginNodeTypeInput<T = unknown> {
  kind: string
  zodSchema: ZodType<T>
  formFields: FormField[]
  /** Defaults to `{ maxOutbound: 1 }` (agent-style) when omitted. */
  edgeRules?: EdgeRules
}

// ---------------------------------------------------------------------------
// Notification channel registration
// ---------------------------------------------------------------------------

/**
 * Input shape plugins pass to `ctx.registerNotificationChannel`. The plugin id
 * is prepended to `id` automatically (`{pluginId}.{id}`), matching the node-
 * type precedent. Built-in workflows-plugin runtime channels (general,
 * announcements, alerts, email) self-register at module load in
 * `plugins/workflows/lib/notification-channel-registry.ts`.
 */
export interface PluginNotificationChannelInput {
  id: string
  label: string
  /** Optional 2-character badge (e.g. "DC", "IG"). Falls back to `id.slice(0, 2).toUpperCase()` at render time. */
  initials?: string
  /** Lucide-react icon export name (e.g. "MessageSquare"). Unknown names fall back to HelpCircle at render time. */
  icon?: string
}

export interface NotificationChannelDef extends PluginNotificationChannelInput {
  runtime: 'builtin' | 'plugin'
  /** Set when runtime === 'plugin'; identifies the owning plugin. */
  pluginId?: string
}

// ---------------------------------------------------------------------------
// Health check registration
// ---------------------------------------------------------------------------

/**
 * Canonical result shape for a single doctor check row.
 */
export interface HealthCheckResult {
  check: string
  status: 'ok' | 'warn' | 'error' | 'fixed'
  message: string
  autoFixable: boolean
}

/**
 * Input shape plugins pass to `ctx.registerHealthCheck`. The plugin id is
 * auto-namespaced as `{pluginId}.{id}`. `run()` returns an array so one
 * registered check can contribute multiple result rows (mirrors how the
 * existing `checkPersonas` returns one per agent).
 */
export interface PluginHealthCheckInput {
  id: string
  name: string
  /**
   * Runs the check, returns any number of result rows. Throws/rejects are
   * caught by the doctor orchestrator and converted to a synthetic error
   * result — a single bad handler never crashes the sweep.
   */
  run: () => Promise<HealthCheckResult[]>
  /**
   * Advisory flag for admin UIs: `true` if `run()` may perform safe
   * auto-fixes internally. Pure metadata in v1 — the orchestrator always
   * invokes every registered check regardless of this value. Plugins that
   * do internal auto-fixes gate on `getSettings().doctor.*` themselves.
   */
  autoFix?: boolean
}

export interface HealthCheckDef extends PluginHealthCheckInput {
  runtime: 'plugin'
  pluginId: string
}

export interface PluginContext {
  storage: StorageAdapter
  events: EventBus
  pluginId: string
  runtime: AgentRuntimeAdapter
  tasks: PluginTaskService
  assets: AssetsAPI
  registerNav(items: NavItem[]): void
  /**
   * @deprecated Use `definePlugin({ routes: [defineRoute({...})] })` to declare
   * routes. This adapter remains during the migration window for any
   * out-of-tree plugin that still calls `ctx.registerRoute(...)` from
   * `activate()`. In-repo plugins migrated in T6–T13 / T20 — none of them
   * call this. The dispatcher adapts the legacy shape (input → body,
   * output → responses[200]) when invoked through this path.
   */
  registerRoute(route: APIRoute): void
  registerSlot(registration: UISlotRegistration): void
  registerExecTool(tool: ExecToolDefinition): void
  registerSkill(skill: SkillDefinition): void
  /**
   * Register a workflow definition shipped by this plugin. Disk-resident
   * user definitions in `~/.bakin/workflows/definitions/` always win on id
   * collision (user-wins). A second plugin claiming an id already taken by
   * another plugin is a containment error: it's logged but does not throw
   * out of `activate()`. Re-registering the same id from the same plugin
   * is idempotent (newer wins) so hot reload works.
   */
  registerWorkflow(definition: WorkflowDefinitionInput, opts?: { readOnly?: boolean }): void
  /**
   * Register a workflow node type owned by this plugin. The kind is
   * auto-namespaced to `{pluginId}.{kind}` so plugins can't stomp each
   * other. Returns the namespaced kind the plugin should use to register
   * a matching `workflows.executeNode.{namespacedKind}` hook handler and
   * to reference the kind from its node renderer export.
   */
  registerNodeType<T = unknown>(def: PluginNodeTypeInput<T>): string
  /**
   * Register a notification channel owned by this plugin. The id is
   * auto-namespaced to `{pluginId}.{id}`. Returns the namespaced id so
   * callers can reference it from downstream code and tests. Built-in
   * workflows-plugin channels register directly (without the plugin prefix)
   * via the registry module's lazy self-seed.
   */
  registerNotificationChannel(def: PluginNotificationChannelInput): string
  /**
   * Register a health check owned by this plugin. The id is auto-namespaced
   * to `{pluginId}.{id}`. `run()` is invoked during every `runDiagnostics()`
   * sweep — throws are isolated, a single bad check never crashes the
   * doctor. Returns the namespaced id.
   */
  registerHealthCheck(def: PluginHealthCheckInput): string
  watchFiles(patterns: string[]): void
  /** Read this plugin's persisted settings */
  getSettings<T = Record<string, unknown>>(): T
  /** Merge a partial update into this plugin's settings and persist */
  updateSettings(patch: Record<string, unknown>): void
  /** Structured activity logging */
  activity: ActivityAPI
  /** Cross-plugin hook registration */
  hooks: HookAPI
  /** Adapter-backed search — register content types, index, query */
  search: SearchAPI
}

// ---------------------------------------------------------------------------
// Public task service
// ---------------------------------------------------------------------------

export type PluginTaskColumn =
  | 'backlog'
  | 'todo'
  | 'inProgress'
  | 'review'
  | 'done'
  | 'blocked'
  | 'archived'

export interface PluginTask {
  id: string
  title: string
  agent?: string
  createdBy?: string
  checked: boolean
  column: PluginTaskColumn
  date?: string
  blockedReason?: string
  description?: string
  log?: TaskLogEntry[]
  dependsOn?: string
  parentId?: string | null
  workflowId?: string
  scheduleJobId?: string
  projectId?: string
  order?: number
  createdAt?: string
  updatedAt?: string
}

export interface TaskLogEntry {
  timestamp: string
  author: string
  message: string
  data?: Record<string, unknown>
}

export interface PluginTaskCreateInput {
  id?: string
  title: string
  description?: string
  agent?: string
  createdBy?: string
  column?: PluginTaskColumn
  date?: string
  workflowId?: string
  projectId?: string
  parentId?: string | null
  skipWorkflowReason?: string
}

export interface PluginTaskUpdateInput {
  title?: string
  description?: string
  agent?: string
  createdBy?: string
  checked?: boolean
  column?: PluginTaskColumn
  date?: string
  blockedReason?: string
  workflowId?: string
  scheduleJobId?: string
  projectId?: string
  parentId?: string | null
}

export interface PluginTaskService {
  create(input: PluginTaskCreateInput): Promise<PluginTask>
  update(id: string, patch: PluginTaskUpdateInput): Promise<PluginTask>
  move(id: string, column: PluginTaskColumn, order?: number): Promise<PluginTask>
  remove(id: string): Promise<void>
  get(id: string): Promise<PluginTask | null>
  list(filter?: { column?: PluginTaskColumn; agent?: string; projectId?: string }): Promise<PluginTask[]>
  appendLog(id: string, entry: TaskLogEntry): Promise<void>
}

// ---------------------------------------------------------------------------
// Public assets service
// ---------------------------------------------------------------------------

export interface AssetVariantMeta {
  role: 'thumbnail' | 'optimized' | 'webp'
  path: string
  filename: string
  size: number
  mimeType: string
}

export interface AssetMeta {
  path: string
  filename: string
  type: 'text' | 'images' | 'video' | 'audio' | 'plans' | 'research' | 'pdf' | 'data' | 'other'
  mimeType: string
  size: number
  mtimeMs?: number
  metadata: {
    agent: string
    taskId: string | null
    created: string
    tool?: string
    description?: string
    tags?: string[]
    originalFilename?: string
  }
  variants?: AssetVariantMeta[]
}

export interface AssetFileRef {
  kind: 'asset'
  filename: string
  mimeType?: string
}

export interface AssetsAPI {
  getByFilename(filename: string): Promise<AssetMeta | null>
  list(filter?: { type?: AssetMeta['type']; taskId?: string | null }): Promise<AssetMeta[]>
  exists(filename: string): Promise<boolean>
  fileRef(filename: string): Promise<AssetFileRef>
}

// ---------------------------------------------------------------------------
// Search API (adapter-backed vector + full-text search)
// ---------------------------------------------------------------------------

/** Field type for search content type schemas */
export interface SearchSchemaField {
  type: 'text' | 'keyword' | 'number' | 'boolean' | 'datetime' | 'array'
}

/**
 * One vector index on a search table. A content type can declare multiple
 * indexes to embed the same document into several vector spaces — e.g. a
 * text index using BGE and a visual index using CLIP on the assets table.
 * Each index has its own embedder (resolved via embedderRef), input
 * declaration, and optional chunker config.
 */
export interface SearchIndexDefinition {
  /** Index name as stored by the search adapter. Must be stable across restarts. */
  name: string
  /** Ref into settings.search.settings.embedders — 'default', 'visual', or custom. */
  embedderRef: string
  /** Handlebars template for this index's text embedding input. */
  embeddingTemplate?: string
  /**
   * Document field containing a URL to media bytes for visual/multimodal
   * embedding input. The search adapter owns provider-specific helper syntax.
   */
  mediaUrlField?: string
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
   * set, queries against this content type attach the configured reranker
   * and score the query-document pair using the value at this field.
   * When unset, queries skip reranking for this content type.
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
   * Raw adapter-specific aggregations passed through unchanged to the query layer.
   * Use for date histograms, range buckets, stats aggregations, or any
   * other shape beyond the term-facet convenience in `facets`. Merged
   * with facet-derived aggregations (these win on key collision).
   * See the active search adapter docs for the aggregation schema.
   */
  aggregations?: Record<string, unknown>
  /**
   * Search strategy override. Defaults to the site-wide search strategy.
   * Pass 'full_text_only' for filter-driven
   * counts or ID lookups — semantic search rejects `limit: 0` queries
   * with the "semantic search requires topk limit to be positive" error.
   */
  strategy?: 'rrf' | 'semantic_only' | 'full_text_only'
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
   * Raw aggregation response from the search adapter, unmodified. Populated whenever
   * the underlying query returned aggregations — use this for non-term
   * shapes like date_histogram, range, stats, etc.
   */
  rawAggregations?: Record<string, unknown>
  meta: {
    query: string
    total: number
    took_ms: number
    source: 'search' | 'fallback'
  }
}

export interface SearchHealthIndex {
  name: string
  type: string
  totalIndexed: number
  walBacklog: number
  error?: string
  rebuilding: boolean
  backfillProgress?: number
}

export interface SearchHealthTable {
  table: string
  pluginId: string
  stats: Record<string, unknown> | null
  indexHealth?: SearchHealthIndex[]
  healthy: boolean
}

export interface SearchHealthSnapshot {
  enabled: boolean
  tables: SearchHealthTable[]
}

/** Atomic transform operation (update fields without re-embedding) */
export interface SearchTransformOp {
  op: '$set' | '$inc' | '$push'
  field?: string
  value: unknown
}

/**
 * One file-pattern → mapper pair used by `FileBackedContentTypeDefinition`.
 * A registration may carry multiple of these when a single content type
 * draws from several distinct file shapes (e.g. workflows store
 * definitions as `.yaml` and instances as `.json`, both indexed into the
 * same `bakin_workflows` table with different key prefixes).
 */
export interface FilePatternMapper {
  /** Glob pattern relative to contentDir. First-match-wins across the patterns array. */
  pattern: string
  /**
   * Derive the search key for a file matching this pattern. Return null
   * to skip the file (e.g. it matches the glob but is missing required
   * companion data).
   */
  fileToId: (relPath: string) => string | null
  /**
   * Build the search document for a file matching this pattern.
   * `content` is the raw file bytes as a UTF-8 string (empty for binary
   * assets, which the watcher recognizes by their `assets/` prefix).
   * Return null to skip indexing (e.g. derived state isn't ready yet).
   */
  fileToDoc: (relPath: string, content: string) => Promise<Record<string, unknown> | null>
}

/**
 * A content type whose source of truth is one or more files under
 * `~/.bakin/`. Registering via `registerFileBackedContentType` wires up:
 *
 *   1. Standard `registerContentType` (table creation, schema, reindex).
 *   2. A watcher sync hook that re-indexes on add/change.
 *   3. A watcher unlink hook that removes on delete.
 *   4. A startup reconcile that detects mtime drift and corrects it.
 *
 * Plugins should reach for this helper first. Use raw `registerContentType`
 * only when the source of truth is NOT the filesystem (e.g. SQLite,
 * external API, runtime adapter).
 */
export interface FileBackedContentTypeDefinition extends SearchContentTypeDefinition {
  /**
   * One or more file-pattern mappers. Patterns should not overlap;
   * first match wins. A file that matches no pattern is ignored.
   */
  filePatterns: FilePatternMapper[]
  /**
   * Optional exclude patterns applied BEFORE any mapper matches. Useful
   * for skipping subdirectories like `assets/**\/.trash/**` or sidecar
   * files like `**\/*.meta.json`.
   */
  excludePatterns?: string[]
  /**
   * Escape hatch for sync events. When provided, the helper invokes
   * this instead of the default `fileToDoc → ctx.search.index` flow for
   * any file matching this content type's patterns. The plugin takes
   * full responsibility for indexing.
   *
   * Use when pairing logic (e.g. assets' binary↔sidecar coupling) can't
   * be expressed as a single mapper. The matched `FilePatternMapper` is
   * still consulted for `fileToId` if the plugin needs the canonical key.
   */
  onSync?: (relPath: string, content: string) => Promise<void>
  /**
   * Escape hatch for unlink events. Same story as `onSync`. If unset,
   * the helper calls the matched mapper's `fileToId(relPath)` and then
   * `ctx.search.remove(id)`.
   */
  onUnlink?: (relPath: string) => Promise<void>
  /**
   * Whether to run the startup reconcile loop on plugin activation.
   * Defaults to true. Set false only when the plugin wants to drive its
   * own initial population (rare).
   */
  buildOnStartup?: boolean
}

/** Search API provided to plugins via ctx.search */
export interface SearchAPI {
  /**
   * Register a content type this plugin will index.
   * Must be called during activate(). Creates the search table if needed.
   *
   * Prefer `registerFileBackedContentType` when the source of truth is
   * a file under `~/.bakin/` — it wires up watcher hooks and startup
   * reconcile automatically. Use this raw form only for non-filesystem
   * sources (SQLite, external APIs, runtime adapters).
   */
  registerContentType(def: SearchContentTypeDefinition): void

  /**
   * Register a file-backed content type. Wraps `registerContentType` and
   * additionally wires watcher sync + unlink hooks scoped to the declared
   * file patterns, plus a startup reconcile that detects mtime drift on
   * boot. This is the blessed API for any plugin whose data lives in the
   * filesystem under `~/.bakin/`.
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
   * tables. This is intentionally narrower than the raw adapter: callers can
   * only touch their own registered content type.
   */
  maintenance?: SearchMaintenanceAPI
}

export interface SearchMaintenanceAPI {
  /** Whether the backing search service is reachable. */
  available(): Promise<boolean>

  /** Iterate every document in this plugin's registered content type. */
  scan(): AsyncIterable<{ key: string; document: Record<string, unknown> }>

  /** Remove several documents from this plugin's registered content type. */
  batchRemove(keys: string[]): Promise<number>

  /** Drop and recreate this plugin's registered content type table. */
  resetContentType(): Promise<void>
}

// ---------------------------------------------------------------------------
// Settings Schema
// ---------------------------------------------------------------------------
interface BaseSettingsField {
  key: string
  label: string
  description?: string
  /** If true, the renderer blocks save when the field is empty (checked inside list rows). */
  required?: boolean
}

export interface StringSettingsField extends BaseSettingsField {
  type: 'string'
  default?: string
}

export interface NumberSettingsField extends BaseSettingsField {
  type: 'number'
  default?: number
}

export interface BooleanSettingsField extends BaseSettingsField {
  type: 'boolean'
  default?: boolean
}

export interface SelectSettingsField extends BaseSettingsField {
  type: 'select'
  options: { value: string; label: string }[]
  default?: string
}

/**
 * List-of-rows field. Each row renders the fields declared in `itemShape`.
 * The persisted value is `Array<Record<string, unknown>>`. Reusable by any
 * plugin that needs a user-editable taxonomy (messaging content types,
 * future notification channels, etc).
 */
export interface ListSettingsField extends BaseSettingsField {
  type: 'list'
  /** Keyed map of sub-fields rendered per row. Nested lists are not supported. */
  itemShape: Record<string, StringSettingsField | NumberSettingsField | BooleanSettingsField | SelectSettingsField>
  default?: unknown[]
  addLabel?: string
  minItems?: number
  maxItems?: number
  /**
   * If set, the renderer blocks save when two rows share the same value for
   * this sub-field key. Typical use: uniqueField: 'id' on a taxonomy list.
   */
  uniqueField?: string
}

export type SettingsField =
  | StringSettingsField
  | NumberSettingsField
  | BooleanSettingsField
  | SelectSettingsField
  | ListSettingsField

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
  /**
   * Called by `bakin plugins remove` BEFORE Bakin tears down the plugin's
   * own bookkeeping (registry rows, settings JSON, plugin dir, etc.).
   * Plugin's responsibility: clean up any data it wrote OUTSIDE its own
   * dir (custom files in user dirs, rows in shared tables, etc.). Bakin
   * handles plugin-owned bookkeeping itself.
   *
   * Receives the same full PluginContext that activate() received — no
   * reduced surface. Errors are logged + audited but do NOT block the
   * rest of the cleanup; a buggy onUninstall must not trap the user in
   * a half-removed state.
   */
  onUninstall?(ctx: PluginContext): void | Promise<void>
  /** Declarative settings schema for auto-generated settings UI */
  settingsSchema?: PluginSettingsSchema
  navItems?: NavItem[]
  contentFiles?: ContentFile[]
  /**
   * Declarative HTTP routes. Registered into the route table BEFORE
   * `activate()` runs, so handlers must use `ctx` for services rather than
   * closing over module-scope state initialized in `activate()`.
   *
   * Use `defineRoute()` from `@bakin/core/routing` to author entries —
   * a bare `routes: APIRoute[]` annotation widens types and breaks the
   * per-route inference that drives the dispatcher's typed `parsed` argument.
   *
   * Optional during the migration window (T1–T16); plugins still using
   * `ctx.registerRoute(...)` from `activate()` continue to work via the
   * dispatcher adapter.
   */
  routes?: ReadonlyArray<DeclarativeAPIRoute<PluginContextLite, any, any, any>>
}

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
