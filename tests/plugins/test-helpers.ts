/**
 * Shared test helpers for plugin route and exec tool testing.
 *
 * Thin adapter over `@makinbakin/sdk/testing` (the published harness — one
 * source of truth for context creation and route/tool dispatch). What stays
 * here is exactly the in-repo delta the published harness deliberately does
 * not ship:
 *
 *  - the three GLOBAL registry side effects (workflows / node types /
 *    notification channels) — the workflows suites assert real registry
 *    state, so registrations must land in the process-global registries,
 *    not just the harness capture arrays;
 *  - `vi.fn` spy affordances on ctx members that existing tests assert on
 *    (`hooks.has.mockReturnValue`, `search.index` call args, `activity.*`,
 *    `updateSettings`, …);
 *  - caller-owned temp-dir semantics (`createTestContext(id, testDir)` —
 *    callers create and clean their own dirs);
 *  - `callSearchRoute` and the legacy `ActivatedPlugin` shape.
 */
import { mkdirSync, existsSync } from 'fs'
import type {
  PluginContext,
  RegisteredAPIRoute,
  ExecToolDefinition,
  BakinPlugin,
  SearchResult,
  SearchResponse,
  HealthCheckRegistrationInput,
  HealthRepairActionDefinition,
  SearchQueryParams,
  WorkflowDefinitionInput,
} from '@bakin/core/plugin-types'
import {
  createTestContext as sdkCreateTestContext,
  callRoute as sdkCallRoute,
  makeRequest,
  callTool as sdkCallTool,
} from '@makinbakin/sdk/testing'
import { registerPluginDefinition } from '@bakin/core/workflows/source-registry'
import { registerPluginNodeType } from '@bakin/core/workflows/node-type-registry'
import { registerPluginNotificationChannel } from '@bakin/core/workflows/notification-channel-registry'
import type { WorkflowDefinition } from '../../plugins/workflows/types'
import { createLogger } from '../../src/core/logger'

const testHelperLog = createLogger('test-helpers')

// Mechanical helpers delegate to the SDK verbatim. They are re-declared with
// `@bakin/core/plugin-types` signatures (what every consuming suite passes)
// rather than bare re-exported, because the SDK's own declarations use its
// mirrored types. T19 collapsed the APIRoute duplication, but the CONTEXT
// tiers (SDK reduced facade vs core full adapter) are deliberately distinct,
// so this boundary cast is permanent and lives HERE, once.
export { makeRequest }

type SdkCallRouteArgs = Parameters<typeof sdkCallRoute>

/**
 * Call a route handler. Declarative routes dispatch through the real router
 * (schema validation, `(req, ctx, parsed)` signature); see the SDK helper.
 */
export async function callRoute(
  route: RegisteredAPIRoute,
  ctx: PluginContext,
  opts: {
    path?: string
    body?: unknown
    searchParams?: Record<string, string>
    rawResponse?: boolean
  } = {},
): Promise<{ status: number; body: Record<string, unknown>; response: Response }> {
  return sdkCallRoute(route as unknown as SdkCallRouteArgs[0], ctx as unknown as SdkCallRouteArgs[1], opts)
}

/** Find a route handler by method and declared path. */
export function findRoute(
  routes: RegisteredAPIRoute[],
  method: string,
  path: string
): RegisteredAPIRoute | undefined {
  return routes.find((r) => r.method === method && r.path === path)
}

/** Find an exec tool by name. */
export function findTool(
  tools: ExecToolDefinition[],
  name: string
): ExecToolDefinition | undefined {
  return tools.find((t) => t.name === name)
}

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
  routes: RegisteredAPIRoute[]
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
 * Uses a real MarkdownStorageAdapter backed by the provided temp directory
 * (caller-owned: this helper never deletes it).
 */
