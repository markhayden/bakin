/**
 * `@bakin/sdk/metadata` — docs-aware contract helpers.
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
 * from `@bakin/sdk/routing` (the typed declarative shape).
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

export {
  defineApiRoute,
  defineCliCommandContract,
  defineExecToolContract,
  defineHookContract,
  definePluginRoute,
  defineRouteContract,
  defineSlotContract,
} from '@bakin/core/docs'
