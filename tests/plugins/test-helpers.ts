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
  SearchResult,
  SearchResponse,
  WorkflowDefinitionInput,
} from '../../src/lib/plugin-types'
import { BakinEventBus } from '../../src/lib/events/event-bus'
import { MarkdownStorageAdapter } from '../../src/lib/storage/markdown-adapter'
import { registerPluginDefinition } from '../../plugins/workflows/lib/source-registry'
import { registerPluginNodeType } from '../../plugins/workflows/lib/node-type-registry'
import { registerPluginNotificationChannel } from '../../plugins/workflows/lib/notification-channel-registry'
import type { WorkflowDefinition } from '../../plugins/workflows/types'
import { createLogger } from '../../src/core/logger'

const testHelperLog = createLogger('test-helpers')

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

export interface ActivatedPlugin {
  ctx: PluginContext
  routes: APIRoute[]
  execTools: ExecToolDefinition[]
  /**
   * Seed the mocked `ctx.search.query()` to return these results on the
   * next (and all subsequent) calls until re-seeded. Aggregations, meta,
   * and source fields are filled in with sensible defaults.
   */
  seedResults: (results: SearchResult[], aggregations?: SearchResponse['aggregations']) => void
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

  let seededResults: SearchResult[] = []
  let seededAggregations: SearchResponse['aggregations'] = undefined

  const seedResults = (
    results: SearchResult[],
    aggregations?: SearchResponse['aggregations'],
  ) => {
    seededResults = results
    seededAggregations = aggregations
  }

  let searchRouteRegistered = false
  const maybeAutoRegisterSearchRoute = () => {
    if (searchRouteRegistered) return
    searchRouteRegistered = true
    routes.push({
      path: '/search',
      method: 'GET',
      description: `Search ${pluginId}`,
      handler: async (req: Request) => {
        const url = new URL(req.url, 'http://localhost')
        const q = url.searchParams.get('q')
        if (!q) return Response.json({ error: 'Missing ?q= parameter' }, { status: 400 })
        const result = await ctx.search.query({
          q,
          limit: Number(url.searchParams.get('limit')) || undefined,
          offset: Number(url.searchParams.get('offset')) || undefined,
          facets: url.searchParams.get('facets')?.split(',').filter(Boolean),
        })
        return Response.json(result)
      },
    })
  }

  const ctx: PluginContext = {
    storage,
    events,
    pluginId,
    registerNav: vi.fn(),
    registerRoute: (route) => routes.push(route),
    registerSlot: vi.fn(),
    registerExecTool: (tool) => execTools.push(tool),
    registerSkill: vi.fn(),
    registerWorkflow: (def: WorkflowDefinitionInput) => {
      const id = (def.id && def.id.length > 0) ? def.id : slugifyWorkflowId(def.name)
      try {
        registerPluginDefinition(pluginId, id, def as unknown as WorkflowDefinition)
      } catch (err) {
        testHelperLog.error(
          `registerWorkflow collision in plugin "${pluginId}" for id "${id}"`,
          err as Error,
        )
      }
    },
    registerNodeType: (def) => {
      try {
        return registerPluginNodeType(pluginId, def)
      } catch (err) {
        testHelperLog.error(
          `registerNodeType collision in plugin "${pluginId}" for kind "${def.kind}"`,
          err as Error,
        )
        return `${pluginId}.${def.kind}`
      }
    },
    registerNotificationChannel: (def) => {
      try {
        return registerPluginNotificationChannel(pluginId, def)
      } catch (err) {
        testHelperLog.error(
          `registerNotificationChannel collision in plugin "${pluginId}" for id "${def.id}"`,
          err as Error,
        )
        return `${pluginId}.${def.id}`
      }
    },
    registerHealthCheck: vi.fn((def) => `${pluginId}.${def.id}`),
    watchFiles: vi.fn(),
    getSettings: (() => ({})) as PluginContext['getSettings'],
    updateSettings: vi.fn(),
    activity: {
      log: vi.fn(),
      audit: vi.fn(),
    },
    search: {
      registerContentType: vi.fn(() => {
        maybeAutoRegisterSearchRoute()
      }),
      registerFileBackedContentType: vi.fn(() => {
        maybeAutoRegisterSearchRoute()
      }),
      index: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      transform: vi.fn(async () => {}),
      query: vi.fn(async (params) => ({
        results: seededResults,
        aggregations: seededAggregations,
        meta: {
          query: params.q,
          total: seededResults.length,
          took_ms: 0,
          source: 'fallback' as const,
        },
      })),
    },
    hooks: {
      register: vi.fn(() => () => {}),
      has: vi.fn(() => false),
      invoke: vi.fn(async () => undefined),
    },
  }

  return { ctx, routes, execTools, seedResults }
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
 * Convenience: call the auto-registered GET /search route on an activated
 * plugin with a query string. Returns the parsed JSON body and status.
 */
export async function callSearchRoute(
  activated: ActivatedPlugin,
  q: string,
  extra: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const route = findRoute(activated.routes, 'GET', '/search')
  if (!route) {
    throw new Error(
      `Activated plugin has no /search route. Did it call ctx.search.registerContentType()?`,
    )
  }
  return callRoute(route, activated.ctx, { searchParams: { q, ...extra } })
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
