# Plugin Client-Side UI Loader

> **Status:** Draft — architecture locked, awaiting final review before issue file
> **Tracking issue:** _to be filed on approval_

## Problem

Today Bakin has two plugin loading paths that don't match:

- **Server:** user plugins load from `~/.bakin/plugins/*` via dynamic `import(/* webpackIgnore: true */ …)` at boot. Routes, hooks, MCP tools, search content types, and watchers all work for user plugins without rebuilding Bakin.
- **Client:** every plugin's UI is bundled at Bakin's build time via ten static imports in `src/lib/plugin-manifest.ts` and ten page wrappers in `src/app/*/page.tsx` that pull from `@bakin/{plugin}/components/*`. A user plugin dropped into `~/.bakin/plugins/` can register server endpoints but cannot show a sidebar nav item, render a page, or contribute UI anywhere else.

The stated direction (`docs/ideas/plugin-system.md`) is Obsidian-style git-distributed plugins. That requires the scenario where a user installs Bakin via CLI, installs a plugin from a git URL, gets a fully working plugin — UI and all — without ever cloning the Bakin repo. That can't work until the client has a loader that matches what the server already does.

This spec covers the client-side loading path, the plugin SDK that makes it authorable, and the migration of all plugins (core and user alike) onto it.

## Goals

1. A user plugin in `~/.bakin/plugins/my-plugin/` can ship UI: nav items, top-level pages, slotted components — all visible without a Bakin rebuild.
2. Plugin authors have one build pipeline that produces a single distributable `client.mjs` (ESM) with React, UI primitives, and cross-plugin hooks treated as externals.
3. All plugins — core and user — load through the same pipeline. There is no "core is special" carve-out. The plugin contract is the contract.
4. No Next.js build step at plugin install time. Server does the work at request-render time.
5. Every Bakin UI — tasks, team, health, user-installed Pomodoro plugin — goes through the dynamic loader. This makes us the first 10 production consumers of the contract.

## Non-goals

- **Plugin sandboxing / isolation.** Plugins run in the main origin with full DOM access. Trust is the Obsidian model: manifest permissions declared, user-consented at install, enforced socially for v1. (Referenced in `docs/ideas/plugin-system.md`.)
- **CSS isolation.** Plugins use Bakin's Tailwind classes via the shared config. CSS collisions are the plugin author's problem.
- **Hot reload in dev.** A plugin author running `bakin dev` still restarts the server to pick up changes, same as today. Hot reload is a future polish issue.
- **Version pinning or semver-range plugin compatibility.** Covered by the separate `bakinVersion` check from the parent plugin-system spec.
- **Marketplace UI, install pipeline CLI, or registry index.** This spec is the loader. Install pipeline is a separate spec.
- **SSR for any page.** All pages hydrate client-side. See Resolved Decisions.

## Resolved decisions

### Import maps, not module federation

We use native browser import maps to resolve `@bakin/sdk`, `react`, and `react-dom` for dynamically-loaded plugin bundles. Module Federation was considered and rejected:

1. **Turbopack doesn't support it.** Next.js 16 is Turbopack-forward for production builds; Vercel's published position is that MF is unsupported on Turbopack. Adopting MF bets against the direction Next.js itself is going.
2. **Webpack coupling.** MF is a Webpack-specific container format. Import maps are a W3C standard shipped in all evergreen browsers since 2023.
3. **Locks plugin authors to Webpack.** MF requires `ModuleFederationPlugin`. Import maps let plugin authors pick Vite, esbuild, rollup, SWC, or anything else with ESM output.
4. **Its killer features are ones we don't want.** MF shines for multiple React versions, version-range negotiation, cross-plugin dependency graphs. We want one React, one SDK, plugins never depend on other plugins. We'd pay MF's complexity tax to not use its benefits.
5. **Debuggability.** MF failures are opaque runtime errors (`ScriptExternalLoadError`, container lookup failures). Import map failures are visible 404s in the network tab.
6. **SSR fit.** MF + SSR requires experimental plumbing. Import maps are client-only by nature, matching our client-only commitment.
7. **Simpler is better when simpler is sufficient.** Import maps cover 100% of what we need. If we ever hit a wall, MF can be retrofitted because the loader module is small — but we won't.

### Single-tier plugin model

All plugins — core and user — build as independent ESM bundles and load dynamically through the same pipeline. There is no "core plugins are statically bundled, user plugins are dynamic" split. Rejected alternatives:

- **Two-tier (core static, user dynamic).** Saves ~5 days of refactor and preserves SSR. Rejected because it puts an exception into the plugin contract — the contract is not the contract if core plugins have a back door.
- **SSR for core plugins.** Rejected because for a self-hosted single-user Tailscale-accessed app, SSR is mostly theater. Pages are data-driven; the server would render placeholders then the client would re-fetch. We already skip that pattern.

