// Part of the @makinbakin/sdk/types contract — see ./index.ts for the
// module's self-containment + two-tier rationale.
import type { ComponentType } from 'react'
import type { z, ZodRawShape } from 'zod'
import type { ActivityAPI, EventBus, HookAPI, StorageAdapter } from './context'
import type { SchemaLike } from './primitives'
import type { AgentRuntimeAdapter } from './runtime'
import type { AssetsAPI, SearchAPI, TaskService } from './services'
import type { ActivityClass } from './api-route'

/** Visual tone for a {@link NavBadge}. Maps to a fixed palette in the sidebar.
 *  Ordered by severity: `error` (red) is the most urgent and wins rollups. */
export type NavBadgeTone = 'error' | 'attention' | 'info' | 'success'

/**
 * Runtime badge attached to a nav item. Both fields are optional:
 *   - `count` present → renders as a small pill (clamped at `99+`).
 *   - `count` omitted but object present → renders as a small dot.
 *   - `count: 0` or passing `null` to `setNavBadge` clears the badge.
 * `tone` defaults to `'attention'`.
 */
export interface NavBadge {
  count?: number
  tone?: NavBadgeTone
}

/** Host-defined sidebar section a top-level plugin nav item may join. */
export type NavSection = 'plan-and-automate' | 'create' | 'operations'

/** Sidebar navigation item registered by a plugin via `ctx.registerNav()`. */
export interface NavItem {
  /** Unique nav item id (used for active-state tracking and badge keying). */
  id: string
  /** Display label in the sidebar. */
  label: string
  /** Lucide icon name (e.g. "tasks", "calendar"). */
  icon?: string
  /** Target route path. */
  href?: string
  /** Sort order within the parent group. Lower renders first. */
  order?: number
  /** Optional nested nav items for groups. */
  children?: NavItem[]
  /** Top-level destination. Omit to render under Mix-ins. */
  section?: NavSection
  /**
   * Initial badge state. Runtime updates flow through `setNavBadge` — the
   * rendered badge for an item is `runtimeRegistry.get(id) ?? item.badge`.
   * Most plugins leave this undefined and set badges purely at runtime.
   */
  badge?: NavBadge
}

// The legacy non-generic `APIRoute` (registered via the deleted
// `ctx.registerRoute`) is gone — the ONE public route type is the
// declarative-generic `APIRoute<C, P, Q, B>` re-exported from
// `@makinbakin/sdk` root and `@makinbakin/sdk/routing` (audit 2026-07 H3).

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
export interface ExecToolDefinition<Shape extends ZodRawShape = ZodRawShape> {
  /** Tool name. Convention: `bakin_exec_{pluginId}_{action}`. */
  name: string
  /** Description shown to the agent (used for tool selection). */
  description: string
  /** Optional UI label for the activity feed. */
  label?: string
  /** If true, this tool can fire multiple times in a single agent turn. */
  activityDuplicate?: boolean
  /** Usage classification propagated by every generic exec-tool transport. Defaults to foreground user activity. */
  activityClass?: ActivityClass
  /** Zod raw shape describing the tool's parameters. */
  parameters: Shape
  /** Handler. Params are inferred from `parameters` — declare once, get typed params. */
  handler: (params: z.infer<z.ZodObject<Shape>>, agent: string, ctx?: PluginToolContext) => Promise<ExecToolResult>
  /** Optional source-file path for generated docs. */
  source?: string
}

/** Runtime skill definition registered via `ctx.registerSkill()`. */
export interface SkillDefinition {
  name: string
  instructions: string
  output_schema?: Record<string, unknown>
  source?: string
  /** Absolute source markdown file path when the skill was loaded from a managed package/plugin file. */
  sourcePath?: string
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
/**
 * A running workflow instance (permissive view of the wire shape produced by
 * the workflows plugin). The key field is `instanceId` — NOT `id`. The full
 * typed shape (stepStates, history, …) is internal to the workflows plugin;
 * this published view types the commonly-read fields and stays open via the
 * index signature.
 */
export interface WorkflowInstance {
  instanceId: string
  workflowId?: string
  taskId?: string
  currentStepId?: string
  status?: string
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

/** Alias for WorkflowDefinition when used as a reusable template. */
export type WorkflowTemplate = WorkflowDefinition

/**
 * How one search hit of a given content type renders in the global (⌘K)
 * search overlay. Plain DATA mapping — the overlay owns row layout,
 * keyboard focus, and debug-badge placement uniformly.
 */
export interface SearchHitDescriptor {
  title: string
  subtitle?: string
  /** Deep link for Enter/click. `null` = renderable but non-navigable. */
  href: string | null
  thumbnailUrl?: string
  /** Lucide icon name fallback when there is no thumbnail. */
  icon?: string
  /** Small meta line (type · agent · date) shown under the subtitle. */
  meta?: string
}

/** Minimal hit shape passed to renderers (matches useSearch's SearchResult). */
export interface SearchHitInput {
  id: string
  table: string
  score: number
  fields: Record<string, unknown>
}

export type SearchHitRenderer = (hit: SearchHitInput) => SearchHitDescriptor
