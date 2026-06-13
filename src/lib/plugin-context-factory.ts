/**
 * The single PluginContext factory.
 *
 * Two call sites build a PluginContext: the plugin loader at activate-time
 * (real registration methods that mutate plugin state) and the per-request
 * plugin-API catch-all (registration is already done, so those methods are
 * no-ops). Everything else — the dynamic service surfaces (storage, runtime,
 * tasks, assets, settings, activity, search, hooks) and the permission wrap —
 * is identical, so it lives here once. The caller supplies the registration
 * behaviour (`registrars`) and the handful of per-context knobs.
 *
 * This replaces two drifted copies (the loader's `buildContext` and the
 * catch-all's `buildCtx`); their `updateSettings` had diverged — the
 * per-request copy silently skipped the `onSettingsChange` notification.
 */
import { join } from 'path'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs'
import type {
  PluginContext,
  StorageAdapter,
  EventBus,
  APIRoute,
  PluginLogger,
} from '@bakin/core/plugin-types'
import type { AppServices } from '@bakin/core/app-services'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { ScopedPluginStorageAdapter } from '../../packages/core/src/storage/scoped-plugin-storage'
import { getContentDir } from '../core/content-dir'
import { appendAudit } from '../core/audit'
import { buildSearchAPI } from '../core/search-registry'
import { wrapPluginContextPermissions } from './plugin-permissions'
import {
  createPluginAssetsAPI,
  createPluginRuntimeFacade,
  createPluginTaskService,
} from './plugin-context-services'

/** The registration methods — real (activate-time) or no-op (per-request). */
export interface PluginContextRegistrars {
  registerNav: PluginContext['registerNav']
  registerRoute: PluginContext['registerRoute']
  registerSlot: PluginContext['registerSlot']
  registerExecTool: PluginContext['registerExecTool']
  registerSkill: PluginContext['registerSkill']
  registerWorkflow: PluginContext['registerWorkflow']
  registerNodeType: PluginContext['registerNodeType']
  registerNotificationChannel: PluginContext['registerNotificationChannel']
  registerHealthCheck: PluginContext['registerHealthCheck']
  watchFiles: PluginContext['watchFiles']
}

export interface BuildPluginContextOptions {
  pluginId: string
  source: 'core' | 'user'
  services: AppServices
  /** Base storage for core plugins; user plugins always get a scoped adapter. */
  storage: StorageAdapter
  events: EventBus
  registrars: PluginContextRegistrars
  /** True for the per-request path: skip watcher/startup-reconcile wiring. */
  skipFileBackedWiring?: boolean
  /** Audit source tag ('rest' for the per-request path; undefined = default). */
  auditSource?: 'human' | 'mcp' | 'rest' | 'cli' | 'system'
  /** Plugin-scoped logger (activate-time). Optional on the per-request path. */
  log?: PluginLogger
  /** Fired after updateSettings persists — the notification both paths now share. */
  onSettingsChange?: (merged: Record<string, unknown>) => void
  manifestPermissions: string[]
}

function settingsPathFor(pluginId: string): { dir: string; file: string } {
  const dir = join(getContentDir(), 'plugin-settings')
  return { dir, file: join(dir, `${pluginId}.json`) }
}

export function buildPluginContext(opts: BuildPluginContextOptions): PluginContext {
  const { pluginId, source, services, events, registrars } = opts
  const storage = source === 'user'
    ? new ScopedPluginStorageAdapter(getContentDir(), pluginId)
    : opts.storage
  const runtime = source === 'user' ? createPluginRuntimeFacade(services.runtime) : services.runtime

  const ctx: PluginContext = {
    storage,
    events,
    pluginId,
    runtime,
    tasks: createPluginTaskService(services.tasks),
    assets: createPluginAssetsAPI(),
    registerNav: registrars.registerNav,
    registerRoute: registrars.registerRoute,
    registerSlot: registrars.registerSlot,
    registerExecTool: registrars.registerExecTool,
    registerSkill: registrars.registerSkill,
    registerWorkflow: registrars.registerWorkflow,
    registerNodeType: registrars.registerNodeType,
    registerNotificationChannel: registrars.registerNotificationChannel,
    registerHealthCheck: registrars.registerHealthCheck,
    watchFiles: registrars.watchFiles,
    getSettings: <T = Record<string, unknown>>(): T => {
      const { file } = settingsPathFor(pluginId)
      try {
        if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf-8')) as T
      } catch { /* return empty */ }
      return {} as T
    },
    updateSettings: (patch: Record<string, unknown>): void => {
      const { dir, file } = settingsPathFor(pluginId)
      let current: Record<string, unknown> = {}
      try {
        if (existsSync(file)) current = JSON.parse(readFileSync(file, 'utf-8'))
      } catch { /* start fresh */ }
      const merged = { ...current, ...patch }
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(file, JSON.stringify(merged, null, 2))
      opts.onSettingsChange?.(merged)
    },
    activity: {
      log: (agent: string, message: string, logOpts?: { taskId?: string; category?: string }) => {
        const broadcastFn = (globalThis as Record<string, unknown>).__bakinBroadcast as
          | ((data: Record<string, unknown>) => void)
          | undefined
        if (broadcastFn) {
          broadcastFn({
            type: 'activity',
            agent,
            message,
            ts: new Date().toISOString(),
            pluginId,
            ...(logOpts?.taskId ? { taskId: logOpts.taskId } : {}),
            ...(logOpts?.category ? { category: logOpts.category } : {}),
          })
        }
      },
      audit: (event: string, agent: string, data?: Record<string, unknown>) => {
        // Only pass the channel arg when set, preserving the activate-time call
        // shape (no channel) vs the per-request path ('rest').
        if (opts.auditSource) {
          appendAudit(getContentDir(), `${pluginId}.${event}`, agent, data || {}, opts.auditSource)
        } else {
          appendAudit(getContentDir(), `${pluginId}.${event}`, agent, data || {})
        }
      },
    },
    ...(opts.log ? { log: opts.log } : {}),
    search: buildSearchAPI(pluginId, {
      registerRoute: registrars.registerRoute,
      ...(opts.skipFileBackedWiring ? { skipFileBackedWiring: true } : {}),
    }),
    hooks: {
      register: (name, handler, metadata) =>
        getHookRegistry().register(name, handler as (data: unknown) => unknown, { pluginId, metadata }),
      call: <T>(name: string, data: T) => getHookRegistry().call<T>(name, data),
      callAll: (name: string, data: Record<string, unknown>) => getHookRegistry().callAll(name, data),
      has: (name: string) => getHookRegistry().has(name),
      invoke: <R>(name: string, data: unknown) => getHookRegistry().invoke<R>(name, data),
    },
  }

  return wrapPluginContextPermissions(ctx, {
    pluginId,
    source,
    manifestPermissions: opts.manifestPermissions,
  })
}

/** No-op registrars for the per-request path (everything is already registered). */
export function noopRegistrars(pluginId: string): PluginContextRegistrars {
  return {
    registerNav: () => {},
    registerRoute: (_route: APIRoute) => {},
    registerSlot: () => {},
    registerExecTool: () => {},
    registerSkill: () => {},
    registerWorkflow: () => {},
    registerNodeType: (def) => `${pluginId}.${def.kind}`,
    registerNotificationChannel: (def) => `${pluginId}.${def.id}`,
    registerHealthCheck: (def) => `${pluginId}.${def.id}`,
    watchFiles: () => {},
  }
}
