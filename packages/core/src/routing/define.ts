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
import { assertValidBodySpec } from './dispatcher'
import type {
  ContentFile,
  NavItem,
  PluginSettingsSchema,
} from '../plugin-types'

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
  assertValidBodySpec(route.body, `${route.method} ${route.path}`)
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
  assertValidBodySpec(route.body, `${route.method} ${route.path}`)
  return route
}

/**
 * The exact shape a plugin definition may carry — the full `BakinPlugin`
 * lifecycle surface plus declarative `routes`. Deliberately CLOSED (no index
 * signature): a typo'd key (`settingSchema`, `onReadey`, …) fails typecheck
 * at the `definePlugin` call site instead of silently doing nothing at
 * runtime (audit 2026-07 H3).
 */
export interface DefinePluginInput {
  id: string
  name: string
  version: string
  routes?: ReadonlyArray<APIRoute<PluginContextLite, any, any, any>>
  // `ctx` is `any` here because authors annotate it with THEIR tier's
  // PluginContext (`@makinbakin/sdk` for external plugins, `@bakin/core`
  // in-repo) and the two context types are deliberately non-identical
  // (reduced runtime facade vs full adapter). The closed key set above is
  // what this interface enforces — param types come from the annotation.
  activate(ctx: any): void | Promise<void>
  onReady?(): void | Promise<void>
  onShutdown?(): void | Promise<void>
  onSettingsChange?(settings: Record<string, unknown>): void | Promise<void>
  onUninstall?(ctx: any): void | Promise<void>
  settingsSchema?: PluginSettingsSchema
  navItems?: NavItem[]
  contentFiles?: ContentFile[]
}

/**
 * Declare a plugin. Returns the input unchanged. Use this instead of a bare
 * `BakinPlugin` annotation so `routes` keeps per-element inference.
 *
 * The `& { [K in Exclude<...>]: never }` intersection is the exactness
 * enforcement: `T extends DefinePluginInput` alone would structurally admit
 * excess keys, so a typo'd `settingSchema` would compile and silently do
 * nothing. With the intersection, any key outside `DefinePluginInput` must
 * be `never` — which no real value satisfies — so typos fail at the call
 * site (audit 2026-07 H3).
 */
export function definePlugin<const T extends DefinePluginInput>(
  plugin: T & { [K in Exclude<keyof T, keyof DefinePluginInput>]: never },
): T {
  return plugin
}
