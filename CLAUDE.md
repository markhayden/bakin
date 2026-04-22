# Bakin

Bakin is a self-hosted multi-agent orchestration platform. It gives a single user a real-time dashboard into what their AI agents are doing — tasks, projects, workflows, assets, schedules — all powered by markdown files on the filesystem, pushed to the browser via SSE.

Runs on a Mac mini, accessed via Tailscale. No database, no SaaS dependencies.

## Architecture

- **Runtime + server:** Bun (>=1.2.0) — custom HTTP server wrapping Next.js 16 (App Router) during the Phase A+B migration to `Bun.serve()`. Port 3737. Migration tracked at #147.
- **Frontend:** React 19, Tailwind CSS 4, shadcn v4 (Base UI), Zustand for state
- **Storage:** Markdown files in `~/.bakin/`, no database
- **Real-time:** Server-Sent Events (SSE) push updates to all connected browsers
- **Agents:** Managed via OpenClaw gateway, communicate through MCP tools
- **Plugins:** 10 core plugins, extensible architecture for addons
- **Search:** `@antfly/sdk` for full-text + semantic search, `ctx.search` plugin API, `bakin_` table prefix
- **OpenClaw Adapter Principle:** Bakin reads from OpenClaw. Bakin writes to OpenClaw. Bakin never copies OpenClaw. Agent identity, soul, rules, tools, models, and workspace data all live in the OpenClaw home directory (`OPENCLAW_HOME` env var, defaults to `~/.openclaw/`). Bakin owns only UI-specific data (display settings, avatars, heartbeats). Question any pattern that duplicates OpenClaw state into Bakin code or storage. All OpenClaw paths MUST use `getOpenClawPath()` from `packages/core/src/openclaw-home.ts` — never hardcode `~/.openclaw/`.

## Directory Map

### Repo Structure
```
server.ts                  — HTTP server entry point (bootstraps Next.js + plugins)
bakin.config.ts            — Plugin configuration (which plugins are enabled)
src/
  core/                    — Server-side core modules
    mcp-server.ts          — MCP tool server (agent tool access)
    dispatch.ts            — Task dispatch engine (sends work to agents)
    task-service.ts        — Task mutations with side effects
    settings.ts            — BakinSettings interface, defaults, file loading
    content-dir.ts         — Content directory resolution (~/.bakin/)
    main-agent.ts          — Runtime orchestrator agent resolution
    sse.ts                 — SSE client management and broadcast
    audit.ts               — Audit logging (JSONL + SSE + Antfly)
    agents.ts              — Agent status and communication
    logger.ts              — Structured logger (createLogger)
    openclaw-client.ts     — OpenClaw HTTP gateway client
    watcher.ts             — Chokidar file watcher integration
    search-registry.ts     — Search content type registry, ctx.search provider
    search-cleanup.ts      — Periodic orphan backstop scan (default 7d)
    search-reconcile.ts    — Startup mtime-aware reconcile + glob matcher
  lib/                     — Shared types and utilities (client + server safe)
    core-constants.ts      — APP_NAME, APP_SLUG, branding constants
    plugin-types.ts        — BakinPlugin, PluginContext, StorageAdapter, EventBus interfaces
    plugin-registry.ts     — Plugin loading singleton
    plugin-manifest.ts     — Client-side plugin imports and navItems aggregation
    constants.ts           — Column config, nav items
    storage/               — MarkdownStorageAdapter
    events/                — BakinEventBus (pub/sub with pattern matching)
    parsers/               — Markdown parsing utilities
  components/
    ui/                    — shadcn base components (button, card, dialog, input, etc.)
    layout/                — App shell (sidebar, header, layout-shell)
    tasks/                 — Task-specific components (activity feed)
    projects/              — Project components
    assets/                — Asset browser components
  app/                     — Next.js App Router pages
    page.tsx               — Dashboard home
    tasks/page.tsx         — Task kanban board
    team/page.tsx          — Agent team grid
    team/[id]/page.tsx     — Agent detail page (tabs: profile, soul, rules, tools, skills, memory, activity, stats)
    projects/page.tsx      — Project list
    workflows/page.tsx     — Workflow template grid
    workflows/[id]/page.tsx — Workflow canvas detail view
    assets/page.tsx        — Asset browser
    schedule/page.tsx      — Cron job manager
    messaging/page.tsx     — Messaging (redirects to /messaging/calendar)
    messaging/calendar/page.tsx — Content calendar view
    messaging/brainstorm/page.tsx — Brainstorm planning sessions
    memory/page.tsx        — Memory observability dashboard (7 tiers via unified bakin_memory table)
    health/page.tsx        — System health dashboard
    models/page.tsx        — Model configuration
    api/plugins/[pluginId]/[[...path]]/route.ts  — Catch-all plugin API router
plugins/                   — Core plugins (each has bakin-plugin.json manifest)
  tasks/                   — Task board management
  workflows/               — Workflow execution engine (xyflow canvas)
  assets/                  — Asset management with sidecar metadata, manual upload, clipboard paste
  projects/                — Project tracking with checklists
  schedule/                — Cron job scheduling with OpenClaw bridge
  memory/                  — Read-only observability over all 7 memory tiers (sessions, turns, checkpoints, daily notes, dreams, durable bootstrap, audit) via unified bakin_memory table
  messaging/               — Content calendar + brainstorm planning sessions
  models/                  — AI model configuration
  team/                    — Agent team management (OpenClaw adapter layer)
  health/                  — System health dashboard
scripts/lib/               — MCP exec tools (self-registering via registry.ts)
cli/                       — CLI tool (wraps HTTP API)
dev/imitation-crab/         — Imitation Crab: OpenClaw mock for dev without real OpenClaw
  index.ts                 — Orchestrator (safety check → seed → gateway → optional Bakin)
  safety.ts                — Blocks if real OpenClaw detected
  seed.ts                  — Creates ~/.imitationcrab/ with fixture data
  gateway.ts               — Mock HTTP gateway on :18789
  cli-shim.ts              — Mock CLI (openclaw cron/message/gateway commands)
  fixtures/                — Agent config, workspace files, cron jobs, SQLite seed
```

