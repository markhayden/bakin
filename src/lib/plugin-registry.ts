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
  PluginNodeTypeInput,
} from '@bakin/core/plugin-types'
import { registerPluginDefinition } from '../../plugins/workflows/lib/source-registry'
import type { WorkflowDefinition } from '../../plugins/workflows/types'
import { registerPluginNodeType, unregisterPluginNodeTypes } from '../../plugins/workflows/lib/node-type-registry'
import {
  registerPluginNotificationChannel,
  unregisterPluginNotificationChannels,
} from '../../plugins/workflows/lib/notification-channel-registry'
import {
  registerPluginHealthCheck,
  unregisterPluginHealthChecks,
} from '../../plugins/health/lib/health-check-registry'
import type {
  PluginNotificationChannelInput,
  PluginHealthCheckInput,
} from '@bakin/core/plugin-types'
import type { AppServices } from '@bakin/core/app-services'
import { registerRouteDoc } from '../core/api-docs'
import { addExecTool } from '../../scripts/lib/registry'
import { runMigrations } from '../core/migrations'
import { getContentDir } from '../core/content-dir'
import { createLogger } from '../core/logger'
import { appendAudit } from '../core/audit'
import { HookRegistry } from '../../packages/core/src/hooks/hook-registry'
import { buildSearchAPI } from '../core/search-registry'
import { loadPluginSkills } from './plugin-skill-loader'
import { setCorePluginCheck, readPluginLockfile } from '../../packages/core/src/plugins/lockfile'
import { parseManifestPermissions } from '../../packages/core/src/plugins/permissions'
import {
  PluginManifestError,
  readPluginManifestJson,
} from '../../packages/core/src/plugins/manifest'
import { ScopedPluginStorageAdapter } from '../../packages/core/src/storage/scoped-plugin-storage'
import { getAppServices } from '../core/app-services'
import type { PluginManifest as PublicPluginManifest } from '@bakin/sdk/types'
import {
  createPluginAssetsAPI,
  createPluginRuntimeFacade,
  createPluginTaskService,
} from './plugin-context-services'

/**
 * Optional static core-plugin table. Set from server.ts on startup so
 * `bun build --compile` can trace each plugin's module graph from the
 * entry point. In test environments this stays empty, so test modules
 * that import the registry don't transitively drag every plugin
 * (and every plugin's side effects) into their module graph.
 *
 * Shape: { 'plugins/team': BakinPluginInstance, ... }
 */
let corePluginTable: Readonly<Record<string, BakinPlugin>> = {}
export function registerCorePlugins(table: Readonly<Record<string, BakinPlugin>>): void {
  corePluginTable = table
  // Seed corePluginIds synchronously from the static table so the predicate
  // is correct from the moment any code can call into the registry — not
  // just after each plugin's loadPlugin activation completes. Without this,
  // any pre-activation lockfile write (migrations, startup hooks) would
  // bypass the defense-in-depth guard. The activation-time add in
  // loadPlugin still runs as a backstop for dynamic-import test paths
  // where the table stays empty.
  for (const plugin of Object.values(table)) {
    if (plugin?.id) corePluginIds.add(plugin.id)
  }
}

const log = createLogger('plugin-registry')

function resolveAppServices(services?: AppServices): AppServices {
  return services ?? getAppServices()
}

/** Singleton hook registry shared across all plugins and core modules.
 *  Backed by globalThis so a single process has exactly one hook map, even
 *  when this module is reached from both the shell entry and dynamically
 *  imported plugin bundles. */
const hookRegistry: HookRegistry = (globalThis as any).__bakinHookRegistry ??= new HookRegistry()

/** Access the hook registry from core modules to call hooks */
export function getHookRegistry(): HookRegistry {
  return hookRegistry
}

