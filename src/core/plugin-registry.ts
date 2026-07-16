/**
 * Server-side plugin registry singleton.
 * Loads plugins, stores their registrations, and provides lookups.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'fs'
import { join } from 'path'
import type { ZodRawShape } from 'zod'
import type {
  BakinConfig,
  BakinPlugin,
  StorageAdapter,
  EventBus,
  PluginContext,
  NavItem,
  RegisteredAPIRoute,
  UISlotRegistration,
  ExecToolDefinition,
  SkillDefinition,
  PluginSettingsSchema,
  WorkflowDefinitionInput,
  PluginNodeTypeInput,
} from '@bakin/core/plugin-types'
import { registerPluginDefinition, unregisterPluginDefinitions } from '@bakin/core/workflows/source-registry'
import type { WorkflowDefinition } from '@bakin/core/workflows/definition-types'
import { registerPluginNodeType, unregisterPluginNodeTypes } from '@bakin/core/workflows/node-type-registry'
import {
  registerPluginNotificationChannel,
  unregisterPluginNotificationChannels,
} from '@bakin/core/workflows/notification-channel-registry'
import {
  registerPluginHealthCheck,
  registerPluginHealthRepairAction,
  unregisterPluginHealthChecks,
} from './health-check-registry'
import type {
  PluginNotificationChannelInput,
  HealthCheckRegistrationInput,
  HealthRepairActionDefinition,
} from '@bakin/core/plugin-types'
import type { AppServices } from '@bakin/core/app-services'
import { assertValidBodySpec } from '@bakin/core/routing'
import { registerRouteDoc, removeRouteDocsByPlugin } from './api-docs'
import { addExecTool, removeExecToolsByPlugin } from './exec-tools/registry'
import { runMigrations } from './migrations'
import { getContentDir } from './content-dir'
import { createLogger } from './logger'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { getPluginSkills as skillRegistry, clearPluginSkills, removePluginSkillsByPlugin } from '@bakin/core/skills/plugin-skill-registry'
import { getContentTypes, purgeContentType, unregisterContentTypesByPlugin } from './search-registry'
import { loadPluginSkills } from '../lib/plugin-skill-loader'
import { setCorePluginCheck, readPluginLockfile } from '../../packages/core/src/plugins/lockfile'
import {
  PluginManifestError,
  readPluginManifestJson,
} from '../../packages/core/src/plugins/manifest'
import { checkBakinRangeCompatibility, IncompatibleHostError } from '../../packages/core/src/plugins/compat'
import { getAppServices } from './app-services'
import type { PluginManifest as PublicPluginManifest } from '@makinbakin/sdk/types'
import { buildPluginContext, type PluginContextRegistrars } from '../lib/plugin-context-factory'
import { startStartupSpan } from './startup-diagnostics'
import type {
  CorePluginRegistration,
  PluginState,
  PluginFailureState,
  PluginLoadEntry,
} from './plugin-registry-types'
import { withCapturedPluginConsole, createPluginScopedLogger } from './plugin-console-capture'
import { logPluginActivation } from './plugin-activation-audit'
import { topologicalSortPlugins } from './plugin-topo-sort'

// Re-exported so `@/lib/plugin-registry` consumers (server.ts) keep their
// import path for the static core-plugin table's element type.

/**
 * Thrown when a live (running-server) plugin operation is attempted before
 * the registry has been initialized with a runtime. Callers classify with
 * `instanceof` — never by matching the message text (arch rule).
 */
export class PluginRegistryNotInitializedError extends Error {
  constructor(detail: string) {
    super(`plugin registry is not initialized; ${detail}`)
    this.name = 'PluginRegistryNotInitializedError'
  }
}
export type { CorePluginRegistration } from './plugin-registry-types'

/**
 * Optional static core-plugin table. Set from server.ts on startup so
 * `bun build --compile` can trace each plugin's module graph from the
 * entry point. In test environments this stays empty, so test modules
 * that import the registry don't transitively drag every plugin
 * (and every plugin's side effects) into their module graph.
 *
 * Shape: { 'plugins/team': { plugin: BakinPluginInstance, manifest }, ... }
 */
let corePluginTable: Readonly<Record<string, CorePluginRegistration>> = {}
export function registerCorePlugins(table: Readonly<Record<string, CorePluginRegistration>>): void {
  for (const { plugin } of Object.values(corePluginTable)) {
    if (plugin?.id) corePluginIds.delete(plugin.id)
  }
  corePluginTable = table
  // Seed corePluginIds synchronously from the static table so the predicate
  // is correct from the moment any code can call into the registry — not
  // just after each plugin's loadPlugin activation completes. Without this,
  // any pre-activation lockfile write (migrations, startup hooks) would
  // bypass the defense-in-depth guard. The activation-time add in
  // loadPlugin still runs as a backstop for dynamic-import test paths
  // where the table stays empty.
  for (const { plugin } of Object.values(table)) {
    if (plugin?.id) corePluginIds.add(plugin.id)
  }
}

const log = createLogger('plugin-registry')

