/**
 * @makinbakin/sdk/testing — plugin testing harness for external authors.
 *
 * Test a Bakin plugin without a running host: `createTestContext` builds an
 * isolated `PluginContext` backed by a throwaway temp directory, and
 * `activatePlugin`/`callRoute`/`callTool` drive the plugin exactly the way
 * the host does — declarative routes dispatch through the real router
 * (schema validation included), exec tools receive a real
 * `PluginToolContext`, and `ctx.storage` reads/writes real files under the
 * harness's temp dir.
 *
 * Nothing here touches `~/.bakin` and no test framework is required — the
 * harness is plain functions plus a `dispose()` you call when done:
 *
 * ```ts
 * import { afterAll, describe, expect, it } from 'bun:test'
 * import { activatePlugin, callRoute, findRoute } from '@makinbakin/sdk/testing'
 * import plugin from '../index'
 *
 * const harness = await activatePlugin(plugin)
 * afterAll(() => harness.dispose())
 *
 * it('serves /hello', async () => {
 *   const route = findRoute(harness.routes, 'GET', '/hello')!
 *   const { status, body } = await callRoute(route, harness.ctx)
 *   expect(status).toBe(200)
 * })
 * ```
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { BakinEventBus } from '@bakin/core/events'
import { MarkdownStorageAdapter } from '@bakin/core/storage'
import { dispatchRoute } from '@bakin/core/routing'
import { createConversationTurnService } from '../../../../src/core/conversation-turns'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import { createMockBakinTaskStore } from '@bakin/core/tasks/testing'
import type {
  BakinPlugin,
  ExecToolDefinition,
  ExecToolResult,
  HealthCheckRegistrationInput,
  HealthRepairActionDefinition,
  NavItem,
  PluginContext,
  PluginNodeTypeInput,
  PluginNotificationChannelInput,
  PluginToolContext,
  SearchResponse,
  SearchResult,
  SkillDefinition,
  UISlotRegistration,
  WorkflowDefinitionInput,
} from '../types'
import type { APIRoute } from '../routing'

/** One captured `ctx.log` line. */
export interface CapturedLog {
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  data?: unknown
}

/** One captured `ctx.activity.log` / `ctx.activity.audit` call. */
export interface CapturedActivity {
  kind: 'log' | 'audit'
  agent: string
  message: string
  data?: Record<string, unknown>
}

/**
 * The harness returned by {@link createTestContext} / {@link activatePlugin}.
 * Everything the plugin registered is captured on plain arrays so tests can
 * assert on it directly.
 */
export interface PluginTestContext {
  /** The isolated context — pass to `callRoute`, or to the plugin directly. */
  ctx: PluginContext
  /** All routes: declarative `plugin.routes` + the auto-wired search route. */
  routes: APIRoute[]
  /** Exec tools registered via `ctx.registerExecTool`. */
  execTools: ExecToolDefinition[]
  /** Nav items registered via `ctx.registerNav`. */
  navItems: NavItem[]
  /** Slot registrations via `ctx.registerSlot`. */
  slots: UISlotRegistration[]
  /** Workflows registered via `ctx.registerWorkflow`. */
  workflows: WorkflowDefinitionInput[]
  /** Node types registered via `ctx.registerNodeType`. */
  nodeTypes: PluginNodeTypeInput<unknown>[]
  /** Notification channels registered via `ctx.registerNotificationChannel`. */
  notificationChannels: PluginNotificationChannelInput[]
  /** Health checks registered via `ctx.registerHealthCheck`. */
  healthChecks: HealthCheckRegistrationInput[]
  /** Repair actions registered via `ctx.registerHealthRepairAction`. */
  healthRepairActions: HealthRepairActionDefinition[]
  /** Runtime skills registered via `ctx.registerSkill`. */
  skills: SkillDefinition[]
  /** File-watch patterns passed to `ctx.watchFiles`. */
  watchedPatterns: string[]
  /** Everything logged through `ctx.log`. */
  logs: CapturedLog[]
  /** Everything sent to `ctx.activity`. */
  activity: CapturedActivity[]
  /** Absolute path of the temp directory backing `ctx.storage`. */
  dir: string
  /**
   * Seed `ctx.search.query()` responses. All subsequent queries return these
   * results until re-seeded.
   */
  seedSearchResults(results: SearchResult[], aggregations?: SearchResponse['aggregations']): void
  /** Build the `PluginToolContext` an exec tool receives as its third arg. */
  toolContext(): PluginToolContext
  /** Delete the temp directory. Call from `afterAll`. Safe to call twice. */
  dispose(): void
}

