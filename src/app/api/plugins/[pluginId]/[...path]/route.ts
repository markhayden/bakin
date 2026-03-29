/**
 * Catch-all API route for plugin-registered handlers.
 * Dispatches /api/plugins/:pluginId/:path to the plugin's registered route handler.
 */
import { NextResponse } from 'next/server'
import { MarkdownStorageAdapter } from '@/lib/storage/markdown-adapter'
import { MCEventBus } from '@/lib/events/event-bus'
import type { PluginContext, MCPlugin, APIRoute } from '@/lib/plugin-types'

// Direct plugin imports (can't use dynamic import in Next.js bundle)
import tasksPlugin from '@mc/tasks'
import memoryPlugin from '@mc/memory'
import modelsPlugin from '@mc/models'
import calendarPlugin from '@mc/calendar'
import workflowsPlugin from '@mc/workflows'
import assetsPlugin from '@mc/assets'
import healthPlugin from '@mc/health'
import schedulePlugin from '@mc/schedule'
import projectsPlugin from '@mc/projects'

interface PluginState {
  plugin: MCPlugin
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
  const events = new MCEventBus(relayBroadcast)

  const plugins = [tasksPlugin, memoryPlugin, modelsPlugin, calendarPlugin, workflowsPlugin, assetsPlugin, healthPlugin, schedulePlugin, projectsPlugin]

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
      registerRoute: (route) => { state.routes.push(route) },
      registerSlot: () => {},
      registerExecTool: () => {},
      registerSkill: () => {},
      watchFiles: () => {},
    }

    plugin.activate(ctx)
    pluginStates.set(plugin.id, state)
    console.log(`[api-route] Plugin ${plugin.id}: ${state.routes.length} routes registered`)
  }
}

function findRoute(pluginId: string, path: string, method: string): APIRoute | null {
  const state = pluginStates.get(pluginId)
  if (!state) return null
  return state.routes.find(r => r.path === path && r.method === method.toUpperCase()) || null
}

function buildContext(pluginId: string): PluginContext {
  const storage = new MarkdownStorageAdapter()
  const events = new MCEventBus(relayBroadcast)
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
  }
}

async function handleRequest(
  req: Request,
  { params }: { params: Promise<{ pluginId: string; path: string[] }> }
) {
  ensureInitialized()

  const { pluginId, path: pathSegments } = await params
  const routePath = '/' + pathSegments.join('/')
  const method = req.method

  const route = findRoute(pluginId, routePath, method)
  if (!route) {
    return NextResponse.json(
      { error: `No ${method} handler for ${pluginId}${routePath}` },
      { status: 404 }
    )
  }

  try {
    const ctx = buildContext(pluginId)
    return await route.handler(req, ctx)
  } catch (err) {
    console.error(`Plugin route error [${pluginId}${routePath}]:`, err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export const GET = handleRequest
export const POST = handleRequest
export const PUT = handleRequest
export const DELETE = handleRequest
