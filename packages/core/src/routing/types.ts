/**
 * Routing primitives — typed route contracts that drive runtime dispatch and
 * OpenAPI emission from a single source.
 *
 * The pure, context-free declarations (the generic `APIRoute`, body/response
 * specs, `ParsedInput`) are DECLARED in `@makinbakin/sdk/types` (api-route.ts
 * — a leaf module) and re-exported here bound to the core-tier
 * `RouteContext`. That direction keeps the package DAG acyclic: core imports
 * SDK types (as `plugin-types.ts` always has); the SDK never imports core
 * from its types layer. Only the tier-specific route CONTEXTS live here.
 */

import type {
  APIRoute as SdkAPIRoute,
} from '@makinbakin/sdk/types'
import type { AgentRuntimeAdapter } from '../adapters/runtime'
import type { StorageAdapter, EventBus, SearchAPI, ActivityAPI, HookAPI, AssetsAPI, PluginTaskService } from '../plugin-types'

// Context-free declarations — re-exported from the SDK leaf (ONE declaration).
export type {
  HttpMethod,
  HttpStatus,
  JsonBodySpec,
  MultipartBodySpec,
  RawBodySpec,
  NoBodySpec,
  BodySpec,
  JsonResponseSpec,
  NoContentResponseSpec,
  NonJsonResponseSpec,
  ResponseSpec,
  ParsedInput,
} from '@makinbakin/sdk/types'

// ---------------------------------------------------------------------------
// Route contexts
// ---------------------------------------------------------------------------

/**
 * Common surface every route handler can rely on, regardless of origin.
 * `PluginContext` and `CoreContext` extend this with their own additions.
 *
 * Types here mirror the plugin-context surface so a plugin handler that
 * declares `ctx: PluginContextLite` can call `ctx.search.index(...)`,
 * `ctx.activity.log(...)`, etc. without casting.
 */
export interface RouteContext {
  runtime: AgentRuntimeAdapter
  search: SearchAPI
  storage: StorageAdapter
  events: EventBus
  activity: ActivityAPI
  hooks: HookAPI
  assets: AssetsAPI
  tasks: PluginTaskService
}

/**
 * Lite plugin context — the public-facing slice every plugin route handler
 * receives. The full `PluginContext` (in `../plugin-types.ts`) extends this
 * with the imperative `registerRoute`/`registerExecTool`/etc. surface that
 * `activate()` uses; route handlers don't need that surface at request time.
 */
export interface PluginContextLite extends RouteContext {
  pluginId: string
  getSettings<T = Record<string, unknown>>(): T
}

/**
 * Core (host) context — host-only surface for routes registered under
 * `packages/host/src/core-routes/`.
 */
export type CoreContext = RouteContext

// ---------------------------------------------------------------------------
// APIRoute — core-tier alias of the ONE published declaration
// ---------------------------------------------------------------------------

/**
 * Same declaration as `@makinbakin/sdk/types`' `APIRoute`, with the core-tier
 * `RouteContext` as the default context. An alias (not a copy): the two are
 * mutually assignable by construction — pinned in
 * tests/core/plugin-type-contract.test.ts.
 */
export type APIRoute<
  C extends RouteContext = RouteContext,
  P = undefined,
  Q = undefined,
  B = undefined,
> = SdkAPIRoute<C, P, Q, B>

// ---------------------------------------------------------------------------
// Plugin shape with declarative routes
// ---------------------------------------------------------------------------

/**
 * Subset of plugin metadata `definePlugin` cares about. The full `BakinPlugin`
 * interface lives in `../plugin-types.ts`; this declares the new fields the
 * routing module needs to typecheck without circular imports.
 */
export interface PluginWithRoutes {
  id: string
  name: string
  version: string
  routes?: ReadonlyArray<APIRoute<PluginContextLite, any, any, any>>
}
