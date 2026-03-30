/**
 * Execution tool registry.
 *
 * Core scripts register here on import. Plugins register via
 * PluginContext.registerExecTool() which calls addExecTool().
 * The MCP server iterates over getAllExecTools() to register them.
 */
import type { ExecToolDefinition, ExecToolResult, PluginToolContext, StorageAdapter, EventBus } from '../../src/lib/plugin-types'

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

const execTools = new Map<string, ExecToolDefinition>()

/** Per-tool call stats for health dashboard */
const toolStats = new Map<string, { calls: number; lastUsed: string | null }>()

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function addExecTool(tool: ExecToolDefinition): void {
  if (execTools.has(tool.name)) {
    console.warn(`Exec tool "${tool.name}" already registered — overriding`)
  }
  execTools.set(tool.name, tool)
  if (!toolStats.has(tool.name)) {
    toolStats.set(tool.name, { calls: 0, lastUsed: null })
  }
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function getAllExecTools(): ExecToolDefinition[] {
  return [...execTools.values()]
}

export function getExecTool(name: string): ExecToolDefinition | undefined {
  return execTools.get(name)
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function recordExecToolCall(name: string): void {
  const stat = toolStats.get(name)
  if (stat) {
    stat.calls++
    stat.lastUsed = new Date().toISOString()
  }
}

export interface ExecToolStat {
  name: string
  source: string
  calls: number
  lastUsed: string | null
}

export function getExecToolStats(): ExecToolStat[] {
  return [...execTools.entries()].map(([name, tool]) => {
    const stat = toolStats.get(name) || { calls: 0, lastUsed: null }
    return {
      name,
      source: tool.source || 'core',
      calls: stat.calls,
      lastUsed: stat.lastUsed,
    }
  })
}

// ---------------------------------------------------------------------------
// Plugin tool context
// ---------------------------------------------------------------------------

/**
 * Build a PluginToolContext for a registered tool.
 * Lazily imports getHookRegistry to avoid circular init.
 */
/**
 * Build a PluginToolContext for a registered exec tool.
 * Only called at runtime from the MCP server (never bundled by Next.js).
 */
export function getToolContext(toolName: string): PluginToolContext | undefined {
  const tool = execTools.get(toolName)
  if (!tool?.source) return undefined
  const pluginId = tool.source.startsWith('plugin:') ? tool.source.slice(7) : tool.source

  // Runtime-only imports hidden behind eval() to prevent Next.js webpack
  // from tracing them at bundle time. getToolContext is only called from
  // the custom Node server's MCP handler, never from Next.js routes.
  // eslint-disable-next-line no-eval
  const _require = eval('require') as NodeRequire
  const { getHookRegistry } = _require('../../src/lib/plugin-registry') as {
    getHookRegistry: () => { register: (name: string, handler: (data: any) => any) => () => void; has: (name: string) => boolean; invoke: <R>(name: string, data: unknown) => Promise<R | undefined> }
  }
  const { getContentDir } = _require('../../src/core/content-dir') as { getContentDir: () => string }
  const { appendAudit } = _require('../../src/core/audit') as { appendAudit: (...args: unknown[]) => void }
  const { MarkdownStorageAdapter } = _require('../../src/lib/storage/markdown-adapter') as { MarkdownStorageAdapter: new (dir: string) => StorageAdapter }
  const { BakinEventBus } = _require('../../src/lib/events/event-bus') as { BakinEventBus: new (broadcast: (data: Record<string, unknown>) => void) => EventBus }

  const hookReg = getHookRegistry()
  const contentDir = getContentDir()
  const broadcastFn = (globalThis as any).__bakinBroadcast || (() => {})

  return {
    storage: new MarkdownStorageAdapter(contentDir),
    events: new BakinEventBus(broadcastFn),
    pluginId,
    hooks: {
      register: (name: string, handler: (data: any) => any) => hookReg.register(name, handler),
      has: (name: string) => hookReg.has(name),
      invoke: <R>(name: string, data: unknown) => hookReg.invoke<R>(name, data),
    },
    activity: {
      log: (agent: string, message: string, opts?: { taskId?: string; category?: string }) => {
        broadcastFn({ type: 'activity', pluginId, agent, message, ts: new Date().toISOString(), ...opts })
      },
      audit: (event: string, agent: string, data?: Record<string, unknown>) => {
        appendAudit(contentDir, `${pluginId}.${event}`, agent, data)
      },
    },
    getSettings: (() => {
      const { join } = require('path')
      const { existsSync, readFileSync } = require('fs')
      const p = join(contentDir, 'plugin-settings', `${pluginId}.json`)
      try { if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8')) } catch {}
      return {}
    }) as PluginToolContext['getSettings'],
  }
}

// ---------------------------------------------------------------------------
// Core tool imports
//
// Self-registering modules are imported from mcp-server.ts (not here)
// to avoid circular initialization. Each tool file calls addExecTool()
// at module scope, which requires execTools to be initialized first.
//
// To add a new core tool: create the file, then add an import in
// src/core/mcp-server.ts alongside the existing tool imports.
// ---------------------------------------------------------------------------
