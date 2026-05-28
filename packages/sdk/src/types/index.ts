/**
 * Public Bakin plugin contract types.
 *
 * This module is intentionally self-contained. External plugins must be able
 * to typecheck against `@makinbakin/sdk/types` without resolving `@bakin/core`,
 * Bakin source aliases, adapter packages, or another plugin's internals.
 */

import type { ComponentType } from 'react'
import type { ZodRawShape } from 'zod'

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** HTTP method literal used in route and contribution definitions. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
/** Visibility tier for a documented contract (route, hook, tool, etc.). */
export type ContractVisibility = 'public' | 'internal' | 'experimental'
/** Stability tier for a documented contract. */
export type ContractStability = 'stable' | 'beta' | 'experimental' | 'deprecated'

/** Minimal interface a validation schema must satisfy (Zod-compatible). */
export interface SchemaLike<T = unknown> {
  parse(data: unknown): T
  safeParse?(data: unknown): { success: true; data: T } | { success: false; error: unknown }
}

/** Pointer to a symbol's source file location, used in generated docs. */
export interface SourceLocation {
  file: string
  symbol?: string
  line?: number
}

/** Reference example for a documented contract (request/response or code snippet). */
export interface DocsExample {
  title: string
  description?: string
  code?: string
  request?: unknown
  response?: unknown
  test?: 'automated' | 'schema' | 'illustrative'
  reason?: string
}

// ---------------------------------------------------------------------------
// Manifest contract
// ---------------------------------------------------------------------------

/** Capability a plugin can request in its manifest (gates access to APIs). */
export type PluginPermission =
  | 'storage.read'
  | 'storage.write'
  | 'events.emit'
  | 'runtime.read'
  | 'runtime.agents'
  | 'runtime.messaging'
  | 'runtime.channels'
  | 'runtime.cron'
  | 'runtime.skills'
  | 'runtime.models'
  | 'tasks.read'
  | 'tasks.write'
  | 'search.read'
  | 'search.write'
  | 'assets.read'

/** Runtime feature a plugin declares it needs (used by doctor/health checks). */
export type RuntimeCapability =
  | 'agents'
  | 'messaging'
  | 'channels.message'
  | 'channels.rich-content'
  | 'channels.interactive-approval'
  | 'channels.threaded-replies'
  | 'cron'
  | 'skills'
  | 'models'
  | 'tasks'
  | 'search'

/** Server and client entry-point file paths for a plugin. */
export interface PluginEntryPoints {
  server: string
  client?: string
}

/** Secret (env var) a plugin declares it needs (rendered in setup/health). */
export interface SecretDeclaration {
  /** Canonical environment variable name, for example `ANTHROPIC_API_KEY`. */
  name: string
  /** Human-readable setup note. Never include a secret value here. */
  description: string
  /** Missing required secrets should be reported by setup/health checks. Defaults to true. */
  required: boolean
}

/** Manifest declaration of an HTTP route the plugin exposes. */
export interface ApiRouteContribution {
  method: HttpMethod
  /** Plugin-relative path. Exposed as `/api/plugins/{pluginId}{path}`. */
  path: string
  summary: string
  description?: string
  operationId?: string
  tags?: string[]
  visibility?: 'public' | 'internal' | 'experimental'
  stability?: 'stable' | 'beta' | 'experimental' | 'deprecated'
  parameters?: ApiParameterContribution[]
  requestBody?: ApiRequestBodyContribution
  responses?: Record<string, ApiResponseContribution>
  permissions?: PluginPermission[]
}

/** Raw JSON Schema object embedded in API contributions. */
export type JsonSchemaContribution = Record<string, unknown>

/** Path/query/header/cookie parameter declaration for an API route. */
export interface ApiParameterContribution {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  description?: string
  schema?: JsonSchemaContribution
  example?: unknown
}

/** Request body declaration for an API route. */
export interface ApiRequestBodyContribution {
  description?: string
  required?: boolean
  contentType?: string
  schema?: JsonSchemaContribution
  example?: unknown
}

/** Response declaration for one HTTP status code on an API route. */
export interface ApiResponseContribution {
  description: string
  contentType?: string
  schema?: JsonSchemaContribution
  example?: unknown
}

/** Manifest declaration of a client-side route the plugin contributes. */
export interface ClientRouteContribution {
  /** Absolute app route, e.g. `/messaging/calendar`. */
  path: string
  summary: string
  slot?: string
}

