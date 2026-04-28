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
   * Route path pattern -> page component. Patterns support exact paths and
   * dynamic segments in either `:id`, `[id]`, or `$id` form.
   */
  routes?: Record<string, ComponentType<any>>
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

interface ClientRouteEntry {
  path: string
  component: ComponentType<Record<string, unknown>>
  owner: string
}

interface ClientRegistry {
  navByPlugin: Map<string, NavItem[]>
  routesByPlugin: Map<string, ClientRouteEntry[]>
  cleanupByPlugin: Map<string, Array<() => void>>
  version: number
  listeners: Set<() => void>
}

function getRegistry(): ClientRegistry {
  const g = globalThis as Record<string, unknown>
  if (!g.__bakinClientRegistry) {
    g.__bakinClientRegistry = {
      navByPlugin: new Map<string, NavItem[]>(),
      routesByPlugin: new Map<string, ClientRouteEntry[]>(),
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

  if (reg.routes) {
    registry.routesByPlugin.set(reg.id, Object.entries(reg.routes).map(([path, component]) => ({
      path,
      component: component as ComponentType<Record<string, unknown>>,
      owner: reg.id,
    })))
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
  registry.routesByPlugin.delete(id)
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

function normalizePattern(pattern: string): string[] {
  return pattern.split('/').filter(Boolean)
}

function matchRoutePattern(pattern: string, pathname: string): { params: Record<string, string>; score: number } | null {
  const patternSegments = normalizePattern(pattern)
  const pathSegments = normalizePattern(pathname)
  if (patternSegments.length !== pathSegments.length) return null

  const params: Record<string, string> = {}
  let score = 0
  for (let i = 0; i < patternSegments.length; i++) {
    const patternSegment = patternSegments[i]
    const pathSegment = pathSegments[i]
    const bracket = patternSegment.match(/^\[([^\]]+)\]$/)
    const isColon = patternSegment.startsWith(':')
    const isDollar = patternSegment.startsWith('$')
    if (bracket || isColon || isDollar) {
      const key = bracket?.[1] ?? patternSegment.slice(1)
      params[key] = decodeURIComponent(pathSegment)
      continue
    }
    if (patternSegment !== pathSegment) return null
    score += 1
  }

  return { params, score }
}

export interface MatchedPluginRoute {
  pluginId: string
  path: string
  component: ComponentType<Record<string, unknown>>
  params: Record<string, string>
}

export function getPluginRoute(pathname: string): MatchedPluginRoute | null {
  const registry = getRegistry()
  let best: (MatchedPluginRoute & { score: number }) | null = null
  for (const [pluginId, routes] of registry.routesByPlugin.entries()) {
    for (const route of routes) {
      const match = matchRoutePattern(route.path, pathname)
      if (!match) continue
      if (!best || match.score > best.score) {
        best = {
          pluginId,
          path: route.path,
          component: route.component,
          params: match.params,
          score: match.score,
        }
      }
    }
  }
  if (!best) return null
  const { score: _score, ...route } = best
  return route
}

export function getPluginRoutes(pluginId?: string): ReadonlyArray<ClientRouteEntry> {
  const registry = getRegistry()
  if (pluginId) return registry.routesByPlugin.get(pluginId) ?? []
  return [...registry.routesByPlugin.values()].flat()
}

export type { NavItem, PluginRegistration, ClientRouteEntry }
