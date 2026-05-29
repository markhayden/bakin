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
import type { NavBadge, NavItem } from './types'

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
  navItemsSnapshot: NavItem[]
  version: number
  listeners: Set<() => void>
  // Nav badge state. Outer key: pluginId (so unregister can drop all of a
  // plugin's badges). Inner key: navItemId. A flattened snapshot is rebuilt
  // on every mutation for useSyncExternalStore consumers.
  badgesByPlugin: Map<string, Map<string, NavBadge>>
  badgesSnapshot: Map<string, NavBadge>
  badgeListeners: Set<() => void>
}

function buildNavItemsSnapshot(registry: ClientRegistry): NavItem[] {
  const items: NavItem[] = []
  for (const navItems of registry.navByPlugin.values()) {
    items.push(...navItems)
  }
  return items.sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
}

function getRegistry(): ClientRegistry {
  const g = globalThis as Record<string, unknown>
  if (!g.__bakinClientRegistry) {
    g.__bakinClientRegistry = {
      navByPlugin: new Map<string, NavItem[]>(),
      routesByPlugin: new Map<string, ClientRouteEntry[]>(),
      cleanupByPlugin: new Map<string, Array<() => void>>(),
      navItemsSnapshot: [],
      version: 0,
      listeners: new Set<() => void>(),
      badgesByPlugin: new Map<string, Map<string, NavBadge>>(),
      badgesSnapshot: new Map<string, NavBadge>(),
      badgeListeners: new Set<() => void>(),
    } as ClientRegistry
  }
  const registry = g.__bakinClientRegistry as ClientRegistry
  if (!Array.isArray(registry.navItemsSnapshot)) {
    registry.navItemsSnapshot = buildNavItemsSnapshot(registry)
  }
  // Hydrate badge fields if the registry pre-dates this addition (HMR retains
  // the singleton across reloads, so older shapes can show up).
  if (!registry.badgesByPlugin) registry.badgesByPlugin = new Map()
  if (!registry.badgesSnapshot) registry.badgesSnapshot = buildBadgesSnapshot(registry)
  if (!registry.badgeListeners) registry.badgeListeners = new Set()
  return registry
}

function buildBadgesSnapshot(registry: ClientRegistry): Map<string, NavBadge> {
  const snapshot = new Map<string, NavBadge>()
  for (const byNavItemId of registry.badgesByPlugin.values()) {
    for (const [navItemId, badge] of byNavItemId) {
      // First plugin wins. NavItem ids are conventionally globally unique
      // (plugins prefix their own ids), so collisions are an authoring bug —
      // we deliberately don't paper over them.
      if (!snapshot.has(navItemId)) snapshot.set(navItemId, badge)
    }
  }
  return snapshot
}

function bumpBadges(): void {
  const registry = getRegistry()
  registry.badgesSnapshot = buildBadgesSnapshot(registry)
  for (const l of registry.badgeListeners) {
    try { l() } catch (err) { console.error('[bakin] badge listener threw:', err) }
  }
}

function bumpVersion(): void {
  const registry = getRegistry()
  registry.navItemsSnapshot = buildNavItemsSnapshot(registry)
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

  // Badges are tracked on a separate channel so badge ticks don't force a
  // full nav re-render — but unregister wipes both at once. Only notify
  // badge subscribers if the plugin actually had badges.
  const hadBadges = registry.badgesByPlugin.delete(id)

  bumpVersion()
  if (hadBadges) bumpBadges()
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
  return [...getRegistry().navItemsSnapshot]
}

/**
 * Stable nav snapshot for React's useSyncExternalStore. The returned array
 * identity only changes when plugin registration changes.
 */
export function getNavItemsSnapshot(): readonly NavItem[] {
  return getRegistry().navItemsSnapshot
}

/**
 * Nav items for a specific plugin. Returned as a readonly copy.
 */
export function getPluginNavItems(pluginId: string): ReadonlyArray<NavItem> {
  return getRegistry().navByPlugin.get(pluginId) ?? []
}

// ---------------------------------------------------------------------------
// Nav badge registry
// ---------------------------------------------------------------------------

/**
 * Set or clear the badge for a nav item owned by a plugin. Pass `null` to
 * clear. Safe to call before the nav item itself is registered — the badge
 * survives in the registry until the owning plugin is unregistered.
 */
export function setNavBadge(pluginId: string, navItemId: string, badge: NavBadge | null): void {
  const registry = getRegistry()
  let plugin = registry.badgesByPlugin.get(pluginId)
  if (badge === null) {
    if (!plugin?.has(navItemId)) return
    plugin.delete(navItemId)
    if (plugin.size === 0) registry.badgesByPlugin.delete(pluginId)
    bumpBadges()
    return
  }
  // Idempotent: a set with an identical value is a no-op, so a redundant
  // call (e.g. an SSE tick that didn't change the count) doesn't rebuild the
  // snapshot or notify subscribers.
  const prev = plugin?.get(navItemId)
  if (prev && prev.count === badge.count && prev.tone === badge.tone) return
  if (!plugin) {
    plugin = new Map()
    registry.badgesByPlugin.set(pluginId, plugin)
  }
  plugin.set(navItemId, badge)
  bumpBadges()
}

/** Read the current badge for a nav item, or undefined if none. */
export function getNavBadge(navItemId: string): NavBadge | undefined {
  return getRegistry().badgesSnapshot.get(navItemId)
}

/**
 * Stable snapshot of every active badge keyed by navItemId. The identity
 * of the returned Map only changes when a badge is set, cleared, or its
 * owning plugin is unregistered — safe for React's `useSyncExternalStore`.
 */
export function getNavBadgesSnapshot(): ReadonlyMap<string, NavBadge> {
  return getRegistry().badgesSnapshot
}

/**
 * Subscribe to badge mutations on a channel separate from `subscribeRegistry`
 * so high-frequency badge ticks don't force the whole nav to re-render.
 */
export function subscribeNavBadges(listener: () => void): () => void {
  const registry = getRegistry()
  registry.badgeListeners.add(listener)
  return () => { registry.badgeListeners.delete(listener) }
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