/** Manifest declaration of an MCP exec tool the plugin exposes. */
export interface ExecToolContribution {
  name: string
  summary: string
  description?: string
  permissions?: PluginPermission[]
}

/** Manifest declaration of a CLI command the plugin contributes. */
export interface CliCommandContribution {
  name: string
  usage: string
  summary: string
  description?: string
  aliases?: string[]
  /** Optional. When present, the manifest-driven CLI dispatcher routes the
   *  command through either the named exec-tool or the given API route.
   *  When absent, the command is documentation-only — its real
   *  implementation lives in `cli/bakin.ts`'s imperative switch. */
  dispatch?: {
    type: 'apiRoute'
    method: HttpMethod
    path: string
  } | {
    type: 'execTool'
    name: string
  }
}

/** Manifest declaration of a settings key the plugin owns. */
export interface SettingsContribution {
  key: string
  summary: string
}

/** Manifest declaration of the plugin's docs page slug. */
export interface DocsContribution {
  slug: string
}

/** The full contributions block in `bakin-plugin.json` — everything a plugin adds to the host. */
export interface PluginContributions {
  /** HTTP routes the plugin exposes under `/api/plugins/{id}/...`. */
  apiRoutes?: ApiRouteContribution[]
  /** Client-side routes the plugin renders (sidebar nav targets). */
  clientRoutes?: ClientRouteContribution[]
  /** MCP exec tools agents can call. */
  execTools?: ExecToolContribution[]
  /** CLI commands the plugin contributes to the `bakin` binary. */
  cliCommands?: CliCommandContribution[]
  /** Settings keys this plugin owns in the settings UI. */
  settings?: SettingsContribution[]
  /** Optional docs page slug. */
  docs?: DocsContribution
}

/** Optional Ed25519 signature block proving manifest authenticity. */
export interface PluginManifestSignature {
  algorithm: 'ed25519'
  /** Human-readable signer label. Trust is bound to publicKey/fingerprint, not this label. */
  signer: string
  /** Base64-encoded Ed25519 SPKI DER public key. */
  publicKey: string
  /** Base64-encoded signature over the canonical manifest without this signature block. */
  signature: string
}

/** The `bakin-plugin.json` manifest. Required for every plugin. */
export interface PluginManifest {
  /** Unique plugin identifier (kebab-case). */
  id: string
  /** Human-readable plugin name. */
  name: string
  /** Plugin version (semver). */
  version: string
  /** Minimum Bakin version this plugin supports. */
  bakin: string
  /** One-line summary shown in the plugin manager. */
  description: string
  /** Server + optional client entry-point file paths. */
  entry: PluginEntryPoints
  /** Static content files the plugin ships (rendered as docs/pages). */
  contentFiles?: string[]
  /** Environment-variable secrets the plugin requires. */
  secrets?: SecretDeclaration[]
  /** Path to a test entry-point (for `bakin plugins test`). */
  tests?: string
  /** Other plugin IDs this plugin depends on. */
  dependencies?: string[]
  /** Capabilities this plugin requests access to. */
  permissions?: PluginPermission[]
  /** Runtime features this plugin needs to function. */
  runtimeCapabilities?: RuntimeCapability[]
  /** Everything the plugin adds to the host (routes, tools, settings, etc.). */
  contributes?: PluginContributions
  /** File globs that trigger a hot reload in dev. */
  devWatch?: string[]
  /** Optional Ed25519 signature for authenticity. */
  signature?: PluginManifestSignature
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** File metadata returned by storage adapter `stat()`. */
export interface StorageStat {
  path: string
  size: number
  mtimeMs: number
  isFile: boolean
  isDirectory: boolean
}

/** Plugin-scoped filesystem adapter passed via `ctx.storage`. */
export interface StorageAdapter {
  read(path: string): string | null
  write(path: string, content: string): void
  append(path: string, content: string): void
  exists(path: string): boolean
  readAll(): Record<string, string>
  list?(path?: string): string[]
  remove?(path: string): void
  rename?(from: string, to: string): void
  stat?(path: string): StorageStat | null
  readJson?<T = unknown>(path: string): T | null
  writeJson?(path: string, value: unknown): void
  searchPath?(path: string): string
}

// ---------------------------------------------------------------------------
// Events, activity, hooks
// ---------------------------------------------------------------------------

/** Cross-plugin event bus. Emit and subscribe by pattern. */
export interface EventBus {
  emit(event: string, data?: Record<string, unknown>): void
  on(pattern: string, handler: (event: string, data: Record<string, unknown>) => void): () => void
  once(pattern: string, handler: (event: string, data: Record<string, unknown>) => void): () => void
}

/** Activity feed + structured audit log API exposed on the plugin context. */
export interface ActivityAPI {
  log(agent: string, message: string, opts?: { taskId?: string; category?: string }): void
  audit(event: string, agent: string, data?: Record<string, unknown>): void
}

/** Plugin-scoped structured logger (writes to server log + stdout). */
export interface PluginLogger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, errorOrData?: unknown, data?: Record<string, unknown>): void
  error(message: string, errorOrData?: unknown, data?: Record<string, unknown>): void
}

