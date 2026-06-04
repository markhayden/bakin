# Repo Architecture — Deep Reference

## Overview

Bakin is a single Bun workspace. The repo is five named packages under
`packages/{core,sdk,host,adapter-openclaw,adapter-antfly}`, eight first-party
plugins under `plugins/<id>/`, a small server-side core under `src/`, and a
handful of scripts. The
whole thing compiles via `bun build --compile` into a single-file
binary that ships per platform.

Bun is the runtime, the bundler, and the package manager. There is no
Node.js, no pnpm, no Next.js. `server.ts` still uses Node's
`http.createServer` (Bun is fully node-compat for this) — but every
build command, every test command, and every dev command runs through
Bun.

## Top-Level Layout

```
/                              ← root package (name: "bakin")
├── server.ts                  ← HTTP server entry — argv → CLI dispatch → boot
├── bakin.config.ts            ← Core plugin enable list
├── package.json               ← Root workspace with scripts
├── bun.lock                   ← Bun lockfile (replaces pnpm-lock.yaml)
├── .bun-version               ← Pinned Bun version
├── tsconfig.json              ← Path aliases + root config
├── bunfig.toml                ← Bun test config (preload + DOM env)
├── packages/
│   ├── core/                  ← @bakin/core — shared types, adapter contracts, settings
│   ├── sdk/                   ← @bakin/sdk — plugin author SDK (published to npm)
│   ├── host/                  ← @bakin/host — client shell + API handlers
│   ├── adapter-openclaw/      ← runtime adapter implementation
│   └── adapter-antfly/        ← search adapter implementation
├── plugins/                   ← 8 first-party plugins (each has bakin-plugin.json)
│   ├── tasks/      workflows/   assets/      schedule/
│   ├── memory/     models/      team/        health/
├── src/
│   ├── core/                  ← server-only modules with side effects
│   └── lib/                   ← shared code (client + server safe)
├── scripts/                   ← build + infrastructure
│   ├── build-vendors.ts       ← import-map vendor bundles
│   ├── build-plugins.ts       ← core plugin dist/ builder
│   ├── build-binary.ts        ← cross-platform `bun build --compile`
│   ├── generate-embedded-assets.ts
│   ├── publish-sdk.ts
│   └── lib/                   ← MCP exec tools (self-registering)
├── cli/                       ← thin CLI wrapper delegated to by the binary dispatcher for HTTP-backed commands
├── dev/imitation-crab/        ← OpenClaw mock for dev without real OpenClaw
├── tests/                     ← bun:test suite (bun test --isolate)
└── docs/                      ← plugin-authoring.md and other human-facing docs
```

## Packages

### `packages/core/` — `@bakin/core`

Shared types, utilities, and settings that are safe to import from
**anywhere** — server, plugins, CLI. No React, no browser APIs, no
side effects at import time (except logger module init).

```
packages/core/src/
├── index.ts                ← barrel export
├── constants.ts            ← APP_NAME, APP_SLUG, APP_VERSION, branding
├── content-dir.ts          ← getContentDir(), getBakinPaths(), initBakinHome()
├── settings.ts             ← BakinSettings, getSettings(), updateSettings()
├── app-services.ts         ← AppServices and health service contracts
├── adapters/               ← runtime/search adapter contracts and test helpers
├── tasks/                  ← Bakin task store
├── plugin-types.ts         ← BakinPlugin, PluginContext, StorageAdapter, EventBus
├── logger.ts               ← createLogger()
├── format.ts               ← formatAge(), isStale()
├── vault.ts                ← secret storage
├── hooks/hook-registry.ts  ← cross-plugin hook RPC
├── storage/                ← MarkdownStorageAdapter
└── events/                 ← BakinEventBus
```

### `packages/sdk/` — `@bakin/sdk`

Plugin author SDK. Published to npm as `@bakin/sdk` via
`scripts/publish-sdk.ts` on release. Plugin authors `bun install`
this package to get types; the actual runtime implementation is
injected via the browser import map so every plugin and the shell
share one SDK instance.

