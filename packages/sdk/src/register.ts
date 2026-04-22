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
 * Plugins currently mutate the slot registry directly via `registerSlot` and
 * export a top-level `navItems` array read at build time by the static
 * plugin-manifest aggregator. Post-#147 Phase F the shell boots with no
 * static manifest and reads nav items from this registry after dynamic-
 * importing each plugin's `client.mjs`.
 *
 * Internally layers onto the existing `registerSlot` registry for slots and
 * a parallel browser-global for nav items. Every plugin component's access
 * pattern stays `<Slot name="page:/route" />` — slots are the transport.
 */

import type { ComponentType } from 'react'
import { registerSlot } from './slots'

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
   * For fine-grained ordering, call `registerSlot(name, Component, order)`
   * directly from the plugin's client.tsx alongside registerPlugin.
   */
  slots?: Record<string, ComponentType<Record<string, unknown>>>
}

interface ClientRegistry {
  navByPlugin: Map<string, NavItem[]>
}

function getRegistry(): ClientRegistry {
  const g = globalThis as Record<string, unknown>
  if (!g.__bakinClientRegistry) {
    g.__bakinClientRegistry = { navByPlugin: new Map<string, NavItem[]>() } as ClientRegistry
  }
  return g.__bakinClientRegistry as ClientRegistry
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
      registerSlot(slotName, component)
    }
  }
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

/**
 * Remove a plugin's nav items. Intended for tests + hot-reload; runtime
 * unregistration is handled by the plugin registry's teardown path.
 */
export function __clearPluginRegistration(pluginId: string): void {
  getRegistry().navByPlugin.delete(pluginId)
}

export type { NavItem, PluginRegistration }
