# Beacon Hardening Plan

## Context

Beacon is an open-source, plugin-based mission control for OpenClaw agents. The current codebase works but has critical gaps: `server.ts` is a 660-line monolith, there are zero tests, no auth/credential protection, fragile CLI-exec-based OpenClaw communication (despite OpenClaw having a full HTTP API), hardcoded values everywhere, silent error swallowing, and no plugin distribution story. This plan hardens Beacon into a scalable, reliable foundation.

**Key discoveries:**
- OpenClaw's gateway (port 18789) exposes `POST /v1/chat/completions` and `POST /tools/invoke` with Bearer token auth — we can replace all `execFile('openclaw', ...)` calls with proper HTTP requests.
- AntflyDB is already evaluated and planned in SPEC.md (2026-03-19). Self-hosted, AI-native document DB with hybrid search (BM25 + vector), automatic embeddings, RAG, multimodal indexing. TypeScript SDK available (`@antfly/sdk`). Integrating as a core module enables semantic search across all content and dramatically reduces token usage via targeted retrieval.

---

## Phase 1: Foundation

### 1A — Decompose server.ts

Extract the monolith into focused modules under `src/core/`. Each exports `start()` and `stop()` functions.

```
src/core/
  sse.ts              — SSE client management, broadcast(), handleSSE()
  watcher.ts          — chokidar setup, handleFileEvent(), inbox handler, sync hooks
  dispatch.ts         — task dispatch loop, state tracking, dispatchTasks()
  watchdog.ts         — stuck task detection, Discord alerting
  calendar-cron.ts    — executeScheduledContent(), cron interval
  continuation.ts     — checkAndContinueDependents()
  lifecycle.ts        — startup sequence, SIGTERM/SIGINT graceful shutdown
  settings.ts         — core settings loader
  logger.ts           — structured logging (replaces all silent catch{} blocks)
```

`server.ts` shrinks to ~50 lines: imports, server creation, route registration, startup calls.

**Files:** `/server.ts` (rewrite), new `src/core/*.ts` files

### 1B — Core Settings System

Introduce `content/.beacon/settings.json` as single source for all currently-hardcoded values.

```typescript
interface BakinSettings {
  dispatch: {
    intervalMs: number            // default 300000
    failureCooldownMs: number     // default 1800000
    maxDispatched: number         // default 500
  }
  watchdog: {
    intervalMs: number            // default 300000
    stuckThresholdMs: number      // default 1800000
    alertChannelId: string        // currently hardcoded Discord channel ID
  }
  calendar: { intervalMs: number }
  sse: { maxClients: number, keepAliveMs: number }
  openclaw: { binaryPath: string, gatewayUrl: string, gatewayPort: number }
  models: { allowlist?: string[], blocklist?: string[] }
  agents: string[]                // replaces KNOWN_AGENTS in 3 places
  antfly: {
    enabled: boolean              // default false — Beacon works without it
    url: string                   // default http://localhost:8080
    auth?: { username: string, password: string }
  }
}
```

API: `GET/POST /api/settings` on the custom server (core route).

**Files:** New `/src/core/settings.ts`, update all consumers of hardcoded values

### 1C — Graceful Shutdown

`src/core/lifecycle.ts` handles SIGTERM/SIGINT: drain SSE, stop intervals, close watcher, close HTTP server, write shutdown audit entry.

### 1D — Error Handling & Structured Logging

Replace all `catch { /* */ }` blocks (12+ occurrences) with structured logger. JSON output: timestamp, level, module, message, error context.

**Files:** New `/src/core/logger.ts`, update all catch blocks across server.ts and plugins

### 1E — Fix Plugin Route Architecture

**Critical bug:** The catch-all at `src/app/api/plugins/[pluginId]/[...path]/route.ts` creates a no-op `BakinEventBus` (`broadcast = () => {}`), so plugin API routes cannot broadcast SSE events.

**Fix:** Relay events through `localhost:${port}/api/activity/emit` or shared module-level emitter.

**Also:** Consolidate duplicate Next.js routes (`/api/tasks/*`) into plugin routes with proper audit logging. Delete the Next.js task routes after adding audit to plugin handlers.