### Runtime Data Directory (`~/.bakin/`)
Created by `bakin init`. Per-installation state, NOT in the repo.
```
~/.bakin/
  settings.json            — Runtime config (dispatch/watchdog/antfly/bridge settings — NOT the agent roster)
  plugin-settings/         — Per-plugin configuration
  plugins/                 — Addon plugins (installed via bakin install)
  agents/                  — Per-agent data ({id}/avatar.jpg, avatar-full.png)
  assets/                  — Content files organized by type
  projects/                — Project markdown files
  heartbeats/              — Agent status heartbeats (JSON)
  schedule/                — Cron job state
  workflows/               — Definitions, instances, skills
  team/                    — Contacts, personas
  MEMORY-LOG.md            — Agent memory log
  audit.jsonl              — Append-only audit trail
```

## Plugin System

Every plugin has:
- `bakin-plugin.json` — manifest with id, name, version, dependencies, permissions
- `index.ts` — server entry: exports `BakinPlugin` with `activate(ctx: PluginContext)`
- `client.tsx` — client entry: exports `navItems` for sidebar
- `components/` — plugin-specific UI components
- `types.ts` — plugin-specific type definitions
- `defaults/` (optional) — `workflows/*.yaml` (auto-registered via `ctx.registerWorkflow`), `workflow-skills/*.md` (auto-registered via `ctx.registerSkill` — S-A in-memory), `openclaw-skills/{name}/` (installed to `~/.openclaw/skills/` by `bakin install plugin-assets` — S-B on disk)

Plugin context provides: `storage`, `events`, `registerNav()`, `registerRoute()`, `registerSlot()`, `registerExecTool()`, `registerSkill()`, `registerWorkflow()`, `registerNodeType()`, `registerNotificationChannel()`, `watchFiles()`, `getSettings()`, `updateSettings()`, `activity` (log + audit), `hooks` (register + has + invoke), `search` (registerContentType, registerFileBackedContentType, index, remove, transform, query)