/** Cross-plugin RPC/event/waterfall hook registry. */
export interface HookAPI {
  register(name: string, handler: (data: unknown) => unknown, metadata?: HookRegistrationMetadata): () => void
  call<T>(name: string, data: T): Promise<T>
  callAll(name: string, data: Record<string, unknown>): Promise<void>
  has(name: string): boolean
  invoke<R>(name: string, data: unknown): Promise<R | undefined>
}

/** Optional documentation metadata for a registered hook. */
export interface HookRegistrationMetadata {
  label?: string
  summary: string
  description?: string
  hookKind?: HookKind
  input?: SchemaLike
  output?: SchemaLike
  visibility?: ContractVisibility
  stability?: ContractStability
  examples?: DocsExample[]
}

/** Hook semantics: single-return RPC, fire-and-forget event, or input transform waterfall. */
export type HookKind = 'rpc' | 'event' | 'waterfall'

// ---------------------------------------------------------------------------
// Navigation, API routes, UI slots
// ---------------------------------------------------------------------------

/** Sidebar navigation item registered by a plugin via `ctx.registerNav()`. */
export interface NavItem {
  /** Unique nav item id (used for active-state tracking). */
  id: string
  /** Display label in the sidebar. */
  label: string
  /** Lucide icon name (e.g. "tasks", "calendar"). */
  icon: string
  /** Target route path. */
  href: string
  /** Sort order within the parent group. Lower renders first. */
  order?: number
  /** Optional nested nav items for groups. */
  children?: NavItem[]
  /** If true, the group cannot be collapsed. */
  alwaysExpanded?: boolean
}

/** HTTP route handler registered by a plugin via `ctx.registerRoute()`. */
export interface APIRoute {
  /** Route path relative to `/api/plugins/{pluginId}`. */
  path: string
  /** HTTP method. */
  method: HttpMethod
  /** Request handler. Receives a standard Request and the plugin context. */
  handler: (req: Request, ctx: PluginContext) => Response | Promise<Response>
  /** One-line summary for docs. */
  summary?: string
  /** Full description for docs. */
  description?: string
  /** Path param descriptor (e.g. ":id"). */
  params?: string
  /** Input schema for validation and docs. */
  input?: SchemaLike
  /** Output schema for docs. */
  output?: SchemaLike
  /** Visibility tier (public/internal/experimental). */
  visibility?: ContractVisibility
  /** Stability tier. */
  stability?: ContractStability
  /** Reference examples for the docs site. */
  examples?: DocsExample[]
  /** Source location for generated docs back-references. */
  source?: SourceLocation
  /** Permissions required to call this route. */
  permissions?: string[]
}

/** Slot registration record: place a component at a named extension point. */
export interface UISlotRegistration {
  slot: string
  component: ComponentType<Record<string, unknown>>
  order?: number
}

/** Static content file shipped with a plugin (e.g. README, docs page). */
export interface ContentFile {
  path: string
}

// ---------------------------------------------------------------------------
// Runtime-facing public types
// ---------------------------------------------------------------------------

/** An agent registered with the runtime (OpenClaw, etc.). */
export interface RuntimeAgent {
  id: string
  name: string
  role?: string
  model?: string
  status?: 'active' | 'inactive' | 'unknown'
  metadata?: Record<string, unknown>
}

/** A messaging channel (Discord, Slack, email, etc.) registered with the runtime. */
export interface RuntimeChannel {
  id: string
  platform: string
  label: string
  capabilities: string[]
  metadata?: Record<string, unknown>
}

/** Whether to expose runtime-native tools for this agent turn. */
export type RuntimeMessageToolsMode = 'auto' | 'none'

