/**
 * `@makinbakin/sdk` — plugin author SDK.
 *
 * The main entry re-exports types + the single-call `registerPlugin` helper
 * so plugin authors can write `import { registerPlugin } from '@makinbakin/sdk'`
 * without having to remember which sub-path it lives at. UI primitives,
 * layout, patterns, charts, conversation UI, rich content, hooks, and slots stay on focused
 * sub-paths to keep the top-level namespace from exploding. The legacy
 * `/components` barrel is REMOVED (storybook-refit P-final) — compose the
 * focused sub-paths below instead.
 *
 * This entry is AUTHOR API ONLY. The host shell's registry/lazy-loading
 * plumbing lives on `@makinbakin/sdk/internal` and is not a public contract.
 *
 * Sub-paths:
 *   - `@makinbakin/sdk/ui`         — shadcn UI primitives (Button, Card, Dialog, ...)
 *   - `@makinbakin/sdk/layout`     — canonical page and responsive composition
 *   - `@makinbakin/sdk/patterns`   — reusable application-aware UI patterns
 *   - `@makinbakin/sdk/charts`     — isolated data visualization
 *   - `@makinbakin/sdk/conversation` — isolated conversation UI and models
 *   - `@makinbakin/sdk/content`    — opt-in rich content rendering and editing
 *   - `@makinbakin/sdk/hooks`      — React hooks (useAgent, useSSE, useSearch, ...)
 *   - `@makinbakin/sdk/slots`      — Slot + registerSlot primitive
 *   - `@makinbakin/sdk/types`      — full type re-exports
 *   - `@makinbakin/sdk/metadata`   — docs-aware contract helpers
 *   - `@makinbakin/sdk/testing`    — plugin test harness (createTestContext, ...)
 *   - `@makinbakin/sdk/styles.css` — canonical compiled design-system CSS
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
/** Register a cleanup callback fired when the plugin is unregistered. */
export { registerPluginCleanup } from './register'
/** Set or clear a runtime badge on a plugin-owned nav item. */
export { setNavBadge } from './register'
/** Read the current badge for a nav item, or undefined if none. */
export { getNavBadge } from './register'
export type { NavItem, PluginRegistration } from './register'

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