Routes registered as: `/api/plugins/{pluginId}/{path}` via the catch-all route.

Exec tools naming: `bakin_exec_{pluginId}_{action}`

See `.claude/knowledge/workflows-plugin.md` for the workflows plugin's source registry, node-type registry, notification-channel registry, CRUD routes, and the S-A vs S-B skill distinction.

## Code Conventions

- **TypeScript strict mode** — no `any` leaking across module boundaries
- **Zod** for validation at system boundaries (API inputs, file parsing, settings)
- **Functional preference** — pure functions over classes where practical
- **Logging:** `const log = createLogger('module')` from `src/core/logger.ts`
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
import next from 'next'
// 3. Internal @/* paths
import { createLogger } from '@/core/logger'
// 4. Plugin @bakin/* paths
import { readProject } from '@bakin/projects/lib/parser'
// 5. Relative
import { helper } from './utils'
```

Path aliases: `@/*` maps to `./src/*`, `@bakin/{plugin}/*` maps to `./plugins/{plugin}/*`

### Commit Conventions
Conventional commits with scope:
- `feat(tasks): add drag-and-drop reordering`
- `fix(schedule): handle timezone edge case`
- `refactor(core): extract settings module`
- `test(workflows): add gate approval test`

## Testing Rules — CRITICAL

**Every test file MUST mock `src/core/content-dir` to use a temp directory.** Tests that touch storage, assets, tasks, or any plugin MUST NOT read from or write to `~/.bakin/`. Leaked test data into the production instance has caused real incidents.

Required mocks for any test that touches the filesystem:
```typescript
const testDir = join(tmpdir(), `bakin-test-${Date.now()}`)

vi.mock('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => { /* return paths under testDir */ },
}))
```

Additional mandatory rules:
- **Always clean up:** `afterAll(() => rmSync(testDir, { recursive: true, force: true }))`
- **Mock the logger:** `vi.mock('../../src/core/logger', ...)` — prevents noise and avoids side effects
- **Mock the watcher:** `vi.mock('../../src/core/watcher', ...)` — prevents chokidar from watching real dirs
- **Mock openclaw-client:** Prevents tests from sending real messages to agents
- **Never hardcode `~/.bakin/`** or `process.env.HOME` in test fixtures
- **Use `tests/plugins/test-helpers.ts`** (`activatePlugin`, `callRoute`, `callTool`) for plugin tests — these provide properly isolated mock contexts

If a test does not mock `getContentDir`, it **will** eventually write to `~/.bakin/` and corrupt production data. There are no exceptions to this rule.

## Key Patterns

### SSE Broadcasting
Real-time updates via `broadcast()` from `src/core/sse.ts`. Uses `globalThis.__bakinBroadcast` to survive Next.js webpack re-evaluation. Two channels: activity (progress) and audit (structured events).

### Agent Activity
Agents report progress via `bakin_log_progress` MCP tool → `logProgress()` in task-service → SSE broadcast. Structured audit via `appendAudit()` → `audit.jsonl` + SSE + Antfly.

### Dispatch Failure Handling
Two layers of defense against transient network blips (issue #115). (1) `openclaw-client.sendMessage` wraps `fetch` in a 3-attempt retry loop with 1 s / 2 s backoff, retrying only on transient errors (`TypeError('fetch failed')`, `ECONNRESET`-class socket errors via `err.cause.code`, `AbortError`). HTTP responses (including 4xx/5xx) never retry. (2) When a failure reaches `dispatch.ts`, `classifyDispatchError()` splits it into `transient` (fetch/network) vs `structural` (any `OpenClaw sendMessage failed (<status>)` error) and the cooldown is chosen accordingly: `settings.dispatch.transientCooldownMs` (default 60 s) for transient, `settings.dispatch.failureCooldownMs` (default 30 min) for structural. Both kinds share the `count` field; `settings.dispatch.maxRetries` (default 5) escalates to blocked regardless of classification. `FailureRecord` on disk is `{ lastAttempt, count, kind }` at `~/.bakin/.dispatch-state.json#failedDispatches`; legacy plain-number entries are migrated to `{ kind: 'structural' }` by `getFailureRecord()` on read.

