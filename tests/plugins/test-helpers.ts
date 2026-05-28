/**
 * Shared test helpers for plugin route and exec tool testing.
 * Provides mock context creation and request/response helpers.
 */
import { mkdirSync, existsSync } from 'fs'
import type {
  PluginContext,
  APIRoute,
  ExecToolDefinition,
  BakinPlugin,
  SearchResult,
  SearchResponse,
  WorkflowDefinitionInput,
  PluginHealthCheckInput,
  SearchQueryParams,
} from '@bakin/core/plugin-types'
import { BakinEventBus } from '../../src/lib/events/event-bus'
import { MarkdownStorageAdapter } from '../../src/lib/storage/markdown-adapter'
import { registerPluginDefinition } from '../../plugins/workflows/lib/source-registry'
import { registerPluginNodeType } from '../../plugins/workflows/lib/node-type-registry'
import { registerPluginNotificationChannel } from '../../plugins/workflows/lib/notification-channel-registry'
import type { WorkflowDefinition } from '../../plugins/workflows/types'
import { createLogger } from '../../src/core/logger'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import { createMockBakinTaskStore } from '@bakin/core/tasks/testing'

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

  // Mirror the production de-dup behavior: if a plugin already declared
  // /search via `searchRoute({ table })` (T6+), skip the auto-wire so the
  // route table stays canonical with no duplicates. Plugins still on the
  // legacy auto-wire path (pre-migration) get the legacy route shape.
  const maybeAutoRegisterSearchRoute = () => {
    if (routes.some(r => r.path === '/search' && r.method === 'GET')) return
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

  const runtime = createMockRuntimeAdapter()
  if (runtime.memory) {
    runtime.memory.watchPaths = async () => [
      '/mock/openclaw/agents/*/sessions/sessions.json',
      '/mock/openclaw/agents/*/sessions/*.jsonl',
      '/mock/openclaw/workspace/*.md',
      '/mock/openclaw/workspace/memory/**/*',
    ]
  }

  const ctx: PluginContext = {
    storage,
    events,
    pluginId,
    runtime,
    tasks: createMockBakinTaskStore() as unknown as PluginContext['tasks'],
    assets: {
      save: vi.fn(async () => ({ ok: false, error: 'not implemented' })),
      getByFilename: vi.fn(async () => null),
      list: vi.fn(async () => []),
      exists: vi.fn(async () => false),
      fileRef: vi.fn(async (filename: string) => ({ kind: 'asset' as const, filename })),
    },
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
    registerHealthCheck: vi.fn((def: PluginHealthCheckInput) => `${pluginId}.${def.id}`),
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
      query: vi.fn(async (params: SearchQueryParams) => ({
        results: seededResults,
        aggregations: seededAggregations,
        meta: {
          query: params.q,
          total: seededResults.length,
          took_ms: 0,
          source: 'fallback' as const,
        },
      })),
      health: vi.fn(async () => ({ enabled: false, tables: [] })),
    },
    hooks: {
      register: vi.fn(() => () => {}),
      call: vi.fn(async (_name: string, data: unknown) => data),
      callAll: vi.fn(async () => undefined),
      has: vi.fn(() => false),
      invoke: vi.fn(async () => undefined),
    },
  }

  return { ctx, routes, execTools, seedResults }
}

/**
 * Activate a plugin and return the captured routes and exec tools.
 *
 * Routes are collected from two sources:
 *   1. The declarative `plugin.routes` array (T6+ pattern).
 *   2. Any `ctx.registerRoute(...)` calls inside `activate()` (legacy).
 *
 * Both populate the same `routes` array so test code can find a route
 * regardless of how the plugin declares it.
 */
