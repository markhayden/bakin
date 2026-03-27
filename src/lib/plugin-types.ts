/**
 * Plugin system type definitions for Beacon.
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
export interface ExecToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown> // Zod schema shape
  handler: (params: Record<string, unknown>, agent: string) => Promise<ExecToolResult>
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
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------
export interface MCPlugin {
  id: string
  name: string
  version: string
  activate(ctx: PluginContext): void | Promise<void>
  navItems?: NavItem[]
  contentFiles?: ContentFile[]
}

// ---------------------------------------------------------------------------
// Plugin Manifest (beacon-plugin.json)
// ---------------------------------------------------------------------------
export interface PluginManifest {
  id: string
  name: string
  version: string
  beacon: string
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

export interface MCConfig {
  plugins: PluginEntry[]
  theme?: Record<string, string>
  storage?: {
    contentDir?: string
  }
}
