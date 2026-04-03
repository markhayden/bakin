# Repo Architecture — Deep Reference

## Overview

Bakin is a monorepo with a pnpm workspace. The main application (Next.js + custom HTTP server) lives at the repo root. Shared types and utilities are extracted into `@bakin/core` at `packages/core/`. Plugins live in `plugins/` as directories (not separate packages).

## Monorepo Layout

```
/                              ← root package (name: "bakin")
├── packages/
│   └── core/                  ← @bakin/core — shared types, utilities, settings
│       └── src/
│           ├── index.ts       ← barrel export (all public APIs)
│           ├── constants.ts   ← APP_NAME, APP_SLUG, APP_HOME_DEFAULT, etc.
│           ├── plugin-types.ts← BakinPlugin, PluginContext, StorageAdapter, EventBus
│           ├── content-dir.ts ← getContentDir(), getBakinPaths(), initBakinHome()
│           ���── settings.ts    ← BakinSettings, getSettings(), updateSettings()
│           ├── main-agent.ts  ← getMainAgentId() runtime resolution
│           ├── logger.ts      ← createLogger()
│           ├── vault.ts       ← secret storage
│           ├── format.ts      ← formatAge(), isStale()
│           ├── storage/       ← MarkdownStorageAdapter
│           └── events/        ← BakinEventBus
├── plugins/                   ← 9 core plugins (NOT workspace packages)
���   ├── tasks/
│   ├── workflows/
│   ├── assets/
│   ├── projects/
│   ├── schedule/
│   ├── memory/
│   ├── calendar/
│   ├── models/
│   └── health/
├── src/
│   ├── core/                  ← server-side modules (NOT in @bakin/core)
│   ├── lib/                   ← shared code (client + server safe)
│   ├── app/                   ← Next.js App Router pages
│   └── components/            ← React components
├── scripts/lib/               ← MCP exec tools (self-registering)
├── cli/                       ← CLI tool (bakin.ts)
├── server.ts                  ← HTTP server entry point
├── bakin.config.ts            ← plugin enable list
├── pnpm-workspace.yaml        ← workspace: packages/*
└── tsconfig.json              ← path aliases for @/* and @bakin/*
```

## @bakin/core Package

**Location:** `packages/core/`
**Workspace:** Listed in `pnpm-workspace.yaml` under `packages/*`
**Dependency:** Root `package.json` has `"@bakin/core": "workspace:*"`

Contains modules that are safe to share across plugins, server, and potentially CLI — no React, no Next.js, no side effects at import time (except logger).

### What's in core vs. what's not

| In `@bakin/core` | NOT in core (stays in `src/core/`) |
|---|---|
| Types: BakinPlugin, PluginContext, StorageAdapter, EventBus | task-service.ts (side effects, SSE) |
| Constants: APP_NAME, APP_SLUG, etc. | audit.ts (append-only writes) |
| Settings: getSettings(), BakinSettings | sse.ts (globalThis state) |
| Content dir: getContentDir(), getBakinPaths() | dispatch.ts (agent communication) |
| Logger: createLogger() | watcher.ts (chokidar, file events) |
| Storage: MarkdownStorageAdapter | mcp-server.ts (tool registration) |
| Events: BakinEventBus | agents.ts (OpenClaw integration) |
| Vault, format utilities | antfly.ts (search indexing) |

**Rule of thumb:** If a module has external side effects (writes files, opens connections, uses globalThis) it stays in `src/core/`. If it's a pure type, utility, or configurable service, it goes in `@bakin/core`.

## Re-export Shim Pattern

Original module locations (`src/core/*.ts`, `src/lib/*.ts`) are kept as thin re-export shims pointing to the actual implementations in `packages/core/src/`. This preserves backward compatibility for existing imports throughout the codebase.

```typescript
// src/core/logger.ts (shim)
export { createLogger } from '../../packages/core/src/logger'

// src/core/content-dir.ts (shim)
export { getContentDir, getBakinPaths, ... } from '../../packages/core/src/content-dir'
```

**Why direct relative paths instead of `@bakin/core`?** tsx runtime doesn't reliably resolve `@bakin/core` re-exports through shim files under parallel module loading. Direct paths work consistently across vitest, tsc, and tsx.

