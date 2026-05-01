/**
 * Routing primitives — typed route contracts that drive runtime dispatch and
 * OpenAPI emission from a single source.
 *
 * The legacy `APIRoute` interface in `../plugin-types.ts` remains during the
 * migration window; this module's `APIRoute<C, P, Q, B>` is the new
 * declarative shape that plugins move to under T6–T16. The two coexist via the
 * `ctx.registerRoute` adapter wired in T4.
 */

import type { z } from 'zod'
import type { ContractStability, ContractVisibility, DocsExample, SourceLocation } from '../docs'
import type { AgentRuntimeAdapter } from '../adapters/runtime'
import type { StorageAdapter, EventBus, SearchAPI, ActivityAPI, HookAPI, AssetsAPI, PluginTaskService } from '../plugin-types'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type HttpStatus =
  | 200 | 201 | 202 | 204
  | 301 | 302 | 304
  | 400 | 401 | 403 | 404 | 409 | 410 | 415 | 422 | 429
  | 500 | 502 | 503 | 504

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
export interface CoreContext extends RouteContext {
  // Host-only surface is added in T4 alongside the dispatcher. T1 keeps the
  // shape minimal so the type compiles without forward-referencing modules
  // that don't exist yet.
}

// ---------------------------------------------------------------------------
// Body / response specs
// ---------------------------------------------------------------------------

export interface JsonBodySpec<B = unknown> {
  contentType: 'application/json'
  schema: z.ZodType<B>
}

export interface MultipartBodySpec<B = unknown> {
  contentType: 'multipart/form-data'
  schema?: z.ZodType<B>
}

export interface RawBodySpec<B = unknown> {
  contentType: '*/*'
  schema?: z.ZodType<B>
}

export interface NoBodySpec {
  contentType: 'none'
}

/**
 * `body` declaration:
 *   - `z.ZodType` shorthand → JSON body validated against the schema.
 *   - explicit JSON spec → same, content-type stated.
 *   - multipart / raw → handler reads `req.formData()` / `req.body` itself.
 *   - none → dispatcher rejects non-empty bodies with 415.
 *
 * Omit the field entirely on routes that don't consume a body.
 */
export type BodySpec<B = unknown> =
  | z.ZodType<B>
  | JsonBodySpec<B>
  | MultipartBodySpec<B>
  | RawBodySpec<B>
  | NoBodySpec

export interface JsonResponseSpec {
  contentType: 'application/json'
  schema: z.ZodType
}

export interface NoContentResponseSpec {
  contentType: 'none'
}

export interface NonJsonResponseSpec {
  contentType:
    | 'text/event-stream'
    | 'text/html'
    | 'text/plain'
    | 'application/octet-stream'
    | 'image/png'
    | 'image/jpeg'
    | 'image/svg+xml'
    | (string & {})
  schema?: z.ZodType
}

export type ResponseSpec =
  | z.ZodType
  | JsonResponseSpec
  | NoContentResponseSpec
  | NonJsonResponseSpec

// ---------------------------------------------------------------------------
// Parsed input — conditional intersection so undeclared keys are absent
// ---------------------------------------------------------------------------

/** Helper: `{ body: B }` if B is declared (non-undefined), else `{}`. */
type Field<K extends string, T> = [T] extends [undefined] ? {} : { [P in K]: T }

/** Body spec extracts to its inferred output type. */
type InferBody<B> =
  B extends z.ZodType<infer Out> ? Out :
  B extends JsonBodySpec<infer Out> ? Out :
  B extends MultipartBodySpec<infer Out> ? Out :
  B extends RawBodySpec<infer Out> ? Out :
  B extends NoBodySpec ? undefined :
  undefined

export type ParsedInput<P, Q, B> =
  & Field<'params', P>
  & Field<'query', Q>
  & Field<'body', B>

// ---------------------------------------------------------------------------
// APIRoute — the new declarative shape
// ---------------------------------------------------------------------------

export interface APIRoute<
  C extends RouteContext = RouteContext,
  P = undefined,
  Q = undefined,
  B = undefined,
> {
  path: string
  method: HttpMethod
  // `summary` is optional during the migration window so legacy `description`-only
  // routes can be wrapped via defineRoute() without restructuring. The validator
  // (T18 fail-closed) flags public bundled routes that lack summary.
  summary?: string
  description?: string

  params?: z.ZodType<P>
  query?: z.ZodType<Q>
  body?: P extends never ? never : BodySpec<B>

  // Optional during migration; the validator (T18) flags public bundled routes
  // that lack any 2xx response declaration.
  responses?: Partial<Record<HttpStatus, ResponseSpec>>

  visibility?: ContractVisibility
  stability?: ContractStability
  permissions?: string[]
  examples?: DocsExample[]
  operationId?: string
  tags?: string[]
  source?: SourceLocation

  handler: (
    req: Request,
    ctx: C,
    parsed: ParsedInput<P, Q, B>,
  ) => Response | Promise<Response>
}

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
