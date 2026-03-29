# Phase 1: .claude Directory as Gospel

**Status:** In Progress
**Created:** 2026-03-28

## Purpose

Establish the `.claude/` directory as the single authoritative source for how Claude Code interacts with this codebase during development. Every convention, pattern, and rule lives here so any Claude Code session starts with the same context.

This is about the **development tool** (Claude Code), not the **application** (Bakin). Bakin's runtime agents (Pixel, Basil, etc.) are application data — they'll live in the app's plugin/package structure, not in `.claude/`.

## Directory Structure

```
CLAUDE.md                          ← repo root, loaded every Claude Code session
.claude/
  specs/                           ← phase specs for the hardening initiative
    01-claude-directory.md
    ...
  skills/                          ← reusable Claude Code slash command definitions
    create-plugin.md
    audit-plugin.md
    add-component.md
  knowledge/                       ← deep reference docs for complex subsystems
    plugin-system.md
    agent-system.md
    storage-model.md
  settings.local.json              ← already exists, permission allow-lists
```

## ~/.bakin/ — Runtime Data Directory

Created automatically when Bakin is installed (`bakin init`). NOT part of the repo — this is per-installation state. Clear separation between installable code and runtime data:

```
~/.bakin/
  settings.json                    ← runtime config (mainAgentId, bridge settings, etc.)
  plugin-settings/                 ← per-plugin config
    assets.json
    schedule.json
    ...

  # --- Installable code (addon plugins & agents) ---
  plugins/                         ← addon plugins installed via `bakin install`
    my-custom-plugin/
      bakin-plugin.json
      index.ts
      ...
  agents/                          ← addon agent definitions (YAML/JSON)
    custom-agent.yaml

  # --- Runtime data ---
  assets/                          ← managed content (images, docs, etc.)
    text/
    image/
    video/
  projects/                        ← project files with metadata sidecars
  heartbeats/                      ← agent status heartbeats
  schedule/                        ← cron job state
  workflows/                       ← workflow definitions & instances
  team/                            ← team contacts, personas
  inbox/                           ← incoming items
  TASKBOARD.md                     ← task kanban board
  MEMORY-LOG.md                    ← agent memory log
  audit.jsonl                      ← append-only audit trail
```

Core plugins ship with the repo (in `plugins/`). Addon plugins get installed to `~/.bakin/plugins/`. The plugin registry checks both locations. Same pattern for agents — core agents are defined in the repo's agent data files, addon agents are YAML files dropped into `~/.bakin/agents/`.

## CLAUDE.md Contents

The root CLAUDE.md is the master document. It should contain:

### 1. Project Identity
- What Bakin is: a self-hosted multi-agent orchestration platform
- Architecture: Next.js 16 custom server, plugin system, markdown-based storage, SSE real-time updates
- Who it's for: single-user, self-hosted on a Mac mini, accessed via Tailscale

### 2. Directory Map
Annotated layout of:
- **Repo structure:** `src/core/`, `src/lib/`, `src/components/`, `plugins/`, `scripts/`, `cli/`
- **Runtime data directory:** `~/.bakin/` — created by `bakin init`, per-installation state (see above)
- **Plugin anatomy:** `bakin-plugin.json`, `index.ts`, `client.tsx`, `types.ts`, `components/`

### 3. Tech Stack
Next.js 16, React 19, TypeScript 5, Tailwind CSS 4, shadcn v4 (Base UI), Zustand, Zod, Vitest, npm (migrating to pnpm)

### 4. Code Conventions
- TypeScript strict mode, no `any` leaking across module boundaries
- Zod for all validation at system boundaries (API inputs, file parsing, settings)
- Functional preference — pure functions over classes where practical
- `createLogger('module')` for all logging (from `src/core/logger.ts`)
- No empty catch blocks — log or rethrow
- Prefer `const` over `let`, never `var`

### 5. Import Ordering
```
node builtins        → import { join } from 'path'
external packages    → import next from 'next'
internal @/* paths   → import { createLogger } from '@/core/logger'
plugin imports       → import { readProject } from '@mc/projects/lib/parser'
relative imports     → import { helper } from './utils'
```

### 6. Commit Conventions
Conventional commits with scope:
- `feat(tasks): add drag-and-drop reordering`
- `fix(schedule): handle timezone edge case in bridge`
- `refactor(core): extract settings into dedicated module`
- `test(workflows): add gate approval integration test`
- `docs: update CLAUDE.md with new plugin rules`

