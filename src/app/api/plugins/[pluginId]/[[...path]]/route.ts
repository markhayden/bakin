/**
 * Catch-all API route for plugin-registered handlers.
 * Dispatches /api/plugins/:pluginId/:path to the plugin's registered route handler.
 */
import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { MarkdownStorageAdapter } from '@/lib/storage/markdown-adapter'
import { BakinEventBus } from '@/lib/events/event-bus'
import { getContentDir } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import { buildSearchAPI } from '@/core/search-registry'
import type { PluginContext, BakinPlugin, APIRoute, SearchAPI } from '@/lib/plugin-types'

const log = createLogger('plugin-route')

/** Build the settings + activity for a lightweight PluginContext */
function buildCtxExtras(pluginId: string): Pick<PluginContext, 'getSettings' | 'updateSettings' | 'activity' | 'hooks' | 'search'> {
  return {
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
        // appendAudit writes to audit.jsonl + broadcasts via SSE
        const contentDir = getContentDir()
        const entry = JSON.stringify({
          ts: new Date().toISOString(),
          event: `${pluginId}.${event}`,
          agent,
          ...(data || {}),
        })
        const auditPath = join(contentDir, 'audit.jsonl')
        try { appendFileSync(auditPath, entry + '\n') } catch { /* best-effort */ }
        const broadcastFn = (globalThis as any).__bakinBroadcast
        if (broadcastFn) {
          broadcastFn({ type: 'audit', event: `${pluginId}.${event}`, agent, ...data })
        }
      },
    },
    // Delegate read/write methods to the real, globalThis-backed registry so
    // plugin REST handlers can actually query and mutate Antfly. Registration
    // methods are stubbed: the custom server in server.ts has already
    // activated every plugin with the real API, populating the shared
    // registry and wiring the watcher hooks. Re-registering here would
    // double-fire watcher sync/unlink hooks.
    search: (() => {
      const real = buildSearchAPI(pluginId)
      const api: SearchAPI = {
        registerContentType: () => {},
        registerFileBackedContentType: () => {},
        index: real.index,
        remove: real.remove,
        transform: real.transform,
        query: real.query,
      }
      return api
    })(),
    hooks: {
      register: (name: string, handler: (data: any) => any) => {
        const registry = (globalThis as any).__bakinHookRegistry
        if (registry) return registry.register(name, handler)
        return () => {}
      },
      has: (name: string) => {
        const registry = (globalThis as any).__bakinHookRegistry
        return registry ? registry.has(name) : false
      },
      invoke: async (name: string, data: unknown) => {
        const registry = (globalThis as any).__bakinHookRegistry
        return registry ? registry.invoke(name, data) : undefined
      },
    },
  }
}

// Direct plugin imports (can't use dynamic import in Next.js bundle)
import tasksPlugin from '@bakin/tasks'
import memoryPlugin from '@bakin/memory'
import modelsPlugin from '@bakin/models'
import messagingPlugin from '@bakin/messaging'
import workflowsPlugin from '@bakin/workflows'
import assetsPlugin from '@bakin/assets'
import healthPlugin from '@bakin/health'
import schedulePlugin from '@bakin/schedule'
import projectsPlugin from '@bakin/projects'
import teamPlugin from '@bakin/team'

interface PluginState {
  plugin: BakinPlugin
  routes: APIRoute[]
}

const pluginStates = new Map<string, PluginState>()
let initialized = false

/**
 * Broadcast function that relays events to the custom server's SSE system.
 * Next.js API routes run in a separate context, so we POST to the activity
 * emit endpoint which the custom server handles and broadcasts via SSE.
 */
function relayBroadcast(data: Record<string, unknown>): void {
  const port = process.env.PORT || 3737
  fetch(`http://localhost:${port}/api/activity/emit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(() => {
    // Best effort — server may not be ready during init
  })
}

function ensureInitialized() {
  if (initialized) return
  initialized = true
  console.log('[api-route] Initializing plugin routes...')

  const storage = new MarkdownStorageAdapter()
  const events = new BakinEventBus(relayBroadcast)

  const plugins = [teamPlugin, tasksPlugin, memoryPlugin, modelsPlugin, messagingPlugin, workflowsPlugin, assetsPlugin, healthPlugin, schedulePlugin, projectsPlugin]

  for (const plugin of plugins) {
    if (!plugin.id || !plugin.activate) continue

    const state: PluginState = {
      plugin,
      routes: [],
    }

    const ctx: PluginContext = {
      storage,
      events,
      pluginId: plugin.id,
      registerNav: () => {},
      registerRoute: (route: APIRoute) => { state.routes.push(route) },
      registerSlot: () => {},
      registerExecTool: () => {},
      registerSkill: () => {},
      watchFiles: () => {},
      ...buildCtxExtras(plugin.id),
    }

    plugin.activate(ctx)
    pluginStates.set(plugin.id, state)
    console.log(`[api-route] Plugin ${plugin.id}: ${state.routes.length} routes registered`)
  }
}

/**
 * Match a request path against registered routes, supporting :param segments.
 * Exact matches take priority. Returns the matched route and extracted path params.
 */
function matchRoute(pluginId: string, path: string, method: string): { route: APIRoute; params: Record<string, string> } | null {
  const state = pluginStates.get(pluginId)
  if (!state) return null
  const upperMethod = method.toUpperCase()

  // 1. Exact match (fast path, backward compatible)
  const exact = state.routes.find(r => r.path === path && r.method === upperMethod)
  if (exact) return { route: exact, params: {} }

  // 2. Parameterized match — e.g. /definitions/:name matches /definitions/my-workflow
  const reqSegments = path.split('/').filter(Boolean)
  for (const route of state.routes) {
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

function buildContext(pluginId: string): PluginContext {
  const storage = new MarkdownStorageAdapter()
  const events = new BakinEventBus(relayBroadcast)
  return {
    storage,
    events,
    pluginId,
    registerNav: () => {},
    registerRoute: () => {},
    registerSlot: () => {},
    registerExecTool: () => {},
    registerSkill: () => {},
    watchFiles: () => {},
    ...buildCtxExtras(pluginId),
  }
}

async function handleRequest(
  req: Request,
  { params }: { params: Promise<{ pluginId: string; path?: string[] }> }
) {
  ensureInitialized()

  const { pluginId, path: pathSegments } = await params
  const routePath = '/' + (pathSegments || []).join('/')
  const method = req.method

  const match = matchRoute(pluginId, routePath, method)
  if (!match) {
    return NextResponse.json(
      { error: `No ${method} handler for ${pluginId}${routePath}` },
      { status: 404 }
    )
  }

  try {
    // Inject extracted path params into the request URL's searchParams
    // so handlers can read them the same way as query params
    let handlerReq = req
    if (Object.keys(match.params).length > 0) {
      const url = new URL(req.url)
      for (const [key, value] of Object.entries(match.params)) {
        if (!url.searchParams.has(key)) {
          url.searchParams.set(key, value)
        }
      }
      handlerReq = new Request(url.toString(), {
        method: req.method,
        headers: req.headers,
        body: req.body,
        // @ts-expect-error duplex is needed for streaming request bodies
        duplex: 'half',
      })
    }

    const ctx = buildContext(pluginId)
    return await match.route.handler(handlerReq, ctx)
  } catch (err) {
    log.error('Plugin route error', err, { pluginId, routePath, method })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export const GET = handleRequest
export const POST = handleRequest
export const PUT = handleRequest
export const PATCH = handleRequest
export const DELETE = handleRequest