export function createTestContext(pluginId: string, testDir: string): ActivatedPlugin {
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true })
  }

  // Permanent two-tier boundary cast: SDK PluginContext and core
  // PluginContext deliberately differ (reduced runtime facade vs full
  // adapter), so the harness's SDK-typed surface is cast once at this
  // boundary. T19 unified APIRoute but NOT the context tiers — by design.
  const harness = sdkCreateTestContext(pluginId, { dir: testDir }) as unknown as {
    ctx: PluginContext
    routes: RegisteredAPIRoute[]
    execTools: ExecToolDefinition[]
  }
  const { ctx, routes, execTools } = harness

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
  // NOTE: one of THREE deliberate copies of the auto GET /search wiring — see
  // src/core/search-plugin-api.ts (production) and packages/sdk/src/testing/index.ts.
  // /search via `searchRoute({ table })` (T6+), skip the auto-wire so the
  // route table stays canonical with no duplicates.
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

  if (ctx.runtime.memory) {
    ctx.runtime.memory.watchPaths = async () => [
      '/mock/openclaw/agents/*/sessions/sessions.json',
      '/mock/openclaw/agents/*/sessions/*.jsonl',
      '/mock/openclaw/workspace/*.md',
      '/mock/openclaw/workspace/memory/**/*',
    ]
  }

  // ---- In-repo overrides on top of the SDK harness ----------------------
  // Spy affordances: suites assert call args / use mockClear / mockReturnValue
  // on these members, so they must be vi.fn spies, not plain functions.
  // Global registries: workflows suites assert process-global registry state.
  Object.assign(ctx, {
    assets: {
      createAsset: vi.fn(async () => ({ assetId: 'test-asset', version: 1 })),
      getAsset: vi.fn(async () => null),
      addVersion: vi.fn(async () => ({ assetId: 'test-asset', version: 2 })),
      addExport: vi.fn(async () => ({ name: 'export', file: 'exports/export.jpg' })),
      resolveVersionFile: vi.fn(async () => null),
      listAssets: vi.fn(async () => []),
      getAssetVersions: vi.fn(async () => null),
      upsertFromSource: vi.fn(async () => ({ assetId: 'test-asset', version: 1, changed: true })),
      resolveStoreFile: vi.fn(async () => null),
    },
    registerNav: vi.fn(),
    registerSlot: vi.fn(),
    registerSkill: vi.fn(),
    // Collision semantics mirror production (R18): duplicates THROW.
    registerWorkflow: (def: WorkflowDefinitionInput) => {
      const id = (def.id && def.id.length > 0) ? def.id : slugifyWorkflowId(def.name)
      registerPluginDefinition(pluginId, id, def as unknown as WorkflowDefinition)
    },
    registerNodeType: (def: Parameters<PluginContext['registerNodeType']>[0]) => {
      return registerPluginNodeType(pluginId, def)
    },
    registerNotificationChannel: (def: Parameters<PluginContext['registerNotificationChannel']>[0]) => {
      return registerPluginNotificationChannel(pluginId, def)
    },
    registerHealthCheck: vi.fn((def: HealthCheckRegistrationInput) => `${pluginId}.${def.id}`),
    registerHealthRepairAction: vi.fn((def: HealthRepairActionDefinition) => `${pluginId}.${def.id}`),
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
          source: 'search' as const,
        },
      })),
      health: vi.fn(async () => ({ enabled: false as const, tables: [] })),
    },
    hooks: {
      register: vi.fn(() => () => {}),
      call: vi.fn(async (_name: string, data: unknown) => data),
      callAll: vi.fn(async () => undefined),
      has: vi.fn(() => false),
      invoke: vi.fn(async () => undefined),
    },
  } satisfies Partial<PluginContext>)

  return { ctx, routes, execTools, seedResults }
}

/**
 * Activate a plugin and return the captured routes and exec tools.
 *
 * Routes are collected from the declarative `plugin.routes` array plus the
 * auto-wired `GET /search` route (`ctx.registerRoute` no longer exists).
 */
export async function activatePlugin(
  plugin: BakinPlugin,
  testDir: string
): Promise<ActivatedPlugin> {
  const result = createTestContext(plugin.id, testDir)
  if (plugin.routes) {
    for (const route of plugin.routes) {
      result.routes.push(route as unknown as RegisteredAPIRoute)
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
 * Call an exec tool handler with params and return the result.
 */
export async function callTool(
  tool: ExecToolDefinition,
  params: Record<string, unknown>,
  agent = 'test-agent'
): Promise<Record<string, unknown>> {
  return (await sdkCallTool(
    tool as unknown as Parameters<typeof sdkCallTool>[0],
    params,
    agent,
  )) as unknown as Record<string, unknown>
}