/** Per-turn policy for which runtime tools the agent may call. */
export interface RuntimeMessageToolPolicy {
  /**
   * Controls whether runtime-native tools are available for this agent turn.
   * `none` disables tools. Omit or use `auto` for runtime/provider defaults.
   */
  toolsMode?: RuntimeMessageToolsMode
  /** Optional runtime-native tool allowlist for this turn. */
  toolsAllow?: string[]
  /** Optional runtime-native tool denylist for this turn. */
  toolsDeny?: string[]
}

/** Arguments for a single message dispatched to an agent. */
export interface RuntimeMessageArgs extends RuntimeMessageToolPolicy {
  agentId: string
  content: string
  /**
   * Adapter-neutral durable conversation key. Runtime adapters should map the
   * same agentId + threadId pair to the same provider/runtime session.
   */
  threadId?: string
  metadata?: Record<string, unknown>
}

/** Result returned by a non-streaming runtime message. */
export interface RuntimeMessageResult {
  id: string
  content?: string
  metadata?: Record<string, unknown>
}

/** Tool call/result event surfaced during a streaming agent turn. */
export interface RuntimeToolActivity {
  phase: 'call' | 'result'
  callId?: string
  toolName: string
  status?: 'running' | 'completed' | 'failed' | string
  summary?: string
  inputPreview?: string
  outputPreview?: string
  durationMs?: number
  exitCode?: number
  metadata?: Record<string, unknown>
}

/** One chunk in a streaming agent response (text, tool, status, done, error). */
export interface RuntimeChatChunk {
  type: 'text' | 'tool' | 'status' | 'done' | 'error'
  content?: string
  data?: Record<string, unknown> | RuntimeToolActivity
}

/** A cron-scheduled job tracked by the runtime. */
export interface CronJob {
  id: string
  name: string
  schedule: string
  command: string
  enabled: boolean
  toolsAllow?: string[]
  metadata?: Record<string, unknown>
}

/** Execution record for a single cron job run. */
export interface CronRun {
  id: string
  jobId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  startedAt?: string
  endedAt?: string
  output?: string
  error?: string
}

/** A skill (runtime-side capability) registered with an agent. */
export interface RuntimeSkill {
  name: string
  description?: string
}

/** A file in an agent's runtime workspace. */
export interface WorkspaceFile {
  path: string
  content?: string
}

/** Provider-agnostic interface for agent runtime adapters (OpenClaw, etc.). */
export interface AgentRuntimeAdapter {
  agents: {
    list(): Promise<RuntimeAgent[]>
    get(agentId: string): Promise<RuntimeAgent | null>
  }
  messaging: {
    send(input: RuntimeMessageArgs): Promise<RuntimeMessageResult>
    stream(input: RuntimeMessageArgs): AsyncIterable<RuntimeChatChunk>
  }
  channels: {
    list(): Promise<RuntimeChannel[]>
    sendMessage(input: {
      channels: string[]
      message: { body: string; title?: string; threadId?: string; metadata?: Record<string, unknown> }
    }): Promise<{ deliveries: Array<{ channelId: string; ref: string; renderedAt: string }> }>
    deliverContent(input: {
      channels: string[]
      content: {
        title: string
        body?: string
        url?: string
        files?: AssetFileRef[]
        metadata?: Record<string, unknown>
      }
    }): Promise<{ deliveries: Array<{ channelId: string; ref: string; renderedAt: string }> }>
  }
  cron: {
    list(): Promise<CronJob[]>
    get(id: string): Promise<CronJob | null>
    create(input: { id?: string; name: string; schedule: string; command: string; enabled?: boolean; toolsAllow?: string[]; metadata?: Record<string, unknown> }): Promise<CronJob>
    update(id: string, patch: Partial<Omit<CronJob, 'id' | 'toolsAllow'>> & { toolsAllow?: string[] | null }): Promise<CronJob>
    remove(id: string): Promise<void>
    runNow(id: string): Promise<CronRun>
    listRuns(jobId: string): Promise<CronRun[]>
    getRaw(id: string, reason: string): Promise<unknown | null>
    restoreRaw(id: string, snapshot: unknown, reason: string): Promise<CronJob>
  }
  skills?: {
    list(): Promise<RuntimeSkill[]>
  }
  models?: {
    listAvailable(opts?: { includeUnavailable?: boolean }): Promise<AvailableModel[]>
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

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
  list(filter?: { column?: ColumnId; agent?: string; projectId?: string }): Promise<Task[]>
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
  chunker?: {
    enabled: boolean
    targetTokens?: number
    overlapTokens?: number
  }
}

/** Full content-type definition: schema, indexes, facets, reindex generator. */
export interface SearchContentTypeDefinition {
  table: string
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
  reindex: () => AsyncGenerator<{ key: string; doc: Record<string, unknown> }>
  verifyExists: (key: string) => Promise<boolean>
}

/** File glob + mappers used by file-backed search content types. */
export interface FilePatternMapper {
  pattern: string
  fileToId: (relPath: string) => string | null
  fileToDoc: (relPath: string, content: string) => Promise<Record<string, unknown> | null>
}

/** File-backed content type: indexes documents derived from on-disk files. */
export interface FileBackedContentTypeDefinition extends SearchContentTypeDefinition {
  filePatterns: FilePatternMapper[]
  excludePatterns?: string[]
  onSync?: (relPath: string, content: string) => Promise<void>
  onUnlink?: (relPath: string) => Promise<void>
  buildOnStartup?: boolean
  preserveVirtualDocuments?: boolean
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
    source: 'search' | 'fallback'
  }
}