**Shim files:**
- `src/core/logger.ts` → `packages/core/src/logger`
- `src/core/content-dir.ts` → `packages/core/src/content-dir`
- `src/core/settings.ts` → `packages/core/src/settings`
- `src/core/main-agent.ts` → `packages/core/src/main-agent`
- `src/core/vault.ts` → `packages/core/src/vault`
- `src/lib/plugin-types.ts` → `packages/core/src/plugin-types`
- `src/lib/format.ts` → `packages/core/src/format`
- `src/lib/core-constants.ts` → `packages/core/src/constants`
- `src/lib/events/event-bus.ts` → `packages/core/src/events/event-bus`
- `src/lib/storage/markdown-adapter.ts` → `packages/core/src/storage/markdown-adapter`

## Plugin Import Rules

Plugins are NOT pnpm workspace packages (no `package.json`). They import via relative paths:

```typescript
// From plugins/X/index.ts (depth 2)
import type { BakinPlugin } from '../../src/lib/plugin-types'
import { createLogger } from '../../src/core/logger'
import { appendAudit } from '../../src/core/audit'        // direct, not in core

// From plugins/X/lib/file.ts (depth 3)
import { getContentDir } from '../../../src/core/content-dir'
```

**Why not workspace packages?** Plugin `package.json` files created ESM package boundaries that broke relative imports crossing the boundary during dynamic `import()` at runtime. Removing them fixed all plugin loading issues.

## TypeScript Path Aliases

Defined in `tsconfig.json`, mirrored in `vitest.config.ts`:

| Alias | Resolves to | Used by |
|---|---|---|
| `@/*` | `./src/*` | App code (pages, components, core modules) |
| `@bakin/core` | `./packages/core/src/index.ts` | Workspace dependency |
| `@bakin/tasks` | `./plugins/tasks` | Cross-plugin imports in tests/app |
| `@bakin/workflows` | `./plugins/workflows` | Cross-plugin imports in tests/app |
| `@bakin/{plugin}` | `./plugins/{plugin}` | All 9 plugins |

## src/core/ vs. src/lib/

| Directory | Constraints | Examples |
|---|---|---|
| `src/core/` | Server-only, may have side effects, Node.js APIs | audit.ts, sse.ts, dispatch.ts, watcher.ts |
| `src/lib/` | Shared (client + server safe), no side effects | plugin-types.ts, constants.ts, parsers/, agents-data.ts |

## Runtime Data (`~/.bakin/`)

Created by `bakin init` or `initBakinHome()`. Symlinked from `~/.beacon/` for backward compat.

```
~/.bakin/
├── settings.json          ← runtime config (deep-merged with defaults)
├── TASKBOARD.md           ← kanban board
├── MEMORY-LOG.md          ← agent memory log
├── audit.jsonl            ← append-only audit trail
├── calendar.json          ← calendar events
├── assets/                ← content files by type
│   ├── text/
│   ├── images/
│   ├── video/
│   ├─��� audio/
│   ├── plans/
│   ├── data/
│   ├── other/
│   └── .trash/
├─��� projects/              ← project markdown files
├── workflows/
│   ├── definitions/       ← workflow YAML templates
│   ├── instances/         ← running workflow state
│   └── skills/            ← skill markdown files
├── heartbeats/            ← agent heartbeat JSON files
├── inbox/                 ← incoming items
├── team/
│   └── personas/          ← agent persona files
├── schedule/              ← cron job state
├── plugins/               ← user addon plugins (override by ID)
└── docs/                  ← generated API docs
```

## Key Entry Points

| What | File | How it starts |
|---|---|---|
| HTTP server | `server.ts` | `npx tsx server.ts` or `bakin start` |
| CLI | `cli/bakin.ts` | `bakin <command>` (globally linked via npm) |
| Plugin config | `bakin.config.ts` | Imported by server.ts, lists enabled plugins |
| Plugin loading | `src/lib/plugin-registry.ts` | Called by server.ts during startup |
| MCP tools | `src/core/mcp-server.ts` | Imports `scripts/lib/*.ts` + plugin exec tools |
| Next.js pages | `src/app/*/page.tsx` | Served by server.ts wrapping Next.js |
