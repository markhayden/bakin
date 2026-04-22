# Bun Migration — Bakin as a Binary

> **Status:** Draft — architecture locked; awaiting final review before implementation
> **Tracking issue:** #147
> **Related:** #141 (plugin client UI loader — partially shipped), #142 (permissions), #146 (Vite hybrid escape hatch)
> **Target branch:** `issue-147-bun-migration`

## Problem

Bakin is built on Next.js 16 App Router, which fights two of the product's stated goals:

1. **End users install plugins with UI, without a toolchain.** Next.js's closed-world bundling means plugin code must be known at build time. Runtime-loading a user-contributed plugin bundle requires either fragile React-sharing hacks or ejecting from Turbopack (which Next.js 16 is now default-forward). Phase 3+4 of #141 hit this wall.
2. **Bakin ships as a binary — no compilation on the end user's machine.** Next.js requires Node + a build pipeline to produce deployable output. Compiling to a single executable via Node.js SEA is possible but rough.

The resolution is to migrate Bakin off Next.js entirely. The target is Bun as a unified runtime + bundler + package manager, with the whole product distributed as a cross-platform binary. Plugin install works because the binary includes `Bun.build()` — the bundler is in the shipped artifact, so users can install plugins written in TypeScript without any local toolchain.

## Goals