/** Health snapshot reported by the search adapter (per-table state). */
export interface SearchHealthSnapshot {
  enabled: boolean
  tables: Array<{
    table: string
    pluginId: string
    stats: Record<string, unknown> | null
    healthy: boolean
  }>
}

/** Atomic transform operation applied to an indexed document. */
export interface SearchTransformOp {
  op: '$set' | '$inc' | '$push'
  field?: string
  value: unknown
}

/** Search API exposed via `ctx.search` — index, query, transform documents. */
export interface SearchAPI {
  registerContentType(def: SearchContentTypeDefinition): void
  registerFileBackedContentType(def: FileBackedContentTypeDefinition): void
  index(key: string, doc: Record<string, unknown>): Promise<void>
  remove(key: string): Promise<void>
  transform(key: string, operations: SearchTransformOp[]): Promise<void>
  query(params: SearchQueryParams): Promise<SearchResponse>
  health?(): Promise<SearchHealthSnapshot>
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/** Auto-generated variant (thumbnail/optimized/webp) for an asset. */
export interface AssetVariantMeta {
  role: 'thumbnail' | 'optimized' | 'webp'
  path: string
  filename: string
  size: number
  mimeType: string
}

/** Structured provenance written by image-generation tools into an asset sidecar. */
export interface AssetGenerationMeta {
  provider: string
  model: string
  surface: string
  width: number
  height: number
  quality: string
  promptHash: string
  promptAssetFilename?: string
  routeReason?: string
  createdByTool: string
}

/** Full asset record: file info + sidecar metadata + auto-generated variants. */
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
    generation?: AssetGenerationMeta
  }
  variants?: AssetVariantMeta[]
}

/** Asset record while in trash (with deleted/expires timestamps). */
export interface TrashedAssetMeta {
  filename: string
  originalFilename: string
  type: string
  mimeType: string
  size: number
  deletedAt: string
  expiresAt: string
  metadata: AssetMeta['metadata'] | null
}

/** Compact reference to an asset by filename — used in channel deliveries. */
export interface AssetFileRef {
  kind: 'asset'
  filename: string
  mimeType?: string
}

/** Input for saving an agent-created or plugin-created file through the Assets plugin. */
export interface AssetSaveInput {
  filePath: string
  taskId: string | null
  type: AssetMeta['type']
  agent: string
  description?: string
  tags?: string[]
  tool?: string
  slug?: string
  source?: 'agent' | 'upload' | 'clipboard'
  originalFilename?: string
  generation?: AssetGenerationMeta
}

/** Result returned after the Assets plugin canonicalizes and persists a file. */
export interface AssetSaveResult {
  ok: boolean
  path?: string
  metadataPath?: string
  filename?: string
  error?: string
  [key: string]: unknown
}

/** Assets API exposed via `ctx.assets` — asset persistence and lookups. */
export interface AssetsAPI {
  save(input: AssetSaveInput): Promise<AssetSaveResult>
  getByFilename(filename: string): Promise<AssetMeta | null>
  list(filter?: { type?: AssetMeta['type']; taskId?: string | null }): Promise<AssetMeta[]>
  exists(filename: string): Promise<boolean>
  fileRef(filename: string): Promise<AssetFileRef>
}

// ---------------------------------------------------------------------------
// Execution tools, skills, health, workflows
// ---------------------------------------------------------------------------

/** Result returned from an exec tool handler. */
export interface ExecToolResult {
  ok: boolean
  error?: string
  details?: unknown
  [key: string]: unknown
}

