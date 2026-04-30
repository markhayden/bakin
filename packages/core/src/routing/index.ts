/**
 * `@bakin/core/routing` — typed route contracts.
 *
 * Re-exports the route types and authoring helpers used by both the host and
 * plugin authors (via `@bakin/sdk/routing`).
 */

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
} from './types'

export { defineRoute, defineCoreRoute, definePlugin } from './define'
export type { DefinePluginInput } from './define'

export { RouteRegistry } from './registry'
export type { RouteScope, RegisteredRoute, RouteMatch } from './registry'

export { operationIdFor } from './operation-id'
