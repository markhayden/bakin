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
}

export interface APIRoute {
  path: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
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
