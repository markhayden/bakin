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

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type ContractVisibility = 'public' | 'internal' | 'experimental'
export type ContractStability = 'stable' | 'beta' | 'experimental' | 'deprecated'

export interface SchemaLike<T = unknown> {
  parse(data: unknown): T
  safeParse?(data: unknown): { success: true; data: T } | { success: false; error: unknown }
}

export interface SourceLocation {
  file: string
  symbol?: string
  line?: number
}

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

export interface PluginEntryPoints {
  server: string
  client?: string
}

export interface SecretDeclaration {
  /** Canonical environment variable name, for example `ANTHROPIC_API_KEY`. */
  name: string
  /** Human-readable setup note. Never include a secret value here. */
  description: string
  /** Missing required secrets should be reported by setup/health checks. Defaults to true. */
  required: boolean
}

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

export type JsonSchemaContribution = Record<string, unknown>

export interface ApiParameterContribution {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  description?: string
  schema?: JsonSchemaContribution
  example?: unknown
}

export interface ApiRequestBodyContribution {
  description?: string
  required?: boolean
  contentType?: string
  schema?: JsonSchemaContribution
  example?: unknown
}

export interface ApiResponseContribution {
  description: string
  contentType?: string
  schema?: JsonSchemaContribution
  example?: unknown
}

export interface ClientRouteContribution {
  /** Absolute app route, e.g. `/messaging/calendar`. */
  path: string
  summary: string
  slot?: string
}

export interface ExecToolContribution {
  name: string
  summary: string
  description?: string
  permissions?: PluginPermission[]
}

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

export interface SettingsContribution {
  key: string
  summary: string
}

export interface DocsContribution {
  slug: string
}

export interface PluginContributions {
  apiRoutes?: ApiRouteContribution[]
  clientRoutes?: ClientRouteContribution[]
  execTools?: ExecToolContribution[]
  cliCommands?: CliCommandContribution[]
  settings?: SettingsContribution[]
  docs?: DocsContribution
}

export interface PluginManifestSignature {
  algorithm: 'ed25519'
  /** Human-readable signer label. Trust is bound to publicKey/fingerprint, not this label. */
  signer: string
  /** Base64-encoded Ed25519 SPKI DER public key. */
  publicKey: string
  /** Base64-encoded signature over the canonical manifest without this signature block. */
  signature: string
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  bakin: string
  description: string
  entry: PluginEntryPoints
  contentFiles?: string[]
  secrets?: SecretDeclaration[]
  tests?: string
  dependencies?: string[]
  permissions?: PluginPermission[]
  runtimeCapabilities?: RuntimeCapability[]
  contributes?: PluginContributions
  devWatch?: string[]
  signature?: PluginManifestSignature
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface StorageStat {
  path: string
  size: number
  mtimeMs: number
  isFile: boolean
  isDirectory: boolean
}

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

export interface EventBus {
  emit(event: string, data?: Record<string, unknown>): void
  on(pattern: string, handler: (event: string, data: Record<string, unknown>) => void): () => void
  once(pattern: string, handler: (event: string, data: Record<string, unknown>) => void): () => void
}

export interface ActivityAPI {
  log(agent: string, message: string, opts?: { taskId?: string; category?: string }): void
  audit(event: string, agent: string, data?: Record<string, unknown>): void
}

export interface PluginLogger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, errorOrData?: unknown, data?: Record<string, unknown>): void
  error(message: string, errorOrData?: unknown, data?: Record<string, unknown>): void
}

export interface HookAPI {
  register(name: string, handler: (data: unknown) => unknown, metadata?: HookRegistrationMetadata): () => void
  call<T>(name: string, data: T): Promise<T>
  callAll(name: string, data: Record<string, unknown>): Promise<void>
  has(name: string): boolean
  invoke<R>(name: string, data: unknown): Promise<R | undefined>
}

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

export type HookKind = 'rpc' | 'event' | 'waterfall'

// ---------------------------------------------------------------------------
// Navigation, API routes, UI slots
// ---------------------------------------------------------------------------

export interface NavItem {
  id: string
  label: string
  icon: string
  href: string
  order?: number
  children?: NavItem[]
  alwaysExpanded?: boolean
}

export interface APIRoute {
  path: string
  method: HttpMethod
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
  component: ComponentType<Record<string, unknown>>
  order?: number
}