export interface CreateTestContextOptions {
  /** Initial `ctx.getSettings()` value. `ctx.updateSettings` patches it. */
  settings?: Record<string, unknown>
  /**
   * Use this directory instead of a fresh temp dir. The harness will NOT
   * delete a caller-provided directory on `dispose()`.
   */
  dir?: string
}

/**
 * Create an isolated `PluginContext` for `pluginId`.
 *
 * Storage is a real filesystem adapter rooted at a fresh temp directory;
 * events are a real in-process bus; hooks are a local registry (the plugin
 * can invoke its own hooks); runtime/tasks are the SDK mock implementations;
 * search is seedable via `seedSearchResults`. Registration calls are
 * captured, never applied to any global registry.
 */
export function createTestContext(
  pluginId: string,
  options: CreateTestContextOptions = {},
): PluginTestContext {
  const ownsDir = !options.dir
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), `bakin-${pluginId}-test-`))

  const routes: APIRoute[] = []
  const execTools: ExecToolDefinition[] = []
  const navItems: NavItem[] = []
  const slots: UISlotRegistration[] = []
  const workflows: WorkflowDefinitionInput[] = []
  const nodeTypes: PluginNodeTypeInput<unknown>[] = []
  const notificationChannels: PluginNotificationChannelInput[] = []
  const healthChecks: HealthCheckRegistrationInput[] = []
  const healthRepairActions: HealthRepairActionDefinition[] = []
  const skills: SkillDefinition[] = []
  const watchedPatterns: string[] = []
  const logs: CapturedLog[] = []
  const activity: CapturedActivity[] = []

  let settings: Record<string, unknown> = { ...(options.settings ?? {}) }
  let seededResults: SearchResult[] = []
  let seededAggregations: SearchResponse['aggregations'] = undefined

  const storage = new MarkdownStorageAdapter(dir)
  const events = new BakinEventBus(() => {})
  const hookHandlers = new Map<string, Array<(data: unknown) => unknown>>()

  // Mirror the host: registering a search content type auto-wires GET /search
  // unless the plugin already declared one (searchRoute pattern).
  // NOTE: one of THREE deliberate copies of this wiring — see
  // src/core/search-plugin-api.ts (production) and tests/plugins/test-helpers.ts.
  const maybeAutoRegisterSearchRoute = () => {
    if (routes.some((r) => r.path === '/search' && r.method === 'GET')) return
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

  const capture = (level: CapturedLog['level']) =>
    (message: string, data?: unknown) => {
      logs.push({ level, message, data })
    }

  const ctx: PluginContext = {
    pluginId,
    storage,
    events,
    // runtime/tasks are genuinely cross-tier (the mocks implement the CORE
    // adapter contracts, the SDK context declares the reduced author tier) —
    // casts are the documented boundary. assets/search below are same-package
    // and MUST typecheck via `satisfies` so a type change can't silently
    // desync the mocks.
    runtime: createMockRuntimeAdapter() as unknown as PluginContext['runtime'],
    tasks: createMockBakinTaskStore() as unknown as PluginContext['tasks'],
    // The REAL turn engine (host implementation) — external-author tests
    // exercise genuine turn lifecycle against the mock runtime. Same
    // documented cross-tier cast as runtime/tasks above.
    conversations: {
      createTurnService: (config) =>
        createConversationTurnService(
          config as unknown as Parameters<typeof createConversationTurnService>[0],
        ) as unknown as ReturnType<PluginContext['conversations']['createTurnService']>,
    },
    assets: {
      createAsset: async () => ({ assetId: 'test-asset', version: 1 }),
      getAsset: async () => null,
      addVersion: async () => ({ assetId: 'test-asset', version: 2 }),
      addExport: async () => ({ name: 'export', file: 'exports/export.jpg' }),
      resolveVersionFile: async () => null,
      listAssets: async () => [],
      getAssetVersions: async () => null,
      upsertFromSource: async () => ({ assetId: 'test-asset', version: 1, changed: true }),
      resolveStoreFile: async () => null,
    } satisfies PluginContext['assets'],
    registerNav: (items) => navItems.push(...items),
    registerSlot: (registration) => slots.push(registration),
    registerExecTool: (tool) => execTools.push(tool as unknown as ExecToolDefinition),
    registerSkill: (skill) => skills.push(skill),
    registerWorkflow: (definition, _opts) => workflows.push(definition),
    registerNodeType: (def) => {
      nodeTypes.push(def as PluginNodeTypeInput<unknown>)
      return `${pluginId}.${def.kind}`
    },
    registerNotificationChannel: (def) => {
      notificationChannels.push(def)
      return `${pluginId}.${def.id}`
    },
    registerHealthCheck: (def) => {
      healthChecks.push(def)
      return `${pluginId}.${def.id}`
    },
    registerHealthRepairAction: (def) => {
      healthRepairActions.push(def)
      return `${pluginId}.${def.id}`
    },
    watchFiles: (patterns) => watchedPatterns.push(...patterns),
    getSettings: (<T = Record<string, unknown>>() => settings as T) as PluginContext['getSettings'],
    updateSettings: (patch) => {
      settings = { ...settings, ...patch }
    },
    activity: {
      log: (agent, message, opts) => activity.push({ kind: 'log', agent, message, data: opts }),
      audit: (event, agent, data) => activity.push({ kind: 'audit', agent, message: event, data }),
    },
    log: {
      debug: capture('debug'),
      info: capture('info'),
      warn: capture('warn'),
      error: capture('error'),
    },
    hooks: {
      register: (name, handler) => {
        const list = hookHandlers.get(name) ?? []
        list.push(handler)
        hookHandlers.set(name, list)
        return () => {
          const current = hookHandlers.get(name) ?? []
          hookHandlers.set(name, current.filter((h) => h !== handler))
        }
      },
      call: async <T,>(name: string, data: T): Promise<T> => {
        let value: unknown = data
        for (const handler of hookHandlers.get(name) ?? []) {
          value = await handler(value)
        }
        return value as T
      },
      callAll: async (name, data) => {
        for (const handler of hookHandlers.get(name) ?? []) {
          await handler(data)
        }
      },
      has: (name) => (hookHandlers.get(name) ?? []).length > 0,
      invoke: async <R,>(name: string, data: unknown): Promise<R | undefined> => {
        const handler = (hookHandlers.get(name) ?? [])[0]
        return handler ? ((await handler(data)) as R) : undefined
      },
    },
    search: {
      registerContentType: () => maybeAutoRegisterSearchRoute(),
      registerFileBackedContentType: () => maybeAutoRegisterSearchRoute(),
      index: async () => {},
      remove: async () => {},
      transform: async () => {},
      query: async (params: { q: string }) => ({
        results: seededResults,
        aggregations: seededAggregations,
        meta: {
          query: params.q,
          total: seededResults.length,
          took_ms: 0,
          source: 'search' as const,
        },
      }),
      health: async () => ({ enabled: false as const, tables: [] }),
    } satisfies PluginContext['search'],
  }

  let disposed = false
  return {
    ctx,
    routes,
    execTools,
    navItems,
    slots,
    workflows,
    nodeTypes,
    notificationChannels,
    healthChecks,
    healthRepairActions,
    skills,
    watchedPatterns,
    logs,
    activity,
    dir,
    seedSearchResults: (results, aggregations) => {
      seededResults = results
      seededAggregations = aggregations
    },
    toolContext: () => ({
      storage: ctx.storage,
      events: ctx.events,
      pluginId: ctx.pluginId,
      runtime: ctx.runtime,
      tasks: ctx.tasks,
      search: ctx.search,
      assets: ctx.assets,
      hooks: ctx.hooks,
      activity: ctx.activity,
      getSettings: ctx.getSettings,
    }),
    dispose: () => {
      if (disposed || !ownsDir) {
        disposed = true
        return
      }
      disposed = true
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * Activate a plugin against a fresh test context. Declarative `plugin.routes`
 * are collected first (as the host does), then `activate(ctx)` runs and its
 * registrations land on the same arrays.
 */
export async function activatePlugin(
  plugin: BakinPlugin,
  options: CreateTestContextOptions = {},
): Promise<PluginTestContext> {
  const harness = createTestContext(plugin.id, options)
  const declarative = (plugin as { routes?: APIRoute[] }).routes
  if (declarative) harness.routes.push(...declarative)
  try {
    await plugin.activate(harness.ctx)
  } catch (err) {
    // The harness is never returned on a throwing activate — dispose here
    // or the temp dir leaks.
    harness.dispose()
    throw err
  }
  return harness
}

/** Find a route by method and declared path (`'GET', '/items/:id'`). */
export function findRoute(routes: APIRoute[], method: string, path: string): APIRoute | undefined {
  return routes.find((r) => r.method === method && r.path === path)
}

/** Find an exec tool by name. */
export function findTool(tools: ExecToolDefinition[], name: string): ExecToolDefinition | undefined {
  return tools.find((t) => t.name === name)
}

/** Build a `Request` the way the host's router would. */
export function makeRequest(
  path: string,
  opts: { method?: string; body?: unknown; searchParams?: Record<string, string> } = {},
): Request {
  const url = new URL(`http://localhost${path}`)
  if (opts.searchParams) {
    for (const [k, v] of Object.entries(opts.searchParams)) url.searchParams.set(k, v)
  }
  const init: RequestInit = { method: opts.method || 'GET' }
  if (opts.body instanceof FormData) {
    // Multipart passes through — Request derives the boundary header.
    init.body = opts.body
  } else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  return new Request(url, init)
}

/**
 * Call a route handler and return `{ status, body, response }`.
 *
 * Routes that declare typed contracts (`params`/`query`/`body`/`responses`)
 * dispatch through the same router the host uses, so schema validation and
 * the `(req, ctx, parsed)` handler signature behave exactly as in
 * production. Path params resolve from `opts.path` (`'/abc-1/move'` binds
 * `:taskId` for a route at `'/:taskId/move'`) or from `opts.searchParams`
 * entries matching placeholder names.
 */
export async function callRoute(
  route: APIRoute,
  ctx: PluginContext,
  opts: {
    path?: string
    body?: unknown
    searchParams?: Record<string, string>
    rawResponse?: boolean
  } = {},
): Promise<{ status: number; body: Record<string, unknown>; response: Response }> {
  let callPath: string
  let queryEntries: Record<string, string> = {}
  if (opts.path) {
    callPath = opts.path
    queryEntries = opts.searchParams ?? {}
  } else {
    const sp = { ...(opts.searchParams ?? {}) }
    callPath = route.path.replace(/:([A-Za-z_][\w]*)/g, (_match: string, name: string) => {
      const value = sp[name]
      if (value !== undefined) {
        delete sp[name]
        return value
      }
      return `:${name}`
    })
    queryEntries = sp
  }

  const req = makeRequest(callPath, {
    method: route.method,
    body: opts.body,
    searchParams: queryEntries,
  })
  const params = extractPathParams(route.path, callPath)

  const declarative = route as { params?: unknown; query?: unknown; body?: unknown; responses?: unknown }
  const isDeclarative =
    !!declarative.params || !!declarative.query || !!declarative.body || !!declarative.responses

  const res: Response = isDeclarative
    ? await dispatchRoute({
        req,
        ctx: ctx as unknown as Parameters<typeof dispatchRoute>[0]['ctx'],
        route: route as unknown as Parameters<typeof dispatchRoute>[0]['route'],
        params,
      })
    : await (route.handler as unknown as (req: Request, ctx: unknown) => Response | Promise<Response>)(req, ctx)

  if (opts.rawResponse) {
    return { status: res.status, body: {}, response: res }
  }
  let body: Record<string, unknown> = {}
  try {
    body = (await res.json()) as Record<string, unknown>
  } catch {
    // Non-JSON responses (HTML, streams, empty bodies) leave body = {}.
  }
  return { status: res.status, body, response: res }
}

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
 * Call an exec tool handler. Pass `toolCtx` (from `harness.toolContext()`)
 * when the tool uses its third argument — scaffold-style tools that persist
 * via `toolCtx.storage` need it.
 */
export async function callTool(
  tool: ExecToolDefinition,
  params: Record<string, unknown>,
  agent = 'test-agent',
  toolCtx?: PluginToolContext,
): Promise<ExecToolResult> {
  // Zod-validate exactly like production: both the MCP transport and the
  // runtime-native provider parse against the declared shape before the
  // handler runs — a test must not pass params production would reject.
  const parsed = z.object(tool.parameters).safeParse(params)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    return { ok: false, error: `invalid parameters for ${tool.name}: ${detail}` }
  }
  return tool.handler(parsed.data as Record<string, unknown>, agent, toolCtx)
}