/**
 * Set of plugin ids that ship with the Bakin binary (vs. user-installed
 * under ~/.bakin/plugins/). Populated by `loadPlugin` after a successful
 * core-plugin activation. globalThis-backed so the predicate stays
 * consistent across module re-evaluations during dev HMR.
 *
 * Read by:
 *   - `/api/plugins/remove` and `/api/plugins/upgrade` — refuse mutation
 *   - `packages/core/src/plugins/lockfile.ts` mutators — defense-in-depth
 *   - `bakin plugins list` — render the [core] marker
 */
const corePluginIds: Set<string> = (globalThis as any).__bakinCorePluginIds ??= new Set<string>()

/** True iff the given plugin id ships with the Bakin binary. */
export function isCorePlugin(pluginId: string): boolean {
  return corePluginIds.has(pluginId)
}

// Wire the lockfile's defense-in-depth guard to our predicate. The lockfile
// module can't import plugin-registry directly (circular), so it accepts a
// setter at boot.
setCorePluginCheck(isCorePlugin)

/**
 * #142 layer 1 — log a plugin's requested permissions on activation.
 * Appends to ~/.bakin/audit.jsonl AND emits an info-level log line.
 *
 * Permission failures are tolerated here (returns []) — install/upgrade
 * already validate; a malformed manifest at boot shouldn't block the
 * server. The audit entry just records `(requests: ?)` in that case.
 */
function logPluginActivation(args: {
  plugin: BakinPlugin
  source: 'core' | 'user'
  manifestPath?: string
}): void {
  const { plugin, source, manifestPath } = args
  let permissions: string[] = []
  let resolvedSource: 'core' | 'github' | 'local' = source === 'core' ? 'core' : 'local'

  if (manifestPath && existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
      permissions = parseManifestPermissions(manifest.permissions)
    } catch {
      // Already validated at install/upgrade — silently keep permissions empty.
    }
  }

  if (source === 'user') {
    try {
      const entry = readPluginLockfile().plugins[plugin.id]
      if (entry?.type === 'github') resolvedSource = 'github'
      else if (entry?.type === 'local') resolvedSource = 'local'
    } catch {
      // lockfile read failure — leave as 'local'
    }
  }

  log.info('plugin activated', {
    pluginId: plugin.id,
    version: plugin.version,
    permissions,
    source: resolvedSource,
  })
  appendAudit(getContentDir(), 'plugin.activate', 'system', {
    pluginId: plugin.id,
    version: plugin.version,
    permissions,
    source: resolvedSource,
  }, 'system')
}

interface PluginState {
  plugin: BakinPlugin
  manifest?: PublicPluginManifest
  source: 'core' | 'user'
  description: string
  navItems: NavItem[]
  routes: APIRoute[]
  slots: UISlotRegistration[]
  watchPatterns: string[]
  /** Namespaced workflow node kinds registered via ctx.registerNodeType. */
  nodeKinds: string[]
  /** Namespaced notification channel ids registered via ctx.registerNotificationChannel. */
  channelIds: string[]
  /** Namespaced health check ids registered via ctx.registerHealthCheck. */
  healthCheckIds: string[]
  /** Cached PluginContext — handed to onUninstall during plugin remove (#119). */
  ctx?: PluginContext
}

interface PluginFailureState {
  id: string
  name: string
  version: string
  description: string
  source: 'built-in' | 'user'
  errorCode: 'manifest_invalid' | 'missing_dependency' | 'dependency_cycle' | 'dependency_failed' | 'activation_failed'
  errorMessage: string
  missingDependencies?: string[]
}

interface PluginLoadEntry {
  path: string
  id: string
  deps: string[]
  manifest?: PublicPluginManifest
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
  private failedPlugins = new Map<string, PluginFailureState>()
  private initialized = false

  async initialize(config: BakinConfig, storage: StorageAdapter, events: EventBus, services?: AppServices): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    const appServices = resolveAppServices(services)

