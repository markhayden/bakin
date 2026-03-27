/**
 * Execution tool registry.
 *
 * Core scripts register here on import. Plugins register via
 * PluginContext.registerExecTool() which calls addExecTool().
 * The MCP server iterates over getAllExecTools() to register them.
 */
import type { ExecToolDefinition, ExecToolResult } from '../../src/lib/plugin-types'

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
// Core tool imports
//
// Self-registering modules are imported from mcp-server.ts (not here)
// to avoid circular initialization. Each tool file calls addExecTool()
// at module scope, which requires execTools to be initialized first.
//
// To add a new core tool: create the file, then add an import in
// src/core/mcp-server.ts alongside the existing tool imports.
// ---------------------------------------------------------------------------