### Usage Recording
All MCP tool calls, REST requests, and agent lifecycle events flow through one in-memory recorder in `src/core/usage.ts`. Emit via `recordUsage({ kind, name, agent, durationMs, status, meta })` where `kind` is `'mcp' | 'rest' | 'agent'`. Reads go through `getUsageFeed({ kind?, window, agent? })` for top-N/by-agent/recent aggregation, `getStatsByMs({ kind?, windowMs, agent? })` for simple total/error counts (watchdog), and `getErrorCount(windowMs)` for the `/summary` errors tile. The ring buffer holds 10k entries, FIFO-evicted. Windows are `'5m' | '1h' | '24h'`. MCP tool calls record automatically in `src/core/mcp-server.ts:registerTools`; REST traffic records automatically via the `trackResponse` middleware in `src/core/rest-tracking.ts`; agent kind entries are emitted from dispatch/heartbeat/lifecycle. **Never add a parallel stat-tracking system** — the previous fragmentation (request-log.ts + toolStats in registry.ts) caused the health dashboard to show zeroes while real traffic was flowing. The health plugin's `/usage-feed` route and the tabbed Usage section on the health page are the only consumers you should add to.

### Models Cache + Catalog
Two layers fix the cold-start problem where `openclaw models list --all --json` takes 15–20 s and would otherwise show fake data in the UI (issue #129). (1) **Persistent disk cache** at `~/.bakin/plugin-settings/models/available.json` via `plugins/models/lib/models-cache.ts` (atomic tmp+rename write, zod-validated reads, silent drop on corruption/schema drift). Flow in `fetchAvailableModels`: in-memory hit → disk hydrate → live fetch → honest empty-with-error (never `fallbackModels()`). The response includes `stale: boolean` so the client can surface cached data immediately and kick off a background `POST /api/plugins/models/refresh` when stale. `POST /api/plugins/models/gateway/restart` clears both cache layers. (2) **Curated catalog** at `plugins/models/data/known-models.ts` — Bakin-maintained lookup of ~22 popular models (frontier + OSS, LLM + image + video) with descriptions, tier, cost range, and brand-icon slugs. Merged into each OpenClaw-sourced `AvailableModel` at server-time via `getKnownModel()` / `getKnownProvider()`. Unknown models render plain — no fabrication. Brand icons render via `<BrandIcon>` which inlines SVG paths from simple-icons.org (CC0) for the 5 brands we have logos for (Anthropic, Google, Ollama, ByteDance, Kuaishou); unknown slugs render a first-letter chip with the provider's brand color. Add a catalog entry by PR'ing `known-models.ts`; add a brand logo by inlining the SVG path in `brand-icon.tsx`.

### OpenClaw Home Directory
All OpenClaw paths resolved through `getOpenClawHome()` / `getOpenClawPath()` in `packages/core/src/openclaw-home.ts`. Resolution: `OPENCLAW_HOME` env → `~/.openclaw/` fallback. For development without OpenClaw: `bun run dev:mock` starts the Imitation Crab mock (`dev/imitation-crab/`), which seeds `~/.imitationcrab/` and sets both `OPENCLAW_HOME` and `BAKIN_HOME` automatically. To reseed fixtures manually, run `bun run mock:seed --force`.

### Content Directory
All paths resolved through `getContentDir()` in `src/core/content-dir.ts`. Resolution: `BAKIN_HOME` env → `~/.bakin/` → `./content/` fallback. Well-known paths via `getBakinPaths()`.

### Plugin Communication
Plugins communicate exclusively through the HookRegistry (`packages/core/src/hooks/hook-registry.ts`). Plugins register hooks in `activate()` via `ctx.hooks.register(name, handler)`. Core modules and other plugins invoke hooks via `getHookRegistry().invoke<R>(name, data)`. Hook naming: `{pluginId}.{operation}` (e.g., `tasks.readTaskboard`, `workflows.getCurrentStep`). No direct imports between plugins or from core → plugins — all cross-boundary calls go through hooks.

### MCP Tool Registration
All MCP tools are dynamically registered — no hardcoded tools exist in `mcp-server.ts`. Plugins register exec tools via `ctx.registerExecTool()` during activation (76 tools across 8 plugins). Scripts self-register via `addExecTool()` on import (5 tools: log, gen_image, post_discord, get_paths, heartbeat). Total: 81 exec tools. `mcp-server.ts` calls `getAllExecTools()` to build the tool list at startup.

### Plugin Settings
Each plugin declares a `settingsSchema` with typed fields (string, number, boolean, select). The settings page at `/settings` dynamically fetches and renders schemas via `PluginSettingsRenderer`. Values persisted at `~/.bakin/plugin-settings/{pluginId}.json`, accessible in plugins via `ctx.getSettings<T>()`. The same renderer also drives a built-in **System & Alerts** tab (`src/components/system-settings.ts`) that edits the core `~/.bakin/settings.json` (watchdog, notifications, MCP alert thresholds) via `/api/settings`. Watchdog re-reads settings every cycle, so channel/threshold changes apply without a restart.

### Server Logging
`createLogger()` writes JSON lines to both stdout and `~/.bakin/logs/server.log` (10 MB rotation, single backup). The file transport survives any launcher that detaches stdio (`nohup`, `launchd`), so background server starts still leave a debuggable trail. Disable with `BAKIN_DISABLE_FILE_LOG=1`. Tests skip the file transport via `NODE_ENV=test` / `VITEST`. Every 5xx catch handler in `server.ts` and the plugin catch-all route logs the stack via `log.error('...', err, { ...context })` so failures land in `server.log`, not just stdout.

### URL State & Deep Linking
All user-facing filter/view state **must** be backed by URL query parameters so pages are bookmarkable and support browser back/forward. Use `useQueryState(key, default)` for single values and `useQueryArrayState(key)` for arrays (comma-separated). Params are omitted when at their default value. Pages using these hooks must wrap their content component in `<Suspense>`. See `.claude/knowledge/url-state-deep-linking.md` for conventions and implementation status.

### Search Indexing
File-backed plugins (projects, workflows, assets, messaging brainstorm) register via `ctx.search.registerFileBackedContentType()` during `activate()` — the helper auto-wires the watcher sync/unlink hooks AND schedules a startup mtime reconcile, so filesystem deletes propagate to the search index within ~300ms without each plugin owning the wiring. Non-filesystem-backed plugins (tasks, schedule, team, memory) use the bare `ctx.search.registerContentType()` and call `ctx.search.index()` / `remove()` themselves. **Both registration helpers also auto-register a `GET /search` route on the plugin's router** (`/api/plugins/{pluginId}/search`) — plugins no longer write that route by hand (issue #67 cleanup). The cross-plugin `GET /api/search` endpoint is backed by `src/core/api-search-handler.ts`. The memory plugin owns the unified `bakin_memory` table — a single table with a `tier` facet that discriminates across sessions, turns, checkpoints, daily notes, dreams, durable bootstrap files, and Bakin's audit log — replacing the former `bakin_audit` table. The messaging plugin owns brainstorm session search. REST/MCP routes still call the search mutators inline for synchronous consistency — the watcher path is the safety net for writes that bypass REST. The orphan backstop scan runs every 7d via `src/core/search-cleanup.ts` to catch the rare events the watcher missed. All Antfly tables use the `bakin_` prefix; `getTableForPlugin(pluginId)` resolves a plugin id to its table and throws if a plugin registers more than one content type. The client-side hook is `useSearch` from `src/hooks/use-search.ts` — it takes a `plugin: <id>` option that targets the plugin's auto-wired `/search` route, falling back to the cross-plugin endpoint when omitted. The MCP search exec tools (`bakin_exec_search_query`, `_table`, `_lookup`, `_facets`, `_similar`, `_reindex`, `_stats`) all take a `plugin` parameter — never a raw table name. Config in `settings.antfly.*`. Antfly is optional — all calls are no-ops when disabled. See `.claude/knowledge/search-system.md` for the "Three consistency paths" architecture and `.claude/knowledge/search-plugin-guide.md` for the helper API walkthrough.

### Memory Observability
The memory plugin is a read-only dashboard over all 7 OpenClaw memory tiers plus Bakin's own audit log, surfaced through the unified `bakin_memory` Antfly table. One row per artifact, discriminated by a `tier` facet (`audit | session | turn | checkpoint | daily_note | durable | dream`) so cross-tier queries, per-agent pivots, and global search all work against a single table. The durable tier carries a secondary `kind` facet (`soul | rules | tools | identity | heartbeat | memory | memory-log | dreams | user | bootstrap | skill`) so the UI can filter by source-file flavor; agent `{workspace}/skills/*/SKILL.md` files index as `tier=durable, kind=skill` rather than a new tier. The plugin watches both `~/.bakin/audit.jsonl` and OpenClaw paths under `~/.openclaw/` (sessions, workspace, daily notes, dream artifacts, skills) and incrementally indexes deltas using persisted byte offsets in `~/.bakin/plugin-settings/memory/offsets.json`. Stable SHA256 row IDs (`turn:<16-hex>`, `checkpoint:<16-hex>`, `skill:<16-hex>`, etc.) make upserts idempotent. The turn and audit tiers have write-time + daily-sweep retention (defaults 7 d / 30 d via `plugins/memory/lib/ttl-prune.ts`), and the plugin owns a per-plugin schema-version marker at `plugin-settings/memory/schema-version.json` — bumping `MEMORY_SCHEMA_VERSION` in `lib/memory-migration.ts` drops `bakin_memory` + clears `offsets.json` on next boot so backfill re-derives every row under the current write rules. 5 MCP exec tools (`bakin_exec_memory_{search,get_session,get_turn,list_agents,status}`) expose the same data to agents. See `.claude/knowledge/memory-plugin.md` for tier-by-tier data sources, offset strategy, retention, and the full route/MCP surface.

### Onboarding
`src/core/onboarding/` — eight component modules (mkdir, settings, openclaw, antfly, models, mcporter, llm, channels) with a shared `check()` + `install()` contract. The orchestrator in `index.ts` runs them in a fixed dependency order, writes `~/.bakin/.onboarded` on completion, and the doctor gates on the marker via `settings.doctor.requireOnboard`. CLI surface: `bakin onboard` (aggregated), `bakin mkdir`, `bakin install {antfly,models,mcporter}`, `bakin check {openclaw,llm,channels,all}`, `bakin settings init`. On a fresh machine, use `bakin onboard --yes` to set everything up non-interactively.

### Debug Mode
Global client-side debug toggle. State lives in Zustand (`useContentStore`) + localStorage (`bakin-debug`). Access via `useDebug()` from `src/hooks/use-debug.ts` — returns `[debug, toggleDebug]`. Toggle button in the header (Bug icon). URL `?debug=true` on any page activates debug mode as a one-shot seed. Currently controls: activity feed duplicate event visibility, Antfly search score overlays on asset cards. Plugins and components should use `useDebug()` to conditionally render debug info.

### Shared UI Components
- **`PluginHeader`** (`src/components/plugin-header.tsx`) — Consistent page title + count badge + search + actions slot. Used by all 10 plugins.
- **`FacetFilter`** (`src/components/facet-filter.tsx`) — Popover-based multi-select filter with removable chips. Replaces long tab bars for 4+ filter options. Always back with `useQueryArrayState`.

## Reference

- **Specs:** `.claude/specs/` — detailed specs for each hardening phase
- **Knowledge:** `.claude/knowledge/` — deep dives on plugin system, agent system, storage model
- **Skills:** `.claude/skills/` — reusable Claude Code operations (create-plugin, audit-plugin, add-component)
