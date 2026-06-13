/**
 * Execution tool registry.
 *
 * Core scripts register here on import. Plugins register via
 * PluginContext.registerExecTool() which calls addExecTool().
 * The MCP server iterates over getAllExecTools() to register them.
 */
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { ExecToolDefinition, PluginToolContext } from '@bakin/core/plugin-types'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { getContentDir } from '../content-dir'
import { appendAudit } from '../audit'
import { MarkdownStorageAdapter } from '../../lib/storage/markdown-adapter'
import { ScopedPluginStorageAdapter } from '@bakin/core/storage/scoped-plugin-storage'
import { BakinEventBus } from '../../lib/events/event-bus'
import { getAppServices } from '../app-services'
import { buildSearchAPI } from '../search-registry'
import {
  createPluginAssetsAPI,
  createPluginRuntimeFacade,
  createPluginTaskService,
} from '../../lib/plugin-context-services'
import { wrapPluginContextPermissions } from '../../lib/plugin-permissions'

// ---------------------------------------------------------------------------
// Registry state
//
// Backed by globalThis so every reach into this module shares one registry.
// Without this, plugins activated at boot are invisible to later code paths
// (the doctor's skill-sync check, runtime-loaded user plugins).
// ---------------------------------------------------------------------------

const execTools: Map<string, ExecToolDefinition> =
  (globalThis as any).__bakinExecTools ??= new Map<string, ExecToolDefinition>()

type RuntimePluginState = {
  source?: 'core' | 'user'
  manifest?: { permissions?: readonly string[] }
}

function getRuntimePluginState(pluginId: string): RuntimePluginState | undefined {
  const registry = (globalThis as {
    __bakinPluginRegistry?: {
      getPluginState?: (id: string) => RuntimePluginState | undefined
    }
  }).__bakinPluginRegistry
  return registry?.getPluginState?.(pluginId)
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function addExecTool(tool: ExecToolDefinition): void {
  const existing = execTools.get(tool.name)
  if (existing) {
    const owner = existing.source ? ` by ${existing.source}` : ''
    throw new Error(`Exec tool "${tool.name}" is already registered${owner}`)
  }
  execTools.set(tool.name, tool)
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

/**
 * Remove every exec tool whose name starts with `bakin_exec_<pluginId>_`.
 * Used by `bakin plugins remove` (#119) to tear down a plugin's MCP tools
 * before deleting its files. Returns the number removed.
 */
export function removeExecToolsByPlugin(pluginId: string): number {
  const prefix = `bakin_exec_${pluginId}_`
  const pluginSource = `plugin:${pluginId}`
  let removed = 0
  for (const [name, tool] of [...execTools.entries()]) {
    if (name.startsWith(prefix) || tool.source === pluginSource) {
      execTools.delete(name)
      removed++
    }
  }
  return removed
}

// ---------------------------------------------------------------------------
// Plugin tool context
// ---------------------------------------------------------------------------

/**
 * Build a PluginToolContext for a registered exec tool. Called at runtime from
 * the MCP handler — safe against the plugin-registry ↔ registry circular by
 * then, since both modules are fully evaluated before any tool handler runs.
 */
export function getToolContext(toolName: string): PluginToolContext | undefined {
  const tool = execTools.get(toolName)
  if (!tool?.source) return undefined
  const pluginId = tool.source.startsWith('plugin:') ? tool.source.slice(7) : tool.source

  const hookReg = getHookRegistry()
  const services = getAppServices()
  const contentDir = getContentDir()
  const broadcastFn = (globalThis as { __bakinBroadcast?: (data: Record<string, unknown>) => void }).__bakinBroadcast ?? (() => {})
  const assets = createPluginAssetsAPI()
  const storage = pluginId === 'core'
    ? new MarkdownStorageAdapter(contentDir)
    : new ScopedPluginStorageAdapter(contentDir, pluginId)

  const state = getRuntimePluginState(pluginId)
  const ctx: PluginToolContext = {
    storage,
    events: new BakinEventBus(broadcastFn),
    pluginId,
    runtime: createPluginRuntimeFacade(services.runtime),
    tasks: createPluginTaskService(services.tasks),
    assets,
    search: buildSearchAPI(pluginId, { skipFileBackedWiring: true }),
    hooks: {
      register: (name: string, handler: (data: any) => any, metadata) => hookReg.register(name, handler, { metadata }),
      call: <T>(name: string, data: T) => hookReg.call<T>(name, data),
      callAll: (name: string, data: Record<string, unknown>) => hookReg.callAll(name, data),
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
      const p = join(contentDir, 'plugin-settings', `${pluginId}.json`)
      try { if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8')) } catch { /* best-effort */ }
      return {}
    }) as PluginToolContext['getSettings'],
  }

  return wrapPluginContextPermissions(ctx, {
    pluginId,
    source: state?.source ?? (pluginId === 'core' ? 'core' : 'user'),
    manifestPermissions: state?.manifest?.permissions ?? [],
  })
}

// ---------------------------------------------------------------------------
// Core tool imports
//
// Self-registering tool modules are imported from mcp-server.ts, not here:
// each tool file calls addExecTool() at module scope, which requires this
// module's execTools map to be initialized first.
//
// To add a new core tool: create the file, then add an import to
// src/core/mcp-server.ts alongside the existing tool imports.
// ---------------------------------------------------------------------------
