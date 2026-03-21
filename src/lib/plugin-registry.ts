/**
 * Server-side plugin registry singleton.
 * Loads plugins, stores their registrations, and provides lookups.
 */
import type {
  MCConfig,
  MCPlugin,
  StorageAdapter,
  EventBus,
  PluginContext,
  NavItem,
  APIRoute,
  UISlotRegistration,
} from './plugin-types'
import { registerRouteDoc } from '../core/api-docs'

interface PluginState {
  plugin: MCPlugin
  navItems: NavItem[]
  routes: APIRoute[]
  slots: UISlotRegistration[]
  watchPatterns: string[]
}

class PluginRegistryImpl {
  private plugins = new Map<string, PluginState>()
  private initialized = false

  async initialize(config: MCConfig, storage: StorageAdapter, events: EventBus): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    for (const entry of config.plugins) {
      if (entry.enabled === false) continue

      try {
        // Dynamic import from project root
        const mod = await import(/* webpackIgnore: true */ `../../${entry.path}`)
        const plugin: MCPlugin = mod.default || mod.plugin || mod

        if (!plugin.id || !plugin.activate) {
          console.warn(`Plugin at ${entry.path} missing id or activate — skipping`)
          continue
        }

        const state: PluginState = {
          plugin,
          navItems: plugin.navItems || [],
          routes: [],
          slots: [],
          watchPatterns: [],
        }

        const ctx: PluginContext = {
          storage,
          events,
          pluginId: plugin.id,
          registerNav: (items) => { state.navItems.push(...items) },
          registerRoute: (route) => {
            state.routes.push(route)
            registerRouteDoc(plugin.id, route)
          },
          registerSlot: (reg) => { state.slots.push(reg) },
          watchFiles: (patterns) => { state.watchPatterns.push(...patterns) },
        }

        await plugin.activate(ctx)
        this.plugins.set(plugin.id, state)
        console.log(`  ✓ Plugin loaded: ${plugin.name} v${plugin.version}`)
      } catch (err) {
        console.error(`  ✗ Failed to load plugin at ${entry.path}:`, err)
      }
    }
  }

  getNavItems(): NavItem[] {
    const items: NavItem[] = []
    for (const state of this.plugins.values()) {
      items.push(...state.navItems)
    }
    return items.sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
  }

  findRoute(pluginId: string, path: string, method: string): APIRoute | null {
    const state = this.plugins.get(pluginId)
    if (!state) return null
    return state.routes.find(r =>
      r.path === path && r.method === method.toUpperCase()
    ) || null
  }

  getSlotComponents(slotName: string): UISlotRegistration[] {
    const registrations: UISlotRegistration[] = []
    for (const state of this.plugins.values()) {
      registrations.push(...state.slots.filter(s => s.slot === slotName))
    }
    return registrations.sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
  }

  getPluginIds(): string[] {
    return [...this.plugins.keys()]
  }

  getPluginState(pluginId: string): PluginState | undefined {
    return this.plugins.get(pluginId)
  }
}

export const pluginRegistry = new PluginRegistryImpl()