export async function activatePlugin(
  plugin: BakinPlugin,
  testDir: string
): Promise<ActivatedPlugin> {
  const result = createTestContext(plugin.id, testDir)
  if (plugin.routes) {
    for (const route of plugin.routes) {
      result.routes.push(route as unknown as APIRoute)
    }
  }
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
 * Call a route handler. Returns { status, body } by default (body parsed as
 * JSON). Pass `rawResponse: true` to also receive the unconsumed Response —
 * essential for streaming endpoints where the caller needs to read the body
 * themselves.
 *
 * Routes that declare typed contracts (`params`/`query`/`body` schemas) are
 * dispatched through the runtime dispatcher so input validation, content-type
 * gating, and the (req, ctx, parsed) handler signature all behave the same
 * in tests as in production. Path-param values are extracted from
 * `opts.path` against `route.path`; pass `opts.path: '/abc-1/move'` to bind
 * `:taskId` to `'abc-1'` for a route declared at `/:taskId/move`.
 */
export async function callRoute(
  route: APIRoute,
  ctx: PluginContext,
  opts: {
    path?: string
    body?: unknown
    searchParams?: Record<string, string>
    rawResponse?: boolean
  } = {}
): Promise<{ status: number; body: Record<string, unknown>; response: Response }> {
  // If opts.path is given, use it verbatim. Otherwise resolve `:param`
  // placeholders in route.path against opts.searchParams (legacy
  // convention — the catch-all dispatcher previously injected path
  // params into searchParams). Remaining searchParams entries flow into
  // the URL as query string.
  let callPath: string
  let queryEntries: Record<string, string> = {}
  if (opts.path) {
    callPath = opts.path
    queryEntries = opts.searchParams ?? {}
  } else {
    const placeholderNames = (route.path.match(/:([A-Za-z_][\w]*)/g) ?? []).map(s => s.slice(1))
    const sp = { ...(opts.searchParams ?? {}) }
    callPath = route.path.replace(/:([A-Za-z_][\w]*)/g, (_match, name) => {
      const value = sp[name]
      if (value !== undefined) {
        delete sp[name]
        return value
      }
      return `:${name}`
    })
    void placeholderNames
    queryEntries = sp
  }

  const req = makeRequest(callPath, {
    method: route.method,
    body: opts.body,
    searchParams: queryEntries,
  })

  // Extract path params by matching the resolved callPath against route.path.
  const params = extractPathParams(route.path, callPath)

  // Tests run under NODE_ENV=test which makes the dispatcher's response
  // validator throw on unmatched status codes. Fall back to direct
  // handler invocation when the route declares no schemas (legacy shape)
  // OR when explicitly opting out via rawResponse mode.
  const declarative = (route as { params?: unknown; query?: unknown; body?: unknown; responses?: unknown })
  const isDeclarative =
    !!declarative.params || !!declarative.query
    || !!declarative.body || !!declarative.responses

  let res: Response
  if (isDeclarative) {
    const { dispatchRoute } = await import('../../packages/core/src/routing')
    res = await dispatchRoute({
      req,
      ctx,
      route: route as unknown as Parameters<typeof dispatchRoute>[0]['route'],
      params,
    })
  } else {
    res = await route.handler(req, ctx)
  }

  if (opts.rawResponse) {
    return { status: res.status, body: {}, response: res }
  }
  let body: Record<string, unknown> = {}
  try {
    body = await res.json()
  } catch {
    // Some responses may not have JSON body
  }
  return { status: res.status, body, response: res }
}

/**
 * Extract path-param values from `actualPath` matched against `routePath`.
 * Supports `:param` segments. Returns `{}` when there are no params.
 */
function extractPathParams(routePath: string, actualPath: string): Record<string, string> {
  const routeSegments = routePath.split('/').filter(Boolean)
  const actualSegments = actualPath.split('?')[0].split('/').filter(Boolean)
  if (routeSegments.length !== actualSegments.length) return {}
  const out: Record<string, string> = {}
  for (let i = 0; i < routeSegments.length; i++) {
    const r = routeSegments[i]
    if (r.startsWith(':')) out[r.slice(1)] = actualSegments[i]
  }
  return out
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