    // Collect all plugin paths and their manifest dependencies
    const entries: PluginLoadEntry[] = []
    for (const entry of config.plugins) {
      if (entry.enabled === false) continue
      const manifestPath = join(entry.path, 'bakin-plugin.json')
      let id = entry.path.split('/').pop() || entry.path
      let deps: string[] = []
      let manifest: PublicPluginManifest | undefined
      if (existsSync(manifestPath)) {
        try {
          manifest = readPluginManifestJson(readFileSync(manifestPath, 'utf-8'), { allowLegacy: true })
          id = manifest.id || id
          deps = manifest.dependencies || []
        } catch (err) {
          this.markPluginFailed({
            id,
            name: id,
            version: '0.0.0',
            description: '',
            source: 'built-in',
            errorCode: 'manifest_invalid',
            errorMessage: err instanceof Error ? err.message : String(err),
          })
          continue
        }
      }
      entries.push({ path: entry.path, id, deps, manifest })
    }

    // Topological sort (Kahn's algorithm)
    const sorted = this.topologicalSort(entries)
    log.info(`Plugin activation order: ${sorted.map(e => e.id).join(' → ')}`)

    // Activate in dependency order
    for (const entry of sorted) {
      const failedDeps = entry.deps.filter(dep => this.failedPlugins.has(dep))
      if (failedDeps.length > 0) {
        this.markPluginFailed({
          id: entry.id,
          name: entry.manifest?.name ?? entry.id,
          version: entry.manifest?.version ?? '0.0.0',
          description: entry.manifest?.description ?? '',
          source: 'built-in',
          errorCode: 'dependency_failed',
          errorMessage: `Dependency failed: ${failedDeps.join(', ')}`,
          missingDependencies: failedDeps,
        })
        continue
      }
      await this.loadPlugin(entry.path, storage, events, appServices, entry.manifest)
    }

