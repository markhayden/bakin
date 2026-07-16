/**
 * Plugin system type definitions for Bakin (the internal, in-process surface).
 *
 * Two-tier contract — read before "deduplicating" against the SDK:
 * `@makinbakin/sdk/types` is the PUBLISHED, self-contained, deliberately
 * NARROWER plugin-author surface; this file is the INTERNAL surface that
 * in-process core plugins actually receive. They are NOT a fork to collapse.
 * Concretely:
 *   - `PluginContext.runtime` here is the FULL `AgentRuntimeAdapter`
 *     (adapters/runtime/concepts.ts: agents×11, tools, sessions, memory,
 *     config, images, media, restart…). Core plugins use ~15 full-only
 *     methods. The SDK exposes a curated subset.
 *   - `ctx.tasks` here returns the `PluginTask` projection; the SDK returns
 *     `Task`. `BakinPlugin` here adds `routes?`. `StorageAdapter`/`NavItem`/
 *     `APIRoute`/`HookAPI`/`SkillDefinition` are intentionally fuller here.
 * Genuinely-identical LEAF data types (health, exec-result, search, manifest,
 * EventBus/ActivityAPI/PluginLogger, TaskLogEntry, …) ARE single-homed in the
 * SDK and re-exported below. Collapsing the boundary itself is WS2 work.
 */

import type { z, ZodRawShape, ZodType } from 'zod'
import type {
  ActivityAPI,
  ActivityClass,
  EventBus,
  ExecToolResult,
  HealthCheckRegistrationInput,
  HealthOwner,
  HealthRepairActionDefinition,
  PluginLogger,
  SearchAPI,
  TaskLogEntry,
} from '@makinbakin/sdk/types'
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
  list(path?: string): string[]
  remove(path: string): void
  rename(from: string, to: string): void
  stat(path: string): {
    path: string
    size: number
    mtimeMs: number
    isFile: boolean
    isDirectory: boolean
  } | null
  readJson<T = unknown>(path: string): T | null
  writeJson(path: string, value: unknown): void
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
// Identical leaf primitive — single-homed in the SDK, re-exported here.
export type { EventBus } from '@makinbakin/sdk/types'

// ---------------------------------------------------------------------------
// Navigation + Routes + UI Slots
// ---------------------------------------------------------------------------
export type NavSection = 'plan-and-automate' | 'create' | 'operations'

export interface NavItem {
  id: string
  label: string
  icon: string // lucide icon name
  href: string
  order?: number
  children?: NavItem[]
  section?: NavSection
  /** @deprecated Removed after owned navigation groups migrate to the standard disclosure behavior. */
  alwaysExpanded?: boolean
  /** @deprecated Removed after the owned Explore entry migrates to the shell promotion. */
  placement?: 'bottom'
}

/**
 * INTERNAL registered-route record — the erased shape routes take inside the
 * plugin registry's state after declarative registration (typed schemas
 * survive as extra fields the dispatcher reads). NOT a public authoring
 * type: plugin authors declare routes with `defineRoute()` and the
 * declarative-generic `APIRoute<C, P, Q, B>` from `@bakin/core/routing` /
 * `@makinbakin/sdk` (audit 2026-07 H3 collapsed the two same-named types).
 */
