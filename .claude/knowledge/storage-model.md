# Storage Model — Deep Reference

## Overview

Bakin stores its own state in markdown files, JSON files, and JSONL logs under the content directory (`~/.bakin/` by default). Task metadata is Bakin-owned JSON under `~/.bakin/tasks/`, sharded by creation month. Provider-owned data stays behind adapters: OpenClaw agent identity, workspace files, channels, cron jobs, and memory are accessed through `AppServices.runtime`, not by importing provider path helpers from core or plugins.

## Content Directory

### Resolution (`packages/core/src/content-dir.ts`, re-exported via `src/core/content-dir.ts`)
Priority order:
1. `BAKIN_HOME` env var
2. `~/.bakin/`

Resolved once at startup, cached in module. Access via `getContentDir()`.

### Well-known paths (`getBakinPaths()`)
Returns a `BakinPaths` object with absolute paths:

| Key | Path | Purpose |
|-----|------|---------|
| `home` | `~/.bakin/` | Content root |
| `memoryLog` | `MEMORY-LOG.md` | Agent memory log |
| `messaging` | `messaging.json` | Messaging / content calendar events |
| `audit` | `audit.jsonl` | Append-only audit trail |
| `assets` | `assets/` | Asset root |
| `assets.store` | `assets/store/` | Canonical asset store (flat, sharded by month) |
| `assets.inbox` | `assets/inbox/` | Drop-zone for manually-placed files awaiting ingestion |
| `assets.trash` | `assets/.trash/` | Soft-deleted assets with 7-day TTL |
| `agents` | `agents/` | Bakin-owned per-agent UI assets |
| `personas` | `team/personas/` | Agent persona files |
| `team` | `team/` | Team directory |
| `heartbeats` | `heartbeats/` | Agent heartbeat JSON files |
| `inbox` | `inbox/` | Incoming items |
| `projects` | `projects/` | Project markdown files |
| `tasks` | `tasks/` | Bakin-owned task metadata JSON |
| `workflows` | `workflows/` | Definitions, instances, skills |
| `settings` | `settings.json` | Runtime settings |

### Initialization (`initBakinHome()`)
Called by `bakin init` or first run. Creates the directory structure:
- `assets/`, `assets/store/`, `assets/inbox/`, `assets/.trash/` (month shards under `store/` are created on-demand by `saveAsset`)
- `agents/`, `heartbeats/`, `inbox/`, `plugins/`, `projects/`, `tasks/`, `team/personas/`
- `workflows/definitions/`, `workflows/skills/`, `workflows/instances/`
- Seeds workflow skill files and definitions from plugin defaults

## Storage Adapter

### `MarkdownStorageAdapter` (`src/lib/storage/markdown-adapter.ts`)
Implements `StorageAdapter` interface. All paths are relative to content dir.

```typescript
interface StorageAdapter {
  read(path: string): string | null       // read file, null if missing
  write(path: string, content: string): void  // write file, create dirs
  append(path: string, content: string): void // append to file
  exists(path: string): boolean           // check existence
  readAll(): Record<string, string>       // read all files (flat)
}
```

Provided to plugins via `PluginContext.storage`. Each plugin reads/writes to namespaced paths by convention (not enforced):
- Tasks plugin: Bakin task store under `getBakinPaths().tasks`, exposed through `plugins/tasks/lib/flow-store.ts` for historical API compatibility
- Projects plugin: `projects/*.md`
- Assets plugin: `assets/store/{YYYY-MM}/{filename}` — filename-as-identity; sharded by month, flat inside the shard. See `.claude/knowledge/assets-plugin.md` for the storage model.
- Schedule plugin: `schedule/`
- Memory plugin: `MEMORY-LOG.md`

## Key File Formats

### Task Storage (Bakin JSON)
Tasks are stored in the core Bakin task store at `getBakinPaths().tasks`. The concrete file store is `packages/core/src/tasks/store.ts`; it writes one JSON document per task at `tasks/{YYYY-MM}/task-{id}.json` with atomic temp-file rename writes. `plugins/tasks/lib/flow-store.ts` is now a compatibility-named service layer over that store, not a legacy DB adapter.

Bakin's own operational state (`audit.jsonl`, per-plugin `plugin-settings/*.json`, heartbeats, task JSON, etc.) is plain JSON / JSONL on the filesystem. User content (projects, assets, workflows, messaging) stays in markdown + sidecars on the filesystem; that boundary is intentional.

Task execution state is runtime-owned and is linked from task metadata through `task.execution.flowId` plus an execution cache. Runtime execution records are not the authoritative task metadata store.

