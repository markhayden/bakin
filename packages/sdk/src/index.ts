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
export { defineRoute, defineCoreRoute, definePlugin } from './routing'
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
