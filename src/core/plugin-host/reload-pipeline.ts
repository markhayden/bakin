/**
 * Server-side hot-reload pipeline (Phase 2 P2.C7).
 *
 * `runReloadPipeline(pluginId, dir)` performs an in-process swap of a
 * linked plugin's server-side module:
 *
 *   1. Run the old plugin's `onShutdown()` (errors logged, never throw).
 *   2. Sweep every registry the plugin contributed to: exec tools, hooks,
 *      workflow node types, notification channels, health checks, search
 *      content types. Empty the state's per-plugin arrays so the next
 *      activate doesn't pile registrations on top of the swept ones.
 *   3. Cache-bust import the new module (`<dir>/dist/index.js?v=<n>`).
 *   4. Run the new plugin's `activate(ctx)`. The same `ctx` from the
 *      previous activation is reused; its closures already reference the
 *      `state` arrays we just emptied, so the new plugin's registrations
 *      land cleanly.
 *   5. On success: replace `state.plugin` with the new module, bump the
 *      version, broadcast `dev:plugin:reload` (the client + the
 *      version-mismatch detector both react to it).
 *   6. On failure: re-run the sweep, broadcast `dev:plugin:error`, leave
 *      the plugin entry in the registry with no registrations (effective
 *      "disabled" state — every route returns 404 until reload succeeds).
 *
 * The coordinator (P2.C8) calls this function and owns the file watcher
 * + per-plugin pipeline mutex. The pipeline itself is single-shot and
 * makes no assumptions about concurrency — callers serialize.
 *
 * Module is server-only and dev-only. The compiled binary doesn't ship
 * a watcher, so production never imports this code path.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from '@/core/logger'
import { pluginRegistry, getHookRegistry } from '@/lib/plugin-registry'
import { removeExecToolsByPlugin } from '../../../scripts/lib/registry'
import { unregisterPluginNodeTypes } from '../../../plugins/workflows/lib/node-type-registry'
import { unregisterPluginNotificationChannels } from '../../../plugins/workflows/lib/notification-channel-registry'
import { unregisterPluginHealthChecks } from '../../../plugins/health/lib/health-check-registry'
import { getContentTypes, purgeContentType } from '@/core/search-registry'
import {
  bumpVersion,
  getVersion,
} from './version-stamp'
import {
  broadcastPluginReload,
  broadcastPluginError,
  broadcastPluginRecover,
} from '@/core/sse'
import type { BakinPlugin, PluginContext } from '@bakin/core/plugin-types'

const log = createLogger('reload-pipeline')

export interface ReloadResult {
  ok: boolean
  /** Final version recorded after a successful reload, or the unchanged version on failure. */
  version: number
  /** Set when the reload failed — caller surfaces in the dev overlay. */
  error?: string
  /** Stage at which the reload failed. Aids debugging + integration tests. */
  failedAt?: 'not-registered' | 'import' | 'activate'
}

/**
 * Track plugins whose previous reload ended in failure. The next
 * successful reload of a "previously errored" plugin emits a
 * `dev:plugin:recover` event so the dev overlay can clear.
 */
const erroredPlugins = new Set<string>()

/**
 * Process-lifetime monotonic counter used as the `?v=` cache-bust
 * suffix on import. Distinct from `version-stamp.ts`'s per-plugin
 * version because the version-stamp only bumps on SUCCESS — reloads
 * that fail in import or activate must still get a fresh URL on the
 * NEXT attempt, otherwise Bun's module cache returns the previous
 * (failing) module and the user can't recover even after fixing the
 * code. Bumps unconditionally before every import, never decrements.
 */
let importAttemptCounter = 0
function nextImportAttempt(): number {
  importAttemptCounter += 1
  return importAttemptCounter
}

/** Empty all per-plugin state arrays — safe to call multiple times. */
function clearStateArrays(state: {
  routes: unknown[]
  slots: unknown[]
  navItems: unknown[]
  watchPatterns: unknown[]
  nodeKinds: unknown[]
  channelIds: unknown[]
  healthCheckIds: unknown[]
}): void {
  state.routes.length = 0
  state.slots.length = 0
  state.navItems.length = 0
  state.watchPatterns.length = 0
  state.nodeKinds.length = 0
  state.channelIds.length = 0
  state.healthCheckIds.length = 0
}

/**
 * Sweep every registry surface a plugin can contribute to. Idempotent —
 * each sub-helper is no-op-on-empty so a re-sweep after a half-successful
 * activate doesn't double-error.
 */
