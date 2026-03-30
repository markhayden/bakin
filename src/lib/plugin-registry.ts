/**
 * Server-side plugin registry singleton.
 * Loads plugins, stores their registrations, and provides lookups.
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type {
  BakinConfig,
  BakinPlugin,
  StorageAdapter,
  EventBus,
  PluginContext,
  NavItem,
  APIRoute,
  UISlotRegistration,
  ExecToolDefinition,
  SkillDefinition,
} from './plugin-types'
import { registerRouteDoc } from '../core/api-docs'
import { addExecTool } from '../../scripts/lib/registry'

interface PluginState {
  plugin: BakinPlugin
  navItems: NavItem[]
  routes: APIRoute[]
  slots: UISlotRegistration[]
  watchPatterns: string[]
}

/** Skills registered by plugins (keyed by name, first-registered wins) */
const pluginSkills = new Map<string, SkillDefinition>()

export function getPluginSkills(): Map<string, SkillDefinition> {
  return pluginSkills
}

class PluginRegistryImpl {
  private plugins = new Map<string, PluginState>()
  private initialized = false

  async initialize(config: BakinConfig, storage: StorageAdapter, events: EventBus): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    // Load built-in plugins from repo
    for (const entry of config.plugins) {
      if (entry.enabled === false) continue
      await this.loadPlugin(entry.path, storage, events)
    }

    // Load user plugins from ~/.bakin/plugins/ (override by ID)
    await this.loadUserPlugins(storage, events)
  }

  private buildContext(
    pluginId: string,
    state: PluginState,
    storage: StorageAdapter,
    events: EventBus,
  ): PluginContext {
    return {
      storage,
      events,
      pluginId,
      registerNav: (items: NavItem[]) => { state.navItems.push(...items) },
      registerRoute: (route: APIRoute) => {
        state.routes.push(route)
        registerRouteDoc(pluginId, route)
      },
      registerSlot: (reg: UISlotRegistration) => { state.slots.push(reg) },
      registerExecTool: (tool: ExecToolDefinition) => {
        tool.source = `plugin:${pluginId}`
        addExecTool(tool)
      },
      registerSkill: (skill: SkillDefinition) => {
        skill.source = `plugin:${pluginId}`
        if (!pluginSkills.has(skill.name)) {
          pluginSkills.set(skill.name, skill)
        }
      },
      watchFiles: (patterns: string[]) => { state.watchPatterns.push(...patterns) },
    }
  }

  private async loadPlugin(pluginPath: string, storage: StorageAdapter, events: EventBus): Promise<void> {
    try {
      const mod = await import(/* webpackIgnore: true */ `../../${pluginPath}`)
      const plugin: BakinPlugin = mod.default || mod.plugin || mod

      if (!plugin.id || !plugin.activate) {
        console.warn(`Plugin at ${pluginPath} missing id or activate — skipping`)
        return
      }

      const state: PluginState = {
        plugin,
        navItems: plugin.navItems || [],
        routes: [],
        slots: [],
        watchPatterns: [],
      }

      const ctx = this.buildContext(plugin.id, state, storage, events)
      await plugin.activate(ctx)
      this.plugins.set(plugin.id, state)
      console.log(`  ✓ Plugin loaded: ${plugin.name} v${plugin.version}`)
    } catch (err) {
      console.error(`  ✗ Failed to load plugin at ${pluginPath}:`, err)
    }
  }

  /**
   * Scan ~/.bakin/plugins/ for user-installed plugins.
   * User plugins with the same ID as built-in plugins override them.
   */
  private async loadUserPlugins(storage: StorageAdapter, events: EventBus): Promise<void> {
    const bakinHome = process.env.BAKIN_HOME || join(homedir(), '.bakin')
    const userPluginsDir = join(bakinHome, 'plugins')

    if (!existsSync(userPluginsDir)) return

    try {
      const entries = readdirSync(userPluginsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const manifestPath = join(userPluginsDir, entry.name, 'bakin-plugin.json')
        if (!existsSync(manifestPath)) continue

        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
          const pluginId = manifest.id || entry.name

          // User plugin overrides built-in
          if (this.plugins.has(pluginId)) {
            console.log(`  ↻ User plugin overrides built-in: ${pluginId}`)
            this.plugins.delete(pluginId)
          }

          const serverEntry = manifest.entry?.server || 'index.ts'
          const relativePath = join(userPluginsDir, entry.name, serverEntry)

          const mod = await import(/* webpackIgnore: true */ relativePath)
          const plugin: BakinPlugin = mod.default || mod.plugin || mod

          if (!plugin.id || !plugin.activate) {
            console.warn(`User plugin "${entry.name}" missing id or activate — skipping`)
            continue
          }

          const state: PluginState = {
            plugin,
            navItems: plugin.navItems || [],
            routes: [],
            slots: [],
            watchPatterns: [],
          }

          const ctx = this.buildContext(plugin.id, state, storage, events)
          await plugin.activate(ctx)
          this.plugins.set(plugin.id, state)
          console.log(`  ✓ User plugin loaded: ${plugin.name} v${plugin.version}`)
        } catch (err) {
          console.error(`  ✗ Failed to load user plugin "${entry.name}":`, err)
        }
      }
    } catch {
      // ~/.bakin/plugins/ not readable, skip silently
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

  /**
   * Snapshot of all registered plugins for the health dashboard.
   */
  getRegistrySnapshot(): Array<{
    id: string
    name: string
    version: string
    source: 'built-in' | 'user'
    routes: number
  }> {
    return [...this.plugins.entries()].map(([id, state]) => ({
      id,
      name: state.plugin.name,
      version: state.plugin.version,
      source: id.startsWith('user:') ? 'user' as const : 'built-in' as const,
      routes: state.routes.length,
    }))
  }
}

export const pluginRegistry = new PluginRegistryImpl()