// Plugin console capture + plugin-scoped logging now live in
// ./plugin-console-capture (withCapturedPluginConsole / createPluginScopedLogger).

function resolveAppServices(services?: AppServices): AppServices {
  return services ?? getAppServices()
}

function isPluginDirectoryEntry(parentDir: string, name: string): boolean {
  try {
    return statSync(join(parentDir, name)).isDirectory()
  } catch {
    return false
  }
}

// The hook-registry singleton + getHookRegistry now live in the dependency-free
// leaf @bakin/core/hooks/hook-registry-singleton. Core modules, the exec-tool
// registry, and the per-request plugin context import it from there — never from
// this loader — so there is no import cycle back through plugin-registry. This
// loader is just another consumer.

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

// logPluginActivation (#142 layer 1 — audit a plugin's requested permissions on
// activation) now lives in ./plugin-activation-audit.
// PluginState / PluginFailureState / PluginLoadEntry now live in
// ./plugin-registry-types.

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

// The plugin-skill registry (map + getPluginSkills/removePluginSkillsByPlugin)
// now lives in the dependency-free leaf @bakin/core/skills/plugin-skill-registry,
// so skill consumers (e.g. workflow-skill-drift) don't cycle back through this
// loader. Re-exported here for the existing public surface.
export { getPluginSkills, removePluginSkillsByPlugin } from '@bakin/core/skills/plugin-skill-registry'

let userPluginImportCounter = 0

class PluginRegistryImpl {
  private plugins = new Map<string, PluginState>()
  private failedPlugins = new Map<string, PluginFailureState>()
  private initialized = false
  private runtime: { storage: StorageAdapter; events: EventBus; services: AppServices } | null = null