async function sweepPluginRegistrations(pluginId: string): Promise<void> {
  try { removeExecToolsByPlugin(pluginId) } catch (err) {
    log.warn('sweep: removeExecToolsByPlugin failed', { pluginId, err: String(err) })
  }
  try { getHookRegistry().unregisterByPlugin(pluginId) } catch (err) {
    log.warn('sweep: unregisterByPlugin failed', { pluginId, err: String(err) })
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
  // Search content types — there can be more than one in principle; purge each.
  try {
    const contentTypes = getContentTypes()
    const tablesToPurge: string[] = []
    for (const [tableName, def] of contentTypes) {
      if (def.pluginId === pluginId) tablesToPurge.push(tableName)
    }
    for (const tableName of tablesToPurge) {
      try { await purgeContentType(tableName) } catch (err) {
        log.warn('sweep: purgeContentType failed', { pluginId, tableName, err: String(err) })
      }
    }
  } catch (err) {
    log.warn('sweep: search-registry walk failed', { pluginId, err: String(err) })
  }
}

/**
 * Resolve the dist entry path inside a plugin dir. `buildUserPlugin`
 * always emits `dist/index.js`; tests and rare hand-built fixtures may
 * use `dist/index.mjs`. Probe both. Caller appends `?v=<n>` to the
 * returned path so Bun's import cache treats each reload as fresh.
 */
async function resolveDistEntry(dir: string, version: number): Promise<string> {
  const jsPath = join(dir, 'dist', 'index.js')
  const mjsPath = join(dir, 'dist', 'index.mjs')
  if (existsSync(jsPath)) return `${jsPath}?v=${version}`
  if (existsSync(mjsPath)) return `${mjsPath}?v=${version}`
  // Fall back to `index.js` so the import error message points at the
  // canonical name when neither exists.
  return `${jsPath}?v=${version}`
}

/** Look up the resolved BakinPlugin instance from a freshly-imported module. */
function resolvePluginExport(mod: unknown): BakinPlugin | null {
  if (!mod || typeof mod !== 'object') return null
  const m = mod as { default?: BakinPlugin; plugin?: BakinPlugin; activate?: BakinPlugin['activate'] }
  if (m.default && typeof m.default.activate === 'function') return m.default
  if (m.plugin && typeof m.plugin.activate === 'function') return m.plugin
  if (typeof m.activate === 'function') return m as unknown as BakinPlugin
  return null
}

/**
 * Run the full reload cycle for a single plugin id. Caller (P2.C8's
 * coordinator) owns serialization — this function does no locking and
 * assumes the previous invocation for the same id has settled.
 */
export async function runReloadPipeline(args: {
  pluginId: string
  dir: string
}): Promise<ReloadResult> {
  const { pluginId, dir } = args
  const state = pluginRegistry.getPluginState(pluginId)
  if (!state) {
    return { ok: false, version: getVersion(pluginId), error: `plugin "${pluginId}" not registered`, failedAt: 'not-registered' }
  }
  if (!state.ctx) {
    // Should never happen — initialize() always caches ctx — but guard anyway.
    return { ok: false, version: getVersion(pluginId), error: `plugin "${pluginId}" has no cached ctx; restart required`, failedAt: 'not-registered' }
  }

  const ctx: PluginContext = state.ctx

  // Step 1: onShutdown. Errors logged but never propagate — the new
  // module is going to land regardless of how cleanly the old one bowed
  // out, otherwise a buggy onShutdown would brick the dev loop.
  try {
    await state.plugin.onShutdown?.()
  } catch (err) {
    log.warn('onShutdown threw during reload (continuing)', { pluginId, err: String(err) })
  }

  // Step 2: sweep registries + clear state arrays.
  await sweepPluginRegistrations(pluginId)
  clearStateArrays(state)

  // Step 3: cache-bust import. Bun resolves `?v=<n>` as a fresh module
  // graph entry — every reload sees the file system's current bytes.
  // `dist/index.js` is the canonical output of buildUserPlugin; tests
  // and edge cases may produce `.mjs` instead, so we try both.
  //
  // Use the always-increment importAttemptCounter rather than the
  // success-only plugin version so a retry after a failed reload still
  // gets a fresh module URL.
  const importVersion = nextImportAttempt()
  const importTarget = await resolveDistEntry(dir, importVersion)
  let mod: unknown
  try {
    mod = await import(/* @vite-ignore */ importTarget)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('reload: dynamic import failed', err as Error, { pluginId, importTarget })
    erroredPlugins.add(pluginId)
    broadcastPluginError(pluginId, `dynamic import failed: ${message}`)
    return { ok: false, version: getVersion(pluginId), error: message, failedAt: 'import' }
  }

  const newPlugin = resolvePluginExport(mod)
  if (!newPlugin) {
    const message = `module ${importTarget} returned no usable BakinPlugin export`
    log.error(message, undefined, { pluginId })
    erroredPlugins.add(pluginId)
    broadcastPluginError(pluginId, message)
    return { ok: false, version: getVersion(pluginId), error: message, failedAt: 'import' }
  }

  // Step 4: activate. On throw, re-sweep so any partial registrations
  // the activate body managed to complete are gone.
  try {
    await newPlugin.activate(ctx)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('reload: activate threw', err as Error, { pluginId })
    await sweepPluginRegistrations(pluginId)
    clearStateArrays(state)
    erroredPlugins.add(pluginId)
    broadcastPluginError(pluginId, `activate() threw: ${message}`)
    return { ok: false, version: getVersion(pluginId), error: message, failedAt: 'activate' }
  }

  // Step 5: success. Swap the plugin instance + bump the version.
  state.plugin = newPlugin
  const newVersion = bumpVersion(pluginId)

  if (erroredPlugins.has(pluginId)) {
    // Coming back from a previous failure — let the client clear its
    // error overlay before swapping the bundle in.
    erroredPlugins.delete(pluginId)
    broadcastPluginRecover(pluginId)
  }
  broadcastPluginReload(pluginId, newVersion)

  log.info('reload succeeded', { pluginId, version: newVersion })
  return { ok: true, version: newVersion }
}

/** Clear cross-test state. Test-only. */
export function __resetReloadPipelineForTest(): void {
  erroredPlugins.clear()
  importAttemptCounter = 0
}