The single-tier call commits to:

- `src/app/*/page.tsx` (10 files) collapse to one `src/app/[[...segments]]/page.tsx` catch-all.
- `src/lib/plugin-manifest.ts` gets deleted entirely.
- Every plugin, core and user, has a `vite.config.ts` + `package.json` producing `dist/client.mjs`.
- Every plugin imports React, UI primitives, and cross-plugin hooks from `@bakin/sdk` — no direct relative imports between plugins.
- Lint rule applies universally.

### All pages client-rendered

Direct consequence of single-tier. Accepted.

### Top-level path claims, no `/p/<pluginId>/` prefix

Plugins claim page paths via `ctx.registerPage(path, Component)`. Core plugins claim `/tasks`, `/team`, `/health` etc. (preserving existing URLs). User plugins claim whatever they want. Registry refuses duplicates at activation time with a clear error. No reserved-prefix scheme — collision detection is enough.

Rejected alternative: namespace all user plugin pages under `/p/<pluginId>/...`. Ugly URLs and architecturally inconsistent with core plugins claiming top-level paths.

## Architecture

### Plugin SDK package

New package at `packages/sdk/` published as `@bakin/sdk`. Exposes:

- **React**: re-export so plugins peer-dep on it.
- **UI primitives**: shadcn base components from `src/components/ui/*` — Button, Card, Dialog, Input, Badge, Select, Skeleton — re-exported under `@bakin/sdk/ui`.
- **Layout primitives**: `PluginHeader`, `FacetFilter`, the search UI, markdown viewer/editor.
- **Cross-plugin React hooks**: `useAgent`, `useAgentList`, `useAgentIds` (backed by team), `useNotificationChannels` (backed by workflows), `useTaskboard`, etc. Internally call plugin API endpoints.
- **Plugin runtime hooks**: `useBakinSettings()`, `usePluginSettings<T>()`, `useDebug()`, `useSSE(channel)`.
- **Slot primitive**: `<Slot name="..." {...props} />`.
- **Types**: `AssetMeta`, `AvailableModel`, `NavItem`, `BakinPlugin`, etc.

`@bakin/sdk` is the ONLY way a plugin talks to Bakin or to another plugin's UI. Direct `@bakin/{other-plugin}/*` imports are banned for all plugins by lint rule.

At Bakin build time, `@bakin/sdk` resolves to local source. At plugin build time, `@bakin/sdk` + `react` + `react-dom` are marked as externals. At runtime, Bakin emits an import map that resolves those externals to its bundled copies. One React instance, one SDK.

### Plugin bundle layout

Every plugin — core or user — has this layout:

```
plugins/<id>/                    ← core plugins live here (same repo)
~/.bakin/plugins/<id>/           ← user plugins live here (installed)
├── bakin-plugin.json            ← manifest
├── package.json                 ← declares build tooling + SDK externals
├── vite.config.ts               ← build config (SDK-externalized ESM)
├── src/
│   ├── index.ts                 ← server entry (activate function)
│   ├── client.tsx               ← client entry (registerPlugin call)
│   └── components/              ← plugin-owned React
└── dist/
    ├── index.js                 ← server bundle
    └── client.mjs               ← client bundle (externalizes @bakin/sdk, react)
```

Bakin's own build becomes an aggregation step: build each core plugin's `dist/`, copy into `public/plugins/<id>/`, serve over `/api/plugins/<id>/assets/*`.

### Loading mechanism

**Server-side: `/api/plugins/manifest` route.** Returns the aggregated client-loadable manifest for every registered plugin (core and user):

```json
{
  "plugins": [
    {
      "id": "tasks",
      "clientEntry": "/api/plugins/tasks/assets/client.mjs",
      "pages": [{ "path": "/tasks", "component": "KanbanBoard" }],
      "navItems": [{ "path": "/tasks", "label": "Tasks", "icon": "ListChecks", "order": 10 }],
      "slots": []
    },
    {
      "id": "my-pomodoro",
      "clientEntry": "/api/plugins/my-pomodoro/assets/client.mjs",
      "pages": [{ "path": "/pomodoro", "component": "Timer" }],
      "navItems": [{ "path": "/pomodoro", "label": "Pomodoro", "icon": "Timer", "order": 90 }],
      "slots": [{ "name": "task-sidebar", "component": "TaskTimer" }]
    }
  ],
  "importMap": {
    "imports": {
      "@bakin/sdk": "/sdk/index.mjs",
      "@bakin/sdk/ui": "/sdk/ui/index.mjs",
      "react": "/sdk/vendor/react.mjs",
      "react-dom": "/sdk/vendor/react-dom.mjs"
    }
  }
}
```

