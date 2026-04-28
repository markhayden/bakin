'use client'

/**
 * `registerPlugin` — single-call plugin contribution API.
 *
 * Consolidates what each plugin's client.tsx does into one call:
 *   registerPlugin({
 *     id: 'my-plugin',
 *     navItems: [ ... ],
 *     slots: { 'asset-preview': AssetRenderer, 'page:/foo': MyPage },
 *   })
 *
 * Companion `unregisterPlugin` tears everything back down — used by the
 * v2 dev-mode plugin hot-swap path and by any consumer that needs a clean
 * reload. Plugin-local registries (e.g., workflows' node renderers and
 * source definitions) hook into the teardown via `registerPluginCleanup`.
 *
 * Shell subscribes via `subscribeRegistry` / `getRegistryVersion` so the
 * nav + slot trees re-render when plugins come or go at runtime.
 */

import type { ComponentType } from 'react'
import { registerSlot, clearSlotsOwnedBy } from './slots'

interface NavItem {
  id: string
  label: string
  icon?: string
  href?: string
  order?: number
  alwaysExpanded?: boolean
  children?: NavItem[]
}

interface PluginRegistration {
  id: string
  navItems?: NavItem[]
  /**
   * Map of slot name → component. Registered with the default order (100).
   * Components are typed as `ComponentType<any>` because different slots
   * accept different prop shapes (e.g. `page:/team/[id]` takes `agentId`,
   * `asset-preview` takes `asset`) and `Slot` threads props through unchanged.
   * For fine-grained ordering, call `registerSlot(name, Component, order, id)`
   * directly from the plugin's client.tsx alongside registerPlugin.
   */
  slots?: Record<string, ComponentType<any>>
}

interface ClientRegistry {
  navByPlugin: Map<string, NavItem[]>
  cleanupByPlugin: Map<string, Array<() => void>>
  version: number
  listeners: Set<() => void>
}

function getRegistry(): ClientRegistry {
  const g = globalThis as Record<string, unknown>
  if (!g.__bakinClientRegistry) {
    g.__bakinClientRegistry = {
      navByPlugin: new Map<string, NavItem[]>(),
      cleanupByPlugin: new Map<string, Array<() => void>>(),
      version: 0,
      listeners: new Set<() => void>(),
    } as ClientRegistry
  }
  return g.__bakinClientRegistry as ClientRegistry
}

function bumpVersion(): void {
  const registry = getRegistry()
  registry.version++
  for (const l of registry.listeners) {
    try { l() } catch (err) { console.error('[bakin] registry listener threw:', err) }
  }
}

/**
 * Register everything a plugin contributes in one call. Invoked at the top
 * of the plugin's client.tsx (or on dynamic import by the host's PluginHost).
 */
export function registerPlugin(reg: PluginRegistration): void {
  const registry = getRegistry()

  if (reg.navItems?.length) {
    registry.navByPlugin.set(reg.id, reg.navItems)
  }

  if (reg.slots) {
    for (const [slotName, component] of Object.entries(reg.slots)) {
      registerSlot(slotName, component as ComponentType<Record<string, unknown>>, 100, reg.id)
    }
  }

  bumpVersion()
}

/**
 * Remove every contribution a plugin made — nav items, owned slot entries,
 * and any plugin-local registry cleanup functions it enrolled via
 * `registerPluginCleanup`. Idempotent. Used by the v2 dev-mode hot-swap
 * path before re-importing the plugin's client bundle.
 */
export function unregisterPlugin(id: string): void {
  const registry = getRegistry()

  const cleanups = registry.cleanupByPlugin.get(id)
  if (cleanups) {
    for (const fn of cleanups) {
      try { fn() } catch (err) { console.error(`[bakin] cleanup fn for ${id} threw:`, err) }
    }
    registry.cleanupByPlugin.delete(id)
  }

  registry.navByPlugin.delete(id)
  clearSlotsOwnedBy(id)

  bumpVersion()
}

/**
 * Enroll a teardown function for the given plugin id. Runs when
 * `unregisterPlugin(id)` is called. Plugins that maintain their own
 * client-side registries (workflows' node renderers, source definitions)
 * use this to hook into the unified teardown path.
 */
export function registerPluginCleanup(id: string, fn: () => void): void {
  const registry = getRegistry()
  const list = registry.cleanupByPlugin.get(id) ?? []
  list.push(fn)
  registry.cleanupByPlugin.set(id, list)
}

/**
 * Monotonic counter bumped on every register / unregister. Used with
 * React's `useSyncExternalStore` (via `subscribeRegistry`) so the shell
 * re-renders nav + slots when plugins come or go at runtime.
 */
export function getRegistryVersion(): number {
  return getRegistry().version
}

/**
 * Subscribe to registry mutations. Returns an unsubscribe function.
 */
export function subscribeRegistry(listener: () => void): () => void {
  const registry = getRegistry()
  registry.listeners.add(listener)
  return () => { registry.listeners.delete(listener) }
}

/**
 * All nav items from all registered plugins, sorted by `order` (default 100).
 * The shell's sidebar reads this at render time.
 */
export function getAllNavItems(): NavItem[] {
  const registry = getRegistry()
  const items: NavItem[] = []
  for (const navItems of registry.navByPlugin.values()) {
    items.push(...navItems)
  }
  return items.sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

/**
 * Nav items for a specific plugin. Returned as a readonly copy.
 */
export function getPluginNavItems(pluginId: string): ReadonlyArray<NavItem> {
  return getRegistry().navByPlugin.get(pluginId) ?? []
}

export type { NavItem, PluginRegistration }