**Files:** `/src/app/api/plugins/[pluginId]/[...path]/route.ts`, `/plugins/tasks/index.ts`, delete `/src/app/api/tasks/*/route.ts` (8 files), update client components

**Depends on:** 1A, 1B

---

## Phase 2: Security & OpenClaw Communication

### 2A — Credential Vault

`src/core/vault.ts` reads credentials from `~/.openclaw/openclaw.json` and auth-profiles at startup, caches in memory. No credential is ever serialized to a response.

Plugin context gains `vault?: { get(key: string): string | null }` — plugins declare needed secrets in their manifest and only get those.

**Files:** New `/src/core/vault.ts`, `/src/lib/plugin-types.ts` (add vault to PluginContext), `/plugins/calendar/index.ts` (use vault instead of reading openclaw.json), `/plugins/models/index.ts` (use vault instead of reading auth-profiles)

### 2B — OpenClaw HTTP Client

Replace all `execFile('openclaw', ...)` with HTTP calls to the gateway API.

```typescript
// src/core/openclaw-client.ts
interface OpenClawClient {
  sendMessage(agentId: string, message: string): Promise<void>     // POST /v1/chat/completions
  invokeTool(tool: string, args: Record<string, unknown>): Promise<unknown>  // POST /tools/invoke
  sendChannelMessage(channel: string, target: string, message: string, media?: string): Promise<void>
  restartGateway(): Promise<void>
  ping(): Promise<boolean>
}
```

**Replacements:**
| Location | Current (CLI exec) | New (HTTP) |
|----------|-------------------|------------|
| dispatch.ts (task dispatch) | `openclaw agent --agent X --message Y --deliver` | `sendMessage()` |
| watcher.ts (inbox notify) | same pattern | `sendMessage()` |
| continuation.ts (dep resume) | same pattern | `sendMessage()` |
| watchdog.ts (Discord alert) | `openclaw message --channel discord --to channel:X` | `sendChannelMessage()` |
| calendar plugin (publish) | `openclaw message send --channel discord ...` | `sendChannelMessage()` |
| models plugin (restart) | `openclaw gateway restart` | `restartGateway()` |

**Files:** New `/src/core/openclaw-client.ts`, update all 6 call sites

**Depends on:** 1A, 2A

### 2C — Request Validation

Lightweight middleware: validate Content-Type on POST/PUT/DELETE, return 400 on parse errors (not 500), rate limit SSE per IP.

**Files:** New `/src/core/middleware.ts`, apply to server routes and catch-all

### 2D — Antfly Core Module (Vector DB Foundation)

AntflyDB integration as an **optional core module** — Beacon works without it (file-only mode), but dramatically improves with it enabled. Uses `@antfly/sdk` npm package.

**`src/core/antfly.ts`:**
```typescript
interface AntflyCore {
  enabled(): boolean
  index(table: string, doc: { id: string, content: string, metadata: Record<string, unknown> }): Promise<void>
  search(query: string, options?: { table?: string, limit?: number }): Promise<SearchResult[]>
  delete(table: string, id: string): Promise<void>
}
```

**Tables (matching SPEC.md):**
| Table | Source | Indexed when |
|-------|--------|-------------|
| `tasks` | TASKBOARD.md entries | On task completion (move to Done) |
| `decisions` | MEMORY-LOG.md | On write (via watcher sync hook) |
| `audit` | audit.jsonl entries | On every audit event |
| `content` | Calendar items, project docs | On create/update |
| `assets` | content/assets/ images | On create (metadata: prompt, tags, agent) |

**Sync layer** — hooks into the storage adapter and watcher:
- `MarkdownStorageAdapter.write()` gains an `onWrite` hook that dual-writes to Antfly when enabled
- `watcher.ts` calls `antfly.index()` on file change events for watched content types
- Audit events (`broadcastAuditEvent`) also index to Antfly `audit` table
- All sync is fire-and-forget (non-blocking) — file write succeeds even if Antfly is down