```
packages/sdk/src/
├── index.ts                ← registerPlugin, NavItem re-export
├── register.ts             ← registerPlugin + nav/slot browser-global registry
├── ui/                     ← shadcn primitives (Button, Card, Dialog, ...)
├── hooks/                  ← useAgent, useSSE, useSearch, useQueryState, ...
├── components/             ← PluginHeader, FacetFilter, AgentAvatar, ...
├── slots/                  ← Slot, registerSlot primitive
├── types/                  ← Full type re-exports
└── utils/                  ← cn, formatAge, formatSize, isStale
```

Sub-paths are declared via `exports` in `packages/sdk/package.json`:
`@bakin/sdk/ui`, `@bakin/sdk/hooks`, `@bakin/sdk/components`,
`@bakin/sdk/slots`, `@bakin/sdk/types`, `@bakin/sdk/utils`.

### `packages/adapter-openclaw/` and `packages/adapter-antfly/`

Concrete provider implementations. These are not plugin author surfaces and
should only be imported by `src/core/runtime-adapter-factory.ts` and
`src/core/search-adapter-factory.ts`.

```
packages/adapter-openclaw/src/
├── index.ts                ← createOpenClawRuntimeAdapter()
├── runtime.ts              ← AgentRuntimeAdapter implementation
├── home.ts                 ← OPENCLAW_HOME / ~/.openclaw helpers
└── config.ts               ← OpenClaw config parsing helpers

packages/adapter-antfly/src/
├── index.ts                ← createAntflySearchAdapter()
└── search.ts               ← SearchAdapter implementation
```

### `packages/host/` — `@bakin/host`

Client shell + server API handlers. The shell builds to
`packages/host/dist/main.js`; the API handlers are imported directly
by `server.ts`.

```
packages/host/
├── build.ts                ← Bun.build() for the shell → dist/main.js
├── public/
│   ├── index.html          ← shell HTML with <script type="importmap">
│   ├── globals.css
│   └── vendor/             ← prebuilt react/sdk bundles (from build-vendors.ts)
├── dist/                   ← generated (main.js, main.css); not checked in
└── src/
    ├── main.tsx            ← client entry (ReactDOM.createRoot)
    ├── router.ts           ← TanStack Router root
    ├── routes/             ← code-based route modules, one per URL
    │   ├── __root.tsx      ← shell layout + <PluginHost>
    │   ├── index.tsx       ← dashboard /
    │   ├── tasks.tsx       ← /tasks → <Slot name="page:/tasks" />
    │   ├── team.$id.tsx    ← /team/:id → <Slot name="page:/team/[id]" />
    │   ├── workflows.$id.index.tsx / workflows.$id.edit.tsx
    │   └── ...             ← one file per plugin page
    ├── plugin-host/
    │   ├── PluginHost.tsx  ← runtime plugin loader
    │   └── user-plugin-builder.ts — in-binary Bun.build for ~/.bakin/plugins/
    ├── api/                ← Web Fetch-style handlers (Request → Response)
    │   ├── _adapter.ts     ← Node req/res ↔ Web Request/Response bridge
    │   ├── _static.ts      ← host-shell static serve (hashed main.js + vendor)
    │   ├── _embedded-assets.ts / _embedded-assets-static.ts
    │   ├── activity.ts, state.ts, memory/log.ts, agents/*.ts, ...
    │   ├── plugin-settings/[pluginId].ts, plugin-settings/schemas.ts
    │   └── plugins/
    │       ├── manifest.ts        ← GET /api/plugins/manifest
    │       ├── assets.ts          ← serves plugin dist/client.js
    │       ├── install.ts, remove.ts
    │       └── [pluginId]/[[...path]].ts — catch-all plugin router
    ├── components/layout/  ← app shell (sidebar, header, layout-shell)
    ├── providers/          ← Providers, AgentThemeProvider
    ├── context/            ← SidebarContext, ActivityContext
    ├── hooks/use-pathname.ts
    └── lib/react-identity.ts — catch plugins that bundled their own React
```

