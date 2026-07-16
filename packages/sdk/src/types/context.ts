// Part of the @makinbakin/sdk/types contract — see ./index.ts for the
// module's self-containment + two-tier rationale.
import type { ZodRawShape } from 'zod'
import type { ContractStability, ContractVisibility, DocsExample, SchemaLike } from './primitives'
import type { HealthCheckRegistrationInput, HealthRepairActionDefinition } from './health'
import type { ContentFile, ExecToolDefinition, NavItem, PluginNodeTypeInput, PluginNotificationChannelInput, PluginSettingsSchema, SkillDefinition, UISlotRegistration, WorkflowDefinitionInput } from './registration'
import type { AgentRuntimeAdapter } from './runtime'
import type { AssetsAPI, SearchAPI, TaskService } from './services'

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
  list(path?: string): string[]
  remove(path: string): void
  rename(from: string, to: string): void
  stat(path: string): StorageStat | null
  readJson<T = unknown>(path: string): T | null
  writeJson(path: string, value: unknown): void
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
  /** Register a component for a named slot (legacy — prefer `<Slot>` from `/slots`). */
  registerSlot(registration: UISlotRegistration): void
  /** Register an MCP exec tool agents can call. */
  registerExecTool<Shape extends ZodRawShape>(tool: ExecToolDefinition<Shape>): void
  /** Register a runtime skill (capability definition). */
  registerSkill(skill: SkillDefinition): void
  /** Register a workflow definition (or template) the plugin ships. */
  registerWorkflow(definition: WorkflowDefinitionInput, opts?: { readOnly?: boolean }): void
  /** Register a custom workflow node type (step kind). */
  registerNodeType<T = unknown>(def: PluginNodeTypeInput<T>): string
  /** Register a notification channel the runtime can deliver to. */
  registerNotificationChannel(def: PluginNotificationChannelInput): string
  /** Register an owner-scoped health check that runs during doctor sweeps. */
  registerHealthCheck(def: HealthCheckRegistrationInput): string
  /** Register an owner-scoped repair action referenced by health incidents. */
  registerHealthRepairAction(def: HealthRepairActionDefinition): string
  /** Subscribe to file globs for live updates (Chokidar-based). */
  watchFiles(patterns: string[]): void
  /** Read this plugin's persisted settings. */
  getSettings<T = Record<string, unknown>>(): T
  /** Patch this plugin's persisted settings. */
  updateSettings(patch: Record<string, unknown>): void
  /** Activity feed + audit log API. */
  activity: ActivityAPI
  /** Plugin-scoped structured logger. Always provided by the host. */
  log: PluginLogger
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
  /**
   * Declarative HTTP routes, registered before `activate()` runs. Author
   * entries with `defineRoute()`; compose with `definePlugin()` so per-route
   * inference survives. The route type is the declarative-generic `APIRoute`
   * from `@makinbakin/sdk/routing`.
   *
   * Ctx is `any` here for the same documented reason activate()'s ctx is:
   * the SDK and core context tiers are deliberately distinct, and this leaf
   * type module must not import `../routing` (it reaches into @bakin/core
   * and closes a package import cycle). Handler ctx typing comes from
   * `defineRoute()` at authoring time, not from this field.
   */
  routes?: ReadonlyArray<import('./api-route').APIRoute<any, any, any, any>>
  /** Convenience: nav items to auto-register at activation. */
  navItems?: NavItem[]
  /** Convenience: static content files declared at construction. */
  contentFiles?: ContentFile[]
}

// ---------------------------------------------------------------------------
// Misc public domain types used by existing plugins
// ---------------------------------------------------------------------------
