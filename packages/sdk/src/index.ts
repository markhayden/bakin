/**
 * `@makinbakin/sdk` — plugin author SDK.
 *
 * The main entry re-exports types + the single-call `registerPlugin` helper
 * so plugin authors can write `import { registerPlugin } from '@makinbakin/sdk'`
 * without having to remember which sub-path it lives at. UI primitives,
 * hooks, and components stay on sub-paths (`/ui`, `/hooks`, `/components`,
 * `/slots`) to keep the top-level namespace from exploding.
 *
 * Sub-paths:
 *   - `@makinbakin/sdk/ui`         — shadcn UI primitives (Button, Card, Dialog, ...)
 *   - `@makinbakin/sdk/hooks`      — React hooks (useAgent, useSSE, useSearch, ...)
 *   - `@makinbakin/sdk/components` — shared components (PluginHeader, FacetFilter, ...)
 *   - `@makinbakin/sdk/slots`      — Slot + registerSlot primitive
 *   - `@makinbakin/sdk/types`      — full type re-exports
 *   - `@makinbakin/sdk/metadata`   — docs-aware contract helpers
 *
 * Plugin authors: at build time, mark `@makinbakin/sdk`, `@makinbakin/sdk/*`, and
 * `react`/`react-dom` as externals. At runtime the browser's import map
 * (emitted by Bakin) resolves those to the host's bundled copies so there
 * is a single React instance and a single SDK.
 */

/** Re-exports every plugin contract type. See `@makinbakin/sdk/types` for the full list. */
export * from './types'

/** Register a plugin (single-call entry from a plugin's `client.tsx`). */
export { registerPlugin } from './register'
/** Tear down all registrations owned by a plugin (used during hot-swap). */
export { unregisterPlugin } from './register'
/** Register a cleanup callback fired when the plugin is unregistered. */
export { registerPluginCleanup } from './register'
/** Current registry version — bumps on every mutation (for useSyncExternalStore). */
export { getRegistryVersion } from './register'
/** Subscribe to registry-version changes. */
export { subscribeRegistry } from './register'
/** Get every registered nav item across all plugins. */
export { getAllNavItems } from './register'
/** Get a snapshot of the current nav items (non-subscribing). */
export { getNavItemsSnapshot } from './register'
/** Get nav items contributed by a specific plugin. */
export { getPluginNavItems } from './register'
/** Set or clear a runtime badge on a plugin-owned nav item. */
export { setNavBadge } from './register'
/** Read the current badge for a nav item, or undefined if none. */
export { getNavBadge } from './register'
/** Stable snapshot of every active nav badge keyed by navItemId. */
export { getNavBadgesSnapshot } from './register'
/** Subscribe to nav-badge mutations (separate channel from `subscribeRegistry`). */
export { subscribeNavBadges } from './register'
/** Look up a specific client route by plugin id + path. */
export { getPluginRoute } from './register'
/** Get all registered client routes (across all plugins). */
export { getPluginRoutes } from './register'
/** Seed a plugin's declarative nav from its manifest (host-side; survives unregisterPlugin). */
export { setManifestNav } from './register'
/** Read the manifest nav currently seeded for a plugin (drift validation). */
export { getManifestNav } from './register'
export type { ClientRouteEntry, MatchedPluginRoute, NavItem, PluginRegistration } from './register'

/** Install the manifest-derived slot/route ownership index for lazy loading (host-side). */
export { configureLazyPlugins } from './lazy'
/** Install the demand loader that imports a plugin's client bundle (host-side). */
export { setLazyPluginLoader } from './lazy'
/** Report a plugin client's load progress: idle → loading → loaded | error (host-side). */
export { setPluginLoadState } from './lazy'
/** Current load state for a plugin client. Unknown plugins report 'idle'. */
export { getPluginLoadState } from './lazy'
/** Last load error message for a plugin whose state is 'error', if any. */
export { getPluginLoadError } from './lazy'
/** Plugins whose manifests declare the given slot in `contributes.slots`. */
export { getSlotOwners } from './lazy'
/** Plugins whose manifest `contributes.routes` patterns match a pathname. */
export { getRouteOwners } from './lazy'
/** Ask the host to lazy-load every idle plugin that fills the named slot. */
export { requestSlotPlugins } from './lazy'
/** Ask the host to lazy-load every idle plugin whose route patterns match the pathname. */
export { requestRoutePlugins } from './lazy'
/** Reset a failed plugin to idle and re-request its client bundle. */
export { retryPluginLoad } from './lazy'
/** Monotonic lazy-store version for useSyncExternalStore consumers. */
export { getLazyPluginsVersion } from './lazy'
/** Subscribe to lazy-plugin store mutations. Returns an unsubscribe fn. */
export { subscribeLazyPlugins } from './lazy'
export type { LazyPluginIndex, PluginLoadState } from './lazy'

/** Define a plugin HTTP route with typed input/output schemas. */
export { defineRoute } from './routing'
/** Define a core (non-plugin) HTTP route. */
export { defineCoreRoute } from './routing'
/** Compose a plugin's routes into a single definition for the server. */
export { definePlugin } from './routing'
export type {
  APIRoute,
  HttpStatus,
  RouteContext,
  PluginContextLite,
  CoreContext,
  BodySpec,
  ResponseSpec,
  ParsedInput,
} from './routing'