### What lives in `src/core/` vs `packages/core/`

| In `@bakin/core` | In `src/core/` |
|---|---|
| Types: BakinPlugin, PluginContext, StorageAdapter, EventBus | task-service.ts (side effects, SSE) |
| Constants: APP_NAME, APP_SLUG, etc. | audit.ts (append-only writes) |
| Settings: getSettings(), BakinSettings | sse.ts (globalThis state) |
| Content dir: getContentDir(), getBakinPaths() | dispatch.ts (agent communication through AppServices.runtime) |
| Logger: createLogger() | watcher.ts (chokidar, file events) |
| Storage: MarkdownStorageAdapter | mcp-server.ts (tool registration) |
| Events: BakinEventBus | agents.ts (agent API through AppServices.runtime) |
| Vault, format utilities | app-services.ts and adapter factories |
| Hook registry | cli.ts (binary CLI dispatcher) |
|  | runtime-config-raw.ts (allowlisted raw runtime config reads) |
|  | plugin-scaffold.ts, self-update.ts |
|  | onboarding/ (11 components) |

**Rule of thumb:** If a module has external side effects (writes files,
opens connections, uses globalThis) it stays in `src/core/`. If it's a
pure type, utility, or configurable service, it goes in `@bakin/core`.

### Core Package Facades

A small set of source-tree facades (`src/core/*.ts`, `src/lib/*.ts`) point at
`packages/core/src/` while shared code is split into `@bakin/core`. These are
package-split facades, not provider-client compatibility shims. Do not add new
facades for adapter/provider internals; runtime/search provider details belong
behind `packages/adapter-*` and the adapter factories.

```typescript
// src/core/logger.ts
export { createLogger } from '../../packages/core/src/logger'

// src/core/content-dir.ts
export { getContentDir, getBakinPaths, ... } from '../../packages/core/src/content-dir'
```

Tests **must** mock both paths (see `CLAUDE.md` testing rules) because
either path may be imported while the package split exists, and a missed mock
leaks writes to `~/.bakin/`.

## Plugin Import Rules

Plugins live under `plugins/<id>/` and are NOT Bun workspace packages.
They have their own `package.json` (for `@bakin/sdk` + `react`
devDependencies) but are not declared under the root workspace.

From a core plugin:

```typescript
// From plugins/X/index.ts (depth 2)
import type { BakinPlugin } from '../../src/lib/plugin-types'
import { createLogger } from '../../src/core/logger'
import { appendAudit } from '../../src/core/audit'

// From plugins/X/lib/file.ts (depth 3)
import { getContentDir } from '../../../src/core/content-dir'

// Client files import from the SDK
import { registerPlugin, type NavItem } from '@bakin/sdk'
import { PluginHeader } from '@bakin/sdk/components'
```

Plugin authors (outside the repo) never use the `../../src/*` paths —
they only see `@bakin/sdk/*`. The lint rule enforces this.

## TypeScript Path Aliases

Defined in `tsconfig.json`; bun picks them up automatically for both runtime and `bun test`:

| Alias | Resolves to | Used by |
|---|---|---|
| `@/*` | `./src/*` | Server code + packages/host internals |
| `@bakin/core` | `./packages/core/src/index.ts` | Workspace dependency |
| `@bakin/adapter-openclaw` | `./packages/adapter-openclaw/src/index.ts` | Runtime adapter factory only |
| `@bakin/adapter-antfly` | `./packages/adapter-antfly/src/index.ts` | Search adapter factory only |
| `@bakin/sdk` + sub-paths | `./packages/sdk/src/*` | Plugin client entries |
| `@bakin/tasks` ... `@bakin/health` | `./plugins/<id>` | App + test code (never cross-plugin) |

## Build Pipeline

`bun run build` chains four stages in sequence. `CONTRIBUTING.md` owns
the detailed command reference; the summary:

1. **`bun run build:vendors`** — `scripts/build-vendors.ts` builds
   standalone ESM bundles of `react`, `react-dom`, `react/jsx-runtime`,
   and every `@bakin/sdk/*` sub-path to
   `packages/host/public/vendor/*.js`. The import map in
   `packages/host/public/index.html` points at these files.
2. **`bun run build:plugins`** — `scripts/build-plugins.ts` builds
   each `plugins/<id>/{index.ts, client.tsx}` to `plugins/<id>/dist/`
   with `react` + `@bakin/sdk/*` externalized.
3. **`bun run build:host-shell`** — `packages/host/build.ts` builds
   `packages/host/src/main.tsx` → `packages/host/dist/main.js` (+ `.css`)
   with the same externals.
4. **`bun build --compile`** — `scripts/build-binary.ts` compiles
   `server.ts` for each target triple
   (`bun-darwin-arm64`, `bun-linux-x64`, `bun-linux-arm64`) into
   single-file binaries under `dist/bakin-<platform>-<arch>`.

Stage 1 must run before stage 3/4 so externals resolve at bundle time.
Stages 2 and 3 are independent. Stage 4 requires all prior.

### Embedded assets for the binary

Stage 4 needs every runtime asset (host shell bundle, public/ statics,
plugin dist/ trees) visible to `bun build --compile`. The approach:
`scripts/generate-embedded-assets.ts` walks `packages/host/dist/`,
`packages/host/public/`, and every `plugins/*/dist/`, then writes
`packages/host/src/api/_embedded-assets-static.ts` with one
`import … with { type: 'file' }` per asset. Bun's `--compile` sees
those imports and embeds the file bytes into the binary. At runtime,
`setEmbeddedAssets(EMBEDDED_ASSETS_STATIC)` makes them addressable by
the static handler.

## Request Flow

```
Browser →  HTTP request → Bakin (server.ts)
  ↓
  Node http.createServer((req, res) => ...)
  Dispatch by URL prefix:
    /api/sse           → handleSSE                   (streams)
    /api/*             → dispatchWebHandler(handler) (Web Fetch shape)
    /mcp               → handleMcpRequest            (SSE + Streamable HTTP)
    /api/plugins/<id>/<path> → plugin catch-all router
    /vendor/*          → static handler (from public/vendor or embedded)
    /assets/*          → plugin asset router
    (anything else)    → serveHostClient = SPA fallback (index.html)
  ↓
  index.html loads vendor/*.js + main.js
  ↓
  React mounts <PluginHost><Shell/></PluginHost>
  ↓
  PluginHost fetches /api/plugins/manifest
  PluginHost dynamic-imports each plugin's /api/plugins/<id>/assets/client.js
  Each plugin module runs registerPlugin({ id, navItems, slots }) as a side effect
  ↓
  TanStack Router matches the URL to a route file in packages/host/src/routes/
  Route renders <Slot name="page:/foo" /> → pulls the plugin-registered component
```

## Testing Layout

`bun test` covers both server-side modules and selected React components.
Run: `bun test --isolate` (CI) or `bun test --watch --isolate` (dev).

- `tests/**/*.test.ts` — default-environment tests for core modules,
  routes, plugin logic, and utilities
- `tests/components/**/*.test.tsx` — component tests using Testing
  Library; the DOM comes from `@happy-dom/global-registrator`
  registered globally in `tests/setup.ts`
- `bunfig.toml` preloads `tests/setup.ts` for every run; that file
  also exposes the `vi` compatibility shim (see `tests/vi-shim.d.ts`)
  for legacy vitest-era APIs (`useFakeTimers`, `stubGlobal`,
  `resetModules`, etc.) not mapped 1:1 by `bun:test`

`tests/plugins/test-helpers.ts` owns `activatePlugin`, `callRoute`,
`callTool` — the canonical way to run a plugin in a mocked
`PluginContext` without touching `~/.bakin/`.

