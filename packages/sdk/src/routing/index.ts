/**
 * `@makinbakin/sdk/routing` — typed route contracts for plugin authors.
 *
 * Re-exports from `@bakin/core/routing` for a single source of truth. The
 * SDK's general type module (`@makinbakin/sdk/types`) keeps duplicated primitives
 * for self-containment, but the routing surface re-exports because keeping
 * two parallel `APIRoute<...>` definitions in sync is a debt we are
 * deliberately avoiding.
 */

/** Define a plugin HTTP route with typed input/output and handler. */
export { defineRoute } from '@bakin/core/routing'
/** Define a core (non-plugin) HTTP route. */
export { defineCoreRoute } from '@bakin/core/routing'
/** Compose a plugin's routes into a single definition for the server. */
export { definePlugin } from '@bakin/core/routing'

export type {
  HttpMethod,
  HttpStatus,
  RouteContext,
  PluginContextLite,
  CoreContext,
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
  APIRoute,
  PluginWithRoutes,
  DefinePluginInput,
} from '@bakin/core/routing'
