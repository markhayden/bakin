/**
 * Source registry — in-memory index of every workflow definition the system
 * knows about, keyed by id, with provenance (plugin vs user).
 *
 * User copies always shadow plugin copies with the same id. Two different
 * plugins registering the same id is a hard error; a plugin may overwrite
 * its own registration (hot reload during activate()).
 *
 * Backed by globalThis so a single process keeps one registry instance
 * even when this module is reached from multiple entry points (same
 * pattern as src/core/sse.ts and src/core/openclaw-client.ts).
 */
import type { WorkflowDefinition } from '../types'

export type DefinitionSource = 'plugin' | 'user'

export interface SourceEntry {
  id: string
  definition: WorkflowDefinition
  source: DefinitionSource
  /** Present when source === 'plugin' */
  pluginId?: string
}

interface PluginEntry {
  pluginId: string
  definition: WorkflowDefinition
}

interface SourceStore {
  plugin: Map<string, PluginEntry>
  user: Map<string, WorkflowDefinition>
}

declare global {
  var __bakinWorkflowSources: SourceStore | undefined
}

function getStore(): SourceStore {
  if (!globalThis.__bakinWorkflowSources) {
    globalThis.__bakinWorkflowSources = {
      plugin: new Map(),
      user: new Map(),
    }
  }
  return globalThis.__bakinWorkflowSources
}

/**
 * Register a plugin-owned workflow definition.
 * Throws if a *different* plugin has already registered the same id.
 * The same plugin is allowed to overwrite its own registration.
 */
export function registerPluginDefinition(
  pluginId: string,
  id: string,
  definition: WorkflowDefinition,
): void {
  const store = getStore()
  const existing = store.plugin.get(id)
  if (existing && existing.pluginId !== pluginId) {
    throw new Error(
      `Workflow id "${id}" is already registered by plugin "${existing.pluginId}" ` +
        `(attempted by "${pluginId}")`,
    )
  }
  store.plugin.set(id, { pluginId, definition })
}

/**
 * Remove every plugin-owned entry for the given pluginId (used when a plugin
 * is deactivated or reloaded).
 */
export function unregisterPluginDefinitions(pluginId: string): void {
  const store = getStore()
  for (const [id, entry] of store.plugin) {
    if (entry.pluginId === pluginId) store.plugin.delete(id)
  }
}

/**
 * Register a user-owned workflow definition (from ~/.bakin/workflows/definitions/).
 * User registration silently shadows any plugin-owned copy with the same id.
 */
export function registerUserDefinition(id: string, definition: WorkflowDefinition): void {
  getStore().user.set(id, definition)
}

export function unregisterUserDefinition(id: string): void {
  getStore().user.delete(id)
}

/**
 * Fetch the effective definition for an id. User wins over plugin.
 */
export function getDefinition(id: string): SourceEntry | undefined {
  const store = getStore()
  const userDef = store.user.get(id)
  if (userDef) {
    return { id, definition: userDef, source: 'user' }
  }
  const pluginEntry = store.plugin.get(id)
  if (pluginEntry) {
    return {
      id,
      definition: pluginEntry.definition,
      source: 'plugin',
      pluginId: pluginEntry.pluginId,
    }
  }
  return undefined
}

/**
 * List every id known to the registry, resolved through the user-wins rule.
 */
export function listAll(): SourceEntry[] {
  const store = getStore()
  const ids = new Set<string>([...store.plugin.keys(), ...store.user.keys()])
  const out: SourceEntry[] = []
  for (const id of ids) {
    const entry = getDefinition(id)
    if (entry) out.push(entry)
  }
  return out
}

/**
 * True iff the id resolves to a plugin-owned definition with no user shadow.
 * Plugin-owned ids are read-only in the UI — CRUD routes refuse writes on them.
 */
export function isReadOnly(id: string): boolean {
  const store = getStore()
  return !store.user.has(id) && store.plugin.has(id)
}

export function getSource(id: string): DefinitionSource | undefined {
  return getDefinition(id)?.source
}

/**
 * Test-only helper: clear all registry state. Production code must not call
 * this — plugin hot-reload uses unregisterPluginDefinitions instead.
 */
export function clearSourceRegistry(): void {
  const store = getStore()
  store.plugin.clear()
  store.user.clear()
}