/** Context passed to an exec tool handler. Subset of PluginContext sans UI registration. */
export interface PluginToolContext {
  /** Plugin-scoped storage adapter. */
  storage: StorageAdapter
  /** Cross-plugin event bus. */
  events: EventBus
  /** ID of the plugin owning this tool. */
  pluginId: string
  /** Agent runtime adapter (messaging, agents, channels, cron). */
  runtime: AgentRuntimeAdapter
  /** Task CRUD service. */
  tasks: TaskService
  /** Search API. */
  search: SearchAPI
  /** Assets API. */
  assets: AssetsAPI
  /** Hook registry. */
  hooks: HookAPI
  /** Activity feed and audit log. */
  activity: ActivityAPI
  /** Read this plugin's persisted settings. */
  getSettings<T = Record<string, unknown>>(): T
}

/** MCP exec tool definition registered via `ctx.registerExecTool()`. */
export interface ExecToolDefinition {
  /** Tool name. Convention: `bakin_exec_{pluginId}_{action}`. */
  name: string
  /** Description shown to the agent (used for tool selection). */
  description: string
  /** Optional UI label for the activity feed. */
  label?: string
  /** If true, this tool can fire multiple times in a single agent turn. */
  activityDuplicate?: boolean
  /** Zod raw shape describing the tool's parameters. */
  parameters: ZodRawShape
  /** Handler that executes the tool. */
  handler: (params: Record<string, unknown>, agent: string, ctx?: PluginToolContext) => Promise<ExecToolResult>
  /** Optional source-file path for generated docs. */
  source?: string
}

/** Runtime skill definition registered via `ctx.registerSkill()`. */
export interface SkillDefinition {
  name: string
  instructions: string
  output_schema?: Record<string, unknown>
  source?: string
}

/** Layout hints for a workflow's canvas rendering. */
export interface WorkflowLayoutInput {
  positions?: Record<string, { x: number; y: number; [key: string]: unknown }>
  [key: string]: unknown
}

/** Plugin-contributed workflow definition input shape. */
export interface WorkflowDefinitionInput {
  id?: string
  name: string
  description: string
  version: number
  inputs?: Record<string, unknown>
  layout?: WorkflowLayoutInput
  steps: unknown[]
  [key: string]: unknown
}

/** Field types supported by FormField. */
export type FormFieldType = 'string' | 'text' | 'number' | 'boolean' | 'select' | 'agent' | 'skill' | 'list'

/** Form field descriptor for plugin-contributed workflow nodes. */
export interface FormField {
  name: string
  type: FormFieldType
  required?: boolean
  description?: string
  options?: { value: string; label: string }[]
}

/** Edge constraints for a plugin-contributed workflow node type. */
export interface EdgeRules {
  maxInbound?: number
  maxOutbound?: number
}

/** Workflow node type contributed by a plugin (custom step kind). */
export interface PluginNodeTypeInput<T = unknown> {
  kind: string
  zodSchema: SchemaLike<T>
  formFields: FormField[]
  edgeRules?: EdgeRules
}

/** Notification channel definition contributed by a plugin. */
export interface PluginNotificationChannelInput {
  id: string
  label: string
  initials?: string
  icon?: string
}

/** Result row returned by a health check (doctor). */
export interface HealthCheckResult {
  /** Stable check identifier. */
  check: string
  /** Severity of the result. */
  status: 'ok' | 'warn' | 'error' | 'fixed'
  /** Human-readable message describing the finding. */
  message: string
  /** Whether the issue can be auto-fixed by an attached repair handler. */
  autoFixable: boolean
}

/** Repair safety tier: safe (auto), manual (needs review), destructive (data-affecting). */
export type HealthRepairSafety = 'safe' | 'manual' | 'destructive'

/** Single change a repair plan will apply. */
export interface HealthRepairChange {
  kind: 'file' | 'setting' | 'service' | 'runtime' | 'task' | 'other'
  target: string
  action: 'create' | 'update' | 'delete' | 'install' | 'invoke'
  description: string
}

/** One item in a repair plan: what will change and why. */
export interface HealthRepairPlanItem {
  id: string
  checkId: string
  title: string
  reason: string
  safety: HealthRepairSafety
  requiresConfirmation: boolean
  changes: HealthRepairChange[]
}

/** Result of applying a single repair plan item. */
export interface HealthRepairApplyResult {
  id: string
  checkId: string
  status: 'applied' | 'skipped' | 'failed'
  message: string
  changes: HealthRepairChange[]
}