### 7. Plugin Authoring Rules
- Every plugin must have a `bakin-plugin.json` manifest
- Entry point exports an object implementing `BakinPlugin` interface (currently `MCPlugin`)
- Routes registered via `ctx.registerRoute()` in `activate()`
- Exec tools registered via `ctx.registerExecTool()` — naming: `bakin_exec_{pluginId}_{action}`
- Client component exports `navItems` array for sidebar registration
- Plugin dependencies declared in manifest

### 8. File & Naming Conventions
- Files: `kebab-case.ts` (e.g., `task-service.ts`, `plugin-registry.ts`)
- Components: `kebab-case.tsx` (current convention)
- Functions/variables: `camelCase`
- Types/interfaces: `PascalCase` (e.g., `BakinPlugin`, `PluginContext`)
- Constants: `UPPER_SNAKE_CASE` for true constants, `camelCase` for config objects

## Skills

Each skill is a markdown file that Claude Code can use as a slash command:

### create-plugin.md
Scaffolds a new plugin with:
- `bakin-plugin.json` manifest (prompts for id, name, version, dependencies)
- `index.ts` with activate() skeleton and route registration
- `client.tsx` with navItems export and basic page component
- `types.ts` with plugin-specific type definitions
- `__tests__/` directory with a basic test file

### audit-plugin.md
Runs through the standardized plugin audit checklist:
1. Route inventory — naming, ID-based access, deep linking
2. MCP tool inventory — naming convention, Zod schemas
3. Client component audit — design system compliance
4. Test coverage — identify gaps
5. Storage format documentation
6. Plugin settings schema
7. Hook integration (events emitted/consumed)
8. Activity logging compliance
9. Accessibility check

### add-component.md
Creates a new UI component following the design system:
- Uses shadcn/ui patterns (CVA variants, cn() merging, data-slot attributes)
- Tailwind CSS 4 with design tokens from globals.css
- Proper TypeScript props interface
- Exported from components/ui/ or appropriate plugin components/ directory

## Knowledge Files

### plugin-system.md
Deep reference on:
- Plugin lifecycle: discover → validate manifest → activate(ctx) → ready
- `PluginContext` API: storage, events, registerNav, registerRoute, registerSlot, registerExecTool, registerSkill, watchFiles
- `BakinPlugin` interface and `PluginManifest` schema
- Route handling: `/api/plugins/[pluginId]/[...path]/route.ts` catch-all
- Exec tool registry: `scripts/lib/registry.ts`, `addExecTool()`, `getAllExecTools()`
- Client manifest: `src/lib/plugin-manifest.ts`, static imports, `allNavItems`
- Key files: `src/lib/plugin-types.ts`, `src/lib/plugin-registry.ts`, `bakin.config.ts` (currently `mc.config.ts`)

### agent-system.md
Deep reference on:
- Agent data: `src/lib/agents-data.ts` — `AgentProfile` interface, `AGENT_PROFILES`, `AGENT_MAP`
- Agent resolution: `src/core/agents.ts` — status from heartbeats + taskboard
- Dispatch: `src/core/dispatch.ts` — how tasks get delivered to agents via OpenClaw
- Heartbeat system: `~/.bakin/heartbeats/{agentId}.json`
- MCP tool access: agents get tools via MCP sessions, identity from `?agent=` query param
- Activity logging: `bakin_log_progress` → `logProgress()` → SSE broadcast + taskboard append
- Audit trail: `appendAudit()` → `audit.jsonl` + SSE + Antfly indexing

### storage-model.md
Deep reference on:
- Content directory: `~/.bakin/` — created by `bakin init`, resolved via `getContentDir()` in `src/core/content-dir.ts`
- Markdown storage: `MarkdownStorageAdapter` in `src/lib/storage/markdown-adapter.ts`
- Key files: `TASKBOARD.md` (kanban), `MEMORY-LOG.md` (audit), `projects/*.md`
- Sidecar metadata pattern: `{filename}.meta.json` alongside content files
- Asset structure: `~/.bakin/assets/{type}/{taskId}/`
- Antfly indexing: fire-and-forget via `src/core/antfly.ts`
- Settings: `~/.bakin/settings.json` — runtime config including `mainAgentId`
- Plugin settings: `~/.bakin/plugin-settings/{pluginId}.json`

## Verification

- [ ] CLAUDE.md exists at repo root and accurately reflects current codebase
- [ ] `.claude/skills/` has create-plugin, audit-plugin, add-component
- [ ] `.claude/knowledge/` has plugin-system, agent-system, storage-model
- [ ] All conventions documented match what's actually in the code
- [ ] A fresh Claude Code session loading CLAUDE.md has sufficient context to make correct changes