### Project files (`projects/{id}.md`)
Markdown with YAML frontmatter:
```markdown
---
id: proj-abc123
title: Q2 Content Campaign
status: active
created: 2026-03-28
---

## Checklist
- [x] Define content calendar [[task:task-001]]
- [ ] Create hero images [[task:task-002]]
- [ ] Write blog posts

## Notes
Free-form markdown content...
```

Parsed by `plugins/projects/lib/parser.ts`. Checklist items can link to tasks via `[[task:id]]`.

### Sidecar metadata pattern
Content files have optional `.meta.json` sidecars colocated alongside the file:
```
assets/store/2026-03/
  20260328-spec-a1b2c3d4.md              ← content
  20260328-spec-a1b2c3d4.md.meta.json    ← metadata sidecar
```

Sidecar contains:
```json
{
  "taskId": "task-abc123",
  "agent": "basil",
  "created": "2026-03-28T10:30:00Z",
  "type": "text",
  "tags": ["recipe", "blog"],
  "title": "Spring Salad Recipe"
}
```

For assets, `type` and `taskId` live in the sidecar, not in the path. Retype and relink are metadata-only — the file never moves. See `.claude/knowledge/assets-plugin.md`.

### Heartbeat files (`heartbeats/{agentId}.json`)
```json
{
  "timestamp": "2026-03-28T10:30:00Z",
  "status": "working",
  "currentTask": "task-abc123"
}
```

### Audit log (`audit.jsonl`)
Append-only, one JSON object per line:
```json
{"ts":"2026-03-28T10:30:00Z","event":"task.moved","agent":"main","data":{"taskId":"task-abc","from":"todo","to":"inProgress"},"channel":"mcp"}
```

### Settings (`settings.json` at content root)
`BakinSettings` interface defined in `packages/core/src/settings.ts` (re-exported via `src/core/settings.ts`). Deep-merged with hard defaults at load time. Cached with `resetSettingsCache()` for invalidation.

Key sections: `runtime`, `search`, `dispatch`, `watchdog`, `messaging`, `sse`, `models`, `doctor`, `service`, `notifications`, `workflow`.

## File Watching

`src/core/watcher.ts` uses Chokidar to watch the content directory. File changes are:
1. Detected by Chokidar
2. Injected via `injectFileEvent(path, event, content)` into the event bus
3. Broadcast via SSE to connected clients
4. Clients update their Zustand stores

Plugins can request watch patterns via `ctx.watchFiles(['projects/*.md'])`.

## Antfly Search Integration

Antfly is the search index layer. The filesystem remains the source of truth — Antfly is never the primary store.

### Dual-write pattern
Mutations write to the source filesystem **and** fire `ctx.search.index(key, doc)` to update the Antfly index. Indexing is fire-and-forget — a failure does not block the mutation. The index may be stale; it is always reconstructable via `def.reindex()`.

### Deletion sync
When the file watcher detects an unlink event, the watcher unlink hook (auto-wired by `ctx.search.registerFileBackedContentType()`) calls `ctx.search.remove(key)` to remove the document from Antfly within ~300ms. This is the primary consistency path for file-backed plugins — no scheduled scan required for the common case.

### Orphan backstop scan
`src/core/search-cleanup.ts` runs a periodic scan (default 7d, `settings.search.settings.cleanupInterval`). For each registered content type it calls `def.verifyExists(key)` per indexed document and removes any whose source no longer exists. This is a **backstop**, not the primary path — it only catches the rare events the watcher missed (process down during the delete, fs event lost, etc.).

### Not a replacement
Antfly is the search index, not a database. Do not read authoritative state from Antfly — always read from the filesystem or runtime adapter and treat Antfly results as pointers to source documents.

Configured in `BakinSettings.search`. See `.claude/knowledge/search-system.md` for the full architecture.

## Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/content-dir.ts` | Content directory resolution, path constants, init |
| `src/core/content-dir.ts` | Re-export shim for backward compat |
| `src/lib/storage/markdown-adapter.ts` | StorageAdapter implementation |
| `packages/core/src/tasks/store.ts` | Bakin task metadata store |
| `plugins/tasks/lib/flow-store.ts` | Compatibility-named task service layer over the Bakin task store |
| `src/lib/parsers/` | Markdown parsing utilities |
| `src/core/audit.ts` | Audit JSONL writing + broadcast |
| `src/core/settings.ts` | Settings loading with defaults |
| `src/core/watcher.ts` | Chokidar file watcher |
| `src/core/search-adapter-factory.ts` | Search adapter factory |
| `src/core/search-registry.ts` | Search content type registry, ctx.search provider |
| `src/core/search-cleanup.ts` | Periodic orphan cleanup for search indexes |
| `plugins/projects/lib/parser.ts` | Project file parsing |
| `plugins/assets/` | Asset management with sidecars |
