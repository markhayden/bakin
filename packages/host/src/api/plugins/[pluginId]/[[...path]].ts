/**
 * Catch-all handler for /api/plugins/:pluginId/:path*.
 *
 * Dispatches to the plugin's registered route handler (via
 * `ctx.registerRoute` during plugin activation). Supports `:param` segments
 * in registered route paths.
 *
 * Previously this lived at src/app/api/plugins/[pluginId]/[[...path]]/route.ts
 * as a Next.js App Router catch-all. That file had to lazy-activate all 10
 * plugins in its own module context because Next.js API routes run in
 * isolated webpack-compiled contexts that don't share state with server.ts.
 *
 * Post-TB18 we just use the real `pluginRegistry` from the server scope —
 * plugins are activated once at boot, routes are already registered, ctx
 * lookups go through the real globals. ~170 lines of duplication removed.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { MarkdownStorageAdapter } from '@/lib/storage/markdown-adapter'
import { ScopedPluginStorageAdapter } from '@bakin/core/storage/scoped-plugin-storage'
import { BakinEventBus } from '@/lib/events/event-bus'
import { getContentDir } from '@/core/content-dir'
import { getAppServices } from '@/core/app-services'
import { createLogger } from '@/core/logger'
import { buildSearchAPI } from '@/core/search-registry'
import { appendAudit } from '@/core/audit'
import { pluginRegistry } from '@/lib/plugin-registry'
import {
  createPluginAssetsAPI,
  createPluginRuntimeFacade,
  createPluginTaskService,
} from '@/lib/plugin-context-services'
import { wrapPluginContextPermissions } from '@/lib/plugin-permissions'
import { stampPluginResponse } from '@/core/plugin-host/version-stamp'
import type { PluginContext, APIRoute } from '@bakin/core/plugin-types'
import { dispatchRoute } from '@bakin/core/routing'

const log = createLogger('plugin-route')

/**
 * Rebuild a per-request PluginContext. The activate-time registration APIs
 * (registerRoute/Nav/Slot/etc.) are no-ops here — everything was already
 * registered at plugin-registry initialize. The dynamic surfaces
 * (settings, activity, hooks, search) read/write through the real globals.
 */
function buildCtx(pluginId: string): PluginContext {
  const services = getAppServices()
  const state = pluginRegistry.getPluginState(pluginId)
  const storage = state?.source === 'user'
    ? new ScopedPluginStorageAdapter(getContentDir(), pluginId)
    : new MarkdownStorageAdapter()
  const events = new BakinEventBus((data) => {
    const broadcastFn = (globalThis as Record<string, unknown>).__bakinBroadcast as
      | ((data: Record<string, unknown>) => void)
      | undefined
    if (broadcastFn) broadcastFn(data as Record<string, unknown>)
  })
  const noopRegisterRoute = () => {}
  const assets = createPluginAssetsAPI()
  const ctx: PluginContext = {
    storage,
    events,
    pluginId,
    runtime: state?.source === 'user' ? createPluginRuntimeFacade(services.runtime) : services.runtime,
    tasks: createPluginTaskService(services.tasks),
    assets,
    registerNav: () => {},
    registerRoute: noopRegisterRoute,
    registerSlot: () => {},
    registerExecTool: () => {},
    registerSkill: () => {},
    registerWorkflow: () => {},
    registerNodeType: (def) => `${pluginId}.${def.kind}`,
    registerNotificationChannel: (def) => `${pluginId}.${def.id}`,
    registerHealthCheck: (def) => `${pluginId}.${def.id}`,
    watchFiles: () => {},
    getSettings: <T = Record<string, unknown>>(): T => {
      const p = join(getContentDir(), 'plugin-settings', `${pluginId}.json`)
      try { if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf-8')) as T } catch {}
      return {} as T
    },
    updateSettings: (patch: Record<string, unknown>) => {
      const dir = join(getContentDir(), 'plugin-settings')
      const p = join(dir, `${pluginId}.json`)
      let cur: Record<string, unknown> = {}
      try { if (existsSync(p)) cur = JSON.parse(readFileSync(p, 'utf-8')) } catch {}
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(p, JSON.stringify({ ...cur, ...patch }, null, 2))
    },
    activity: {
      log: (agent, message, opts) => {
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
            ...(opts?.taskId ? { taskId: opts.taskId } : {}),
            ...(opts?.category ? { category: opts.category } : {}),
          })
        }
      },
      audit: (event, agent, data) => {
        appendAudit(getContentDir(), `${pluginId}.${event}`, agent, data || {}, 'rest')
      },
    },
    search: buildSearchAPI(pluginId, { registerRoute: noopRegisterRoute, skipFileBackedWiring: true }),
    hooks: {
      register: (name, handler, metadata) => {
        const registry = (globalThis as Record<string, unknown>).__bakinHookRegistry as
          | { register: (n: string, h: (data: unknown) => unknown, options?: unknown) => () => void }
          | undefined
        if (registry) return registry.register(name, handler as (data: unknown) => unknown, { pluginId, metadata })
        return () => {}
      },
      call: async <T>(name: string, data: T) => {
        const registry = (globalThis as Record<string, unknown>).__bakinHookRegistry as
          | { call: <T>(n: string, d: T) => Promise<T> }
          | undefined
        return registry ? registry.call<T>(name, data) : data
      },
      callAll: async (name: string, data: Record<string, unknown>) => {
        const registry = (globalThis as Record<string, unknown>).__bakinHookRegistry as
          | { callAll: (n: string, d: Record<string, unknown>) => Promise<void> }
          | undefined
        if (registry) await registry.callAll(name, data)
      },
      has: (name) => {
        const registry = (globalThis as Record<string, unknown>).__bakinHookRegistry as
          | { has: (n: string) => boolean }
          | undefined
        return registry ? registry.has(name) : false
      },
      invoke: async <R>(name: string, data: unknown) => {
        const registry = (globalThis as Record<string, unknown>).__bakinHookRegistry as
          | { invoke: <R>(n: string, d: unknown) => Promise<R | undefined> }
          | undefined
        return registry ? registry.invoke<R>(name, data) : undefined
      },
    },
  }
  return wrapPluginContextPermissions(ctx, {
    pluginId,
    source: state?.source ?? 'user',
    manifestPermissions: state?.manifest?.permissions ?? [],
  })
}