export interface ContentFile {
  path: string
}

// ---------------------------------------------------------------------------
// Runtime-facing public types
// ---------------------------------------------------------------------------

export interface RuntimeAgent {
  id: string
  name: string
  role?: string
  model?: string
  status?: 'active' | 'inactive' | 'unknown'
  metadata?: Record<string, unknown>
}

export interface RuntimeChannel {
  id: string
  platform: string
  label: string
  capabilities: string[]
  metadata?: Record<string, unknown>
}

export interface RuntimeMessageArgs {
  agentId: string
  content: string
  /**
   * Adapter-neutral durable conversation key. Runtime adapters should map the
   * same agentId + threadId pair to the same provider/runtime session.
   */
  threadId?: string
  metadata?: Record<string, unknown>
}

export interface RuntimeMessageResult {
  id: string
  content?: string
  metadata?: Record<string, unknown>
}

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

export interface RuntimeChatChunk {
  type: 'text' | 'tool' | 'status' | 'done' | 'error'
  content?: string
  data?: Record<string, unknown> | RuntimeToolActivity
}

export interface CronJob {
  id: string
  name: string
  schedule: string
  command: string
  enabled: boolean
  toolsAllow?: string[]
  metadata?: Record<string, unknown>
}

export interface CronRun {
  id: string
  jobId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  startedAt?: string
  endedAt?: string
  output?: string
  error?: string
}

export interface RuntimeSkill {
  name: string
  description?: string
}

export interface WorkspaceFile {
  path: string
  content?: string
}

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

export interface TaskLogEntry {
  timestamp: string
  author: string
  message: string
  data?: Record<string, unknown>
}

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
  order?: number
  createdAt?: string
  updatedAt?: string
}

export interface TaskColumns {
  backlog: Task[]
  inProgress: Task[]
  todo: Task[]
  review: Task[]
  done: Task[]
  blocked: Task[]
  archived: Task[]
}

export interface TaskBoard {
  columns: TaskColumns
  timestamp?: string
}

export type ColumnId = keyof TaskColumns

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
  skipWorkflowReason?: string
}

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
}

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

export interface SearchSchemaField {
  type: 'text' | 'keyword' | 'number' | 'boolean' | 'datetime' | 'array'
}

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

export interface FilePatternMapper {
  pattern: string
  fileToId: (relPath: string) => string | null
  fileToDoc: (relPath: string, content: string) => Promise<Record<string, unknown> | null>
}

export interface FileBackedContentTypeDefinition extends SearchContentTypeDefinition {
  filePatterns: FilePatternMapper[]
  excludePatterns?: string[]
  onSync?: (relPath: string, content: string) => Promise<void>
  onUnlink?: (relPath: string) => Promise<void>
  buildOnStartup?: boolean
}

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

export interface SearchResult {
  id: string
  table: string
  score: number
  fields: Record<string, unknown>
  rerankScore?: number
}

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

export interface SearchHealthSnapshot {
  enabled: boolean
  tables: Array<{
    table: string
    pluginId: string
    stats: Record<string, unknown> | null
    healthy: boolean
  }>
}

export interface SearchTransformOp {
  op: '$set' | '$inc' | '$push'
  field?: string
  value: unknown
}

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
// Execution tools, skills, health, workflows
// ---------------------------------------------------------------------------

export interface ExecToolResult {
  ok: boolean
  error?: string
  details?: unknown
  [key: string]: unknown
}

export interface PluginToolContext {
  storage: StorageAdapter
  events: EventBus
  pluginId: string
  runtime: AgentRuntimeAdapter
  tasks: TaskService
  search: SearchAPI
  assets: AssetsAPI
  hooks: HookAPI
  activity: ActivityAPI
  getSettings<T = Record<string, unknown>>(): T
}

export interface ExecToolDefinition {
  name: string
  description: string
  label?: string
  activityDuplicate?: boolean
  parameters: ZodRawShape
  handler: (params: Record<string, unknown>, agent: string, ctx?: PluginToolContext) => Promise<ExecToolResult>
  source?: string
}

export interface SkillDefinition {
  name: string
  instructions: string
  output_schema?: Record<string, unknown>
  source?: string
}