export interface RegisteredAPIRoute {
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
  activityClass?: ActivityClass
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

// ExecToolResult is single-homed in the SDK (the plugin-author surface).
// Core re-exports it; PluginToolContext/ExecToolDefinition below reference the
// imported type.
export type { ExecToolResult } from '@makinbakin/sdk/types'

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

export interface ExecToolDefinition<Shape extends ZodRawShape = ZodRawShape> {
  name: string
  description: string
  label?: string // Short human-readable action phrase for activity feed (e.g., "Created a task")
  activityDuplicate?: boolean // true = handler already emits a meaningful activity event; auto-audit can be hidden
  activityClass?: ActivityClass // propagated by generic exec-tool transports; omitted tools are foreground user activity
  parameters: Shape
  /** Params are inferred from `parameters` — declare the shape once, get typed params. */
  handler: (params: z.infer<z.ZodObject<Shape>>, agent: string, ctx?: PluginToolContext) => Promise<ExecToolResult>
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
  /** Absolute source markdown file path when the skill was loaded from a managed package/plugin file. */
  sourcePath?: string
}

// ---------------------------------------------------------------------------
// Workflow Definition Input (permissive shape — full schema lives in the
// workflows plugin, but core needs the type to expose ctx.registerWorkflow
// without an upward import. The workflows plugin re-validates with Zod.)
// ---------------------------------------------------------------------------
export interface WorkflowLayoutInput {
  positions?: Record<string, { x: number; y: number; [key: string]: unknown }>
  [key: string]: unknown
}

export interface WorkflowDefinitionInput {
  /** Stable workflow id. Falls back to slug(name) when omitted. */
  id?: string
  name: string
  description: string
  version: number
  inputs?: Record<string, unknown>
  layout?: WorkflowLayoutInput
  steps: unknown[]
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Plugin Context (provided to activate())
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Activity API (structured logging for plugins)
// ---------------------------------------------------------------------------
// Identical leaf primitives — single-homed in the SDK, re-exported here.
export type { ActivityAPI, PluginLogger } from '@makinbakin/sdk/types'

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
 * `packages/core/src/workflows/notification-channel-registry.ts`.
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

// The health-check contract is single-homed in the SDK (the plugin-author
// surface, `@makinbakin/sdk/types`). Core re-exports it so internal consumers
// (doctor, app-services) and the in-repo plugin sites keep importing it from
// '@bakin/core/plugin-types'.
export type {
  ActionIncidentInput,
  AdvisoryIncidentInput,
  CanonicalErrorObservation,
  CanonicalHealthyObservation,
  CanonicalUnknownObservation,
  CanonicalWarningObservation,
  ErrorObservationInput,
  HealthCheckExecution,
  HealthCheckRegistrationInput,
  HealthCheckRunContext,
  HealthCheckRunInput,
  HealthCheckSnapshot,
  HealthCheckState,
  HealthDisposition,
  HealthFullSweep,
  HealthGroup,
  HealthIncident,
  HealthIncidentInput,
  HealthInstructionsResolution,
  HealthNavigateResolution,
  HealthNonEmptyArray,
  HealthObservation,
  HealthObservationInput,
  HealthObservationStatus,
  HealthOwner,
  HealthOwnerKind,
  HealthRepairActionDefinition,
  HealthRepairApplyRequest,
  HealthRepairApplyResult,
  HealthRepairSafety,
  HealthRepairChange,
  HealthRepairPlanItem,
  HealthRepairPlan,
  HealthRepairPrecondition,
  HealthRepairResolution,
  HealthRepairTarget,
  HealthReport,
  HealthReportStatus,
  HealthReportSummary,
  HealthResolution,
  HealthResource,
  HealthResourceKind,
  HealthRerunResolution,
  HealthyObservationInput,
  JsonObject,
  JsonValue,
  SearchReadiness,
  SearchReadinessStage,
  SearchReadinessStageKey,
  SearchReadinessStatus,
  SearchStageStatus,
  UnknownObservationInput,
  WarningObservationInput,
  WatchIncidentInput,
} from '@makinbakin/sdk/types'

/** Core-internal canonical registration with its resolved owner and local id. */
export interface HealthCheckDef extends HealthCheckRegistrationInput {
  id: string
  localId: string
  owner: HealthOwner
}

/** Core-internal canonical repair action with its resolved owner and local id. */
export interface HealthRepairActionDef extends HealthRepairActionDefinition {
  id: string
  localId: string
  owner: HealthOwner
}

export interface PluginContext {
  storage: StorageAdapter
  events: EventBus
  pluginId: string
  runtime: AgentRuntimeAdapter
  tasks: PluginTaskService
  assets: AssetsAPI
  registerNav(items: NavItem[]): void
  registerSlot(registration: UISlotRegistration): void
  registerExecTool<Shape extends ZodRawShape>(tool: ExecToolDefinition<Shape>): void
  registerSkill(skill: SkillDefinition): void
  /**
   * Register a workflow definition shipped by this plugin. Disk-resident
   * user definitions in `~/.bakin/workflows/definitions/` always win on id
   * collision (user-wins). A second plugin claiming an id already taken by
   * another plugin THROWS out of `activate()` (R18 — the activation fails
   * and the plugin's partial registrations are swept). Re-registering the
   * same id from the same plugin is an update (newer wins) so hot reload
   * works.
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
  registerHealthCheck(def: HealthCheckRegistrationInput): string
  /** Register an owner-local repair action referenced by Health observations. */
  registerHealthRepairAction(def: HealthRepairActionDefinition): string
  watchFiles(patterns: string[]): void
  /** Read this plugin's persisted settings */
  getSettings<T = Record<string, unknown>>(): T
  /** Merge a partial update into this plugin's settings and persist */
  updateSettings(patch: Record<string, unknown>): void
  /** Structured activity logging */
  activity: ActivityAPI
  /** Plugin-scoped server log. Always provided; prefer over console.*. */
  log: PluginLogger
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
  brandId?: string
  availableAt?: string
  dueAt?: string
  source?: PluginTaskSource
  order?: number
  createdAt?: string
  updatedAt?: string
}

export interface PluginTaskSource {
  pluginId?: string
  entityType?: string
  entityId?: string
  purpose?: string
}

// Single-homed in the SDK; re-exported here (referenced by PluginTask.log
// and PluginTaskService.appendLog below).
export type { TaskLogEntry } from '@makinbakin/sdk/types'

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
  brandId?: string
  parentId?: string | null
  availableAt?: string
  dueAt?: string
  source?: PluginTaskSource
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
  brandId?: string
  parentId?: string | null
  availableAt?: string | null
  dueAt?: string | null
  source?: PluginTaskSource | null
}

export interface PluginTaskService {
  create(input: PluginTaskCreateInput): Promise<PluginTask>
  update(id: string, patch: PluginTaskUpdateInput): Promise<PluginTask>
  move(id: string, column: PluginTaskColumn, order?: number): Promise<PluginTask>
  remove(id: string): Promise<void>
  get(id: string): Promise<PluginTask | null>
  list(filter?: { column?: PluginTaskColumn; agent?: string; projectId?: string; brandId?: string }): Promise<PluginTask[]>
  appendLog(id: string, entry: TaskLogEntry): Promise<void>
}

// ---------------------------------------------------------------------------
// Public assets service
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

export interface VersionedAssetRef {
  assetId: string
  version: number
}

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

export interface AssetsAPI {
  // Versioned (asset-as-directory) surface.
  createAsset(input: AssetCreateInput): Promise<VersionedAssetRef>
  /** Read an asset's current-version summary by id (metadata: type/description/tags/etc.), or null. */
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
// Search API (adapter-backed vector + full-text search)
// ---------------------------------------------------------------------------

// The search API contract is single-homed in the SDK (the plugin-author
// surface). Core re-exports the whole cluster; the import below is for the
// local PluginContext/PluginToolContext `search: SearchAPI` references.
export type {
  SearchSchemaField,
  SearchIndexDefinition,
  SearchContentTypeDefinition,
  SearchQueryParams,
  SearchResult,
  SearchResponse,
  SearchHealthIndex,
  SearchHealthTable,
  SearchHealthSnapshot,
  SearchReindexItem,
  SearchTransformOp,
  SearchScanOptions,
  FilePatternMapper,
  FileBackedContentTypeDefinition,
  SearchAPI,
  SearchMaintenanceAPI,
} from '@makinbakin/sdk/types'

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
   */
  routes?: ReadonlyArray<DeclarativeAPIRoute<PluginContextLite, any, any, any>>
}

// ---------------------------------------------------------------------------
// Plugin Manifest (bakin-plugin.json) + config
// ---------------------------------------------------------------------------
// Single-homed in the SDK. Core's previous PluginManifest had drifted stale
// (missing runtimeCapabilities/contributes/devWatch); the SDK copy is the
// current superset and is what core's own manifest parser already imports.
export type {
  PluginManifestSignature,
  SecretDeclaration,
  PluginManifest,
  PluginEntry,
  BakinConfig,
} from '@makinbakin/sdk/types'
