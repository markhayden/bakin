/**
 * Authoring helpers for the routing module.
 *
 * `defineRoute`, `defineCoreRoute`, and `definePlugin` exist to preserve
 * precise per-route type inference that bare `APIRoute<...>[]` annotations
 * widen and lose. The function signatures explicitly take separate generics
 * for path-params (P), query (Q), and body (B) so TypeScript can infer them
 * from the schemas in the route literal.
 */

import type {
  APIRoute,
  CoreContext,
  PluginContextLite,
} from './types'

/**
 * Declare a plugin route. Handler `ctx` is bound to `PluginContextLite`. The
 * three generics (P/Q/B) are inferred from `params`, `query`, and `body`
 * schemas respectively; they default to `undefined` when those fields are
 * omitted, which causes `ParsedInput` to omit the corresponding key.
 */
export function defineRoute<
  P = undefined,
  Q = undefined,
  B = undefined,
>(
  route: APIRoute<PluginContextLite, P, Q, B>,
): APIRoute<PluginContextLite, P, Q, B> {
  return route
}

/**
 * Declare a core (host) route. Handler `ctx` is bound to `CoreContext`.
 */
export function defineCoreRoute<
  P = undefined,
  Q = undefined,
  B = undefined,
>(
  route: APIRoute<CoreContext, P, Q, B>,
): APIRoute<CoreContext, P, Q, B> {
  return route
}

/** Lower-bound shape every plugin definition must satisfy. */
export interface DefinePluginInput {
  id: string
  name: string
  version: string
  routes?: ReadonlyArray<APIRoute<PluginContextLite, any, any, any>>
  // Accept any other plugin fields without typing them — `BakinPlugin`
  // validates the rest at the consumption site.
  [key: string]: unknown
}

/**
 * Declare a plugin. Returns the input unchanged. Use this instead of a bare
 * `BakinPlugin` annotation so `routes` keeps per-element inference.
 */
export function definePlugin<const T extends DefinePluginInput>(plugin: T): T {
  return plugin
}