**Search API** — core route, not plugin:
- `GET /api/search?q=<query>&table=<optional>&limit=<optional>` — semantic + keyword hybrid search
- Returns ranked results with snippets, source file, relevance score
- Falls back to basic grep-style search when Antfly is disabled

**Why core, not plugin:** Search across all content types is a foundational capability. Plugins produce data; the core indexes and searches it. The memory plugin, task history, API docs discovery, and future model optimization all benefit from this being centralized.

**Files:** New `/src/core/antfly.ts`, `/src/lib/storage/markdown-adapter.ts` (add sync hook), `/src/core/watcher.ts` (index on file events), `/package.json` (add `@antfly/sdk`)

**Depends on:** 1A, 1B (settings for antfly config), 2A (vault for antfly auth)

---

## Phase 3: Testing, Models Core, API Docs

### 3A — Test Infrastructure (Vitest)

```
tests/
  core/
    settings.test.ts
    sse.test.ts
    dispatch.test.ts
    openclaw-client.test.ts
    vault.test.ts
    antfly.test.ts          — sync, search, disabled-mode no-op
  plugins/
    contract.test.ts        — load all plugins, verify BakinPlugin interface
    tasks/taskboard.test.ts — CRUD, mutex, serialization roundtrip
    tasks/parser.test.ts    — markdown parsing edge cases
    calendar/storage.test.ts
  lib/
    event-bus.test.ts       — pattern matching, once(), error handling
    storage-adapter.test.ts — read/write/append/exists
```

Plugin contract test: dynamically load all plugins from config, verify `id`/`name`/`version`/`activate`, call `activate` with mock context, verify routes registered correctly.

**Files:** `/package.json` (add vitest), new `/vitest.config.ts`, new `tests/**/*.test.ts`

**Depends on:** 1A, 1B

### 3B — Models as Core Module

Move model resolution logic from `plugins/models/` into `src/core/models.ts`:
- Read/write model config from `~/.openclaw/openclaw.json`
- Per-agent model resolution (override -> default)
- Model allowlists/blocklists from settings
- Available models cache (Anthropic API, 1hr TTL)

Plugin keeps UI + API routes but delegates to core module.

**Future work (not this phase):** per-task-type routing (heartbeat->haiku, code->opus), budget tracking, usage dashboards.

**Files:** New `/src/core/models.ts`, `/plugins/models/index.ts` (delegate), `/src/core/settings.ts` (add model settings)

**Depends on:** 1B, 2A

### 3C — Self-Documenting API

Add `description` and `params` fields to `APIRoute` interface. Plugin registry collects all routes at startup and:
1. Generates `content/docs/API.md` (markdown, agent-readable)
2. Serves `GET /api/docs` (JSON, programmatic discovery)

Agents can `curl localhost:3737/api/docs` to discover all available endpoints.

**Files:** `/src/lib/plugin-types.ts` (extend APIRoute), `/src/lib/plugin-registry.ts` (doc generation), all plugin index.ts files (add descriptions), new `/src/core/api-docs.ts`

**Depends on:** 1E

---

## Phase 4: CLI, Plugin Distribution, Advanced Features

### 4A — Beacon CLI

Standalone CLI at `cli/beacon.ts`. All commands are thin wrappers around `fetch()` to `http://localhost:3737/api/*`.

```
bakin status                     — system health, agents, dispatch timer
beacon dispatch                   — trigger immediate dispatch
beacon agents list                — list agents and status
beacon agents send <id> <msg>     — send message to agent
beacon tasks list [--column=X]    — list tasks
beacon tasks create <title>       — create task
beacon tasks move <id> <column>   — move task
beacon settings get [key]         — read settings
beacon settings set <key> <val>   — update settings
beacon plugins list               — installed plugins
beacon plugins install <path>     — install plugin (local, later git URL)
beacon docs                       — print API docs
beacon search <query>             — semantic search across all indexed content
```

Agents use CLI commands vs hitting APIs directly — simpler, discoverable, documented.

**Files:** New `/cli/beacon.ts`, `/package.json` (add `bin` field)

**Depends on:** 1B, 3C

### 4B — Plugin Manifest Format

