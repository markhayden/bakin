/**
 * `@bakin/sdk` — plugin author SDK.
 *
 * The main entry re-exports types + the single-call `registerPlugin` helper
 * so plugin authors can write `import { registerPlugin } from '@bakin/sdk'`
 * without having to remember which sub-path it lives at. UI primitives,
 * hooks, and components stay on sub-paths (`/ui`, `/hooks`, `/components`,
 * `/slots`) to keep the top-level namespace from exploding.
 *
 * Sub-paths:
 *   - `@bakin/sdk/ui`         — shadcn UI primitives (Button, Card, Dialog, ...)
 *   - `@bakin/sdk/hooks`      — React hooks (useAgent, useSSE, useSearch, ...)
 *   - `@bakin/sdk/components` — shared components (PluginHeader, FacetFilter, ...)
 *   - `@bakin/sdk/slots`      — Slot + registerSlot primitive
 *   - `@bakin/sdk/types`      — full type re-exports
 *   - `@bakin/sdk/metadata`   — docs-aware contract helpers
 *
 * Plugin authors: at build time, mark `@bakin/sdk`, `@bakin/sdk/*`, and
 * `react`/`react-dom` as externals. At runtime the browser's import map
 * (emitted by Bakin) resolves those to the host's bundled copies so there
 * is a single React instance and a single SDK.
 */
export * from './types'
export {
  registerPlugin,
  unregisterPlugin,
  registerPluginCleanup,
  getRegistryVersion,
  subscribeRegistry,
  getAllNavItems,
  getNavItemsSnapshot,
  getPluginNavItems,
  getPluginRoute,
  getPluginRoutes,
} from './register'
export type { ClientRouteEntry, MatchedPluginRoute, NavItem, PluginRegistration } from './register'