**Client-side: `PluginHost` at the app shell.** On mount:
1. Fetch `/api/plugins/manifest`.
2. Inject the `importMap` into the document `<head>` as `<script type="importmap">`.
3. Dynamic-import every plugin's `clientEntry`. Each plugin's client module exports a registration function that runs on import:

```ts
// plugins/tasks/src/client.tsx
import { registerPlugin } from '@bakin/sdk'
import { KanbanBoard } from './components/KanbanBoard'

registerPlugin({
  id: 'tasks',
  pages: { '/tasks': KanbanBoard },
  navItems: [{ path: '/tasks', label: 'Tasks', icon: 'ListChecks', order: 10 }],
})
```

4. Once all plugins have registered, the shell re-renders with their contributions: sidebar nav comes from the registry, routes route through it, slots render.

### Routing

Single catch-all page at `src/app/[[...segments]]/page.tsx`:

```ts
export default function Page({ params }: { params: { segments?: string[] } }) {
  const path = '/' + (params.segments?.join('/') ?? '')
  return <PluginRouter path={path} />
}
```

`PluginRouter` looks up the registered page component for the path in the browser-side plugin registry. No match → renders 404. Deterministic.

### Nav aggregation

`src/lib/plugin-manifest.ts` deleted. Nav items come from the manifest, aggregated into the sidebar at render time. Order is the `order` field on each registered nav item (same semantics as today, just different source).

### Slot system

`ctx.registerSlot(name, Component)` server-side API (plugin declares it in `activate()` or exports it alongside `registerPlugin`). `<Slot name="..." {...props} />` client component looks up all registered renderers for the name and renders them in order.

Initial slots in scope:

- `asset-preview` — renderer for an asset given `{ asset }`. Currently hardcoded in `plugins/assets/components/asset-detail.tsx:29`. Migration makes this the forcing case.
- `task-sidebar` — optional custom side panels on task detail dialog.
- `home-widget` — dashboard tiles.

Slots are additive — many plugins can register for the same slot name; all render.

### Asset serving

