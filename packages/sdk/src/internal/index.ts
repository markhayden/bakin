/**
 * `@makinbakin/sdk/internal` — host-shell plumbing. NOT plugin-author API.
 *
 * Everything here exists so the Bakin host shell (PluginHost, sidebar,
 * router catch-all, ⌘K overlay, drift checker) can drive the shared
 * client-side registries that `registerPlugin` populates. Plugin authors
 * never import this entry; the author surface is the root barrel plus the
 * documented sub-paths. Excluded from the generated SDK reference docs.
 *
 * Breaking changes here only ever affect the host shell, which ships in
 * lockstep with the SDK — there is no compatibility contract on this entry.
 */

// ── Registry read/observe surface (host shell rendering) ────────────────────
/** Tear down all registrations owned by a plugin (dev hot-swap teardown). */
export { unregisterPlugin } from '../register'
/** Current registry version — bumps on every mutation (for useSyncExternalStore). */
export { getRegistryVersion } from '../register'
/** Subscribe to registry-version changes. */
export { subscribeRegistry } from '../register'
/** Get every registered nav item across all plugins. */
export { getAllNavItems } from '../register'
/** Get a snapshot of the current nav items (non-subscribing). */
export { getNavItemsSnapshot } from '../register'
/** Get nav items contributed by a specific plugin. */
export { getPluginNavItems } from '../register'
/** Stable snapshot of every active nav badge keyed by navItemId. */
export { getNavBadgesSnapshot } from '../register'
/** Subscribe to nav-badge mutations (separate channel from `subscribeRegistry`). */
export { subscribeNavBadges } from '../register'
/** Look up a specific client route by plugin id + path. */
export { getPluginRoute } from '../register'
/** Get all registered client routes (across all plugins). */
export { getPluginRoutes } from '../register'
/** Seed a plugin's declarative nav from its manifest (survives unregisterPlugin). */
export { setManifestNav } from '../register'
/** Read the manifest nav currently seeded for a plugin (drift validation). */
export { getManifestNav } from '../register'
/** Look up the ⌘K hit renderer registered for a content type. */
export { getSearchHitRenderer } from '../register'
/** Stable snapshot of all registered hit renderers keyed by content type. */
export { getSearchHitRenderersSnapshot } from '../register'
/** Subscribe to hit-renderer mutations (own channel). */
export { subscribeSearchHitRenderers } from '../register'
export type { ClientRouteEntry, MatchedPluginRoute } from '../register'

// ── Host router compatibility (shared with the browser fixture) ────────────
/** Parse opaque string query values without TanStack JSON coercion. */
export { parseSearchPlain, stringifySearchPlain } from '../navigation/search-params'

// ── Lazy plugin loading (manifest-driven demand loading) ────────────────────
/** Install the manifest-derived slot/route ownership index for lazy loading. */
export { configureLazyPlugins } from './lazy'
/** Install the demand loader that imports a plugin's client bundle. */
export { setLazyPluginLoader } from './lazy'
/** Report a plugin client's load progress: idle → loading → loaded | error. */
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
/** Ask the host to lazy-load every idle plugin — cross-plugin surfaces (⌘K search). */
export { requestAllPlugins } from './lazy'
/** Reset a failed plugin to idle and re-request its client bundle. */
export { retryPluginLoad } from './lazy'
/** Monotonic lazy-store version for useSyncExternalStore consumers. */
export { getLazyPluginsVersion } from './lazy'
/** Subscribe to lazy-plugin store mutations. Returns an unsubscribe fn. */
export { subscribeLazyPlugins } from './lazy'
export type { LazyPluginIndex, PluginLoadState } from './lazy'

// ── Plugin UI ownership (host-injected; not an author-facing component) ────
/** Transparent DOM/context boundary used around registered page and slot UI. */
export { PluginOwnershipRoot, usePluginOwnership } from './plugin-ownership'