  async initialize(config: BakinConfig, storage: StorageAdapter, events: EventBus, services?: AppServices): Promise<void> {
    if (this.initialized) {
      startStartupSpan(log, 'pluginRegistry.initialize', {
        phase: 'plugins',
        count: config.plugins.length,
        thresholdMs: 1_000,
      }).end({ status: 'skipped', reason: 'already-initialized' })
      return
    }
    const span = startStartupSpan(log, 'pluginRegistry.initialize', {
      phase: 'plugins',
      count: config.plugins.length,
      thresholdMs: 1_000,
    })
    this.initialized = true
    try {
      const appServices = resolveAppServices(services)
      this.runtime = { storage, events, services: appServices }

      // Collect all plugin paths and their manifest dependencies
      const entries: PluginLoadEntry[] = []
      for (const entry of config.plugins) {
        if (entry.enabled === false) continue
        const manifestPath = join(entry.path, 'bakin-plugin.json')
        let id = entry.path.split('/').pop() || entry.path
        let deps: string[] = []
        let manifest: PublicPluginManifest | undefined = corePluginTable[entry.path]?.manifest
        if (manifest) {
          id = manifest.id || id
          deps = manifest.dependencies || []
        } else if (existsSync(manifestPath)) {
          try {
            manifest = readPluginManifestJson(readFileSync(manifestPath, 'utf-8'))
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
      span.end({
        status: 'ok',
        count: this.plugins.size,
        failedCount: this.failedPlugins.size,
      })
    } catch (err) {
      span.end({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }

  /**
   * Core-plugin activation order. A missing dependency FAILS the dependent
   * (core deps must all be present), and a detected cycle is logged.
   */
  private topologicalSort(entries: PluginLoadEntry[]): PluginLoadEntry[] {
    return topologicalSortPlugins(
      entries,
      { source: 'built-in', failOnMissingDep: true, logCycle: true },
      {
        markFailed: (failure) => this.markPluginFailed(failure),
        isFailed: (id) => this.failedPlugins.has(id),
      },
    )
  }

  /**
   * User-plugin activation order. loadUserPlugins has already pruned missing
   * dependencies (passing only intra-user deps), so a missing edge is skipped
   * silently here; only cycles fail.
   */
  private topologicalSortUserPlugins(entries: PluginLoadEntry[]): PluginLoadEntry[] {
    return topologicalSortPlugins(
      entries,
      { source: 'user', failOnMissingDep: false, logCycle: false },
      {
        markFailed: (failure) => this.markPluginFailed(failure),
        isFailed: (id) => this.failedPlugins.has(id),
      },
    )
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

  private clearStateArrays(state: PluginState): void {
    state.routes.length = 0
    state.slots.length = 0
    state.navItems.length = 0
    state.watchPatterns.length = 0
    state.nodeKinds.length = 0
    state.channelIds.length = 0
    state.healthCheckIds.length = 0
    state.healthRepairActionIds.length = 0
  }

  /**
   * Non-destructive sweep of every registry surface a plugin can contribute
   * to: hooks, exec tools, node types, notification channels, health checks,
   * skills, plugin-owned workflow definitions, search runtime wiring, route
   * docs, and the per-plugin state arrays. Never drops search tables —
   * uninstall (`deactivatePlugin`) owns destructive cleanup.
   *
   * Used by the activation-failure path (R18 collisions THROW out of
   * activate(), and everything the plugin registered before the throw must
   * not survive as callable, failed-owner registrations) and delegated to by
   * the hot-reload pipeline. Idempotent — every sub-sweep is no-op-on-empty.
   */
  sweepPluginRegistrations(pluginId: string): void {
    try { getHookRegistry().unregisterByPlugin(pluginId) } catch (err) {
      log.warn('sweep: unregisterByPlugin failed', { pluginId, err: String(err) })
    }
    try { removeExecToolsByPlugin(pluginId) } catch (err) {
      log.warn('sweep: removeExecToolsByPlugin failed', { pluginId, err: String(err) })
    }
    try { unregisterPluginNodeTypes(pluginId) } catch (err) {
      log.warn('sweep: unregisterPluginNodeTypes failed', { pluginId, err: String(err) })
    }
    try { unregisterPluginNotificationChannels(pluginId) } catch (err) {
      log.warn('sweep: unregisterPluginNotificationChannels failed', { pluginId, err: String(err) })
    }
    try { unregisterPluginHealthChecks(pluginId) } catch (err) {
      log.warn('sweep: unregisterPluginHealthChecks failed', { pluginId, err: String(err) })
    }
    try { removePluginSkillsByPlugin(pluginId) } catch (err) {
      log.warn('sweep: removePluginSkillsByPlugin failed', { pluginId, err: String(err) })
    }
    try { unregisterPluginDefinitions(pluginId) } catch (err) {
      log.warn('sweep: unregisterPluginDefinitions failed', { pluginId, err: String(err) })
    }
    // Runtime wiring only — never drops backing search tables.
    try { unregisterContentTypesByPlugin(pluginId) } catch (err) {
      log.warn('sweep: unregisterContentTypesByPlugin failed', { pluginId, err: String(err) })
    }
    try { removeRouteDocsByPlugin(pluginId) } catch (err) {
      log.warn('sweep: removeRouteDocsByPlugin failed', { pluginId, err: String(err) })
    }
    const state = this.plugins.get(pluginId)
    if (state) this.clearStateArrays(state)
  }

  async deactivatePlugin(pluginId: string, opts: { callShutdown?: boolean; removeState?: boolean } = {}): Promise<{
    hooks: number
    execTools: number
    contentTypes: number
    skills: number
  }> {
    const state = this.plugins.get(pluginId)
    const report = { hooks: 0, execTools: 0, contentTypes: 0, skills: 0 }
    if (!state) return report

    if (opts.callShutdown !== false) {
      try {
        await state.plugin.onShutdown?.()
      } catch (err) {
        log.warn(`onShutdown failed during plugin deactivation`, { pluginId, err: String(err) })
      }
    }

    try { report.hooks = getHookRegistry().unregisterByPlugin(pluginId) } catch (err) {
      log.warn('deactivate: unregisterByPlugin failed', { pluginId, err: String(err) })
    }
    try { report.execTools = removeExecToolsByPlugin(pluginId) } catch (err) {
      log.warn('deactivate: removeExecToolsByPlugin failed', { pluginId, err: String(err) })
    }
    try { unregisterPluginNodeTypes(pluginId) } catch (err) {
      log.warn('deactivate: unregisterPluginNodeTypes failed', { pluginId, err: String(err) })
    }
    try { unregisterPluginNotificationChannels(pluginId) } catch (err) {
      log.warn('deactivate: unregisterPluginNotificationChannels failed', { pluginId, err: String(err) })
    }
    try { unregisterPluginHealthChecks(pluginId) } catch (err) {
      log.warn('deactivate: unregisterPluginHealthChecks failed', { pluginId, err: String(err) })
    }
    // Plugin-owned workflow definitions: with cross-plugin id collisions now
    // THROWING (R18), a removed plugin's stale ids would make its workflow
    // ids permanently unclaimable in this process.
    try { unregisterPluginDefinitions(pluginId) } catch (err) {
      log.warn('deactivate: unregisterPluginDefinitions failed', { pluginId, err: String(err) })
    }
    try { removeRouteDocsByPlugin(pluginId) } catch (err) {
      log.warn('deactivate: removeRouteDocsByPlugin failed', { pluginId, err: String(err) })
    }
    try {
      const ownedTables = [...getContentTypes().entries()]
        .filter(([, def]) => def.pluginId === pluginId)
        .map(([table]) => table)
      for (const table of ownedTables) {
        try {
          await purgeContentType(table)
          report.contentTypes++
        } catch (err) {
          log.warn('deactivate: purgeContentType failed', { pluginId, table, err: String(err) })
        }
      }
    } catch (err) {
      log.warn('deactivate: search-registry walk failed', { pluginId, err: String(err) })
    }

    report.skills = removePluginSkillsByPlugin(pluginId)
    this.clearStateArrays(state)
    if (opts.removeState !== false) {
      this.plugins.delete(pluginId)
      corePluginIds.delete(pluginId)
    }
    return report
  }

  async activateUserPluginFromDir(pluginPath: string, opts: { cacheBust?: boolean } = {}): Promise<{ id: string; version: string }> {
    if (!this.runtime) {
      throw new PluginRegistryNotInitializedError('cannot activate user plugin')
    }

    const manifestPath = join(pluginPath, 'bakin-plugin.json')
    if (!existsSync(manifestPath)) {
      throw new Error(`source dir is missing bakin-plugin.json: ${pluginPath}`)
    }

    let manifest: PublicPluginManifest
    try {
      manifest = readPluginManifestJson(readFileSync(manifestPath, 'utf-8'))
    } catch (err) {
      const id = pluginPath.split('/').pop() ?? pluginPath
      this.markPluginFailed({
        id,
        name: id,
        version: '0.0.0',
        description: '',
        source: 'user',
        errorCode: 'manifest_invalid',
        errorMessage: err instanceof PluginManifestError || err instanceof Error ? err.message : String(err),
      })
      throw err
    }

    const deps = manifest.dependencies ?? []
    const missing = deps.filter(dep => !this.plugins.has(dep))
    if (missing.length > 0) {
      const message = `Missing dependencies: ${missing.join(', ')}`
      this.markPluginFailed({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? '',
        source: 'user',
        errorCode: 'missing_dependency',
        errorMessage: message,
        missingDependencies: missing,
      })
      throw new Error(message)
    }

    const failedDeps = deps.filter(dep => this.failedPlugins.has(dep))
    if (failedDeps.length > 0) {
      const message = `Dependency failed: ${failedDeps.join(', ')}`
      this.markPluginFailed({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? '',
        source: 'user',
        errorCode: 'dependency_failed',
        errorMessage: message,
        missingDependencies: failedDeps,
      })
      throw new Error(message)
    }

    try {
      return await this.activateUserPluginEntry(
        { path: pluginPath, id: manifest.id, deps, manifest },
        this.runtime.storage,
        this.runtime.events,
        this.runtime.services,
        opts,
      )
    } catch (err) {
      this.markPluginFailed({
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? '',
        source: 'user',
        errorCode: err instanceof IncompatibleHostError ? 'incompatible_host' : 'activation_failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  /**
   * Register declarative routes from `plugin.routes` into state.routes.
   * Called BEFORE `plugin.activate()` (the spec invariant): every plugin
   * populates `plugin.routes` at module-load time so the static analyzer +
   * the docs generator see the full surface without invoking activate().
   * The only other producer onto state.routes is the search auto-route
   * (an internal registrar — `ctx.registerRoute` no longer exists).
   */
  /**
   * Re-register a reloaded module's declarative routes. Boot registers them
   * inside finalizeActivation; the hot-reload pipeline re-runs activate()
   * against a swept state and must repeat this step itself or every
   * declarative route 404s until re-link (found live: linked bits plugins
   * after the ctx.registerRoute removal). Same validation + manifest
   * enforcement + route-doc registration as boot.
   */
  registerDeclarativeRoutesForReload(plugin: BakinPlugin, pluginId: string): void {
    const state = this.plugins.get(pluginId)
    if (!state) throw new Error(`registerDeclarativeRoutesForReload: plugin "${pluginId}" not registered`)
    this.registerDeclarativeRoutes(plugin, state)
  }

  private registerDeclarativeRoutes(plugin: BakinPlugin, state: PluginState): void {
    const declarative = plugin.routes ?? []
    if (declarative.length === 0) return
    for (const route of declarative) {
      // Cast: declarative RegisteredAPIRoute<C, P, Q, B> is structurally compatible
      // with the legacy RegisteredAPIRoute used by state.routes — same path/method/
      // handler primary fields, plus extra typed schemas the dispatcher
      // adapter knows how to read.
      const erased = route as unknown as RegisteredAPIRoute
      // Bare-literal routes never went through defineRoute's definition-time
      // validation — reject malformed body specs here so a typo'd contentType
      // fails activation with a named route instead of silently parsing to
      // an undefined body at request time.
      assertValidBodySpec((route as { body?: unknown }).body, `${erased.method} ${erased.path}`)
      // T16: declarative routes face the same manifest enforcement as
      // ctx.registerRoute — user plugins must declare every route in
      // contributes.apiRoutes (assertRouteDeclared no-ops for core).
      this.assertRouteDeclared(plugin.id, state, erased)
      state.routes.push(erased)
      // Docs parity: declarative routes feed the runtime /api/docs surface
      // exactly like the (deleted) imperative path always did — without this,
      // getAllRoutes() only ever saw core + search auto-routes.
      registerRouteDoc(plugin.id, erased)
    }
  }

  private assertRouteDeclared(pluginId: string, state: PluginState, route: RegisteredAPIRoute): void {
    if (state.source !== 'user') return
    const declared = state.manifest?.contributes?.apiRoutes ?? []
    // Manifest methods are uppercased at parse; code-side methods are
    // as-authored (plain-JS plugins may register method:'get') — compare
    // case-insensitively so the enforcer and sync-manifest agree.
    const method = route.method.toUpperCase()
    const found = declared.some(item => item.method === method && item.path === route.path)
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
    const expectedPrefix = `bakin_exec_${pluginId}_`
    if (!tool.name.startsWith(expectedPrefix)) {
      throw new Error(
        `Plugin "${pluginId}" registered exec tool "${tool.name}" outside its namespace. ` +
        `User plugin exec tools must start with "${expectedPrefix}".`,
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
    const registerRoute = (route: RegisteredAPIRoute) => {
      // Dedup against declarative routes already registered before
      // activate(). Without this, plugins that declare a route via
      // `routes: [searchRoute(...)]` AND trigger the auto-wire path
      // (ctx.search.registerContentType → opts.registerRoute) would
      // double-register `<method, path>`.
      const exists = state.routes.some(r => r.method === route.method && r.path === route.path)
      if (exists) return
      this.assertRouteDeclared(pluginId, state, route)
      state.routes.push(route)
      registerRouteDoc(pluginId, route)
    }
    const registrars: PluginContextRegistrars = {
      registerNav: (items: NavItem[]) => { state.navItems.push(...items) },
      registerRoute,
      registerSlot: (reg: UISlotRegistration) => { state.slots.push(reg) },
      registerExecTool: <Shape extends ZodRawShape>(tool: ExecToolDefinition<Shape>) => {
        const erased = tool as unknown as ExecToolDefinition
        this.assertExecToolDeclared(pluginId, state, erased)
        erased.source = `plugin:${pluginId}`
        addExecTool(erased)
      },
      // Collision semantics are uniform across every registrar (R18): a
      // duplicate registration THROWS with the collision + owning plugin.
      // Hot reload is safe — the reload pipeline sweeps all five per-plugin
      // registries before re-running activate() (see reload-pipeline.ts).
      registerSkill: (skill: SkillDefinition) => {
        const existing = skillRegistry().get(skill.name)
        if (existing) {
          throw new Error(
            `Skill "${skill.name}" is already registered by ${existing.source ?? 'unknown'} — ` +
            `plugin "${pluginId}" must use a unique skill name`,
          )
        }
        skill.source = `plugin:${pluginId}`
        skillRegistry().set(skill.name, skill)
      },
      registerWorkflow: (def: WorkflowDefinitionInput) => {
        const id = (def.id && def.id.length > 0) ? def.id : slugifyWorkflowId(def.name)
        registerPluginDefinition(pluginId, id, def as unknown as WorkflowDefinition)
      },
      registerNodeType: <T = unknown>(def: PluginNodeTypeInput<T>): string => {
        const namespacedKind = registerPluginNodeType<T>(pluginId, def)
        state.nodeKinds.push(namespacedKind)
        return namespacedKind
      },
      registerNotificationChannel: (def: PluginNotificationChannelInput): string => {
        const namespacedId = registerPluginNotificationChannel(pluginId, def)
        state.channelIds.push(namespacedId)
        return namespacedId
      },
      registerHealthCheck: (def: HealthCheckRegistrationInput): string => {
        const namespacedId = registerPluginHealthCheck(pluginId, def, state.plugin.name)
        state.healthCheckIds.push(namespacedId)
        return namespacedId
      },
      registerHealthRepairAction: (def: HealthRepairActionDefinition): string => {
        const namespacedId = registerPluginHealthRepairAction(pluginId, def, state.plugin.name)
        state.healthRepairActionIds.push(namespacedId)
        return namespacedId
      },
      watchFiles: (patterns: string[]) => { state.watchPatterns.push(...patterns) },
    }
    return buildPluginContext({
      pluginId,
      source: state.source,
      services,
      storage,
      events,
      registrars,
      log: createPluginScopedLogger(pluginId),
      onSettingsChange: (merged) => state.plugin.onSettingsChange?.(merged),
      manifestPermissions: state.manifest?.permissions ?? [],
    })
  }

  /**
   * Shared activation tail for both the core (loadPlugin) and user
   * (activateUserPluginEntry) paths. The two callers differ only in how they
   * ACQUIRE the module (static table + migrations vs dist import + teardown) and
   * in their error contract (core swallows → markPluginFailed; user rethrows);
   * everything from build-context onward is identical modulo the `source`
   * discriminator (span tag, console-capture wrapping, id bookkeeping, log
   * wording, audit manifest arg). Returns the skill-load result so each caller
   * can close its own loadSpan with its own field set.
   *
   * NOTE: logPluginActivation now runs AFTER the plugin state is registered for
   * BOTH paths — the user path previously audited before skills loaded. This is
   * the deliberate boot-path ordering normalization; only the audit/log emission
   * order changes (nothing functional depends on it).
   */
  private async finalizeActivation(
    plugin: BakinPlugin,
    state: PluginState,
    pluginPath: string,
    storage: StorageAdapter,
    events: EventBus,
    services: AppServices,
    opts: { source: 'core' | 'user'; manifestPath: string; manifest?: PublicPluginManifest; captureConsole: boolean },
  ): Promise<ReturnType<typeof loadPluginSkills>> {
    const { source, manifestPath, manifest, captureConsole } = opts
    const ctx = this.buildContext(plugin.id, state, storage, events, services)
    this.registerDeclarativeRoutes(plugin, state)
    const activateSpan = startStartupSpan(log, 'plugin.activate', {
      phase: 'plugin',
      pluginId: plugin.id,
      pluginSource: source,
    })
    try {
      if (captureConsole) {
        await withCapturedPluginConsole(plugin.id, () => plugin.activate(ctx))
      } else {
        await plugin.activate(ctx)
      }
      activateSpan.end({ status: 'ok' })
    } catch (err) {
      activateSpan.end({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      // A throwing activate() is now the DESIGNED collision outcome (R18).
      // Sweep everything the plugin registered before the throw — exec
      // tools, hooks, skills, etc. would otherwise survive as callable
      // registrations owned by a plugin whose status is `failed`.
      this.sweepPluginRegistrations(plugin.id)
      throw err
    }
    state.ctx = ctx
    const skillSpan = startStartupSpan(log, 'plugin.skills', {
      phase: 'plugin',
      pluginId: plugin.id,
      pluginSource: source,
    })
    let skillResult: ReturnType<typeof loadPluginSkills>
    try {
      skillResult = loadPluginSkills(pluginPath, ctx, log)
    } catch (err) {
      skillSpan.end({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      throw err
    }
    skillSpan.end({
      status: skillResult.skipped.length > 0 ? 'error' : 'ok',
      count: skillResult.registered.length,
      skippedCount: skillResult.skipped.length,
    })
    if (skillResult.registered.length > 0) {
      const target = source === 'user' ? `user plugin "${plugin.id}"` : `"${plugin.id}"`
      log.info(`Auto-registered ${skillResult.registered.length} workflow skill(s) for ${target}`, {
        skills: skillResult.registered,
      })
    }
    this.plugins.set(plugin.id, state)
    this.failedPlugins.delete(plugin.id)
    if (source === 'core') {
      corePluginIds.add(plugin.id)
    } else {
      corePluginIds.delete(plugin.id)
    }
    // #142 layer 1 — log requested permissions on every activation so
    // `cat ~/.bakin/audit.jsonl | jq 'select(.event=="plugin.activate")'`
    // shows the full surface the user authorized. For core, the resolved
    // manifest is passed; for user, the helper reads source from the lockfile.
    logPluginActivation({ plugin, source, manifestPath, manifest })
    log.info(`${source === 'user' ? 'User plugin' : 'Plugin'} loaded: ${plugin.name} v${plugin.version}`, {
      source: 'plugin',
      pluginId: plugin.id,
      version: plugin.version,
      pluginSource: source,
    })
    return skillResult
  }

  private async loadPlugin(
    pluginPath: string,
    storage: StorageAdapter,
    events: EventBus,
    services: AppServices,
    manifest?: PublicPluginManifest,
  ): Promise<void> {
    const fallbackId = manifest?.id ?? pluginPath.split('/').pop() ?? pluginPath
    const loadSpan = startStartupSpan(log, 'plugin.load', {
      phase: 'plugin',
      pluginId: fallbackId,
      pluginSource: 'core',
    })
    try {
      // Core plugins come from the static table `server.ts` registers
      // via `registerCorePlugins` — this is what lets `bun build --compile`
      // trace and embed each plugin's module graph. In tests the table
      // stays empty, so we fall back to dynamic import by path (which
      // is how the registry worked before TG1).
      const staticCore = corePluginTable[pluginPath]
      let plugin: BakinPlugin | undefined = staticCore?.plugin
      if (!plugin) {
        // Absolute paths (used by tests + user plugins under ~/.bakin/plugins/)
        // resolve directly. Relative paths (used by core plugins in
        // bakin.config.ts) resolve relative to this file.
        const importSpan = startStartupSpan(log, 'plugin.import', {
          phase: 'plugin',
          pluginId: fallbackId,
          pluginSource: 'core',
        })
        const importTarget = pluginPath.startsWith('/') ? pluginPath : `../../${pluginPath}`
        try {
          const mod = await import(/* webpackIgnore: true */ importTarget)
          plugin = mod.default || mod.plugin || mod
          importSpan.end({ status: 'ok' })
        } catch (err) {
          importSpan.end({ status: 'error', error: err instanceof Error ? err.message : String(err) })
          throw err
        }
      }
      if (!plugin) {
        console.warn(`Plugin at ${pluginPath} returned no export — skipping`)
        loadSpan.end({ status: 'skipped', reason: 'missing-export' })
        return
      }

      if (!plugin.id || !plugin.activate) {
        console.warn(`Plugin at ${pluginPath} missing id or activate — skipping`)
        loadSpan.end({ status: 'skipped', reason: 'missing-id-or-activate' })
        return
      }

      // Run pending data migrations before activating
      const migrationsDir = join(pluginPath, 'migrations')
      if (existsSync(migrationsDir)) {
        const migrationSpan = startStartupSpan(log, 'plugin.migrations', {
          phase: 'plugin',
          pluginId: plugin.id,
          pluginSource: 'core',
        })
        let ran: number
        try {
          ran = await runMigrations(plugin.id, plugin.version, migrationsDir, getContentDir())
          migrationSpan.end({ status: 'ok', count: ran })
        } catch (err) {
          migrationSpan.end({ status: 'error', error: err instanceof Error ? err.message : String(err) })
          throw err
        }
        if (ran > 0) log.info(`Ran ${ran} migration(s) for ${plugin.id}`)
      }

      // Read description from manifest if available
      const resolvedManifest = manifest ?? staticCore?.manifest
      let description = resolvedManifest?.description ?? ''
      const manifestPath = join(pluginPath, 'bakin-plugin.json')
      if (!description && existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
          description = manifest.description || ''
        } catch { /* use empty */ }
      }

      const state: PluginState = {
        plugin,
        manifest: resolvedManifest,
        source: 'core',
        description,
        navItems: plugin.navItems || [],
        routes: [],
        slots: [],
        watchPatterns: [],
        nodeKinds: [],
        channelIds: [],
        healthCheckIds: [],
        healthRepairActionIds: [],
      }

      const skillResult = await this.finalizeActivation(plugin, state, pluginPath, storage, events, services, {
        source: 'core',
        manifestPath,
        manifest: resolvedManifest,
        captureConsole: false,
      })
      loadSpan.end({
        status: 'ok',
        pluginId: plugin.id,
        routes: state.routes.length,
        execTools: undefined,
        skills: skillResult.registered.length,
      })
    } catch (err) {
      loadSpan.end({ status: 'error', error: err instanceof Error ? err.message : String(err) })
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

  private async activateUserPluginEntry(
    entry: PluginLoadEntry,
    storage: StorageAdapter,
    events: EventBus,
    services: AppServices,
    opts: { cacheBust?: boolean } = {},
  ): Promise<{ id: string; version: string }> {
    const manifest = entry.manifest!
    const pluginId = manifest.id
    const manifestPath = join(entry.path, 'bakin-plugin.json')

    // Host-compatibility gate (T15/R13) — the single choke point for both
    // the boot scan and runtime installs/reloads. Core plugins never route
    // through here (they are version-locked to the host by definition).
    const compat = checkBakinRangeCompatibility(manifest.bakin)
    if (!compat.ok) {
      throw new IncompatibleHostError(`User plugin "${pluginId}" is not compatible with this host: ${compat.message}`)
    }
    const loadSpan = startStartupSpan(log, 'plugin.load', {
      phase: 'plugin',
      pluginId,
      pluginSource: 'user',
    })

    // User plugin overrides built-in or replaces a previous user instance.
    // Tear down the currently active registration set before activating
    // the new module so routes/hooks/tools/search tables don't pile up.
    if (this.plugins.has(pluginId)) {
      log.info(`User plugin reloads: ${pluginId}`, {
        source: 'plugin',
        pluginId,
        pluginSource: 'user',
      })
      await this.deactivatePlugin(pluginId, { callShutdown: true, removeState: true })
    }

    const distServer = join(entry.path, 'dist', 'index.js')
    if (!existsSync(distServer)) {
      loadSpan.end({ status: 'error', error: 'plugin dist missing' })
      throw new Error(`User plugin "${pluginId}" is not built. Expected ${distServer}. Reinstall the plugin or rebuild it before starting Bakin.`)
    }

    let importTarget = distServer
    if (opts.cacheBust) {
      userPluginImportCounter += 1
      importTarget = `${importTarget}?v=${Date.now()}-${userPluginImportCounter}`
    }

    const importSpan = startStartupSpan(log, 'plugin.import', {
      phase: 'plugin',
      pluginId,
      pluginSource: 'user',
    })
    let mod: any
    try {
      mod = await withCapturedPluginConsole(pluginId, () => import(/* webpackIgnore: true */ importTarget))
      importSpan.end({ status: 'ok' })
    } catch (err) {
      importSpan.end({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      loadSpan.end({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      throw err
    }
    const plugin: BakinPlugin = mod.default || mod.plugin || mod

    if (!plugin.id || !plugin.activate) {
      loadSpan.end({ status: 'error', error: `User plugin "${entry.id}" missing id or activate` })
      throw new Error(`User plugin "${entry.id}" missing id or activate`)
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
      healthRepairActionIds: [],
    }

    let skillResult: ReturnType<typeof loadPluginSkills>
    try {
      skillResult = await this.finalizeActivation(plugin, state, entry.path, storage, events, services, {
        source: 'user',
        manifestPath,
        captureConsole: true,
      })
    } catch (err) {
      loadSpan.end({ status: 'error', error: err instanceof Error ? err.message : String(err) })
      throw err
    }
    loadSpan.end({
      status: 'ok',
      pluginId: plugin.id,
      routes: state.routes.length,
      skills: skillResult.registered.length,
    })
    return { id: plugin.id, version: plugin.version }
  }

  /**
   * Scan ~/.bakin/plugins/ for user-installed plugins.
   * User plugins with the same ID as built-in plugins override them.
   */
  private async loadUserPlugins(storage: StorageAdapter, events: EventBus, services: AppServices): Promise<void> {
    const userPluginsDir = join(getContentDir(), 'plugins')

    const span = startStartupSpan(log, 'pluginRegistry.loadUserPlugins', {
      phase: 'plugins',
      pluginSource: 'user',
      thresholdMs: 1_000,
    })

    if (!existsSync(userPluginsDir)) {
      span.end({ status: 'skipped', reason: 'user-plugins-dir-missing', count: 0 })
      return
    }

    try {
      const dirEntries = readdirSync(userPluginsDir, { withFileTypes: true })
      const entries: PluginLoadEntry[] = []
      for (const entry of dirEntries) {
        if (!isPluginDirectoryEntry(userPluginsDir, entry.name)) continue

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
          await this.activateUserPluginEntry(entry, storage, events, services)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          log.error(`Failed to load user plugin "${entry.id}": ${message}`, err, { pluginId: entry.id })
          this.markPluginFailed({
            id: entry.id,
            name: entry.manifest?.name ?? entry.id,
            version: entry.manifest?.version ?? '0.0.0',
            description: entry.manifest?.description ?? '',
            source: 'user',
            errorCode: err instanceof IncompatibleHostError ? 'incompatible_host' : 'activation_failed',
            errorMessage: message,
          })
        }
      }
      span.end({ status: 'ok', count: entries.length })
    } catch {
      // ~/.bakin/plugins/ not readable, skip silently
      span.end({ status: 'skipped', reason: 'user-plugins-dir-unreadable' })
    }
  }

  getNavItems(): NavItem[] {
    const items: NavItem[] = []
    for (const state of this.plugins.values()) {
      items.push(...state.navItems)
    }
    return items.sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
  }

  findRoute(pluginId: string, path: string, method: string): RegisteredAPIRoute | null {
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

  /**
   * Enumerate every registered route across every active plugin, paired
   * with the plugin id (scope) for OpenAPI / docs generation. Used by the
   * runtime `/api/docs` builder.
   */
  getAllPluginRoutes(): Array<{ pluginId: string; route: RegisteredAPIRoute }> {
    const out: Array<{ pluginId: string; route: RegisteredAPIRoute }> = []
    for (const [pluginId, state] of this.plugins.entries()) {
      for (const route of state.routes) {
        out.push({ pluginId, route })
      }
    }
    return out
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
    contributes?: PublicPluginManifest['contributes']
    source: 'built-in' | 'user'
    status: 'active' | 'failed'
    errorCode?: PluginFailureState['errorCode']
    errorMessage?: string
    missingDependencies?: string[]
    routes: number
  }> {
    let installedUserPluginVersions: Record<string, string | undefined> = {}
    try {
      const lock = readPluginLockfile()
      installedUserPluginVersions = Object.fromEntries(
        Object.entries(lock.plugins).map(([id, entry]) => [id, entry.version]),
      )
    } catch (err) {
      log.warn('Failed to read plugin lockfile for registry snapshot', err)
    }

    const active = [...this.plugins.entries()].map(([id, state]) => ({
      id,
      name: state.plugin.name,
      version: isCorePlugin(id) ? state.plugin.version : installedUserPluginVersions[id] ?? state.plugin.version,
      description: state.description,
      contributes: state.manifest?.contributes,
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
    const allReadySpan = startStartupSpan(log, 'pluginRegistry.onAllReady', {
      phase: 'plugins',
      count: this.plugins.size,
      thresholdMs: 1_000,
    })
    for (const [id, state] of this.plugins) {
      const span = startStartupSpan(log, 'plugin.onReady', {
        phase: 'plugin',
        pluginId: id,
        pluginSource: state.source,
      })
      try {
        if (state.source === 'user') {
          await withCapturedPluginConsole(id, () => state.plugin.onReady?.())
        } else {
          await state.plugin.onReady?.()
        }
        span.end({ status: 'ok' })
      } catch (err) {
        span.end({ status: 'error', error: err instanceof Error ? err.message : String(err) })
        log.error(`onReady failed for plugin "${id}"`, err)
      }
    }
    log.info(`All plugins ready (${this.plugins.size} loaded)`)
    allReadySpan.end({ status: 'ok', count: this.plugins.size })
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
  getSettingsSchemas(): Array<{ id: string; name: string; schema: PluginSettingsSchema; source: 'built-in' | 'user' }> {
    const result: Array<{ id: string; name: string; schema: PluginSettingsSchema; source: 'built-in' | 'user' }> = []
    for (const [id, state] of this.plugins) {
      if (state.plugin.settingsSchema) {
        result.push({
          id,
          name: state.plugin.name,
          schema: state.plugin.settingsSchema,
          source: isCorePlugin(id) ? 'built-in' as const : 'user' as const,
        })
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
    corePluginTable = {}
    corePluginIds.clear()
    clearPluginSkills()
    this.initialized = false
    this.runtime = null
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