    // Load user plugins from ~/.bakin/plugins/ (override by ID)
    await this.loadUserPlugins(storage, events, appServices)
  }

  private topologicalSort(entries: PluginLoadEntry[]): PluginLoadEntry[] {
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
          this.markPluginFailed({
            id: e.id,
            name: e.manifest?.name ?? e.id,
            version: e.manifest?.version ?? '0.0.0',
            description: e.manifest?.description ?? '',
            source: 'built-in',
            errorCode: 'missing_dependency',
            errorMessage: `Missing dependency: ${dep}`,
            missingDependencies: [dep],
          })
          continue
        }
        inDegree.set(e.id, (inDegree.get(e.id) || 0) + 1)
        dependents.get(dep)!.push(e.id)
      }
    }

    // Start with nodes that have no dependencies
    const queue = entries.filter(e => inDegree.get(e.id) === 0).map(e => e.id)
    const result: PluginLoadEntry[] = []

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
      log.error(`Circular plugin dependencies detected: ${cycle}`)
      for (const entry of missing) {
        this.markPluginFailed({
          id: entry.id,
          name: entry.manifest?.name ?? entry.id,
          version: entry.manifest?.version ?? '0.0.0',
          description: entry.manifest?.description ?? '',
          source: 'built-in',
          errorCode: 'dependency_cycle',
          errorMessage: `Circular plugin dependency detected: ${cycle}`,
        })
      }
    }

    return result.filter(entry => !this.failedPlugins.has(entry.id))
  }

  private topologicalSortUserPlugins(entries: PluginLoadEntry[]): PluginLoadEntry[] {
    const byId = new Map(entries.map(e => [e.id, e]))
    const inDegree = new Map<string, number>()
    const dependents = new Map<string, string[]>()

    for (const entry of entries) {
      inDegree.set(entry.id, 0)
      dependents.set(entry.id, [])
    }
    for (const entry of entries) {
      for (const dep of entry.deps) {
        if (!byId.has(dep)) continue
        inDegree.set(entry.id, (inDegree.get(entry.id) ?? 0) + 1)
        dependents.get(dep)!.push(entry.id)
      }
    }

    const queue = entries.filter(entry => inDegree.get(entry.id) === 0).map(entry => entry.id)
    const result: PluginLoadEntry[] = []
    while (queue.length > 0) {
      const id = queue.shift()!
      result.push(byId.get(id)!)
      for (const dependent of dependents.get(id) ?? []) {
        const next = (inDegree.get(dependent) ?? 1) - 1
        inDegree.set(dependent, next)
        if (next === 0) queue.push(dependent)
      }
    }

    if (result.length < entries.length) {
      const cycleEntries = entries.filter(entry => !result.some(sorted => sorted.id === entry.id))
      const cycle = cycleEntries.map(entry => entry.id).join(' ↔ ')
      for (const entry of cycleEntries) {
        this.markPluginFailed({
          id: entry.id,
          name: entry.manifest?.name ?? entry.id,
          version: entry.manifest?.version ?? '0.0.0',
          description: entry.manifest?.description ?? '',
          source: 'user',
          errorCode: 'dependency_cycle',
          errorMessage: `Circular plugin dependency detected: ${cycle}`,
        })
      }
    }

    return result
  }

  private markPluginFailed(failure: PluginFailureState): void {
    this.plugins.delete(failure.id)
    corePluginIds.delete(failure.id)
    this.failedPlugins.set(failure.id, failure)
    log.error(`Plugin "${failure.id}" failed: ${failure.errorCode}`, {
      message: failure.errorMessage,
      missingDependencies: failure.missingDependencies,
    })
  }

  private assertRouteDeclared(pluginId: string, state: PluginState, route: APIRoute): void {
    if (state.source !== 'user') return
    const declared = state.manifest?.contributes?.apiRoutes ?? []
    const found = declared.some(item => item.method === route.method && item.path === route.path)
    if (!found) {
      throw new Error(
        `Plugin "${pluginId}" registered undeclared API route ${route.method} ${route.path}. ` +
        `Declare it in bakin-plugin.json contributes.apiRoutes.`,
      )
    }
  }

  private assertExecToolDeclared(pluginId: string, state: PluginState, tool: ExecToolDefinition): void {
    if (state.source !== 'user') return
    const declared = state.manifest?.contributes?.execTools ?? []
    const found = declared.some(item => item.name === tool.name)
    if (!found) {
      throw new Error(
        `Plugin "${pluginId}" registered undeclared exec tool "${tool.name}". ` +
        `Declare it in bakin-plugin.json contributes.execTools.`,
      )
    }
  }

  private buildContext(
    pluginId: string,
    state: PluginState,
    storage: StorageAdapter,
    events: EventBus,
    services: AppServices,
  ): PluginContext {
    // Extract as a local so both ctx.registerRoute and the search API's
    // auto-route wiring land routes in the same place (and share the
    // same docs registration side effect).
    const registerRoute = (route: APIRoute) => {
      this.assertRouteDeclared(pluginId, state, route)
      state.routes.push(route)
      registerRouteDoc(pluginId, route)
    }
    const pluginStorage = state.source === 'user'
      ? new ScopedPluginStorageAdapter(getContentDir(), pluginId)
      : storage
    const assets = createPluginAssetsAPI()
    return {
      storage: pluginStorage,
      events,
      pluginId,
      runtime: state.source === 'user' ? createPluginRuntimeFacade(services.runtime) : services.runtime,
      tasks: createPluginTaskService(services.tasks),
      assets,
      registerNav: (items: NavItem[]) => { state.navItems.push(...items) },
      registerRoute,
      registerSlot: (reg: UISlotRegistration) => { state.slots.push(reg) },
      registerExecTool: (tool: ExecToolDefinition) => {
        this.assertExecToolDeclared(pluginId, state, tool)
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
      registerNodeType: <T = unknown>(def: PluginNodeTypeInput<T>): string => {
        try {
          const namespacedKind = registerPluginNodeType<T>(pluginId, def)
          state.nodeKinds.push(namespacedKind)
          return namespacedKind
        } catch (err) {
          log.error(
            `registerNodeType collision in plugin "${pluginId}" for kind "${def.kind}"`,
            err as Error,
          )
          return `${pluginId}.${def.kind}`
        }
      },
      registerNotificationChannel: (def: PluginNotificationChannelInput): string => {
        try {
          const namespacedId = registerPluginNotificationChannel(pluginId, def)
          state.channelIds.push(namespacedId)
          return namespacedId
        } catch (err) {
          log.error(
            `registerNotificationChannel collision in plugin "${pluginId}" for id "${def.id}"`,
            err as Error,
          )
          return `${pluginId}.${def.id}`
        }
      },
      registerHealthCheck: (def: PluginHealthCheckInput): string => {
        try {
          const namespacedId = registerPluginHealthCheck(pluginId, def)
          state.healthCheckIds.push(namespacedId)
          return namespacedId
        } catch (err) {
          log.error(
            `registerHealthCheck collision in plugin "${pluginId}" for id "${def.id}"`,
            err as Error,
          )
          return `${pluginId}.${def.id}`
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
        register: (name: string, handler: (data: any) => any) => {
          // Forward the plugin id so unregisterByPlugin can sweep this
          // handler when the plugin is removed (#119).
          return hookRegistry.register(name, handler, pluginId)
        },
        has: (name: string) => hookRegistry.has(name),
        invoke: <R>(name: string, data: unknown) => hookRegistry.invoke<R>(name, data),
      },
    }
  }

  private async loadPlugin(
    pluginPath: string,
    storage: StorageAdapter,
    events: EventBus,
    services: AppServices,
    manifest?: PublicPluginManifest,
  ): Promise<void> {
    const fallbackId = manifest?.id ?? pluginPath.split('/').pop() ?? pluginPath
    try {
      // Core plugins come from the static table `server.ts` registers
      // via `registerCorePlugins` — this is what lets `bun build --compile`
      // trace and embed each plugin's module graph. In tests the table
      // stays empty, so we fall back to dynamic import by path (which
      // is how the registry worked before TG1).
      let plugin: BakinPlugin | undefined = corePluginTable[pluginPath]
      if (!plugin) {
        // Absolute paths (used by tests + user plugins under ~/.bakin/plugins/)
        // resolve directly. Relative paths (used by core plugins in
        // bakin.config.ts) resolve relative to this file.
        const importTarget = pluginPath.startsWith('/') ? pluginPath : `../../${pluginPath}`
        const mod = await import(/* webpackIgnore: true */ importTarget)
        plugin = mod.default || mod.plugin || mod
      }
      if (!plugin) {
        console.warn(`Plugin at ${pluginPath} returned no export — skipping`)
        return
      }

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
        manifest,
        source: 'core',
        description,
        navItems: plugin.navItems || [],
        routes: [],
        slots: [],
        watchPatterns: [],
        nodeKinds: [],
        channelIds: [],
        healthCheckIds: [],
      }

      const ctx = this.buildContext(plugin.id, state, storage, events, services)
      await plugin.activate(ctx)
      state.ctx = ctx
      const skillResult = loadPluginSkills(pluginPath, ctx, log)
      if (skillResult.registered.length > 0) {
        log.info(`Auto-registered ${skillResult.registered.length} workflow skill(s) for "${plugin.id}"`, {
          skills: skillResult.registered,
        })
      }
      this.plugins.set(plugin.id, state)
      this.failedPlugins.delete(plugin.id)
      // Mark this id as core — `loadPlugin` is the core-only entry; user
      // plugins go through `loadUserPlugins` and never land here.
      corePluginIds.add(plugin.id)
      // #142 layer 1 — log requested permissions on every activation so
      // `cat ~/.bakin/audit.jsonl | jq 'select(.event=="plugin.activate")'`
      // shows the full surface the user authorized.
      logPluginActivation({ plugin, source: 'core', manifestPath })
      console.log(`  ✓ Plugin loaded: ${plugin.name} v${plugin.version}`)
    } catch (err) {
      log.error(`Failed to load plugin at ${pluginPath}`, err)
      this.markPluginFailed({
        id: fallbackId,
        name: manifest?.name ?? fallbackId,
        version: manifest?.version ?? '0.0.0',
        description: manifest?.description ?? '',
        source: 'built-in',
        errorCode: 'activation_failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Scan ~/.bakin/plugins/ for user-installed plugins.
   * User plugins with the same ID as built-in plugins override them.
   */
  private async loadUserPlugins(storage: StorageAdapter, events: EventBus, services: AppServices): Promise<void> {
    const userPluginsDir = join(getContentDir(), 'plugins')

    if (!existsSync(userPluginsDir)) return

    try {
      const dirEntries = readdirSync(userPluginsDir, { withFileTypes: true })
      const entries: PluginLoadEntry[] = []
      for (const entry of dirEntries) {
        if (!entry.isDirectory()) continue

        const manifestPath = join(userPluginsDir, entry.name, 'bakin-plugin.json')
        if (!existsSync(manifestPath)) continue

        try {
          const manifest = readPluginManifestJson(readFileSync(manifestPath, 'utf-8'))
          entries.push({
            path: join(userPluginsDir, entry.name),
            id: manifest.id,
            deps: manifest.dependencies ?? [],
            manifest,
          })
        } catch (err) {
          this.markPluginFailed({
            id: entry.name,
            name: entry.name,
            version: '0.0.0',
            description: '',
            source: 'user',
            errorCode: 'manifest_invalid',
            errorMessage: err instanceof PluginManifestError || err instanceof Error ? err.message : String(err),
          })
        }
      }

      const userIds = new Set(entries.map(entry => entry.id))
      const availableIds = new Set([...this.plugins.keys(), ...userIds])
      const loadableEntries: PluginLoadEntry[] = []
      for (const entry of entries) {
        const missing = entry.deps.filter(dep => !availableIds.has(dep))
        if (missing.length > 0) {
          this.markPluginFailed({
            id: entry.id,
            name: entry.manifest?.name ?? entry.id,
            version: entry.manifest?.version ?? '0.0.0',
            description: entry.manifest?.description ?? '',
            source: 'user',
            errorCode: 'missing_dependency',
            errorMessage: `Missing dependencies: ${missing.join(', ')}`,
            missingDependencies: missing,
          })
          continue
        }
        loadableEntries.push({
          ...entry,
          deps: entry.deps.filter(dep => userIds.has(dep)),
        })
      }

      const sorted = this.topologicalSortUserPlugins(loadableEntries)
      for (const entry of sorted) {
        const failedDeps = (entry.manifest?.dependencies ?? []).filter(dep => this.failedPlugins.has(dep))
        if (failedDeps.length > 0) {
          this.markPluginFailed({
            id: entry.id,
            name: entry.manifest?.name ?? entry.id,
            version: entry.manifest?.version ?? '0.0.0',
            description: entry.manifest?.description ?? '',
            source: 'user',
            errorCode: 'dependency_failed',
            errorMessage: `Dependency failed: ${failedDeps.join(', ')}`,
            missingDependencies: failedDeps,
          })
          continue
        }

        try {
          const manifest = entry.manifest!
          const pluginId = manifest.id
          const manifestPath = join(entry.path, 'bakin-plugin.json')

          // User plugin overrides built-in — drop the built-in's workflow
          // node kinds so the user plugin can re-register them without
          // hitting the duplicate-kind guard in registerPluginNodeType.
          // Also drop the core marker: the active instance is now the user's
          // and they should be able to `bakin plugins remove` their override.
          if (this.plugins.has(pluginId)) {
            console.log(`  ↻ User plugin overrides built-in: ${pluginId}`)
            unregisterPluginNodeTypes(pluginId)
            unregisterPluginNotificationChannels(pluginId)
            unregisterPluginHealthChecks(pluginId)
            this.plugins.delete(pluginId)
            corePluginIds.delete(pluginId)
          }

          const serverEntry = manifest.entry?.server || 'index.ts'
          const relativePath = join(entry.path, serverEntry)

          const mod = await import(/* webpackIgnore: true */ relativePath)
          const plugin: BakinPlugin = mod.default || mod.plugin || mod

          if (!plugin.id || !plugin.activate) {
            console.warn(`User plugin "${entry.id}" missing id or activate — skipping`)
            continue
          }

          const state: PluginState = {
            plugin,
            manifest,
            source: 'user',
            description: manifest.description || '',
            navItems: plugin.navItems || [],
            routes: [],
            slots: [],
            watchPatterns: [],
            nodeKinds: [],
            channelIds: [],
            healthCheckIds: [],
          }

          const ctx = this.buildContext(plugin.id, state, storage, events, services)
          await plugin.activate(ctx)
          state.ctx = ctx
          // #142 layer 1 — surface user-plugin permissions to the audit log.
          // Source is read from the lockfile (github vs local) by the helper.
          logPluginActivation({ plugin, source: 'user', manifestPath })
          const userPluginPath = entry.path
          const skillResult = loadPluginSkills(userPluginPath, ctx, log)
          if (skillResult.registered.length > 0) {
            log.info(`Auto-registered ${skillResult.registered.length} workflow skill(s) for user plugin "${plugin.id}"`, {
              skills: skillResult.registered,
            })
          }
          this.plugins.set(plugin.id, state)
          this.failedPlugins.delete(plugin.id)
          console.log(`  ✓ User plugin loaded: ${plugin.name} v${plugin.version}`)
        } catch (err) {
          log.error(`Failed to load user plugin "${entry.id}"`, err)
          this.markPluginFailed({
            id: entry.id,
            name: entry.manifest?.name ?? entry.id,
            version: entry.manifest?.version ?? '0.0.0',
            description: entry.manifest?.description ?? '',
            source: 'user',
            errorCode: 'activation_failed',
            errorMessage: err instanceof Error ? err.message : String(err),
          })
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

  /** Look up the BakinPlugin instance — used by remove flow to call onUninstall. */
  getPlugin(pluginId: string): BakinPlugin | undefined {
    return this.plugins.get(pluginId)?.plugin
  }

  /** Look up the cached PluginContext that was handed to plugin.activate(). */
  getPluginContext(pluginId: string): PluginContext | undefined {
    return this.plugins.get(pluginId)?.ctx
  }

  /** Drop the in-memory plugin state. Used by remove flow after fs cleanup. */
  deletePlugin(pluginId: string): boolean {
    return this.plugins.delete(pluginId)
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
    status: 'active' | 'failed'
    errorCode?: PluginFailureState['errorCode']
    errorMessage?: string
    missingDependencies?: string[]
    routes: number
  }> {
    const active = [...this.plugins.entries()].map(([id, state]) => ({
      id,
      name: state.plugin.name,
      version: state.plugin.version,
      description: state.description,
      // Was a `id.startsWith('user:')` heuristic that always evaluated to
      // 'built-in' — no id is ever prefixed `user:`. Use the authoritative
      // corePluginIds predicate instead.
      source: isCorePlugin(id) ? 'built-in' as const : 'user' as const,
      status: 'active' as const,
      routes: state.routes.length,
    }))
    const failed = [...this.failedPlugins.values()].map(failure => ({
      id: failure.id,
      name: failure.name,
      version: failure.version,
      description: failure.description,
      source: failure.source,
      status: 'failed' as const,
      errorCode: failure.errorCode,
      errorMessage: failure.errorMessage,
      missingDependencies: failure.missingDependencies,
      routes: 0,
    }))
    return [...active, ...failed]
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

  /** Reset internal state. Tests use this between cases since `bun:test`
   *  has no `vi.resetModules()` equivalent to rebuild the singleton. */
  _resetForTests(): void {
    this.plugins.clear()
    this.failedPlugins.clear()
    this.initialized = false
  }
}

// Backed by globalThis so every caller (shell, API handler, runtime-loaded
// plugin bundle) sees the same registry instance even if this module is
// evaluated more than once in a single process.
const g = globalThis as unknown as { __bakinPluginRegistry?: PluginRegistryImpl }
if (!g.__bakinPluginRegistry) {
  g.__bakinPluginRegistry = new PluginRegistryImpl()
}
export const pluginRegistry = g.__bakinPluginRegistry
