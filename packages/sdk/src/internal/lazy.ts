'use client'

/**
 * Lazy plugin-client loading — the SDK side.
 *
 * With declarative manifests (`contributes.nav/routes/slots`), the host no
 * longer imports every plugin's client bundle at boot. Instead it:
 *
 *   1. calls `configureLazyPlugins()` with an ownership index built from the
 *      manifest — which plugin fills which slot, which plugin owns which
 *      client route pattern;
 *   2. installs a loader via `setLazyPluginLoader()` that dynamic-imports a
 *      plugin's client.js on demand.
 *
 * Demand comes from two render-time surfaces:
 *   - `<Slot>` calls `requestSlotPlugins(name)` when it renders — if an
 *     owning plugin's client hasn't loaded yet, the loader fires and the
 *     slot re-renders when `registerPlugin` runs as the module's side effect;
 *   - the host's plugin route catch-all calls `requestRoutePlugins(pathname)`.
 *
 * Load state per plugin (`idle → loading → loaded | error`) lives in a
 * browser-global store (HMR-safe, same pattern as the client registry) so
 * `<Slot>` and the catch-all can render loading/error fallbacks and offer a
 * retry without the shell crashing on a failed import.
 */

import { matchRoutePattern } from '../register'

export type PluginLoadState = 'idle' | 'loading' | 'loaded' | 'error'

interface LazyPluginStore {
  /** slot name → pluginIds whose manifests declare it in `contributes.slots`. */
  ownersBySlot: Map<string, string[]>
  /** Manifest route patterns (`contributes.routes`) → owning pluginId. */
  routeOwners: Array<{ pattern: string; pluginId: string }>
  states: Map<string, PluginLoadState>
  /** Last load error message per plugin (set alongside state 'error'). */
  errors: Map<string, string>
  loader: ((pluginId: string) => void) | null
  version: number
  listeners: Set<() => void>
}

function getStore(): LazyPluginStore {
  const g = globalThis as Record<string, unknown>
  if (!g.__bakinLazyPluginStore) {
    g.__bakinLazyPluginStore = {
      ownersBySlot: new Map<string, string[]>(),
      routeOwners: [],
      states: new Map<string, PluginLoadState>(),
      errors: new Map<string, string>(),
      loader: null,
      version: 0,
      listeners: new Set<() => void>(),
    } satisfies LazyPluginStore
  }
  return g.__bakinLazyPluginStore as LazyPluginStore
}

function bump(): void {
  const store = getStore()
  store.version++
  for (const l of store.listeners) {
    try { l() } catch (err) { console.error('[bakin] lazy-plugin listener threw:', err) }
  }
}

export interface LazyPluginIndex {
  /** slot name → owning pluginIds (from each manifest's `contributes.slots`). */
  slotOwners: ReadonlyMap<string, string[]>
  /** Route pattern → owning pluginId (from `contributes.routes`). */
  routeOwners: ReadonlyArray<{ pattern: string; pluginId: string }>
}

/**
 * Install the manifest-derived ownership index. Called by the host on boot
 * and after every manifest refresh (hot-swap). Replaces the previous index;
 * load states are preserved.
 */
export function configureLazyPlugins(index: LazyPluginIndex): void {
  const store = getStore()
  store.ownersBySlot = new Map(index.slotOwners)
  store.routeOwners = [...index.routeOwners]
  bump()
}

/**
 * Install the demand loader. The host's loader dynamic-imports the plugin's
 * client bundle and reports progress through `setPluginLoadState`. Pass
 * `null` to uninstall (tests). Without a loader, demand requests are no-ops.
 */
export function setLazyPluginLoader(loader: ((pluginId: string) => void) | null): void {
  getStore().loader = loader
}

/** Report a plugin client's load progress. Host-side use. */
export function setPluginLoadState(pluginId: string, state: PluginLoadState, error?: string): void {
  const store = getStore()
  if (store.states.get(pluginId) === state && store.errors.get(pluginId) === error) return
  store.states.set(pluginId, state)
  if (state === 'error' && error) store.errors.set(pluginId, error)
  else store.errors.delete(pluginId)
  bump()
}

/** Current load state for a plugin client. Unknown plugins report 'idle'. */
export function getPluginLoadState(pluginId: string): PluginLoadState {
  return getStore().states.get(pluginId) ?? 'idle'
}

/** Last load error message for a plugin whose state is 'error', if any. */
export function getPluginLoadError(pluginId: string): string | undefined {
  return getStore().errors.get(pluginId)
}

/** Plugins whose manifests declare the given slot in `contributes.slots`. */
export function getSlotOwners(name: string): ReadonlyArray<string> {
  return getStore().ownersBySlot.get(name) ?? []
}

/**
 * Plugins whose manifest `contributes.routes` patterns match the pathname.
 */
export function getRouteOwners(pathname: string): ReadonlyArray<string> {
  const owners: string[] = []
  for (const { pattern, pluginId } of getStore().routeOwners) {
    if (matchRoutePattern(pattern, pathname) && !owners.includes(pluginId)) {
      owners.push(pluginId)
    }
  }
  return owners
}

function demand(pluginIds: ReadonlyArray<string>): void {
  const store = getStore()
  if (!store.loader) return
  for (const pluginId of pluginIds) {
    if ((store.states.get(pluginId) ?? 'idle') !== 'idle') continue
    store.loader(pluginId)
  }
}

/**
 * Ask the host to load every idle plugin that fills the named slot.
 * Called by `<Slot>` on render (via effect). Safe to call repeatedly —
 * non-idle plugins are skipped.
 */
export function requestSlotPlugins(name: string): void {
  demand(getSlotOwners(name))
}

/**
 * Ask the host to load every idle plugin whose manifest route patterns
 * match the pathname. Called by the host's plugin route catch-all.
 */
export function requestRoutePlugins(pathname: string): void {
  demand(getRouteOwners(pathname))
}

/**
 * Ask the host to load EVERY idle plugin in the ownership index (slot and
 * route owners alike). Cross-plugin surfaces — the ⌘K global search overlay
 * — need renderers from all plugins, not just the ones whose pages have
 * been visited. Safe to call repeatedly; non-idle plugins are skipped.
 */
export function requestAllPlugins(): void {
  const store = getStore()
  const ids = new Set<string>()
  for (const owners of store.ownersBySlot.values()) {
    for (const id of owners) ids.add(id)
  }
  for (const { pluginId } of store.routeOwners) ids.add(pluginId)
  demand([...ids])
}

/** Reset a failed plugin to idle and re-request it. Used by error fallbacks. */
export function retryPluginLoad(pluginId: string): void {
  const store = getStore()
  if (store.states.get(pluginId) !== 'error') return
  store.states.set(pluginId, 'idle')
  store.errors.delete(pluginId)
  bump()
  demand([pluginId])
}

/** Monotonic version for useSyncExternalStore consumers. */
export function getLazyPluginsVersion(): number {
  return getStore().version
}

/** Subscribe to lazy-plugin store mutations. Returns an unsubscribe fn. */
export function subscribeLazyPlugins(listener: () => void): () => void {
  const store = getStore()
  store.listeners.add(listener)
  return () => { store.listeners.delete(listener) }
}