Every test **must** mock both `src/core/content-dir` and
`packages/core/src/content-dir` — see the testing rules in
`CLAUDE.md`.

## Runtime Data (`~/.bakin/`)

Created by `bakin onboard` or `initBakinHome()`.

```
~/.bakin/
├── settings.json             ← runtime config (deep-merged with defaults)
├── .onboarded                ← marker the doctor gates on
├── MEMORY-LOG.md             ← agent memory log
├── audit.jsonl               ← append-only audit trail
├── assets/
│   ├── store/                ← canonical assets, flat, sharded by month
│   ├── inbox/                ← drop-zone for manual ingestion
│   └── .trash/               ← soft-delete with 7-day TTL
├── plugins/                  ← installed external plugin storage and bundles
├── workflows/
│   ├── definitions/          ← YAML templates (user-owned)
│   ├── instances/            ← running workflow state
│   └── skills/               ← skill markdown files
├── heartbeats/               ← agent heartbeat JSON files
├── inbox/                    ← incoming items
├── team/personas/            ← agent persona files
├── schedule/                 ← cron job state
├── plugin-settings/          ← per-plugin settings JSON
├── plugins/<id>/             ← installed user plugins (source + generated dist/)
└── logs/server.log           ← rotating server log (10 MB, single backup)
```

## Key Entry Points

| What | File | How it starts |
|---|---|---|
| HTTP server | `server.ts` | `bakin start` (binary) or `bun run dev` |
| Binary CLI | `src/core/cli.ts` | argv parsed in `server.ts` before boot; dispatches `start/stop/status/version/update/plugins/...` |
| Core plugin config | `bakin.config.ts` | Imported by `server.ts` + `registerCorePlugins` |
| Plugin loading | `src/lib/plugin-registry.ts` | Called by `server.ts` during startup |
| MCP tools | `src/core/mcp-server.ts` | Imports `scripts/lib/*.ts` + plugin exec tools. Supports Streamable HTTP and SSE transports. |
| Runtime adapters | `packages/adapter-*` | Provider-specific runtime implementations for agents, channels, approvals, cron, memory, and raw access gates |
| Doctor cron | `src/core/doctor.ts` | `doctor.start(contentDir, projectRoot)` from `server.ts`. ~170-line orchestrator (cron + cache + audit + notify); every check is plugin-registered. Deep ref: `.claude/knowledge/doctor-and-health-checks.md`. |
| TanStack router | `packages/host/src/router.ts` | Boots on client, matches URL to `routes/*.tsx` |
| Runtime plugin loader | `packages/host/src/plugin-host/PluginHost.tsx` | Dynamic-imports every plugin's `client.js` on mount |
| Binary build | `scripts/build-binary.ts` | Runs `bun build --compile` per target triple |

## Binary Packaging

`bun build --compile --target=bun-<platform>-<arch> server.ts -o dist/bakin-<platform>-<arch>`
produces a single-file executable that contains:

- The Bun runtime
- `server.ts` + everything reachable through its import graph
- Every asset imported via `with { type: 'file' }` in
  `packages/host/src/api/_embedded-assets-static.ts` — that's the host
  shell bundle, `public/` static files, and every core plugin's
  `dist/`

User plugins are **not** baked in. They live at runtime in
`~/.bakin/plugins/` and are built in-binary by the user-plugin-builder
the first time they load.

Binaries ship under 120 MB raw per target. The release pipeline
(`.github/workflows/release.yml`) fires on `v*` tags, builds all three
targets, packages each executable as `bakin-<platform>-<arch>.tar.gz`,
computes checksums for the archives users download, and publishes
`@bakin/sdk` to npm.

## Related docs

- `../../CLAUDE.md` — project-level conventions + every key pattern
- `../../CONTRIBUTING.md` — dev setup + build command reference
- `../../docs/plugin-authoring.md` — plugin author walkthrough
- `plugin-system.md` — plugin runtime deep reference
- `storage-model.md` — content-dir layout + sidecar conventions