/** Two-phase repair handler attached to a health check. */
export interface HealthRepairHandler {
  plan(rows: HealthCheckResult[]): Promise<HealthRepairPlanItem[]>
  apply(items: HealthRepairPlanItem[]): Promise<HealthRepairApplyResult[]>
}

/** Health check registration input passed to `ctx.registerHealthCheck()`. */
export interface PluginHealthCheckInput {
  id: string
  name: string
  run: () => Promise<HealthCheckResult[]>
  autoFix?: boolean
  repair?: HealthRepairHandler
}

// ---------------------------------------------------------------------------
// Settings schema
// ---------------------------------------------------------------------------

interface BaseSettingsField {
  key: string
  label: string
  description?: string
  required?: boolean
}

/** Single-line text settings field. */
export interface StringSettingsField extends BaseSettingsField {
  type: 'string'
  default?: string
}

/** Numeric settings field with optional default. */
export interface NumberSettingsField extends BaseSettingsField {
  type: 'number'
  default?: number
}

/** Boolean toggle settings field. */
export interface BooleanSettingsField extends BaseSettingsField {
  type: 'boolean'
  default?: boolean
}

/** Dropdown settings field with predefined options. */
export interface SelectSettingsField extends BaseSettingsField {
  type: 'select'
  options: { value: string; label: string }[]
  default?: string
}

/** Repeatable list settings field with per-item shape. */
export interface ListSettingsField extends BaseSettingsField {
  type: 'list'
  itemShape: Record<string, StringSettingsField | NumberSettingsField | BooleanSettingsField | SelectSettingsField>
  default?: unknown[]
  addLabel?: string
  minItems?: number
  maxItems?: number
  uniqueField?: string
}

/** Union of all supported settings field types. */
export type SettingsField =
  | StringSettingsField
  | NumberSettingsField
  | BooleanSettingsField
  | SelectSettingsField
  | ListSettingsField

/** Plugin settings schema — declares fields rendered on the settings page. */
export interface PluginSettingsSchema {
  /** Ordered list of settings fields for the form. */
  fields: SettingsField[]
}

// ---------------------------------------------------------------------------
// Plugin context and plugin object
// ---------------------------------------------------------------------------

/** The activation context passed to a plugin's `activate(ctx)` method.
 *  This is the primary API surface for plugin authors. Everything a plugin
 *  needs to register with the host — routes, tools, nav, slots, health checks,
 *  settings — flows through this object. */
export interface PluginContext {
  /** Plugin-scoped filesystem storage adapter. */
  storage: StorageAdapter
  /** Cross-plugin event bus. */
  events: EventBus
  /** ID of the plugin this context belongs to. */
  pluginId: string
  /** Agent runtime adapter (agents, messaging, channels, cron, skills). */
  runtime: AgentRuntimeAdapter
  /** Task CRUD service. */
  tasks: TaskService
  /** Assets API for asset metadata + file lookups. */
  assets: AssetsAPI
  /** Register sidebar navigation items. */
  registerNav(items: NavItem[]): void
  /** Register an HTTP route under `/api/plugins/{pluginId}`. */
  registerRoute(route: APIRoute): void
  /** Register a component for a named slot (legacy — prefer `<Slot>` from `/slots`). */
  registerSlot(registration: UISlotRegistration): void
  /** Register an MCP exec tool agents can call. */
  registerExecTool(tool: ExecToolDefinition): void
  /** Register a runtime skill (capability definition). */
  registerSkill(skill: SkillDefinition): void
  /** Register a workflow definition (or template) the plugin ships. */
  registerWorkflow(definition: WorkflowDefinitionInput, opts?: { readOnly?: boolean }): void
  /** Register a custom workflow node type (step kind). */
  registerNodeType<T = unknown>(def: PluginNodeTypeInput<T>): string
  /** Register a notification channel the runtime can deliver to. */
  registerNotificationChannel(def: PluginNotificationChannelInput): string
  /** Register a health check that runs on `bakin doctor`. */
  registerHealthCheck(def: PluginHealthCheckInput): string
  /** Subscribe to file globs for live updates (Chokidar-based). */
  watchFiles(patterns: string[]): void
  /** Read this plugin's persisted settings. */
  getSettings<T = Record<string, unknown>>(): T
  /** Patch this plugin's persisted settings. */
  updateSettings(patch: Record<string, unknown>): void
  /** Activity feed + audit log API. */
  activity: ActivityAPI
  /** Plugin-scoped structured logger. Optional — falls back to console. */
  log?: PluginLogger
  /** Cross-plugin hook registry. */
  hooks: HookAPI
  /** Search API for indexing and querying. */
  search: SearchAPI
}

