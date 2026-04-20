/**
 * Server-side plugin registry singleton.
 * Loads plugins, stores their registrations, and provides lookups.
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
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
  PluginSettingsSchema,
  WorkflowDefinitionInput,
} from './plugin-types'
import { registerPluginDefinition } from '../../plugins/workflows/lib/source-registry'
import type { WorkflowDefinition } from '../../plugins/workflows/types'
import { registerRouteDoc } from '../core/api-docs'
import { addExecTool } from '../../scripts/lib/registry'
import { runMigrations } from '../core/migrations'
import { getContentDir } from '../core/content-dir'
import { createLogger } from '../core/logger'
import { appendAudit } from '../core/audit'
import { HookRegistry } from '../../packages/core/src/hooks/hook-registry'
import { buildSearchAPI } from '../core/search-registry'

const log = createLogger('plugin-registry')

/** Singleton hook registry shared across all plugins and core modules.
 *  Backed by globalThis to survive Next.js webpack re-evaluation. */
const hookRegistry: HookRegistry = (globalThis as any).__bakinHookRegistry ??= new HookRegistry()

/** Access the hook registry from core modules to call hooks */
export function getHookRegistry(): HookRegistry {
  return hookRegistry
}

interface PluginState {
  plugin: BakinPlugin
  description: string
  navItems: NavItem[]
  routes: APIRoute[]
  slots: UISlotRegistration[]
  watchPatterns: string[]
}

