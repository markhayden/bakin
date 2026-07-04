/**
 * Source registry — in-memory index of every workflow definition the system
 * knows about, keyed by id, with provenance (plugin / agent-package / user).
 *
 * Precedence (highest wins, last loses):
 *   user                — files in ~/.bakin/workflows/definitions/
 *   agent-package       — workflows shipped by an installed agent-package
 *                         (kind: "agent" or "workflow-pack"), loaded at boot
 *                         from the lockfile
 *   plugin              — workflows shipped via plugin defaults/, registered
 *                         during plugin activation
 *
 * Two different plugins registering the same id is a hard error; the same
 * plugin may overwrite its own registration (hot reload during activate()).
 * Symmetrically: two different agent-packages cannot register the same id;
 * the same package may re-register on update.
 *
 * Backed by globalThis so a single process keeps one registry instance
 * even when this module is reached from multiple entry points.
 */
import type { WorkflowDefinition } from './definition-types'

export type DefinitionSource = 'plugin' | 'agent-package' | 'user'

export interface SourceEntry {
  id: string
  definition: WorkflowDefinition
  source: DefinitionSource
  /** Present when source === 'plugin' */
  pluginId?: string
  /** Present when source === 'agent-package' */
  packageId?: string
}

export interface ShadowedSource {
  source: 'plugin' | 'agent-package'
  pluginId?: string
  packageId?: string
}

interface PluginEntry {
  pluginId: string
  definition: WorkflowDefinition
}

interface AgentPackageEntry {
  packageId: string
  definition: WorkflowDefinition
}

interface SourceStore {
  plugin: Map<string, PluginEntry>
  agentPackage: Map<string, AgentPackageEntry>
  user: Map<string, WorkflowDefinition>
}

declare global {
  var __bakinWorkflowSources: SourceStore | undefined
}

function getStore(): SourceStore {
  if (!globalThis.__bakinWorkflowSources) {
    globalThis.__bakinWorkflowSources = {
      plugin: new Map(),
      agentPackage: new Map(),
      user: new Map(),
    }
  }
  // Migration: callers from earlier versions of this module may have set
  // a store with only `plugin` + `user`. Backfill the third map so we
  // never observe `undefined` here.
  if (!globalThis.__bakinWorkflowSources.agentPackage) {
    globalThis.__bakinWorkflowSources.agentPackage = new Map()
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
 * Register an agent-package-owned workflow definition.
 * Symmetric to `registerPluginDefinition`: throws if a *different* package
 * has already registered the same id; the same package may overwrite its
 * own registration (e.g. when the user runs `bakin agents sync`).
 */
export function registerAgentPackageDefinition(
  packageId: string,
  id: string,
  definition: WorkflowDefinition,
): void {
  const store = getStore()
  const existing = store.agentPackage.get(id)
  if (existing && existing.packageId !== packageId) {
    throw new Error(
      `Workflow id "${id}" is already registered by agent-package "${existing.packageId}" ` +
        `(attempted by "${packageId}")`,
    )
  }
  store.agentPackage.set(id, { packageId, definition })
}

/**
 * Remove every agent-package-owned entry for the given packageId. Called by
 * the uninstaller when a package is removed; lockfile entry deletion is the
 * only signal needed — the source registry stops resolving the package's
 * contributions immediately, no Bakin restart required.
 */
export function unregisterAgentPackageDefinitions(packageId: string): void {
  const store = getStore()
  for (const [id, entry] of store.agentPackage) {
    if (entry.packageId === packageId) store.agentPackage.delete(id)
  }
}

/**
 * Register a user-owned workflow definition (from ~/.bakin/workflows/definitions/).
 * User registration silently shadows any plugin- or agent-package-owned copy
 * with the same id.
 */
export function registerUserDefinition(id: string, definition: WorkflowDefinition): void {
  getStore().user.set(id, definition)
}

export function unregisterUserDefinition(id: string): void {
  getStore().user.delete(id)
}

/**
 * Fetch the effective definition for an id under the precedence rule:
 *   user > agent-package > plugin
 *
 * The agent-package tier sits between user and plugin so a freshly installed
 * package can override a plugin-shipped workflow without the user having to
 * shadow it manually, while user files still always win.
 */
export function getDefinition(id: string): SourceEntry | undefined {
  const store = getStore()
  const userDef = store.user.get(id)
  if (userDef) {
    return { id, definition: userDef, source: 'user' }
  }
  const pkgEntry = store.agentPackage.get(id)
  if (pkgEntry) {
    return {
      id,
      definition: pkgEntry.definition,
      source: 'agent-package',
      packageId: pkgEntry.packageId,
    }
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

export function getManagedDefinition(id: string): SourceEntry | undefined {
  const store = getStore()
  const pkgEntry = store.agentPackage.get(id)
  if (pkgEntry) {
    return {
      id,
      definition: pkgEntry.definition,
      source: 'agent-package',
      packageId: pkgEntry.packageId,
    }
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

export function getShadowedSource(id: string): ShadowedSource | undefined {
  const store = getStore()
  const pkgEntry = store.agentPackage.get(id)
  if (pkgEntry) return { source: 'agent-package', packageId: pkgEntry.packageId }
  const pluginEntry = store.plugin.get(id)
  if (pluginEntry) return { source: 'plugin', pluginId: pluginEntry.pluginId }
  return undefined
}

/**
 * List every id known to the registry, resolved through the precedence rule.
 */
export function listAll(): SourceEntry[] {
  const store = getStore()
  const ids = new Set<string>([
    ...store.plugin.keys(),
    ...store.agentPackage.keys(),
    ...store.user.keys(),
  ])
  const out: SourceEntry[] = []
  for (const id of ids) {
    const entry = getDefinition(id)
    if (entry) out.push(entry)
  }
  return out
}

/**
 * True iff the id resolves to a plugin- or agent-package-owned definition
 * with no user shadow. Read-only ids refuse writes from the UI's CRUD routes.
 */
export function isReadOnly(id: string): boolean {
  const store = getStore()
  if (store.user.has(id)) return false
  return store.agentPackage.has(id) || store.plugin.has(id)
}

export function getSource(id: string): DefinitionSource | undefined {
  return getDefinition(id)?.source
}

/**
 * Test-only helper: clear all registry state. Production code must not call
 * this — plugin hot-reload uses unregisterPluginDefinitions and agent-package
 * removal uses unregisterAgentPackageDefinitions instead.
 */
export function clearSourceRegistry(): void {
  const store = getStore()
  store.plugin.clear()
  store.agentPackage.clear()
  store.user.clear()
}