/** The main plugin interface. The default export of a plugin's `index.ts`. */
export interface BakinPlugin {
  /** Unique plugin identifier (matches manifest `id`). */
  id: string
  /** Display name. */
  name: string
  /** Plugin version (semver). */
  version: string
  /** Called once at plugin load. Register routes/tools/nav/etc. here. */
  activate(ctx: PluginContext): void | Promise<void>
  /** Called after all plugins have activated. Useful for cross-plugin setup. */
  onReady?(): void | Promise<void>
  /** Called when the server shuts down or the plugin is hot-swapped out. */
  onShutdown?(): void | Promise<void>
  /** Called when this plugin's settings are persisted. */
  onSettingsChange?(settings: Record<string, unknown>): void | Promise<void>
  /** Called when the plugin is uninstalled — clean up persisted data here. */
  onUninstall?(ctx: PluginContext): void | Promise<void>
  /** Settings schema rendered on this plugin's settings page. */
  settingsSchema?: PluginSettingsSchema
  /** Convenience: nav items to auto-register at activation. */
  navItems?: NavItem[]
  /** Convenience: static content files declared at construction. */
  contentFiles?: ContentFile[]
}

// ---------------------------------------------------------------------------
// Misc public domain types used by existing plugins
// ---------------------------------------------------------------------------

/** Single calendar event (time + text). */
export interface CalendarEvent {
  time?: string
  text: string
}

/** One day on an agent's calendar (date + list of events). */
export interface CalendarDay {
  date: string
  label?: string
  events: CalendarEvent[]
}

/** A recurring event (cron expression + display text). */
export interface RecurringEvent {
  schedule: string
  text: string
}

/** Single memory entry (decision, learned-thing, or freeform note). */
export interface MemoryEntry {
  type: 'decision' | 'learned' | 'note'
  text: string
}

/** Memory entries grouped by day. */
export interface MemoryDay {
  date: string
  entries: MemoryEntry[]
}

/** Agent heartbeat snapshot (status + current task + timestamp). */
export interface Heartbeat {
  status: 'working' | 'idle' | 'down'
  currentTask?: string
  timestamp: string
}

/** Project metadata loaded from a markdown project file. */
export interface ProjectMeta {
  filename: string
  title: string
  status?: string
  content: string
}

/** A model available in the models catalog (LLM, image, or video). */
export interface AvailableModel {
  id: string
  name?: string
  provider?: string
  source?: string
  tier?: 'budget' | 'standard' | 'premium'
  input?: string
  contextWindow?: number
  local?: boolean
  available?: boolean
  tags?: string[]
  configured?: boolean
  isDefault?: boolean
  fallbackIndex?: number | null
  description?: string
  bestFor?: string
  costRange?: string
  contextWindowDisplay?: string
  kind?: 'llm' | 'image' | 'video'
  brandIconSlug?: string
  providerLabel?: string
  providerBrandIconSlug?: string
  providerBrandColor?: string
}

/** A workflow definition stored on disk (YAML or programmatic). */
export interface WorkflowDefinition {
  id?: string
  name: string
  description?: string
  version?: number
  steps: unknown[]
  [key: string]: unknown
}

/** A running instance of a workflow attached to a task. */
export interface WorkflowInstance {
  id: string
  taskId?: string
  status?: string
  [key: string]: unknown
}

/** One step in a workflow definition or instance. */
export interface WorkflowStep {
  id: string
  type: string
  [key: string]: unknown
}

/** Alias for WorkflowDefinition when used as a reusable template. */
export type WorkflowTemplate = WorkflowDefinition

/** The `bakin.config.ts` shape — root configuration for a Bakin installation. */
export interface BakinConfig {
  /** Plugins to load at startup. */
  plugins: PluginEntry[]
  /** Theme overrides for CSS custom properties. */
  theme?: Record<string, string>
  /** Storage configuration. */
  storage?: {
    /** Override the default content directory. */
    contentDir?: string
  }
}

/** A plugin entry in `bakin.config.ts`. */
export interface PluginEntry {
  /** Path or package specifier resolving to the plugin's entry file. */
  path: string
  /** If false, the plugin is loaded but not activated. Default true. */
  enabled?: boolean
}
