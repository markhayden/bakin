/**
 * Public Bakin plugin contract types.
 *
 * This module is intentionally self-contained. External plugins must be able
 * to typecheck against `@makinbakin/sdk/types` without resolving `@bakin/core`,
 * Bakin source aliases, adapter packages, or another plugin's internals.
 *
 * Two-tier contract: this is the PUBLISHED, deliberately narrower plugin-author
 * surface. `packages/core/src/plugin-types.ts` is the INTERNAL surface in-process
 * core plugins receive — it carries the FULL `AgentRuntimeAdapter`, the
 * `PluginTask` projection, `BakinPlugin.routes`, and fuller `StorageAdapter`/
 * `NavItem`/`APIRoute`/`HookAPI`/`SkillDefinition`. Those divergences are
 * intentional, not drift. Genuinely-identical leaf data types are single-homed
 * HERE and re-exported by core; do not collapse the context/runtime/plugin
 * surface across the two tiers (see core's header for the rationale).
 */


// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

// The public contract is split into focused modules; this barrel re-exports
// the full surface. @makinbakin/sdk/types resolves here (vendor entrypoint).
export * from './primitives'
export * from './manifest'
export * from './runtime'
export * from './services'
export * from './health'
export * from './registration'
export * from './context'
export * from './conversation-turns'
export * from './scheduled-events'

// The ONE public route type (declarative-generic) + its pure companions —
// DECLARED here (api-route.ts is a leaf; reaching through ../routing pulled
// @bakin/core back in and closed a package cycle). Bare `APIRoute` here has
// `C = unknown`; the contextful default rides `@makinbakin/sdk/routing`,
// which also re-exports the tier-bound `PluginContextLite`.
export * from './api-route'
