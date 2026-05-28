/**
 * `@makinbakin/sdk/metadata` — docs-aware contract helpers.
 *
 * Re-exports the canonical `RouteContract`, `CliCommandContract`,
 * `HookContract`, `SlotContract`, `ExecToolContract`, and the corresponding
 * `define*Contract` helpers from `@bakin/core/docs`. The duplicated copy that
 * previously lived in this file has been retired (T1) — keeping it
 * structurally identical to the core copy was a maintenance burden the spec
 * explicitly removes.
 *
 * `defineApiRoute` / `definePluginRoute` are kept as re-exports for backward
 * compatibility with existing call sites; new code should use `defineRoute`
 * from `@makinbakin/sdk/routing` (the typed declarative shape).
 */

export type {
  ContractMetadata,
  ContractStability,
  ContractVisibility,
  CliCommandContract,
  DocsAwareAPIRoute,
  DocsExample,
  ExecToolContract,
  HookContract,
  HookKind,
  PublicContract,
  RouteContract,
  SchemaLike,
  SlotContract,
  SourceLocation,
} from '@bakin/core/docs'

/** Legacy: declare an API route with docs metadata. Prefer `defineRoute` from `/routing`. */
export { defineApiRoute } from '@bakin/core/docs'
/** Define a CLI command contract for documentation. */
export { defineCliCommandContract } from '@bakin/core/docs'
/** Define an MCP exec tool contract for documentation. */
export { defineExecToolContract } from '@bakin/core/docs'
/** Define a cross-plugin hook contract for documentation. */
export { defineHookContract } from '@bakin/core/docs'
/** Legacy: declare a plugin route with docs metadata. Prefer `defineRoute` from `/routing`. */
export { definePluginRoute } from '@bakin/core/docs'
/** Define a generic route contract (shared shape for API + plugin routes). */
export { defineRouteContract } from '@bakin/core/docs'
/** Define a UI slot contract for documentation. */
export { defineSlotContract } from '@bakin/core/docs'