export interface WorkflowDefinitionInput {
  id?: string
  name: string
  description: string
  version: number
  inputs?: Record<string, unknown>
  steps: unknown[]
}

export type FormFieldType = 'string' | 'text' | 'number' | 'boolean' | 'select' | 'agent' | 'skill' | 'list'

export interface FormField {
  name: string
  type: FormFieldType
  required?: boolean
  description?: string
  options?: { value: string; label: string }[]
}

export interface EdgeRules {
  maxInbound?: number
  maxOutbound?: number
}

export interface PluginNodeTypeInput<T = unknown> {
  kind: string
  zodSchema: SchemaLike<T>
  formFields: FormField[]
  edgeRules?: EdgeRules
}

export interface PluginNotificationChannelInput {
  id: string
  label: string
  initials?: string
  icon?: string
}

export interface HealthCheckResult {
  check: string
  status: 'ok' | 'warn' | 'error' | 'fixed'
  message: string
  autoFixable: boolean
}

export interface PluginHealthCheckInput {
  id: string
  name: string
  run: () => Promise<HealthCheckResult[]>
  autoFix?: boolean
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

export interface ListSettingsField extends BaseSettingsField {
  type: 'list'
  itemShape: Record<string, StringSettingsField | NumberSettingsField | BooleanSettingsField | SelectSettingsField>
  default?: unknown[]
  addLabel?: string
  minItems?: number
  maxItems?: number
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
// Plugin context and plugin object
// ---------------------------------------------------------------------------

export interface PluginContext {
  storage: StorageAdapter
  events: EventBus
  pluginId: string
  runtime: AgentRuntimeAdapter
  tasks: TaskService
  assets: AssetsAPI
  registerNav(items: NavItem[]): void
  registerRoute(route: APIRoute): void
  registerSlot(registration: UISlotRegistration): void
  registerExecTool(tool: ExecToolDefinition): void
  registerSkill(skill: SkillDefinition): void
  registerWorkflow(definition: WorkflowDefinitionInput, opts?: { readOnly?: boolean }): void
  registerNodeType<T = unknown>(def: PluginNodeTypeInput<T>): string
  registerNotificationChannel(def: PluginNotificationChannelInput): string
  registerHealthCheck(def: PluginHealthCheckInput): string
  watchFiles(patterns: string[]): void
  getSettings<T = Record<string, unknown>>(): T
  updateSettings(patch: Record<string, unknown>): void
  activity: ActivityAPI
  log?: PluginLogger
  hooks: HookAPI
  search: SearchAPI
}

export interface BakinPlugin {
  id: string
  name: string
  version: string
  activate(ctx: PluginContext): void | Promise<void>
  onReady?(): void | Promise<void>
  onShutdown?(): void | Promise<void>
  onSettingsChange?(settings: Record<string, unknown>): void | Promise<void>
  onUninstall?(ctx: PluginContext): void | Promise<void>
  settingsSchema?: PluginSettingsSchema
  navItems?: NavItem[]
  contentFiles?: ContentFile[]
}

// ---------------------------------------------------------------------------
// Misc public domain types used by existing plugins
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  time?: string
  text: string
}

export interface CalendarDay {
  date: string
  label?: string
  events: CalendarEvent[]
}

export interface RecurringEvent {
  schedule: string
  text: string
}

export interface MemoryEntry {
  type: 'decision' | 'learned' | 'note'
  text: string
}

export interface MemoryDay {
  date: string
  entries: MemoryEntry[]
}

export interface Heartbeat {
  status: 'working' | 'idle' | 'down'
  currentTask?: string
  timestamp: string
}

export interface ProjectMeta {
  filename: string
  title: string
  status?: string
  content: string
}

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

export interface WorkflowDefinition {
  id?: string
  name: string
  description?: string
  version?: number
  steps: unknown[]
  [key: string]: unknown
}

export interface WorkflowInstance {
  id: string
  taskId?: string
  status?: string
  [key: string]: unknown
}

export interface WorkflowStep {
  id: string
  type: string
  [key: string]: unknown
}

export type WorkflowTemplate = WorkflowDefinition

export interface BakinConfig {
  plugins: PluginEntry[]
  theme?: Record<string, string>
  storage?: {
    contentDir?: string
  }
}

export interface PluginEntry {
  path: string
  enabled?: boolean
}