/** Slug a workflow definition `name` into a stable id when no `id` is supplied. */
function slugifyWorkflowId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/, '')
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

    // Collect all plugin paths and their manifest dependencies
    const entries: Array<{ path: string; id: string; deps: string[] }> = []
    for (const entry of config.plugins) {
      if (entry.enabled === false) continue
      const manifestPath = join(entry.path, 'bakin-plugin.json')
      let id = entry.path.split('/').pop() || entry.path
      let deps: string[] = []
      if (existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
          id = manifest.id || id
          // Filter to only plugin IDs (skip npm package names like "ajv")
          const pluginIds = new Set(config.plugins.map(p => p.path.split('/').pop()))
          deps = (manifest.dependencies || []).filter((d: string) => pluginIds.has(d))
        } catch { /* use defaults */ }
      }
      entries.push({ path: entry.path, id, deps })
    }

    // Topological sort (Kahn's algorithm)
    const sorted = this.topologicalSort(entries)
    log.info(`Plugin activation order: ${sorted.map(e => e.id).join(' → ')}`)

    // Activate in dependency order
    for (const entry of sorted) {
      await this.loadPlugin(entry.path, storage, events)
    }

    // Load user plugins from ~/.bakin/plugins/ (override by ID)
    await this.loadUserPlugins(storage, events)
  }

  private topologicalSort(entries: Array<{ path: string; id: string; deps: string[] }>): Array<{ path: string; id: string; deps: string[] }> {
    const byId = new Map(entries.map(e => [e.id, e]))
    const inDegree = new Map<string, number>()
    const dependents = new Map<string, string[]>()

    for (const e of entries) {
      inDegree.set(e.id, 0)
      dependents.set(e.id, [])
    }

    for (const e of entries) {
      for (const dep of e.deps) {
        if (!byId.has(dep)) {
          log.warn(`Plugin "${e.id}" depends on "${dep}" which is not loaded — ignoring`)
          continue
        }
        inDegree.set(e.id, (inDegree.get(e.id) || 0) + 1)
        dependents.get(dep)!.push(e.id)
      }
    }

    // Start with nodes that have no dependencies
    const queue = entries.filter(e => inDegree.get(e.id) === 0).map(e => e.id)
    const result: Array<{ path: string; id: string; deps: string[] }> = []

    while (queue.length > 0) {
      const id = queue.shift()!
      result.push(byId.get(id)!)
      for (const dep of dependents.get(id) || []) {
        const deg = (inDegree.get(dep) || 1) - 1
        inDegree.set(dep, deg)
        if (deg === 0) queue.push(dep)
      }
    }

    // Detect cycles — any entries not in result have circular deps
    if (result.length < entries.length) {
      const missing = entries.filter(e => !result.find(r => r.id === e.id))
      const cycle = missing.map(e => e.id).join(' ↔ ')
      log.error(`Circular plugin dependencies detected: ${cycle} — loading in config order`)
      // Fall back: append cycle participants in config order
      result.push(...missing)
    }

    return result
  }

  private buildContext(
    pluginId: string,
    state: PluginState,
    storage: StorageAdapter,
    events: EventBus,
  ): PluginContext {
    // Extract as a local so both ctx.registerRoute and the search API's
    // auto-route wiring land routes in the same place (and share the
    // same docs registration side effect).
    const registerRoute = (route: APIRoute) => {
      state.routes.push(route)
      registerRouteDoc(pluginId, route)
    }
    return {
      storage,
      events,
      pluginId,
      registerNav: (items: NavItem[]) => { state.navItems.push(...items) },
      registerRoute,
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
      registerWorkflow: (def: WorkflowDefinitionInput) => {
        const id = (def.id && def.id.length > 0) ? def.id : slugifyWorkflowId(def.name)
        try {
          registerPluginDefinition(pluginId, id, def as unknown as WorkflowDefinition)
        } catch (err) {
          log.error(
            `registerWorkflow collision in plugin "${pluginId}" for id "${id}"`,
            err as Error,
          )
        }
      },
      watchFiles: (patterns: string[]) => { state.watchPatterns.push(...patterns) },
      getSettings: <T = Record<string, unknown>>(): T => {
        const settingsPath = join(getContentDir(), 'plugin-settings', `${pluginId}.json`)
        try {
          if (existsSync(settingsPath)) {
            return JSON.parse(readFileSync(settingsPath, 'utf-8')) as T
          }
        } catch { /* return empty */ }
        return {} as T
      },
      updateSettings: (patch: Record<string, unknown>): void => {
        const settingsDir = join(getContentDir(), 'plugin-settings')
        const settingsPath = join(settingsDir, `${pluginId}.json`)
        let current: Record<string, unknown> = {}
        try {
          if (existsSync(settingsPath)) {
            current = JSON.parse(readFileSync(settingsPath, 'utf-8'))
          }
        } catch { /* start fresh */ }
        const merged = { ...current, ...patch }
        const { mkdirSync, writeFileSync } = require('fs')
        if (!existsSync(settingsDir)) mkdirSync(settingsDir, { recursive: true })
        writeFileSync(settingsPath, JSON.stringify(merged, null, 2))
        state.plugin.onSettingsChange?.(merged)
      },
      activity: {
        log: (agent: string, message: string, opts?: { taskId?: string; category?: string }) => {
          const broadcastFn = (globalThis as any).__bakinBroadcast
          if (broadcastFn) {
            broadcastFn({
              type: 'activity',
              agent,
              message,
              ts: new Date().toISOString(),
              pluginId,
              ...(opts?.taskId ? { taskId: opts.taskId } : {}),
              ...(opts?.category ? { category: opts.category } : {}),
            })
          }
        },
        audit: (event: string, agent: string, data?: Record<string, unknown>) => {
          appendAudit(getContentDir(), `${pluginId}.${event}`, agent, data || {})
        },
      },
      search: buildSearchAPI(pluginId, { registerRoute }),
      hooks: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        register: (name: string, handler: (data: any) => any) => {
          return hookRegistry.register(name, handler)
        },
        has: (name: string) => hookRegistry.has(name),
        invoke: <R>(name: string, data: unknown) => hookRegistry.invoke<R>(name, data),
      },
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

      // Run pending data migrations before activating
      const migrationsDir = join(pluginPath, 'migrations')
      if (existsSync(migrationsDir)) {
        const ran = await runMigrations(plugin.id, plugin.version, migrationsDir, getContentDir())
        if (ran > 0) log.info(`Ran ${ran} migration(s) for ${plugin.id}`)
      }

      // Read description from manifest if available
      let description = ''
      const manifestPath = join(pluginPath, 'bakin-plugin.json')
      if (existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
          description = manifest.description || ''
        } catch { /* use empty */ }
      }

      const state: PluginState = {
        plugin,
        description,
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
    const userPluginsDir = join(getContentDir(), 'plugins')

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
            description: manifest.description || '',
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
    description: string
    source: 'built-in' | 'user'
    routes: number
  }> {
    return [...this.plugins.entries()].map(([id, state]) => ({
      id,
      name: state.plugin.name,
      version: state.plugin.version,
      description: state.description,
      source: id.startsWith('user:') ? 'user' as const : 'built-in' as const,
      routes: state.routes.length,
    }))
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Call onReady() on all plugins after all plugins have been activated. */
  async onAllReady(): Promise<void> {
    for (const [id, state] of this.plugins) {
      try {
        await state.plugin.onReady?.()
      } catch (err) {
        log.error(`onReady failed for plugin "${id}"`, err)
      }
    }
    log.info(`All plugins ready (${this.plugins.size} loaded)`)
  }

  /** Call onShutdown() on all plugins in reverse activation order. */
  async shutdownAll(): Promise<void> {
    const ids = [...this.plugins.keys()].reverse()
    for (const id of ids) {
      const state = this.plugins.get(id)
      if (!state) continue
      try {
        await state.plugin.onShutdown?.()
      } catch (err) {
        log.error(`onShutdown failed for plugin "${id}"`, err)
      }
    }
    log.info('All plugins shut down')
  }

  /** Get all plugin settings schemas (for the settings page). */
  getSettingsSchemas(): Array<{ id: string; name: string; schema: PluginSettingsSchema }> {
    const result: Array<{ id: string; name: string; schema: PluginSettingsSchema }> = []
    for (const [id, state] of this.plugins) {
      if (state.plugin.settingsSchema) {
        result.push({ id, name: state.plugin.name, schema: state.plugin.settingsSchema })
      }
    }
    return result
  }

  /** Notify a plugin that its settings have changed. */
  async notifySettingsChange(pluginId: string, settings: Record<string, unknown>): Promise<void> {
    const state = this.plugins.get(pluginId)
    if (!state?.plugin.onSettingsChange) return
    try {
      await state.plugin.onSettingsChange(settings)
    } catch (err) {
      log.error(`onSettingsChange failed for plugin "${pluginId}"`, err)
    }
  }
}

// Use globalThis to survive Next.js webpack re-evaluation — without this,
// API routes get a separate module instance with an empty registry.
const g = globalThis as unknown as { __bakinPluginRegistry?: PluginRegistryImpl }
if (!g.__bakinPluginRegistry) {
  g.__bakinPluginRegistry = new PluginRegistryImpl()
}
export const pluginRegistry = g.__bakinPluginRegistry