/**
 * Match a request path against a plugin's registered routes, supporting
 * `:param` segments. Exact matches take priority over parameterized ones.
 */
function matchRoute(
  routes: APIRoute[],
  path: string,
  method: string,
): { route: APIRoute; params: Record<string, string> } | null {
  const upperMethod = method.toUpperCase()

  const exact = routes.find(r => r.path === path && r.method === upperMethod)
  if (exact) return { route: exact, params: {} }

  const reqSegments = path.split('/').filter(Boolean)
  for (const route of routes) {
    if (route.method !== upperMethod) continue
    const routeSegments = route.path.split('/').filter(Boolean)
    if (routeSegments.length !== reqSegments.length) continue

    const params: Record<string, string> = {}
    let match = true
    for (let i = 0; i < routeSegments.length; i++) {
      if (routeSegments[i].startsWith(':')) {
        params[routeSegments[i].slice(1)] = reqSegments[i]
      } else if (routeSegments[i] !== reqSegments[i]) {
        match = false
        break
      }
    }
    if (match) return { route, params }
  }

  return null
}

async function handle(req: Request, url: URL): Promise<Response> {
  // Parse /api/plugins/<pluginId>/<subpath>* from url.pathname
  const match = url.pathname.match(/^\/api\/plugins\/([^/]+)(\/.*)?$/)
  if (!match) {
    return Response.json({ error: 'Invalid plugin route path' }, { status: 404 })
  }
  const [, pluginId, subpathRaw] = match
  const subpath = subpathRaw || '/'
  const method = req.method

  const state = pluginRegistry.getPluginState(pluginId)
  if (!state) {
    return Response.json({ error: `Plugin "${pluginId}" not registered` }, { status: 404 })
  }

  const routeMatch = matchRoute(state.routes, subpath, method)
  if (!routeMatch) {
    return Response.json(
      { error: `No ${method} handler for ${pluginId}${subpath}` },
      { status: 404 },
    )
  }

  const startedAt = Date.now()
  const actor = req.headers.get('x-bakin-agent') || 'human'

  try {
    // Inject :param extractions into handlerReq's searchParams so legacy
    // handlers (those still using `url.searchParams.get('taskId')` style)
    // continue to work alongside routes that consume `parsed.params`.
    let handlerReq = req
    if (Object.keys(routeMatch.params).length > 0) {
      const newUrl = new URL(req.url)
      for (const [key, value] of Object.entries(routeMatch.params)) {
        if (!newUrl.searchParams.has(key)) newUrl.searchParams.set(key, value)
      }
      handlerReq = new Request(newUrl.toString(), {
        method: req.method,
        headers: req.headers,
        body: req.body,
        // @ts-expect-error duplex is needed for streaming request bodies
        duplex: 'half',
      })
    }

    const ctx = buildCtx(pluginId)
    // Run through the dispatcher: when the route declares typed
    // params/query/body or legacy input/output schemas, the dispatcher
    // validates and short-circuits with 400/415 on bad input. Routes with
    // no schemas fall through to the handler unchanged.
    const res = await dispatchRoute({
      req: handlerReq,
      ctx,
      route: routeMatch.route as Parameters<typeof dispatchRoute>[0]['route'],
      params: routeMatch.params,
    })

    // Audit write methods + any failure.
    const durationMs = Date.now() - startedAt
    const isWrite = method !== 'GET' && method !== 'HEAD'
    const isError = res.status >= 400
    if (isWrite || isError) {
      const tag = isError ? 'fail' : 'ok'
      appendAudit(
        getContentDir(),
        `rest.${pluginId}.${method.toLowerCase()}.${tag}`,
        actor,
        { path: subpath, status: res.status, durationMs, duplicate: true },
        'rest',
      )
    }
    return stampPluginResponse(pluginId, res)
  } catch (err) {
    const durationMs = Date.now() - startedAt
    log.error('Plugin route error', err, { pluginId, subpath, method })
    appendAudit(
      getContentDir(),
      `rest.${pluginId}.${method.toLowerCase()}.error`,
      actor,
      { path: subpath, status: 500, durationMs, error: err instanceof Error ? err.message : String(err) },
      'rest',
    )
    return stampPluginResponse(
      pluginId,
      Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 }),
    )
  }
}

export const get = handle
export const post = handle
export const put = handle
export const patch = handle
export const del = handle