User plugin static files served by new `/api/plugins/:pluginId/assets/:path` route reading from `~/.bakin/plugins/:pluginId/dist/`. Core plugin assets served from `public/plugins/:pluginId/dist/` (copied in by Bakin's build). Same origin, no CORS.

## Plugin author workflow

Identical for core and user plugins — that's the point.

1. `pnpm create @bakin/plugin my-cool` scaffolds: `bakin-plugin.json`, `src/index.ts` (server entry), `src/client.tsx` (client entry), `vite.config.ts` preconfigured with `@bakin/sdk` + `react` + `react-dom` externals.
2. Author writes code. Uses `@bakin/sdk` for everything. Never imports `@bakin/{other-plugin}/*`.
3. `pnpm build` produces `dist/index.js` + `dist/client.mjs`.
4. For user plugins: `bakin plugins install ./my-cool` copies `dist/` + `bakin-plugin.json` into `~/.bakin/plugins/my-cool/`, restart.
5. For core plugins: build is aggregated into Bakin's own `pnpm build` step.

## Migration of the 10 existing core plugins

Every core plugin gets:

- Its own `package.json`, `vite.config.ts`, and `dist/` output.
- Its `client.tsx` converted from exporting `navItems` to calling `registerPlugin({...})`.
- Cross-plugin imports (`@bakin/team/hooks/use-agent-store`, `@bakin/assets/components/*`, etc.) swapped for `@bakin/sdk` equivalents.
- Direct component embeds (`<AssetDetailModal>`, `<TaskAssets>`) converted to slots.
- Any server-side cross-plugin imports already covered by the hook-bypass cleanup work.

This is where we stress-test the SDK surface. If migrating tasks-page exposes a gap in `@bakin/sdk`, that's the SDK's problem and we fix it in-place.

## Security surface

Plugins run in main origin. They can read cookies, call any Bakin API, execute arbitrary JS. Obsidian model. Manifest permissions declared, enforcement deferred. Users installing random git URLs are trusting the author; the official curated registry is the social mitigation.

## Sequencing

Shipped behind a feature flag (`BAKIN_ENABLE_CLIENT_PLUGIN_LOADER=true`). Order:

**Phase 1 — SDK package (~4 days)**
1. Create `packages/sdk/` re-exporting React, UI primitives, hooks, types, Slot.
2. Path alias + Webpack externals config.
3. Smoke-test: one core plugin file rewritten to `@bakin/sdk` imports — build green.

**Phase 2 — Slot system (~2 days)**
4. `ctx.registerSlot` + `<Slot>` in SDK.
5. Migrate `asset-preview` as the forcing case.

**Phase 3 — Per-plugin build pipeline (~4 days)**
6. Add `package.json` + `vite.config.ts` to each `plugins/*/` directory. All externalize `@bakin/sdk`, `react`, `react-dom`.
7. Bakin's root `pnpm build` runs the plugin builds first, then Next.js.
8. Build artifacts go to `public/plugins/<id>/dist/`.
9. Assert every plugin's `dist/client.mjs` imports nothing outside the externals list (automated check).

**Phase 4 — Runtime manifest + loader (~4 days)**
10. `/api/plugins/manifest` aggregating all plugin manifests.
11. `PluginHost` component fetching manifest + injecting import map + dynamic-importing entries.
12. `registerPlugin` SDK helper + browser-side plugin registry.

**Phase 5 — Routing overhaul (~3 days)**
13. Catch-all `src/app/[[...segments]]/page.tsx`.
14. Delete the 10 per-plugin `src/app/*/page.tsx` files.
15. `PluginRouter` component.
16. Collision detection in `registerPage` — two plugins claiming the same path = loud error at activation.

**Phase 6 — Core plugin migration (~8 days)**
17. Replace every `@bakin/{other-plugin}/*` client-side import with `@bakin/sdk` equivalent across all 10 plugins.
18. Convert each `plugins/*/client.tsx` from `export const navItems = [...]` to `registerPlugin({...})`.
19. Convert the `<AssetDetailModal>` + `<TaskAssets>` embeds to slots.
20. Delete `src/lib/plugin-manifest.ts`.
21. Visual regression pass — every core page renders identically to today.

**Phase 7 — User plugin install pipeline (~3 days)**
22. `/api/plugins/install` endpoint (finally implements the CLI command that's a stub today).
23. `/api/plugins/remove` endpoint.
24. Asset-serving route for user plugins.
25. `packages/create-plugin/` scaffold.
26. Example user plugin in `examples/` shipping a page + slot.

**Phase 8 — Lockdown + docs (~2 days)**
27. Lint rule: no `@bakin/{plugin-id}/*` imports from any plugin. Applies to core and user.
28. Remove feature flag.
29. Plugin author guide + example walkthrough.

Total: ~30 working days of focused work, 8 phases, ~6 calendar weeks. Each phase individually shippable behind the flag until Phase 8.

## Acceptance criteria

1. A plugin dropped into `~/.bakin/plugins/` that exports a nav item, a page, and a slot renderer shows all three after a single restart.
2. Removing the plugin's folder and restarting removes all three — no orphaned nav/pages/slots.
3. All 10 core plugins produce identical UX to today (no visual or functional regressions).
4. Every plugin (core and user) loads via dynamic import through the same pipeline. No core-plugin static-bundle exception exists.
5. A lint rule fails any PR that adds a `@bakin/{plugin-id}/*` import from any plugin client file.
6. `pnpm tsc --noEmit` + `pnpm vitest run` green at every phase boundary.
7. Plugin install time: single-digit seconds after `dist/` is built. No Next.js rebuild.
8. `src/app/*/page.tsx` (10 files) replaced by one catch-all. `src/lib/plugin-manifest.ts` deleted.
9. Two plugins claiming the same page path fail at activation with a clear error (e.g., `Plugin "my-pomodoro" tried to register path "/tasks" already claimed by plugin "tasks"`).

## Open questions

- **Plugin build tooling.** Ship a Bakin-opinionated Vite config via `create-plugin` scaffold (one-command, zero-config for the author) vs. publish externals docs and let plugin authors roll their own. Lean: ship a template, document the externals contract, don't lock plugins to Vite (any bundler with ESM + externals works).
- **Sidecar CSS.** Plugin ships Tailwind classes Bakin's palette doesn't include (e.g., `bg-fuchsia-400`) — won't render. Solve by shipping the full Tailwind palette in production, or document the constraint. Lean: ship full palette; cost is trivial.
- **Dev loop when writing a plugin.** Restart-to-refresh is painful. A filesystem watcher on `~/.bakin/plugins/*/dist/` that triggers browser reload would be a quick win — not in scope but cheap.
- **SDK versioning.** As `@bakin/sdk` surface grows, breaking changes will happen. For v1, plugins pin to Bakin's version via `bakinVersion` in the manifest; SDK breaking changes = Bakin major bump. Not in scope but needs a doc note.

## Not doing

- **Module federation.** See Resolved Decisions.
- **Two-tier (core static, user dynamic) split.** See Resolved Decisions.
- **Plugin-to-plugin direct imports.** Banned universally by lint rule. All cross-plugin UI goes through `@bakin/sdk`.
- **Runtime permission enforcement.** Tracked separately; manifest-declared only for v1.
- **Install pipeline / git cloning / registry index.** Install endpoint lands in Phase 7 to unstub the CLI, but git cloning + registry index are a separate spec.
- **Plugin-contributed API routes conflicting with core.** Already solved by `/api/plugins/:pluginId/*` namespace — unchanged.
- **SSR for any page.** All hydrated client-side. Accepted tradeoff.
