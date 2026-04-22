/**
 * `@bakin/sdk` — plugin author SDK.
 *
 * The main entry re-exports types so plugin authors can write
 * `import type { PluginContext, AssetMeta } from '@bakin/sdk'` without having
 * to remember which sub-path types live at. UI primitives, hooks, and
 * components stay on sub-paths (`/ui`, `/hooks`, `/components`) to keep the
 * top-level namespace from exploding.
 *
 * Sub-paths:
 *   - `@bakin/sdk/ui`         — shadcn UI primitives (Button, Card, Dialog, ...)
 *   - `@bakin/sdk/hooks`      — React hooks (useAgent, useSSE, useSearch, ...)
 *   - `@bakin/sdk/components` — shared components (PluginHeader, FacetFilter, ...)
 *   - `@bakin/sdk/types`      — full type re-exports
 *
 * Plugin authors: at build time, mark `@bakin/sdk`, `@bakin/sdk/ui`,
 * `@bakin/sdk/hooks`, `@bakin/sdk/components`, and `react` as externals. At
 * runtime the browser's import map (emitted by Bakin) resolves those to the
 * host's bundled copies so there is a single React instance and a single SDK.
 */
export * from './types'
