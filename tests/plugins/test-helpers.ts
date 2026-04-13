/**
 * Shared test helpers for plugin route and exec tool testing.
 * Provides mock context creation and request/response helpers.
 */
import { vi } from 'vitest'
import { mkdirSync, existsSync } from 'fs'
import type {
  PluginContext,
  APIRoute,
  ExecToolDefinition,
  BakinPlugin,
} from '../../src/lib/plugin-types'
import { BakinEventBus } from '../../src/lib/events/event-bus'
import { MarkdownStorageAdapter } from '../../src/lib/storage/markdown-adapter'

export interface ActivatedPlugin {
  ctx: PluginContext
  routes: APIRoute[]
  execTools: ExecToolDefinition[]
}

/**
 * Create a mock PluginContext that captures registered routes and exec tools.
 * Uses a real MarkdownStorageAdapter backed by the provided temp directory.
 */
export function createTestContext(pluginId: string, testDir: string): ActivatedPlugin {
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true })
  }

  const routes: APIRoute[] = []
  const execTools: ExecToolDefinition[] = []
  const storage = new MarkdownStorageAdapter(testDir)
  const events = new BakinEventBus(() => {})

  const ctx: PluginContext = {
    storage,
    events,
    pluginId,
    registerNav: vi.fn(),
    registerRoute: (route) => routes.push(route),
    registerSlot: vi.fn(),
    registerExecTool: (tool) => execTools.push(tool),
    registerSkill: vi.fn(),
    watchFiles: vi.fn(),
    getSettings: (() => ({})) as PluginContext['getSettings'],
    updateSettings: vi.fn(),
    activity: {
      log: vi.fn(),
      audit: vi.fn(),
    },
    search: {
      registerContentType: vi.fn(),
      registerFileBackedContentType: vi.fn(),
      index: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      transform: vi.fn(async () => {}),
      query: vi.fn(async () => ({ results: [], meta: { query: '', total: 0, took_ms: 0, source: 'fallback' as const } })),
    },
    hooks: {
      register: vi.fn(() => () => {}),
      has: vi.fn(() => false),
      invoke: vi.fn(async () => undefined),
    },
  }

  return { ctx, routes, execTools }
}

/**
 * Activate a plugin and return the captured routes and exec tools.
 */
export async function activatePlugin(
  plugin: BakinPlugin,
  testDir: string
): Promise<ActivatedPlugin> {
  const result = createTestContext(plugin.id, testDir)
  await plugin.activate(result.ctx)
  return result
}

/**
 * Find a route handler by method and path pattern.
 * Supports parameterized paths: findRoute(routes, 'GET', '/:id') matches '/:id'.
 */
export function findRoute(
  routes: APIRoute[],
  method: string,
  path: string
): APIRoute | undefined {
  return routes.find((r) => r.method === method && r.path === path)
}

/**
 * Find an exec tool by name.
 */
export function findTool(
  tools: ExecToolDefinition[],
  name: string
): ExecToolDefinition | undefined {
  return tools.find((t) => t.name === name)
}

/**
 * Create a Request object for testing route handlers.
 */
export function makeRequest(
  path: string,
  opts: {
    method?: string
    body?: unknown
    searchParams?: Record<string, string>
  } = {}
): Request {
  const url = new URL(`http://localhost${path}`)
  if (opts.searchParams) {
    for (const [k, v] of Object.entries(opts.searchParams)) {
      url.searchParams.set(k, v)
    }
  }

  const init: RequestInit = { method: opts.method || 'GET' }
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body)
    init.headers = { 'Content-Type': 'application/json' }
  }

  return new Request(url, init)
}

/**
 * Call a route handler and parse the JSON response.
 */
export async function callRoute(
  route: APIRoute,
  ctx: PluginContext,
  opts: {
    path?: string
    body?: unknown
    searchParams?: Record<string, string>
  } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = makeRequest(opts.path || route.path, {
    method: route.method,
    body: opts.body,
    searchParams: opts.searchParams,
  })

  const res = await route.handler(req, ctx)
  let body: Record<string, unknown> = {}
  try {
    body = await res.json()
  } catch {
    // Some responses may not have JSON body
  }
  return { status: res.status, body }
}

/**
 * Call an exec tool handler with params and return the result.
 */
export async function callTool(
  tool: ExecToolDefinition,
  params: Record<string, unknown>,
  agent = 'test-agent'
): Promise<Record<string, unknown>> {
  return tool.handler(params, agent)
}