1. **Single-file binary distribution.** `bakin` is one executable per platform. Users download, run. No Node, no pnpm, no Vite on their machine.
2. **End-user plugin install works from source.** Plugin authors ship TS/TSX + manifest. Bakin compiles via `Bun.build()` on install. No prebuilt `dist/` required in plugin repos.
3. **The post-#145 plugin contract is preserved.** `@bakin/sdk/*`, `registerSlot`, `ctx.hooks.*`, `ctx.registerRoute`, etc. all keep their current shapes. The migration is the runtime, not the API.
4. **Cross-platform: Mac arm64 + Linux x64 + Linux arm64 from day one.** Windows deferred.
5. **Daily development loop stays pleasant.** Start pure Bun; revisit Vite hybrid (#146) if DX degrades.

## Non-goals

- **Windows support in v1.** Bun builds Windows fine; it's a test-coverage question, not a code question.
- **Desktop-app UX (Tauri, Electron).** Bakin remains a server accessed via browser over LAN/Tailscale.
- **Rewriting the plugin contract.** `@bakin/sdk` surface stays as-is.
- **Migrating Vitest to Bun's test runner.** Keep Vitest; revisit later if speed matters.
- **Runtime permission enforcement.** Tracked at #142; independent work.

## Operating principles

Codified from conversation for the implementing engineer. These are not aspirational — they're binding for this migration.

1. **Single-user machine.** This Mac mini is the only Bakin install that matters during development. No backward-compatibility concerns, no feature-flag gates on new paths, no remote production to protect.
2. **Aggressive deletion over wrappers.** When a Next.js file becomes obsolete, delete it. Don't leave stubs, re-exports, or "for future backcompat" shims. The post-migration tree should contain nothing that only exists to ease the transition.
3. **No dual-mode code paths.** Migration runs on a single long-lived branch. Bakin is broken mid-migration — don't try to keep it runnable on both stacks simultaneously behind flags.
4. **Tech-debt reduction is a first-class outcome.** Every migration phase is also a cleanup opportunity. If a file gets touched, check whether it's carrying drift from prior phases and resolve.
5. **Trust the contract.** `@bakin/sdk` was built to be the plugin author's only surface. Don't weaken it during migration. Every cross-boundary import discovered during the work is a bug to be fixed, not a reason to soften the contract.

## Resolved decisions

Each decision below is locked. Changing any of these requires explicit conversation, not a mid-implementation judgment call.

### Runtime + server + bundler + package manager: Bun

**Choice:** Bun replaces Node.js, Next.js (server), Webpack/Turbopack, pnpm, tsc, Hono. One tool, one runtime. `Bun.serve()` is the HTTP server. `Bun.build()` is the bundler, used at both Bakin's build time and at plugin-install time (the bundler ships in the binary). `bun install` handles dependency resolution when plugins declare deps beyond Bakin's externals.

**Alternatives considered:**
- **Node.js + Vite + Hono.** Possible but requires Node on the user's machine OR Node.js SEA (newer, rougher toolchain). Bun compiles to binary natively.
- **Deno.** Solid permissions model but npm-compat story is weaker; ecosystem fit is worse for our deps (zod, zustand, xyflow, antfly are Node/Bun territory).
- **Module Federation for plugins.** Explicitly unsupported on Turbopack; locks plugin authors to Webpack; its key features (multi-version React, version negotiation) are things we don't want.
- **pkg / nexe.** Legacy Node-packaging tools. Maintained but stagnant; not modern ESM-friendly.
- **Tauri.** Rust+webview desktop wrapper. Wrong shape — Bakin is a server accessed via browser, not a desktop GUI.

### Client bundling: `Bun.build()`, not Vite

**Choice:** Production builds use Bun's native bundler with `react` and `@bakin/sdk/*` marked external. Resolution at runtime via browser import maps. Dev builds use pure Bun's watch mode.

**Alternatives considered:**
- **Vite from day one.** Best-in-class HMR but adds a build tool beyond Bun. Rejected for now — keep dependency count low. Tracked as an escape hatch at #146 if dev DX degrades.
- **esbuild standalone.** Bun's bundler IS esbuild internally (or similar). Using Bun's wrapper keeps the surface smaller.
- **rspack / rolldown.** Rust-based bundlers, fast, but smaller ecosystem + redundant when we're already betting on Bun.

### Core plugins compiled into the binary

**Choice:** The 10 core plugins (tasks, team, workflows, projects, assets, schedule, memory, messaging, models, health) ship inside Bakin's binary. Their `Bun.build()` output is bundled in at Bakin's release time. Users don't load core plugins from `~/.bakin/plugins/` — they come with the executable. Core plugins version-lock with Bakin (releasing new Bakin = releasing any core plugin changes atomically). Obsidian's model.

User plugins remain loadable from `~/.bakin/plugins/*` — that's the dynamic path. Build happens on install via in-binary `Bun.build()`.

**Alternatives considered:**
- **All plugins load from `~/.bakin/plugins/` (pure single-tier).** Would force users to "install" core plugins separately, which is awkward and bloats first-run UX. Core plugins are Bakin's product, not extensions.
- **Core plugins as separate binary resources downloaded on first run.** Added complexity with no real win; embedded resources are atomic with the binary version.

### `@bakin/sdk` published to npm

**Choice:** Plugin authors `bun install @bakin/sdk` to get IDE autocomplete + TypeScript types. Package is built from `packages/sdk/` at Bakin release time, version-matched to the binary. If a plugin targets `@bakin/sdk@^1.2.0`, it works against Bakin v1.2.x through v1.x.x per semver. Breaking SDK changes = Bakin major bump.

**Alternatives considered:**
- **Binary-generated types via `bakin plugins types`.** Non-standard; poor IDE UX; no tree-shaking benefits; harder to version.
- **Ship types as a downloadable tarball.** Same downsides; plus users have to know about it.
- **No IDE types at all, rely on runtime errors.** Unacceptable DX for a TypeScript ecosystem plugin system.

### Monorepo structure preserved

**Choice:** Bakin's own repo stays as a monorepo containing core plugins. User plugins live in their own repos (distributed via git clone). The split mirrors VS Code's model (core in monorepo, extensions standalone).

**Alternatives considered:**
- **Core plugins as separate repos.** Nicer release decoupling but core plugins version-lock with Bakin anyway — no independence gained. Added git-repo management overhead for no benefit.

### All client UI is client-rendered

**Choice:** No SSR. Already the post-#145 posture; Bun doesn't change this.

**Alternatives considered:**
- **SSR via Bun.** Bun supports React server rendering, but our pages are data-driven and already client-hydrated. For a LAN single-user app, SSR adds complexity with no perceptible benefit.

### Platforms

**Day-one release matrix:**
- macOS arm64 (Apple Silicon — primary target, your Mac mini)
- Linux x64 (self-hoster fleet)
- Linux arm64 (Raspberry Pi, Oracle free-tier, Graviton)

Windows deferred. GitHub Actions builds all three from one workflow via `bun build --compile --target=<platform>`.

**Alternatives considered:**
- **Mac-arm64-only v1.** Simpler but closes the door to Linux self-hosters. Cost of adding Linux is near-zero in build pipeline time; the real cost is test coverage across platforms, which we accept.

### Router: TanStack Router

**Choice:** TanStack Router is the modern successor to React Router — first-class TypeScript, file-based routing via convention, full type inference on params, Vite/ESM native. Better fit for our stack than React Router's legacy shape.

**Alternatives considered:**
- **React Router v7.** Fine, mature, huge ecosystem. Rejected for less-modern DX (param types aren't inferred as cleanly) and because TanStack Router's file-based convention maps 1:1 with our existing `src/app/*` structure.
- **Custom route tree.** Re-inventing what TanStack Router handles well.
- **Wouter / nanoroute.** Too minimal for our parameterized-route needs.

### Storage: keep markdown, add SQLite for operational state

**Choice:** User-facing content stays in markdown + sidecars (projects, tasks, workflows, assets) — editability in Obsidian and git-diffability are real value. SQLite (via Bun's built-in `bun:sqlite`) **may** handle operational state: audit log (currently `audit.jsonl`), plugin-settings cache, search-state operational metadata. Migration of operational state is opt-in per-module and **out of scope for this migration** — flagged as a post-migration consideration.

**Alternatives considered:**
- **Everything to SQLite.** Loses Obsidian compatibility; loses git-diff visibility for project/task state. Markdown-on-disk is a genuinely good choice for a single-user app.
- **Everything stays in markdown/JSONL.** `audit.jsonl` grows unbounded and has no fast query story; eventually becomes a real pain. SQLite is the right destination eventually, just not in this migration.

### Better-sqlite3 stays (for now)

**Choice:** `plugins/tasks/lib/flow-store.ts` uses `better-sqlite3` for the `flow_runs` SQLite store. Keep this through the migration. Port to `bun:sqlite` later if friction emerges.

**Alternatives considered:**
- **Port during this migration.** Adds risk + scope. The two APIs are similar but different enough to require careful testing of every flow_runs query.

### Chokidar stays (for now)

**Choice:** Chokidar watcher works on Bun. Keep through migration; revisit if event-emission edge cases bite.

**Alternatives considered:**
- **Swap for `Bun.FileSink` / native `fs.watch`.** Unnecessary scope addition; chokidar's multi-file debouncing is well-tuned for Bakin's patterns.

## Architecture

### Runtime flow

```
bakin start
  │
  ├─ Bun runtime initializes
  ├─ Bun.serve() on :3737
  ├─ Core plugins load from embedded resources (bundled in binary)
  │    → each calls plugin.activate(ctx)  (same contract as today)
  ├─ User plugin discovery: scan ~/.bakin/plugins/
  │    ├─ For each: read bakin-plugin.json
  │    ├─ If dist/ stale or missing (mtime check vs. src/):
  │    │    ├─ bun install (only if package.json has deps beyond externals)
  │    │    └─ Bun.build({ entrypoints, external, outdir: dist/ })
  │    ├─ Dynamic-import dist/index.js (server entry)
  │    └─ plugin.activate(ctx)
  ├─ Browser loads shell at http://localhost:3737
  ├─ Shell fetches /api/plugins/manifest
  │    → { plugins: [{ id, clientEntry, navItems, pages, slots }], importMap }
  ├─ Shell injects <script type="importmap">
  ├─ Shell dynamic-imports each plugin's dist/client.mjs
  │    → each calls registerPlugin({ pages, nav, slots })
  └─ Shell renders with plugins contributed
```

### Repository structure

```
bakin/
├── packages/
│   ├── core/                   — framework-agnostic utilities (existing, moved from src/core)
│   │   └── src/                  ids, logger, settings, storage, vault, ...
│   ├── sdk/                    — @bakin/sdk (published to npm at release time)
│   │   └── src/                  ui, hooks, components, slots, types, utils
│   └── host/                   — Bakin's shell (NEW — replaces src/app/)
│       ├── src/
│       │   ├── main.tsx        — client entry (React mount + plugin host)
│       │   ├── server.ts       — Bun server entry (Bun.serve)
│       │   ├── routes/         — TanStack Router route tree
│       │   ├── api/            — REST handler modules
│       │   ├── plugin-host/    — runtime plugin registry + loader
│       │   └── components/     — shell-internal components (layout, header, sidebar)
│       └── public/             — static assets
├── plugins/                    — core plugins (compiled INTO binary)
│   ├── tasks/
│   │   ├── bakin-plugin.json
│   │   ├── package.json        — declares externals + any deps
│   │   ├── src/
│   │   │   ├── index.ts        — server entry (BakinPlugin)
│   │   │   └── client.tsx      — registerPlugin({...})
│   │   └── (no dist/ in repo — built at Bakin release time)
│   └── (9 more, identical shape)
├── bakin.config.ts             — plugin roster for the binary
├── build.ts                    — builds the binary via bun build --compile
├── scripts/                    — CI, release, auxiliary tooling
└── tests/                      — vitest tests (unchanged location)
```

### What gets deleted

- `src/app/**` (Next.js App Router tree)
- `src/components/**` — reorganized: UI primitives that plugin authors need already live in `@bakin/sdk/components`; shell-internal components move to `packages/host/src/components/`
- `src/core/**` — moves to `packages/core/src/` (most already there; complete the move)
- `src/lib/**` — shell-internal code moves to `packages/host/src/lib/`; SDK-facing pieces are already in `@bakin/sdk`
- `src/hooks/**` — same split: SDK-surface hooks already in `@bakin/sdk/hooks`; shell-internal hooks move to `packages/host/src/hooks/`
- `src/types/**` — SDK types already in `@bakin/sdk/types`; shell-internal types move to `packages/host/src/types/`
- `next.config.ts`, `next-env.d.ts`, anything Next.js-specific
- Webpack/Turbopack aliases in `tsconfig.json` — replaced with Bun-aware set
- `package.json` Next.js deps (`next`, `eslint-config-next`)
- `pnpm-lock.yaml` (replaced by `bun.lockb`)
- `pnpm-workspace.yaml` (Bun has workspace support via root `package.json`)

Per operating principle 2: delete these files outright. Don't leave stubs, re-exports, or `.old` backups. Git history is the rollback mechanism.

### What stays

- `plugins/**/index.ts` — server-side `activate(ctx)` shape unchanged
- `plugins/**/client.tsx` — `registerSlot` + `registerPlugin` unchanged (note: `registerPlugin` is a new helper added in this migration; existing `registerSlot` calls continue to work)
- `packages/sdk/**` — surface identical; internal re-export sources may shift as `src/*` files move
- `~/.bakin/` — data format unchanged. No data migration.
- `@bakin/core/openclaw-home`, adapter principle — unchanged
- Antfly SDK integration — unchanged (HTTP client, framework-agnostic)
- Chokidar watcher, SSE broadcast pattern, MCP server, hooks registry — unchanged
- Vitest tests — run via `bun x vitest`
- `better-sqlite3` usage in `plugins/tasks/lib/flow-store.ts` — unchanged

### React-sharing mechanism

Bakin's shell builds with `react`, `react-dom`, `react/jsx-runtime` marked as externals. The binary embeds pre-built React ESM bundles at stable URLs (e.g. `/vendor/react.mjs`). At runtime, the shell emits an import map on the root HTML:

```html
<script type="importmap">
{
  "imports": {
    "react": "/vendor/react.mjs",
    "react-dom": "/vendor/react-dom.mjs",
    "react/jsx-runtime": "/vendor/jsx-runtime.mjs",
    "react/jsx-dev-runtime": "/vendor/jsx-dev-runtime.mjs",
    "@bakin/sdk": "/vendor/sdk/index.mjs",
    "@bakin/sdk/ui": "/vendor/sdk/ui.mjs",
    "@bakin/sdk/hooks": "/vendor/sdk/hooks.mjs",
    "@bakin/sdk/components": "/vendor/sdk/components.mjs",
    "@bakin/sdk/slots": "/vendor/sdk/slots.mjs",
    "@bakin/sdk/types": "/vendor/sdk/types.mjs",
    "@bakin/sdk/utils": "/vendor/sdk/utils.mjs"
  }
}
</script>
```

Plugin bundles have the same externals. At load time, the browser resolves `react` to the same URL for shell and plugin — one React instance across the whole app. Verified by a smoke test that reference-compares `React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE` (or whatever React's current internal marker is) between shell and a registered plugin renderer.

### Plugin build-on-install

`bakin plugins install github:foo/bar`:

1. git clone → `~/.bakin/plugins/<id>/`
2. Read `bakin-plugin.json` (manifest) + `package.json` (if present)
3. If deps declared beyond Bakin's externals: `bun install` in the plugin dir (uses embedded Bun package manager; fetches from public npm registry — see Security section)
4. `Bun.build({ entrypoints: [src/index.ts, src/client.tsx], outdir: dist, external: ['react', 'react-dom', 'react/jsx-runtime', '@bakin/sdk', '@bakin/sdk/*'] })`
5. Trigger a runtime reload:
   - Server: re-scan plugins, dynamic-import new plugin's `dist/index.js`, call `plugin.activate(ctx)`
   - Browser: SSE-nudge on channel `plugins.added`; shell refetches `/api/plugins/manifest`, dynamic-imports the new plugin's `dist/client.mjs`

No Bakin restart required. No toolchain on the user's machine.

## Commands

Canonical CLI surface. Implementing engineer must honor these exactly — plugin authors and the docs depend on them.

### Runtime commands

| Command | Purpose | Exit codes | Output |
|---------|---------|------------|--------|
| `bakin start` | Start the server on :3737 (default) | `0` success, `1` port conflict, `2` corrupt `~/.bakin/`, `3` OpenClaw gateway unreachable (warn, continues) | Structured JSON logs to stdout + `~/.bakin/logs/server.log` |
| `bakin stop` | Kill running server | `0` success or not running, `1` kill failed | `Stopped bakin server` or `No running bakin server` |
| `bakin status` | Show running state | `0` healthy, `1` not running, `2` degraded | JSON: `{ pid, uptime, version, plugins: [...], health: 'ok' }` |
| `bakin update` | Self-replace the binary with latest release | `0` success, `1` network error, `2` signature mismatch | Progress output; confirms version swap |
| `bakin version` | Print binary version | `0` | `bakin <semver> (<commit>)` |

### Plugin commands

| Command | Purpose | Exit codes | Output |
|---------|---------|------------|--------|
| `bakin plugins list` | List installed user plugins (core plugins shown separately) | `0` | Table: id, version, source, status |
| `bakin plugins install <source>` | Install from GitHub (`github:owner/repo`), git URL, or local path | `0` success, `1` invalid manifest, `2` build failure, `3` network/clone failure | Progress: clone → install deps → build → register. Final: `Installed <id>. Visible after next browser reload.` |
| `bakin plugins remove <id>` | Remove user plugin from `~/.bakin/plugins/<id>/` | `0` success, `1` not installed, `2` core plugin (refuse) | `Removed <id>. Restart Bakin to fully unload.` |
| `bakin plugins dev <path>` | Watch a local plugin dir, rebuild on save, SSE-reload browser | `0` clean exit, `1` invalid plugin dir, `2` build error | File-change log + rebuild timing per save |
| `bakin plugins scaffold <name>` | Create a minimal plugin template at `./<name>/` | `0` success, `1` path exists, `2` invalid name | Writes manifest + `package.json` + `src/{index.ts,client.tsx}` |
| `bakin plugins reindex` | Force rebuild all user plugin `dist/` outputs | `0` all succeeded, `1` one or more failed (reported) | Per-plugin status line |
| `bakin plugins types` | Print the current `@bakin/sdk` version for `package.json` pinning | `0` | `@bakin/sdk@<version>` |

### Developer commands (for working on Bakin itself, not end-user)

| Command | Purpose |
|---------|---------|
| `bun dev` | Run Bakin in dev mode (replaces `pnpm dev`) |
| `bun run build` | Build Bakin's binary locally |
| `bun run build:plugins` | Rebuild all core plugins (invoked by `bun run build`) |
| `bun x vitest` | Run the test suite |
| `bun x vitest watch` | Watch mode |
| `bun run lint` | ESLint |
| `bun x tsc --noEmit` | Type check |

### Removed commands (Next.js era)

- `pnpm dev` / `pnpm build` / `pnpm start` — replaced by `bun` equivalents
- Any `next`-prefixed scripts in `package.json` — deleted

## Code style

Existing conventions carry forward. Reiterated here so implementing engineer doesn't have to hunt.

- **TypeScript strict mode.** `strict: true`, `noImplicitAny: true`, `noUncheckedIndexedAccess: true` (consider tightening).
- **No `any` across module boundaries.** Use `unknown` + narrowing or Zod validation at system edges.
- **Zod at system boundaries only.** API input, file parsing, settings. Not for internal object passing.
- **No empty catch blocks.** Every `catch` must either log (`log.warn('...', err)`) or rethrow.
- **Functional preference.** Pure functions over classes where practical. Classes OK for registries and stateful services.
- **`const` over `let`.** `let` only when reassignment is genuinely needed.
- **Never `var`.**
- **Files:** `kebab-case.ts` / `kebab-case.tsx`.
- **Types/interfaces:** `PascalCase`.
- **Constants:** `UPPER_SNAKE_CASE` for true constants only.
- **Comments:** only for WHY, never WHAT. Well-named identifiers replace comments.

### Import order

```ts
// 1. Node builtins (Bun-native: still `import { join } from 'path'` etc.)
import { join } from 'path'
// 2. External packages
import { z } from 'zod'
// 3. @bakin/core and @bakin/sdk
import { createLogger } from '@bakin/core/logger'
import { Button } from '@bakin/sdk/ui'
// 4. Relative (same plugin/package)
import { helper } from './utils'
```

### Path aliases (post-migration)

Simplified from current Next.js-era aliases:

```json
{
  "paths": {
    "@bakin/core": ["./packages/core/src/index.ts"],
    "@bakin/core/*": ["./packages/core/src/*"],
    "@bakin/sdk": ["./packages/sdk/src/index.ts"],
    "@bakin/sdk/*": ["./packages/sdk/src/*"],
    "@bakin/host/*": ["./packages/host/src/*"]
  }
}
```

No more `@/*` alias — replaced by explicit `@bakin/host/*` in host code. Plugins never import `@bakin/host/*`; they use `@bakin/sdk/*` exclusively.

### ESLint rule

Existing `no-restricted-imports` rule for `plugins/**` (from #145) stays. Updates:
- Remove `@/*` patterns (alias is deleted).
- Add `@bakin/host/*` as restricted from plugins.
- Keep `@bakin/<plugin-id>/*` cross-plugin ban.

## Testing strategy

Current baseline: **2984 Vitest tests** across 218 test files. Target: all pass on Bun post-migration, no functionality regressions.

### Test categorization (done at Phase A boundary)

**Category 1 — Unchanged, run as-is (~90% of tests):**
- Pure unit tests (parsers, utilities, formatters)
- Plugin internal-logic tests
- Hook registry tests
- Storage adapter tests
- SDK slot tests

These tests have no framework coupling. They pass on Bun via `bun x vitest run`.

**Category 2 — Adjust mocks (~8% of tests):**
- Tests mocking `next/server` imports (`NextRequest`, `NextResponse`)
- Tests mocking `next/navigation` (`useRouter`, `useParams`)
- Tests mocking `next/image` (if any)

Identified at Phase B/C. Mocks swap from Next.js types to standard `Request`/`Response` (Web Fetch API). For router mocks, TanStack Router has its own testing utilities.

**Category 3 — Rewrite (~2% of tests):**
- Tests that exercise Next.js API route behavior (`route.ts` as module under test)
- Tests hitting Next.js's dev server directly

Identified at Phase B. Rewrite to test the Bun handler module directly (handlers are regular functions taking `Request` returning `Response`).

**Category 4 — New tests:**
- Plugin build-on-install smoke test
- React-instance sharing assertion (import-map end-to-end)
- Binary start/stop/status command tests
- Cross-platform binary smoke tests in CI (Mac arm64, Linux x64, Linux arm64)

### Per-phase regression battery

Every phase ends with `bun x vitest run && bun x tsc --noEmit && bun run build` all green.

- **Phase A:** full Vitest suite on Bun. Uncover Category 2/3 mocks that break under Bun.
- **Phase B:** plus explicit tests that every migrated API endpoint returns the same response shape.
- **Phase C:** plus visual smoke test — all 10 core pages render identically (screenshot diff or manual pass).
- **Phase D:** plus React instance identity test (shell + plugin reference equality).
- **Phase E:** plus plugin build-on-install test with a fixture plugin.
- **Phase F:** plus end-to-end: install a test plugin from a local path, verify nav + page + slot appear without restart.
- **Phase G:** plus binary-spawns-cleanly smoke on each platform in CI.
- **Phase H:** plus `bun install @bakin/sdk` in a temp dir, import types, verify autocomplete surface.
- **Phase I:** plus grep-based sanity: zero Next.js imports, zero `@/*` path references.

### Test infrastructure changes

- **`vi.mock` targets change.** Any test mocking `../../src/core/*` must update to `../../packages/core/src/*` (if moved) — or use aliases consistently. Do this mechanically with a find-replace script at the phase where each file moves.
- **jsdom environment.** Unchanged. Vitest on Bun runs jsdom fine.
- **React Testing Library.** Unchanged. Works on Bun.
- **`test-helpers.ts`** (`tests/plugins/test-helpers.ts`): swap any Next.js-specific types for Web types. Update `ctx` literal construction if PluginContext surface changes.

### Smoke tests for the binary itself

New file: `tests/binary/bakin-cli.test.ts`. Spawns the compiled binary in a subprocess, asserts:
- `bakin version` prints a valid semver
- `bakin status` returns exit 1 when nothing is running
- `bakin start` + `bakin stop` cycle leaves clean state
- `bakin plugins scaffold test-plugin` writes the template
- Binary responds to SIGTERM cleanly

Run only in CI on the release binary; skipped in local `vitest` runs (gated on `BAKIN_TEST_BINARY=1`).

## Performance targets

Measured at Phase I; must meet these before merge:

| Metric | Target | Measurement |
|--------|--------|-------------|
| Binary cold start (Mac arm64) | <500ms to `Bun.serve()` listening | `time bakin start` from a cold launch |
| Binary size | <120MB per platform | `ls -l` on the compiled binary |
| Initial HTML response | <50ms on localhost | `curl -w '%{time_total}'` at `/` |
| React hydration TTFI | <800ms on Mac arm64 LAN | DevTools performance panel, measure from navigation start to interactive |
| Plugin install (typical, 0 deps) | <5s | `time bakin plugins install` on a fixture plugin |
| Plugin install (with `bun install`, ~5 deps) | <30s | Same, fixture with deps |
| Plugin hot-reload after `bakin plugins dev` save | <1s to browser update | Manual |
| Vitest full suite | <10s | `time bun x vitest run` |
| `tsc --noEmit` | <15s cold, <3s warm | `time bun x tsc --noEmit` |

If any target misses by >20%, block merge and investigate.

## Security + trust model

### Plugin install downloads + compiles user code

`bakin plugins install <source>` does three things that require trust:

1. **Network fetch** — `git clone` pulls from GitHub (or any git URL). No authentication; public repos only in v1.
2. **Dependency resolution** — if plugin has `package.json` deps, `bun install` fetches from the public npm registry. Any npm package becomes executable code in Bakin's server process.
3. **Compilation + execution** — `Bun.build()` compiles plugin source; server dynamic-imports the output and calls `plugin.activate(ctx)`. Plugin code runs with Bakin's full permissions (filesystem, network, OpenClaw gateway).

**Trust assumptions for v1:**
- User manually initiates every install (no auto-install from remote triggers).
- User inspects the plugin source before installing (or trusts the author — "Obsidian model").
- Plugins declared in `bakin-plugin.json`'s `permissions` array are logged at install time (not enforced until #142).
- No plugin signing, no curated registry v1. `bakin plugins install` warns on install: "Plugin X from <source> will run with full filesystem and network access. Continue? [y/N]".

**Mitigations planned for later (NOT in this migration):**
- Signed plugin manifests (#142 or follow-up)
- Curated registry with review gates
- Sandboxing via Web Worker / iframe / v8 isolate
- Permission enforcement at runtime (#142)

### `bun install` during plugin install

Requires public npm registry access. Offline installs of deps-heavy plugins are NOT supported in v1. If a user is offline, `bakin plugins install` reports "deps fetch failed, plugin not installed" and rolls back.

### Binary update integrity

`bakin update` fetches from GitHub releases. Must verify:
- **SHA256 checksum** of the downloaded binary against the release's `checksums.txt`
- (Future) GPG signature — deferred, not v1

Update failure modes:
- Checksum mismatch → refuse to swap, leave old binary in place, non-zero exit
- Download failure → same
- Partial write → write to `bakin.new`, rename atomically after verify

### Core plugin integrity

Core plugins are embedded in the binary. No separate verification needed — they're part of the signed/checksummed release artifact.

## Sequencing

Shipped as a series of commits on a single long-lived branch (`issue-147-bun-migration`). No intermediate PRs until the branch is ready to merge whole — this migration doesn't support partial rollouts per operating principle 3.

Commit strategy: **one commit per numbered step** in each phase below. Each commit is reviewable in isolation and serves as a rollback point. Phase boundaries are additional "definitely clean state" checkpoints — `bun x tsc --noEmit && bun x vitest run && bun run build` green before moving to the next phase.

### Phase A — Runtime swap (~3 days)

Goal: Bakin runs on Bun instead of Node. Next.js is still the framework; we just swap the runtime.

- **A1:** Install Bun on dev machine. Verify version >= 1.2.0. Document in README.
- **A2:** Replace `pnpm install` / `pnpm-lock.yaml` with `bun install` / `bun.lockb`. Delete `pnpm-workspace.yaml`; use Bun's workspace support via root `package.json`'s `workspaces` field.
- **A3:** Update `server.ts` to use Bun's globals (`Bun.spawn`, `Bun.file`) where they simplify Node equivalents. Keep Next.js wrapping intact.
- **A4:** Update package.json scripts: `bun dev` runs the dev loop (initially still via Next.js).
- **A5:** Update CLAUDE.md's "Server" line to reflect Bun runtime. Defer full CLAUDE.md rewrite to Phase I.
- **A6:** Run full test suite on Bun: `bun x vitest run`. Expect ~0 regressions; any that appear get filed as Category 2/3 per testing strategy.

**Rollback:** Revert A1-A6 commits; `pnpm install` restores the Node toolchain. No destructive changes yet.

**Commit checkpoint:** `chore(runtime): migrate from Node + pnpm to Bun`

### Phase B — Server migration (~3 days)

Goal: Replace Next.js API routes with Bun.serve() handlers. Next.js still serves the client; we're peeling off the server half.

- **B1:** Add Bun.serve() as the HTTP entry in `server.ts`. Leave existing Next.js handling intact on a sub-path while we migrate routes.
- **B2:** Create `packages/host/src/api/` skeleton. Move API route files one plugin at a time:
  - `src/app/api/activity/route.ts` → `packages/host/src/api/activity.ts`
  - `src/app/api/agents/**/route.ts` → `packages/host/src/api/agents/**`
  - etc. for 16 total route files.
  Each handler becomes a regular exported function: `export async function handler(req: Request): Promise<Response>`. No more `NextRequest`/`NextResponse`.
- **B3:** Wire the handlers into Bun.serve()'s routing. Use a minimal router (explicit pattern match or `URLPattern`).
- **B4:** Per-route migration: move the `route.ts`, rewrite imports (`NextRequest` → `Request`, `NextResponse.json` → `Response.json`), delete the old file.
- **B5:** Plugin catch-all (`/api/plugins/:pluginId/*`) — the biggest route. Move to `packages/host/src/api/plugin-dispatcher.ts`. Dispatches to each plugin's registered route handlers via the PluginRegistry.
- **B6:** Update tests in Category 2/3 to target the new handlers. Rewrite the ~8 Next.js-coupled test files.
- **B7:** Confirm: every route responds correctly. Full `vitest run` green.

**Rollback:** Per-route reverts are possible (each route migration is its own commit). Phase B boundary is the last "easy revert" point before the client is touched.

**Commit checkpoints:** one per route migration (~16 commits in this phase) + a final `feat(server): Bun.serve() replaces Next.js API route layer`.

### Phase C — Client migration (~4 days)

Goal: Replace Next.js App Router + webpack/Turbopack with Bun.build() + TanStack Router. This is the heaviest phase.

- **C1:** Stand up `packages/host/` client build. `main.tsx` as entry; `Bun.build({ entrypoints: ['packages/host/src/main.tsx'], outdir: 'packages/host/dist', target: 'browser', format: 'esm' })`.
- **C2:** Port root layout. `src/app/layout.tsx` → `packages/host/src/components/Shell.tsx` (or wherever). Retain Providers, AgentThemeProvider, etc.
- **C3:** Install TanStack Router. Scaffold route tree at `packages/host/src/routes/`.
- **C4:** Port each `src/app/*/page.tsx` to a TanStack Router route. Each becomes a route module exporting a component that renders `<Slot name="page:/route" />`. Parameterized routes (`[id]`) become TanStack's `$id` syntax.
- **C5:** Replace `next/navigation` (`useRouter`, `useParams`, `usePathname`) with TanStack Router equivalents (`useNavigate`, `useParams`, `useLocation`). Most plugin components use these via `@bakin/sdk/hooks` — update the SDK re-exports to point at TanStack equivalents.
- **C6:** Static asset serving: Bun.serve() serves `packages/host/dist/*` and `packages/host/public/*`. Delete Next.js's implicit `public/` handling.
- **C7:** Run full test suite. Visual smoke test all 10 core pages.

**Rollback:** Revert C1-C7. Next.js client still exists (not yet deleted) — can roll back by re-pointing `server.ts` to Next.js.

**Commit checkpoints:** C1, C2, C3, one per route ported (~15 commits), C5, C6, `feat(client): Bun.build() + TanStack Router replaces Next.js App Router`.

### Phase D — Externals + import map (~2 days)

Goal: Bakin's shell externalizes React + SDK. Import map resolves externals. Plugins will share React.

- **D1:** Add `Bun.build()` option `external: ['react', 'react-dom', 'react/jsx-runtime', '@bakin/sdk', '@bakin/sdk/*']` for the shell build.
- **D2:** Build separate vendor bundles. `scripts/build-vendors.ts` produces `packages/host/public/vendor/react.mjs`, `react-dom.mjs`, `jsx-runtime.mjs`, `sdk/*.mjs`.
- **D3:** Shell emits the import map in its root HTML template.
- **D4:** Add assertion at boot: shell's imported React equals the `/vendor/react.mjs` module's default export (reference equality). Crash-early if they differ.
- **D5:** End-to-end test: fixture plugin built with externals; when loaded, calls `useState` and the returned state object shares React's internal WeakMap with the shell's own state.

**Rollback:** Revert D1-D5. Shell goes back to bundling React inline.

**Commit checkpoint:** `feat(host): emit import map + externalize React/SDK for plugin sharing`

### Phase E — Plugin compilation (~3 days)

Goal: Every plugin (core + user) builds as its own Bun.build() output. No more static imports from plugin-manifest.ts.

- **E1:** Delete `src/lib/plugin-manifest.ts` (the static imports file). Its nav-aggregation role moves to the runtime manifest endpoint (Phase F).
- **E2:** Each core plugin (`plugins/<id>/`) gets its own `bakin-plugin.json` if not present, and `package.json` declaring `react` + `@bakin/sdk` as peer deps.
- **E3:** `build.ts` at repo root. Iterates core plugins, runs `Bun.build()` per plugin with externals, outputs to `plugins/<id>/dist/`.
- **E4:** Bakin's binary-build step embeds `plugins/*/dist/*` as resources via `Bun.embeddedFiles`.
- **E5:** At runtime, `PluginRegistry.loadCorePlugins()` reads embedded resources, dynamic-imports, calls `activate(ctx)`. Same code path as user plugins, just different source.
- **E6:** User plugin install implements the in-binary `Bun.build()` call per the architecture section.

**Rollback:** Delete the `dist/` outputs, restore plugin-manifest.ts from Phase D's commit. Larger blast radius — this is the point where the framework split is real.

**Commit checkpoints:** E1 (delete plugin-manifest.ts), E2 (per-plugin package.json, ~10 commits), E3-E4 (build pipeline), E5 (core plugin loader), E6 (user plugin build-on-install).

### Phase F — Runtime plugin loader (~3 days)

Goal: Browser dynamic-imports plugin bundles at runtime via import maps + manifest endpoint.

- **F1:** `/api/plugins/manifest` endpoint. Returns `{ plugins: [...], importMap: {...} }`.
- **F2:** `PluginHost` React component in shell. On mount: fetches manifest, injects import map, dynamic-imports each plugin's `clientEntry`, waits for all `registerPlugin` calls to complete, re-renders.
- **F3:** `registerPlugin()` helper in `@bakin/sdk/slots` (or adjacent). Mutates browser-side plugin registry. Per-plugin pages, nav items, slots all captured.
- **F4:** Shell reads from the plugin registry at render time — nav items, route component lookups, slot content — same as the existing Slot mechanism, just with `registerPlugin` as the umbrella.
- **F5:** Remove the transitional "static imports" from core plugin client.tsx files. Core plugins register via `registerPlugin` identically to user plugins.
- **F6:** End-to-end: drop a test plugin into `~/.bakin/plugins/`, verify nav + page + slot appear without restart after browser reload.

**Rollback:** Revert F1-F6. Core plugin registrations fall back to whatever Phase E left them at.

**Commit checkpoints:** F1 (manifest endpoint), F2 (PluginHost), F3 (registerPlugin), F4 (shell consumption), F5 (per-plugin conversion, ~10 commits), F6 (e2e test).

### Phase G — Binary compilation + distribution (~3 days)

Goal: Production binary exists, is released, can self-update.

- **G1:** `build.ts` adds `bun build --compile --target=bun-darwin-arm64` for Mac binary. Then Linux x64 + arm64.
- **G2:** `bakin` CLI entry adds subcommands: `start`, `stop`, `status`, `version`, `update`. Current `cli/bakin.ts` already has many of these; unify into the compiled binary.
- **G3:** GitHub Actions workflow: on `v*` tag, build all three platforms, attach binaries + `checksums.txt` to the release.
- **G4:** `bakin update` implementation: fetch latest from GitHub releases API, verify SHA256, atomic rename.
- **G5:** Install script at `bakin.dev/install.sh` (or equivalent) — curl-able one-liner that detects platform, downloads, places in `/usr/local/bin`.
- **G6:** Homebrew tap (`madeinwyo/tap`) with a `bakin.rb` formula. Mac users: `brew install madeinwyo/tap/bakin`.

**Rollback:** Cancel the GitHub release; remove homebrew formula. Next release ships from the last known-good tag.

**Commit checkpoints:** G1, G2 (CLI), G3 (CI workflow), G4 (update command), G5 (install script), G6 (homebrew formula).

### Phase H — SDK npm publish (~2 days)

Goal: `@bakin/sdk` exists on npm, matched to Bakin releases.

- **H1:** `packages/sdk/package.json` — add README, ensure `exports`, `types`, `files` fields are correct for npm publish. Remove `private: true`.
- **H2:** `scripts/publish-sdk.ts` — runs `npm publish` from `packages/sdk/`. Version matches the current git tag.
- **H3:** GitHub Actions release workflow (added in G3): after binary upload, if NPM_TOKEN secret is present, run `scripts/publish-sdk.ts` to push `@bakin/sdk@<version>` to npm.
- **H4:** `bakin plugins scaffold` command writes a plugin template with `@bakin/sdk` in `devDependencies` at the matching version.

**Rollback:** `npm unpublish @bakin/sdk@<version>` (within 72h per npm policy); subsequent releases auto-skip already-published versions.

**Commit checkpoints:** H1, H2, H3, H4.

### Phase I — Cleanup (~2 days)

Goal: Delete all Next.js remnants. Update docs. Zero backcompat cruft.

- **I1:** Delete: `src/app/`, `next.config.ts`, `next-env.d.ts`, anything left in `src/` that didn't move (should be empty or near-empty). Delete `src/` itself if empty.
- **I2:** Remove Next.js deps from `package.json`: `next`, `eslint-config-next`, `@types/next`, any Next-specific shadcn wrappers.
- **I3:** Update `tsconfig.json` — remove `@/*` alias, remove Next.js plugin, remove `jsx: preserve` in favor of `jsx: react-jsx`.
- **I4:** Update ESLint config to reflect new structure; drop Next.js rule presets.
- **I5:** Rewrite CLAUDE.md sections (see Doc update plan below).
- **I6:** Update `docs/plugin-authoring.md` for the new build-on-install story.
- **I7:** Update `.claude/knowledge/*.md` per the Doc update plan.
- **I8:** Final sanity grep: zero `from 'next/...'` imports, zero `@/*` path usage, zero references to `pnpm`, `webpack`, `turbopack`, `App Router`.
- **I9:** Long-tail test fixes uncovered during I1-I8.

**Rollback:** Not a clean rollback point. Phase I is the definitive "no going back without restoring from git history" moment. Prior phases' commits are the only recovery path.

**Commit checkpoints:** I1 (delete src/app), I2 (remove deps), I3 (tsconfig), I4 (eslint), I5-I7 (docs), I8 (final grep), I9 (test fixes).

**Total: ~25 working days. 5 calendar weeks.**

## Doc update plan

Deep-clean of all knowledge surfaces at Phase I. Categorized by scope.

### CLAUDE.md (248 lines today)

**Rewrite:** Architecture section (Next.js → Bun), Directory Map (new package layout), Plugin System section (runtime load flow), Testing Rules (`bun x vitest`), Key Patterns → MCP Tool Registration + other plugin-focused patterns (update for Bun build path).

**Delete:** Any Next.js-specific phrasing, webpack/Turbopack references, pnpm command examples.

**Add:** Brief Bun runtime section, binary distribution note, commands reference (points at the spec).

### docs/plugin-authoring.md

Major rewrite. Current guide assumes pre-built `dist/` shipping; new guide documents source-only shipping + Bakin-builds-on-install. Update:
- Directory layout (remove `dist/` from author's concern)
- Manifest fields (unchanged, but cross-reference new commands)
- Server entry example (unchanged)
- Client entry example (update to `registerPlugin({...})` instead of `export const navItems = [...]`)
- SDK import paths (unchanged)
- Install + dev commands (`bakin plugins install`, `bakin plugins dev`)
- Testing (`bun x vitest`)

### .claude/knowledge/*.md (18 files)

**High-impact rewrites:**
- `plugin-system.md` — rewrite for Bun runtime + binary + `registerPlugin` flow
- `repo-architecture.md` — rewrite for new package structure

**Medium-impact updates (section edits, not rewrite):**
- `storage-model.md` — add note about SQLite-for-operational-state as follow-up; user-content unchanged
- `search-system.md` — note: Antfly integration unchanged (HTTP); runtime is Bun; remove Next.js references
- `shared-ui-patterns.md` — SDK surface unchanged but imports update (`@bakin/sdk/*` stays canonical)
- `url-state-deep-linking.md` — `useQueryState` implementation unchanged, but note that the router underneath is TanStack
- `workflows-plugin.md`, `tasks-plugin.md`, `messaging-plugin.md`, `memory-plugin.md`, `assets-plugin.md`, `team-plugin.md`, `health-plugin.md` — each: remove any Next.js-API-route-specific mentions, confirm server-side contract still matches
- `agent-system.md` — unchanged; OpenClaw adapter boundary holds
- `design-system.md` — unchanged; shadcn/Tailwind stack unchanged
- `search-api-reference.md`, `search-plugin-guide.md`, `multimodal-search.md` — unchanged

**Unchanged (audit only):**
- `workflow-approvals.md`
- `antfly-*.md` files (in `done/`)

**Delete:** any `.md` files in `.claude/specs/done/` or `.claude/tasks/` referencing Next.js as current — mark historical, don't update.

### README.md

Currently minimal/absent per earlier session. If a README exists at repo root, update installation instructions from "clone + pnpm install + pnpm dev" to "brew install bakin OR download binary". Remove references to Node.js version pinning; add Bun version requirement for contributors.

## Acceptance criteria

1. `bakin` binary runs on Mac arm64 + Linux x64 + Linux arm64 with no runtime deps on the user's machine.
2. All 10 core pages render identically to pre-migration. Visual regression on the rendered DOM for every core page.
3. `bun x vitest run` — all 2984 tests pass (plus any new tests added in Phase A-I).
4. A test user plugin dropped into `~/.bakin/plugins/` with source-only (no `dist/`) contributes nav + page + slot after `bakin plugins install`, with no Bakin restart required.
5. `bakin plugins install github:foo/bar` clones, builds via `Bun.build()`, loads dynamically — plugin visible in browser within ~30s for a plugin with typical deps.
6. Binary size <120MB per platform.
7. `bakin update` self-replaces the running binary cleanly, verifies SHA256.
8. `@bakin/sdk` on npm, installable via `bun install @bakin/sdk`.
9. `bakin plugins dev <path>` watches a plugin's source and live-reloads the browser on save within <1s of file change.
10. React instance is shared between shell + plugins (reference-equality assertion passes in an automated test).
11. Zero Next.js imports in the final tree. Zero `@/*` alias usage. Zero `pnpm` references in `package.json` or scripts.
12. All performance targets in the Performance section met.
13. CLAUDE.md + docs/plugin-authoring.md + affected `.claude/knowledge/*.md` reflect the post-migration reality.

## Open questions

- **Dev-loop HMR quality with pure Bun.** Empirical. Revisit after ~1 week of Phase C daily use. Escape hatch at #146.
- **Embedded plugin resource size.** 10 core plugins bundled into the binary could balloon binary size if dep trees are unchecked. Monitor binary size per release. If we breach 120MB, investigate dep tree-shaking or on-demand load for rarely-used core plugins.
- **Chokidar event quality on Bun.** Works but some emission edge cases. Smoke tests during Phase A will surface issues; if brittle, swap for native `fs.watch` in a follow-up.
- **TanStack Router learning curve.** Team (one person) has used React Router for years. Budget ~half a day extra in Phase C for adjustment.

## Not doing

- **Two-tier plugin model** (core static, user dynamic). Rejected in #141 for consistency reasons. Core plugins bundled into binary at build time is a compile-time optimization, not a different runtime contract — they still follow `BakinPlugin` + `registerPlugin`.
- **Plugin sandboxing** (Web Worker, iframe, v8 isolate). Obsidian-style trust: manifest permissions declared + audit logged. Runtime enforcement at #142.
- **Rewriting Vitest tests.** They work on Bun. Revisit if speed matters.
- **Removing the markdown-on-disk architecture.** User-facing content stays markdown.
- **Writing a custom bundler.** `Bun.build()` is sufficient.
- **Shipping a standalone Bakin installer app.** Binary + install script + homebrew is enough.
- **Migrating `better-sqlite3` to `bun:sqlite`.** Later, in a dedicated follow-up.
- **Migrating operational state to SQLite (`audit.jsonl`, plugin-settings).** Opt-in later, per-module.
- **GPG-signing binaries.** SHA256 is the v1 integrity check. GPG signing is follow-up hardening.
- **Private npm registry for `@bakin/sdk`.** Public npm. If Bakin itself becomes private, revisit.
- **Plugin marketplace UI.** Out of scope. `bakin plugins install <github-url>` is the v1 install story.

## Success measure

Six months after merge:

- A hobbyist self-hoster downloads the binary, installs a plugin from a friend's GitHub link, and has working UI in under 2 minutes.
- You personally shipped at least 3 plugin changes without touching framework code.
- Zero GitHub issues about "Next.js said X" or "Turbopack broke Y".
- `bun build --compile` is still the production path (no Vite or other tool crept into prod).
- At least one external contributor has shipped a plugin without needing Bakin source access.