Every plugin gets a `bakin-plugin.json`:

```json
{
  "id": "tasks",
  "name": "Tasks",
  "version": "1.0.0",
  "beacon": ">=1.0.0",
  "description": "Kanban task management with markdown persistence",
  "entry": { "server": "index.ts", "client": "client.tsx" },
  "contentFiles": ["TASKBOARD.md"],
  "secrets": [],
  "tests": "tests/",
  "dependencies": [],
  "permissions": ["storage.read", "storage.write", "events.emit"]
}
```

Plugin registry validates manifest on load, enforces required fields. `tests` field means plugin must pass its test suite.

**Files:** New `plugins/*/bakin-plugin.json` (5 files), `/src/lib/plugin-types.ts` (add PluginManifest), `/src/lib/plugin-registry.ts` (manifest validation), `/bakin.config.ts` (support manifest-based loading)

**Depends on:** 3A

### 4C — SSE Improvements

Add reconnection protocol: events get incrementing IDs, clients send `Last-Event-ID` on reconnect, Beacon replays from audit log. Per-IP connection tracking.

**Files:** `/src/core/sse.ts`, client-side SSE hook

### 4D — Data Migration Framework

Plugins that change storage format get a `migrations/` directory. On startup, registry checks `content/.beacon/plugin-versions.json` against manifest version, runs migrations in order.

**Files:** `/src/lib/plugin-registry.ts` (migration runner), `/src/lib/plugin-types.ts` (add migrations to BakinPlugin)

**Depends on:** 4B

---

## Phase 5: Distribution & Future-Proofing

### 5A — ClawHub (Local First)

- `beacon plugins install ./path` — copy plugin, validate manifest, run tests, add to config
- `beacon plugins install github:user/repo` — clone + same flow
- `beacon plugins remove <id>` — reverse
- Future: central registry with search/ratings

**Files:** New `/src/core/plugin-installer.ts`, `/cli/beacon.ts` (install/remove commands)

**Depends on:** 4A, 4B

### 5B — Agent Communication API

Core routes (not plugin) for agent-to-agent interaction:
- `GET /api/agents/:id/status` — current tasks, last activity
- `POST /api/agents/:id/message` — send message to agent
- `GET /api/agents/:id/tasks` — tasks assigned to agent

**Depends on:** 2B, 3C

### 5C — Multi-Tenant Architecture Review

Review pass over all phases to ensure nothing blocks future multi-tenancy: project-scoped paths, namespace-scoped plugin storage, SSE channel isolation.

No new code — architecture validation.

---

## Dependency Graph

```
1A (decompose) ──┬── 1B (settings) ──┬── 2B (openclaw HTTP) ── 5B (agent API)
                 │                   ├── 2D (antfly core) ── 3B (models core, antfly-enhanced)
                 │                   ├── 3A (tests)
                 │                   ├── 3B (models core)
                 │                   └── 4A (CLI + beacon search) ── 5A (ClawHub)
                 ├── 1C (shutdown)
                 ├── 1D (logging)
                 ├── 1E (fix routes) ── 3C (API docs) ── 4A (CLI)
                 ├── 2A (vault) ──┬── 2B (openclaw HTTP)
                 │                └── 2D (antfly core)
                 ├── 2C (validation)
                 └── 4C (SSE improvements)

3A (tests) ──── 4B (manifest) ──── 4D (migrations)
                                   5A (ClawHub)
```

## Verification

After each phase:
- **Phase 1:** `npm run dev` starts clean, SIGTERM shuts down gracefully, settings API works, no silent errors in logs
- **Phase 2:** No `execFile('openclaw')` calls remain, credentials never appear in API responses, gateway communication works via HTTP, `GET /api/search?q=test` returns results when Antfly enabled (graceful no-op when disabled)
- **Phase 3:** `npm test` passes, all plugins pass contract tests, `GET /api/docs` returns complete route manifest
- **Phase 4:** `bakin status` works, plugins have manifests, SSE reconnects after disconnect
- **Phase 5:** `beacon plugins install ./path` works end-to-end, agents can query each other's status
