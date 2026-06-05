# Bakin

Bakin is a self-hosted multi-agent orchestration platform. It gives a single user a real-time dashboard into what their AI agents are doing — tasks, projects, workflows, assets, schedules — all powered by markdown files on the filesystem, pushed to the browser via SSE.

Runs on a Mac mini, accessed via Tailscale. No SaaS dependencies.

## Architecture

- **Runtime:** Bun (>=1.2.0). No Node.js, no pnpm, no Next.js. Bun is the runtime, the bundler, and the package manager.
- **Server:** `server.ts` uses Node's `http.createServer` hosted under Bun (same shape as pre-migration; Bun runs the node-compat path). Port 3737. MCP server, SSE broadcaster, Chokidar file watcher, dispatch loop all unchanged from pre-#147.
- **API handlers:** Web Fetch-style `(req: Request, url: URL) => Promise<Response>` functions at `packages/host/src/api/**/*.ts`. Dispatched from `server.ts` via `dispatchWebHandler` (see `packages/host/src/api/_adapter.ts`). The plugin catch-all at `packages/host/src/api/plugins/[pluginId]/[[...path]].ts` matches against the live `pluginRegistry`.
- **Client shell:** `packages/host/src/` — React 19 + TanStack Router (code-based routes in `packages/host/src/routes/`). Built via `Bun.build()` to `packages/host/dist/main.js`. Externalizes `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`, `@makinbakin/sdk`, and every `@makinbakin/sdk/*` sub-path.
- **Import map + vendor bundles:** `packages/host/public/index.html` emits a `<script type="importmap">` mapping externalized specifiers to `/vendor/*.js` bundles produced by `scripts/build-vendors.ts`. One React instance, one SDK instance, shared by shell + every plugin.
- **Core plugins:** 10 plugins under `plugins/<id>/`, each built by `scripts/build-plugins.ts` into `plugins/<id>/dist/{index.js, client.js}` with externals matching the shell. Each plugin's `client.tsx` calls `registerPlugin({ id, navItems, slots })` from `@makinbakin/sdk` as a module side effect.
- **Runtime plugin loader:** `packages/host/src/plugin-host/PluginHost.tsx` wraps the shell. On mount it fetches `/api/plugins/manifest`, then dynamic-imports each plugin's `clientEntry` URL (`/api/plugins/<id>/assets/client.js`). Each plugin module runs `registerPlugin` during load, populating the browser-global nav + slot registry. `AppSidebar` reads nav from `getAllNavItems()`.
- **User plugins:** Installed into `~/.bakin/plugins/<id>/` via `bakin plugins install <path|github:user/repo>` — the installer copies source, runs `buildUserPlugin()` (in-binary Bun.build + optional `bun install` when the plugin declares deps), and the next server restart picks it up. User plugins structurally match core plugins; the loader doesn't know which bucket a plugin came from.
- **Plugin lifecycle:** `bakin plugins {list [--check], install [--yes], export, import, upgrade [--yes], remove}` — install/upgrade/remove with consent prompts (#142), reproducible plugin-set import/export (#168), per-plugin teardown sweep + tarball backup (#119), and an install ledger at `~/.bakin/plugins/lock.json` (mirrors agent-packages lockfile pattern). Core plugins refuse `upgrade` and `remove` via `isCorePlugin()`. Deep reference: `.claude/specs/plugin-lifecycle.md`.
- **Storage:** Markdown files, JSON sidecars, and JSONL logs in `~/.bakin/`. Tasks live in the Bakin task-store under `~/.bakin/tasks/`.
- **Real-time:** Server-Sent Events (SSE) push updates to all connected browsers.
- **Agents:** Managed through `AppServices.runtime` / `ctx.runtime`. OpenClaw is the current runtime implementation, isolated in `packages/adapter-openclaw/`.
- **Search:** `AppServices.search` / `ctx.search` for full-text + semantic search. Antfly is the current search implementation, isolated in `packages/adapter-antfly/`; plugin and feature code never import `@antfly/sdk`.
- **Adapter Boundary:** Runtime/search provider details stay behind adapter packages and the factories in `src/core/*-adapter-factory.ts`. Bakin owns UI data, task metadata, audit, assets, workflows, plugin settings/data, and heartbeats. Runtime providers own agent identity, soul, rules, tools, models, workspace data, channels, cron jobs, and memory. Deep reference: `.claude/knowledge/adapter-architecture.md`. Audit skill: `.claude/skills/check-adapter-boundary.md`.
- **Agent Packages:** A second primitive distinct from plugins. Plugins ship code (routes, UI, MCP tools); agent packages ship **content** — identity (SOUL/IDENTITY/AGENTS/TOOLS), runtime skills, workflows, and lesson files — that personifies an agent in the active runtime and gives it domain perspective. Manifested as `bakin-package.json` with `kind: "agent" | "skill-pack" | "workflow-pack" | "lesson-pack"`. Three states per agent: `unmanaged`, `adopted`, `managed`. Deep reference: `.claude/knowledge/agent-packages.md`.

## Build, Dev, CLI

- **Binary:** `bun run build` chains vendors → plugins → host shell → `bun build --compile` per platform. Runtime assets are imported via `with { type: 'file' }` in `packages/host/src/api/_embedded-assets-static.ts` (regenerated by `scripts/generate-embedded-assets.ts`) so they're embedded in the single-file binary. Release pipeline (`.github/workflows/release.yml`) fires on strict `v*` release tags, signs/notarizes macOS before checksums, publishes `@makinbakin/sdk` through npm trusted publishing, updates `markhayden/homebrew-tap` for stable releases, then publishes the GitHub release. Runbook: `.claude/knowledge/release-pipeline.md`.
- **Dev loop:** `bun run dev` runs `scripts/dev.ts` — chokidar-based watcher coordinator with HMR for plugins (no page reload), `location.reload()` for shell/SDK, CSS link swap, and a fullscreen overlay on build errors. Server-side code is **not** watched; manual restart. `bun run dev:mock` swaps in the Imitation Crab OpenClaw mock. Deep reference: `.claude/knowledge/dev-loop.md`.
- **CLI:** Two files cooperate. `src/core/cli.ts` is the binary-facing dispatcher (`start`/`stop`/`status`/`version`/`update`/`plugins {…}`/`dev`); unknown commands delegate to `cli/bakin.ts`, the HTTP-client CLI that owns `doctor`, `dispatch`, `tasks`, `agents`, `packages`, `schedule`, `search`, `trash`, `settings`, `logs`, `paths`, `reindex`, `restart`, `docs`, `onboard`, `init`, `mkdir`, `check`, `install`, plus runtime-discovered commands contributed by installed plugins. Use `bakin --help` for the full surface.

## Directory Map

The full annotated directory map lives in `.claude/knowledge/repo-architecture.md`. Quick orientation: `packages/{core,sdk,host,adapter-openclaw,adapter-antfly}` for shared code + SDK + client shell + provider adapters, `plugins/<id>/` for the 10 core plugins, `src/core/` for server-side modules with side effects, `src/lib/` for client+server-safe shared code, `agents/` for in-repo reference agent packages, `scripts/` for build infrastructure, `cli/` for the legacy HTTP-client CLI, `dev/imitation-crab/` for the OpenClaw mock.

### Runtime Data Directory (`~/.bakin/`)
Created by `bakin onboard` / `initBakinHome()`. Per-installation state, NOT in the repo.
```
~/.bakin/
  settings.json            — Runtime config (dispatch/watchdog/antfly/bridge settings)
  plugin-settings/         — Per-plugin configuration (id.json)
  plugins/<id>/            — Installed addon plugins (source + generated dist/)
  plugin-data/<id>/        — Installed plugin runtime data
  agents/                  — Per-agent UI data ({id}/avatar.jpg, avatar-full.png + .installedBy)
  packages/                — Agent-package install state (lock.json + per-kind dirs)
  assets/                  — Versioned assets: store/<YYYY-MM>/<assetId>/ (manifest.json + vN files + exports/); see .claude/knowledge/assets-versioning.md
  heartbeats/              — Agent status heartbeats (JSON)
  tasks/                   — Bakin-owned task metadata JSON, sharded by created month
  schedule/                — Cron job state
  workflows/               — Definitions, instances, skills
  team/                    — Contacts, personas
  MEMORY-LOG.md            — Agent memory log
  audit.jsonl              — Append-only audit trail
  logs/server.log          — Rotating server log (10 MB, single backup)
```

## Plugin System

Every plugin has `bakin-plugin.json` (manifest), `package.json` (peer deps on `react` + `@makinbakin/sdk`), `index.ts` (server entry exporting a `BakinPlugin` with `activate(ctx)`), `client.tsx` (calls `registerPlugin({ id, navItems, slots })` as a side effect — exports are not read), `components/`, `types.ts`, and optional `defaults/` for workflows / workflow-skills / runtime-skills.

Core plugins build to `plugins/<id>/dist/`. User plugins build to `~/.bakin/plugins/<id>/dist/` via the in-binary builder (`buildUserPlugin` in `packages/host/src/plugin-host/user-plugin-builder.ts`).

Routes registered as `/api/plugins/{pluginId}/{path}`. Exec tools naming: `bakin_exec_{pluginId}_{action}`.

Deep references: `.claude/knowledge/plugin-system.md`, `.claude/knowledge/workflows-plugin.md`, `docs/plugin-authoring.md`.

## Agent Packages

Plugins ship code; agent packages ship content. Every package has `bakin-package.json`, `workspace/` (template SOUL/IDENTITY/AGENTS/TOOLS files seeded once on install), `skills/<name>/`, optional `workflows/*.yaml` + `workflow-skills/*.md`, `lessons/*.md`, and `assets/*`.

Lockfile at `~/.bakin/packages/lock.json` is the canonical install ledger; every projected file gets a `.installedBy` sidecar; `.userEdited` sentinels lock projections from being overwritten.

CLI: `bakin agents {install,list,remove,update,lessons}` and `bakin packages {install,list,remove,update}`. REST: `/api/agent-packages/*` and `/api/packages/*` (top-level, distinct from runtime `/api/agents/*`). Doctor surfaces drift via `bakin check agent-assets` / `bakin install agent-assets`.

Deep references: `.claude/knowledge/agent-packages.md`, `docs/agent-packages-authoring.md`.

## Code Conventions

- **TypeScript strict mode** — no `any` leaking across module boundaries
- **Zod** for validation at system boundaries (API inputs, file parsing, settings)
- **Functional preference** — pure functions over classes where practical
- **Logging:** `const log = createLogger('module')` from `@bakin/core` (re-exported as `src/core/logger`)
- **No empty catch blocks** — always log or rethrow
- **`const` over `let`**, never `var`
- **Files:** `kebab-case.ts` / `kebab-case.tsx`
- **Types/interfaces:** `PascalCase` (e.g., `BakinPlugin`, `PluginContext`)
- **Constants:** `UPPER_SNAKE_CASE` for true constants

### Import Order
```typescript
// 1. Node builtins
import { join } from 'path'
// 2. External packages
import { Database } from 'bun:sqlite'
// 3. SDK (plugin author surface — canonical)
import { registerPlugin, type NavItem } from '@makinbakin/sdk'
import { PluginHeader } from '@makinbakin/sdk/components'
// 4. Internal @/* (inside packages/host and src/ only)
import { createLogger } from '@/core/logger'
// 5. Relative
import { helper } from './utils'
```

Path aliases: `@/*` maps to `./src/*` for server-side code, and core plugins use `@bakin/{plugin}/*` only inside Bakin app code/tests. External plugin authors never use `@/*` or `@bakin/{plugin}/*` — the canonical entry point is `@makinbakin/sdk/*`.

### Commit Conventions
Conventional commits with scope:
- `feat(tasks): add drag-and-drop reordering`
- `fix(schedule): handle timezone edge case`
- `refactor(core): extract settings module`
- `test(workflows): add gate approval test`

## Testing Rules — CRITICAL

**Every test file MUST mock the content-dir resolver AND the OpenClaw home resolver to use temp directories.** Tests that touch storage, assets, tasks, agent packages, or any plugin MUST NOT read from or write to `~/.bakin/` or `~/.openclaw/`. Leaked test data into either production directory has caused real incidents.

Because `src/core/content-dir.ts` is an app-facing facade over `packages/core/src/content-dir.ts`, **mock both**. Any consumer may import from either path (or the `@/core/content-dir` alias), and missing one leaves a leak surface. Same applies to OpenClaw home.

Required mocks for any test that touches the filesystem:
```typescript
const testDir = join(tmpdir(), `bakin-test-${Date.now()}`)

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => { /* return paths under testDir */ },
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => { /* return paths under testDir */ },
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
```

When the test imports modules that read `process.env.OPENCLAW_HOME` at module-load time (the openclaw-adapter is the most common one), set the env var BEFORE any imports — `mock.module` calls run after ES-module imports hoist, which is too late for module-top reads:

```typescript
const testDir = pathJoin(tmpdir(), `bakin-test-foo-${Date.now()}-${randomUUID()}`)
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir

// imports follow — modules read the env vars on first call
import { ... } from '...'
```

Run the full suite with `bun run test` (CI) or `bun run test:watch` (dev) — both pass `--path-ignore-patterns "**/dev/**"` so the dockerized-rig's disposable home (`dev/bakin-instances/`, gitignored) doesn't leak stray test files into the run. Individual file: `bun test tests/path/to/foo.test.ts --isolate`. `--isolate` gives each test file a fresh global so `mock.module` overlays don't leak across files.

Additional mandatory rules:
- **Always clean up:** `afterAll(() => rmSync(testDir, { recursive: true, force: true }))`
- **Mock the logger:** `mock.module('../../src/core/logger', ...)` — prevents noise and avoids side effects
- **Mock the watcher:** `mock.module('../../src/core/watcher', ...)` — prevents chokidar from watching real dirs
- **Mock AppServices/runtime adapters:** Prevents tests from sending real messages to agents
- **Never hardcode `~/.bakin/`** or `process.env.HOME` in test fixtures
- **Use `tests/plugins/test-helpers.ts`** (`activatePlugin`, `callRoute`, `callTool`) for plugin tests — these provide properly isolated mock contexts

If a test does not mock the content-dir resolvers, it **will** eventually write to `~/.bakin/` and corrupt production data. Pure scanner tests under `tests/architecture/` are the only exception because they do not import app modules; the mock checker hook handles that case explicitly.

## Key Patterns

- **SSE Broadcasting** — `broadcast()` from `src/core/sse.ts`. Uses `globalThis.__bakinBroadcast` to survive Bun's HMR / module re-evaluation. Two channels: activity (progress) and audit (structured events).
- **Agent Activity** — Agents report progress via `bakin_log_progress` MCP tool → `logProgress()` in task-service → SSE broadcast. Structured audit via `appendAudit()` → `audit.jsonl` + SSE + Antfly.
- **Dispatch** — Concurrent fire-and-settle dispatch (in-flight turn registry, `settings.dispatch.maxConcurrentTurns`/`maxTurnsPerAgent` caps) with per-attempt provider sessions (`threadId: task:<id>:d<seq>`). Failures are typed `RuntimeError`s classified by `kind` — **never by error-message text** (architecture-test enforced). Deep reference: `.claude/knowledge/dispatch.md`.
- **Session Forensics & Recovery Ladder** — The adapter watches OpenClaw trajectory files (read-only) to fail-fast on session deaths and post-mortem timeouts into `RuntimeTurnError` diagnoses; lost-frame successes are recovered. Diagnosed deaths take a ladder (salvage output as asset → corrective re-dispatch → decomposition into subtasks → diagnostic block), never blind retries. Every dispatch prompt carries OUTPUT DISCIPLINE rules (deliverables → files + `bakin_exec_assets_save`, one at a time; chat stays short). Deep reference: `.claude/knowledge/session-forensics.md`.
- **Usage Recording** — Single in-memory recorder at `src/core/usage.ts`. `recordUsage({ kind: 'mcp'|'rest'|'agent', ... })`; reads via `getUsageFeed`/`getStatsByMs`/`getErrorCount`. **Never add a parallel stat-tracking system** — fragmentation previously broke the health dashboard. Deep reference: `.claude/knowledge/usage-recording.md`.
- **Models Cache + Catalog** — Persistent disk cache at `~/.bakin/plugin-settings/models/available.json` plus a curated catalog (`plugins/models/data/known-models.ts`) merged in server-side. **Never fabricate model metadata.** Deep reference: `.claude/knowledge/models-plugin.md`.
- **Adapter Boundary** — Provider code is factory-only from Bakin's perspective. Use `getAppServices().runtime/search/tasks` in core, `ctx.runtime/search/tasks` in plugins/tools, and `src/core/runtime-config-raw.ts` for the small allowlisted raw-config gate. Deep reference: `.claude/knowledge/adapter-architecture.md`.
- **OpenClaw Home Directory** — Adapter-private `getOpenClawHome()` / `getOpenClawPath()` in `packages/adapter-openclaw/src/home.ts`. Resolution: `OPENCLAW_HOME` env → `~/.openclaw/`. For dev without OpenClaw: `bun run dev:mock` (Imitation Crab in `dev/imitation-crab/`); reseed with `bun run mock:seed --force`. For dev against a **real** OpenClaw in Docker (without touching `~/.openclaw`): `bun run instance up` / `instance dev` — the dockerized rig (`scripts/instance.ts` + `scripts/instance/*`). Deep reference: `.claude/knowledge/dockerized-openclaw-rig.md`.
- **Content Directory** — `getContentDir()` in `packages/core/src/content-dir.ts`. Resolution: `BAKIN_HOME` env → `~/.bakin/`. Well-known paths via `getBakinPaths()`.
- **Versioned Assets** — An asset is a stable `assetId` naming a directory of versioned files + one `manifest.json` (no per-file sidecars). Linear versions, free `currentVersion` pointer, exports are derived (not versions). Manifest writes are atomic + serialized per-asset; addressed by id (`/api/assets/<assetId>[/v/<n>|/thumb|/export/<name>]`); one search row per asset; mutations emit `asset.changed`. Image tools (`generate`→v1, `edit(assetId)`→new version) are idempotent to prevent client-timeout double-bills. `bakin_exec_assets_save` upserts by source path. Deep reference: `.claude/knowledge/assets-versioning.md`.
- **Plugin Communication** — Cross-plugin and core ↔ plugin calls go exclusively through the HookRegistry (`packages/core/src/hooks/hook-registry.ts`). Plugins register hooks in `activate()` via `ctx.hooks.register(name, handler)`; callers use `getHookRegistry().invoke<R>(name, data)`. Hook naming: `{pluginId}.{operation}`. No direct imports between plugins.
- **MCP Tool Registration** — Fully dynamic. Plugins register exec tools via `ctx.registerExecTool()` during activation. Scripts self-register via `addExecTool()` on import. `mcp-server.ts` calls `getAllExecTools()` at startup.
- **Plugin Settings** — Each plugin declares a `settingsSchema`; the settings page renders schemas via `PluginSettingsRenderer`. Values persisted at `~/.bakin/plugin-settings/{pluginId}.json`, accessible via `ctx.getSettings<T>()`. The same renderer drives a built-in **System & Alerts** tab that edits `~/.bakin/settings.json` via `/api/settings`. Watchdog re-reads settings every cycle — no restart needed.
- **Server Logging** — `createLogger()` writes JSON lines to stdout AND `~/.bakin/logs/server.log` (10 MB rotation, single backup). Survives `nohup`/`launchd` detached stdio. Disable with `BAKIN_DISABLE_FILE_LOG=1`. Tests skip the file transport via `NODE_ENV=test` / `VITEST`. Every 5xx catch handler logs the stack via `log.error('...', err, { ...context })`.
- **URL State & Deep Linking** — All user-facing filter/view state must be backed by URL query params. Use `useQueryState(key, default)` and `useQueryArrayState(key)` from `@makinbakin/sdk/hooks`. Params omitted at default. Pages must wrap content in `<Suspense>`. Deep reference: `.claude/knowledge/url-state-deep-linking.md`.
- **Search Indexing** — File-backed plugins use `ctx.search.registerFileBackedContentType()` (auto-wires watcher sync/unlink + startup mtime reconcile + `GET /search` route). Non-file-backed plugins use `ctx.search.registerContentType()` and call `index()`/`remove()` themselves. Cross-plugin endpoint: `GET /api/search`. Memory plugin owns the unified `bakin_memory` table (replaces old `bakin_audit`). All tables use `bakin_` prefix; one content type per plugin. Antfly is optional — calls are no-ops when disabled. Deep references: `.claude/knowledge/search-system.md`, `.claude/knowledge/search-plugin-guide.md`.
- **Memory Observability** — Read-only dashboard over runtime memory tiers + Bakin's audit log, surfaced through the unified `bakin_memory` table with a `tier` facet. Incremental indexing via persisted byte offsets in `~/.bakin/plugin-settings/memory/offsets.json`; stable SHA256 row IDs make upserts idempotent. Schema migrations via `MEMORY_SCHEMA_VERSION` in `lib/memory-migration.ts`. **Memory cleanup** (`lib/routes/cleanup.ts` + `lib/cleanup.ts`): find a stale term across tiers → dispatch a cleanup task to each affected agent (the agent edits its own source; Bakin never writes runtime-memory content) → verify. Deep reference: `.claude/knowledge/memory-plugin.md`.
- **Onboarding** — `src/core/onboarding/` — 8 component modules with shared `check()` + `install()` contract. CLI: `bakin onboard --yes` for non-interactive setup; `bakin mkdir`, `bakin install {search,search-models,mcporter,plugin-assets,agent-assets}`, `bakin check {runtime,search,search-models,llm,channels,plugin-assets,agent-assets,all}`, `bakin settings init`. Doctor gates on `~/.bakin/.onboarded` marker.
- **Debug Mode** — Global client-side toggle. State in Zustand + localStorage (`bakin-debug`). Access via `useDebug()` from `@makinbakin/sdk/hooks`. Toggle button in header (Bug icon). URL `?debug=true` activates as a one-shot seed.
- **Shared UI Components** — All shared UI lives under `@makinbakin/sdk/components` — plugins always import from there, never from `packages/host/src/components/` directly. `PluginHeader` (title + count + search + actions) and `FacetFilter` (popover multi-select, back with `useQueryArrayState`) are the most reused.
- **Doctor & Health Checks** — Every doctor check is plugin-registered via `ctx.registerHealthCheck`. `src/core/doctor.ts` is the orchestrator (cron + cache + audit + notify). Plugin-owned checks live at `plugins/{owner}/lib/health-checks.ts`; system-level checks live in the health plugin under `plugins/health/lib/system-checks/`. The single canonical result type is `HealthCheckResult` from `@makinbakin/sdk`. Deep reference: `.claude/knowledge/doctor-and-health-checks.md`.
- **Plugin Hot Reload (linked plugins)** — `bakin plugins link <localPath>` symlinks a developer source tree as a plugin. With `BAKIN_DEV_HOTRELOAD=1`, file saves trigger build + in-process module swap (no restart). Pipeline: chokidar watcher → debounce → per-plugin pipeline mutex → `buildUserPlugin` → sweep registries (hooks/exec-tools/health-checks/etc.) + clear state arrays → cache-bust `import('${dir}/dist/index.js?v=N')` → re-run `activate(ctx)` against the same ctx → bump version + broadcast `dev:plugin:reload`. Browser receives the SSE event, re-fetches `client.js?v=N`, re-runs `registerPlugin`. Safety net: every `/api/plugins/<id>/*` response carries `X-Bakin-Plugin-Version`; client wraps `fetch` and forces reload on drift if an SSE event was missed. Build errors broadcast `dev:plugin:error` (overlay) + `dev:plugin:recover` on next success. `onShutdown` errors never propagate — a buggy shutdown can't brick the dev loop. Cache-bust uses an always-increment counter (NOT the success-only version) so failed reloads can retry against fresh module URLs. Deep reference: `.claude/knowledge/plugin-system.md` § Hot Reload.

## Reference

- **Contributing:** `CONTRIBUTING.md` — Bun setup, build pipeline, dev loop
- **Plugin authoring:** `docs/plugin-authoring.md`
- **Agent-package authoring:** `docs/agent-packages-authoring.md`
- **Specs:** `.claude/specs/` — detailed specs for each hardening phase
- **Knowledge:** `.claude/knowledge/` — deep dives on every system above
- **Skills:** `.claude/skills/` — reusable Claude Code operations (create-plugin, audit-plugin, add-component)
