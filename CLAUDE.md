# Bakin

Bakin is a self-hosted multi-agent orchestration platform. It gives a single user a real-time dashboard into what their AI agents are doing — tasks, projects, workflows, assets, schedules — all powered by markdown files on the filesystem, pushed to the browser via SSE.

Runs on a Mac mini, accessed via Tailscale. No database, no SaaS dependencies.

## Architecture

- **Server:** Custom Node.js HTTP server wrapping Next.js 16 (App Router), port 3737
- **Frontend:** React 19, Tailwind CSS 4, shadcn v4 (Base UI), Zustand for state
- **Storage:** Markdown files in `~/.bakin/`, no database
- **Real-time:** Server-Sent Events (SSE) push updates to all connected browsers
- **Agents:** Managed via OpenClaw gateway, communicate through MCP tools
- **Plugins:** 10 core plugins, extensible architecture for addons
- **Search:** Antfly SDK for full-text indexing
- **OpenClaw Adapter Principle:** Bakin reads from OpenClaw. Bakin writes to OpenClaw. Bakin never copies OpenClaw. Agent identity, soul, rules, tools, models, and workspace data all live in `~/.openclaw/`. Bakin owns only UI-specific data (display settings, avatars, heartbeats). Question any pattern that duplicates OpenClaw state into Bakin code or storage.

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
    calendar/page.tsx      — Calendar view
    memory/page.tsx        — Audit log viewer
    health/page.tsx        — System health dashboard
    models/page.tsx        — Model configuration
    api/plugins/[pluginId]/[[...path]]/route.ts  — Catch-all plugin API router
plugins/                   — Core plugins (each has bakin-plugin.json manifest)
  tasks/                   — Task board management
  workflows/               — Workflow execution engine (xyflow canvas)
  assets/                  — Asset management with sidecar metadata
  projects/                — Project tracking with checklists
  schedule/                — Cron job scheduling with OpenClaw bridge
  memory/                  — Audit logs and agent workspaces
  calendar/                — Content calendar
  models/                  — AI model configuration
  team/                    — Agent team management (OpenClaw adapter layer)
  health/                  — System health dashboard
scripts/lib/               — MCP exec tools (self-registering via registry.ts)
cli/                       — CLI tool (wraps HTTP API)
```

### Runtime Data Directory (`~/.bakin/`)
Created by `bakin init`. Per-installation state, NOT in the repo.
```
~/.bakin/
  settings.json            — Runtime config (mainAgentId, bridge settings)
  plugin-settings/         — Per-plugin configuration
  plugins/                 — Addon plugins (installed via bakin install)
  agents/                  — Per-agent data ({id}/avatar.jpg, avatar-full.png)
  assets/                  — Content files organized by type
  projects/                — Project markdown files
  heartbeats/              — Agent status heartbeats (JSON)
  schedule/                — Cron job state
  workflows/               — Definitions, instances, skills
  team/                    — Contacts, personas
  TASKBOARD.md             — Task kanban board
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

Plugin context provides: `storage`, `events`, `registerNav()`, `registerRoute()`, `registerSlot()`, `registerExecTool()`, `registerSkill()`, `watchFiles()`, `getSettings()`, `updateSettings()`, `activity` (log + audit), `hooks` (register + has + invoke)

Routes registered as: `/api/plugins/{pluginId}/{path}` via the catch-all route.

Exec tools naming: `bakin_exec_{pluginId}_{action}`

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

## Key Patterns

### SSE Broadcasting
Real-time updates via `broadcast()` from `src/core/sse.ts`. Uses `globalThis.__bakinBroadcast` to survive Next.js webpack re-evaluation. Two channels: activity (progress) and audit (structured events).

### Agent Activity
Agents report progress via `bakin_log_progress` MCP tool → `logProgress()` in task-service → SSE broadcast. Structured audit via `appendAudit()` → `audit.jsonl` + SSE + Antfly.

### Content Directory
All paths resolved through `getContentDir()` in `src/core/content-dir.ts`. Resolution: `BAKIN_HOME` env → `~/.bakin/` → `./content/` fallback. Well-known paths via `getBakinPaths()`.

### Plugin Communication
Plugins communicate exclusively through the HookRegistry (`packages/core/src/hooks/hook-registry.ts`). Plugins register hooks in `activate()` via `ctx.hooks.register(name, handler)`. Core modules and other plugins invoke hooks via `getHookRegistry().invoke<R>(name, data)`. Hook naming: `{pluginId}.{operation}` (e.g., `tasks.readTaskboard`, `workflows.getCurrentStep`). No direct imports between plugins or from core → plugins — all cross-boundary calls go through hooks.

### MCP Tool Registration
All MCP tools are dynamically registered — no hardcoded tools exist in `mcp-server.ts`. Plugins register exec tools via `ctx.registerExecTool()` during activation (72 tools across 8 plugins). Scripts self-register via `addExecTool()` on import (5 tools: log, gen_image, post_discord, get_paths, heartbeat). Total: 77 exec tools. `mcp-server.ts` calls `getAllExecTools()` to build the tool list at startup.

### Plugin Settings
Each plugin declares a `settingsSchema` with typed fields (string, number, boolean, select). The settings page at `/settings` dynamically fetches and renders schemas via `PluginSettingsRenderer`. Values persisted at `~/.bakin/plugin-settings/{pluginId}.json`, accessible in plugins via `ctx.getSettings<T>()`.

### URL State & Deep Linking
All user-facing filter/view state **must** be backed by URL query parameters so pages are bookmarkable and support browser back/forward. Use `useQueryState(key, default)` for single values and `useQueryArrayState(key)` for arrays (comma-separated). Params are omitted when at their default value. Pages using these hooks must wrap their content component in `<Suspense>`. See `.claude/knowledge/url-state-deep-linking.md` for conventions and implementation status.

### Shared UI Components
- **`PluginHeader`** (`src/components/plugin-header.tsx`) — Consistent page title + count badge + search + actions slot. Used by all 10 plugins.
- **`FacetFilter`** (`src/components/facet-filter.tsx`) — Popover-based multi-select filter with removable chips. Replaces long tab bars for 4+ filter options. Always back with `useQueryArrayState`.

## Reference

- **Specs:** `.claude/specs/` — detailed specs for each hardening phase
- **Knowledge:** `.claude/knowledge/` — deep dives on plugin system, agent system, storage model
- **Skills:** `.claude/skills/` — reusable Claude Code operations (create-plugin, audit-plugin, add-component)
