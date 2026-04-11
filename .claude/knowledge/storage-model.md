# Storage Model — Deep Reference

## Overview

Bakin uses a hybrid storage model. Most state is stored as markdown files, JSON files, and JSONL logs in a content directory (`~/.bakin/`). Tasks are stored in OpenClaw's `flow_runs` SQLite table (`{OPENCLAW_HOME}/flows/registry.sqlite`) — this is the one exception to filesystem-based storage, adopted to share task state with OpenClaw and enable efficient archival. All OpenClaw paths are resolved via `getOpenClawPath()` from `packages/core/src/openclaw-home.ts`, respecting the `OPENCLAW_HOME` env var (defaults to `~/.openclaw/`).

## Content Directory

### Resolution (`packages/core/src/content-dir.ts`, re-exported via `src/core/content-dir.ts`)
Priority order:
1. `BAKIN_HOME` env var
2. `CONTENT_DIR` env var (legacy compat)
3. `~/.bakin/` if it exists
4. `./content/` fallback

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
| `assets.text` | `assets/text/` | Text content |
| `assets.images` | `assets/images/` | Image files |
| `assets.video` | `assets/video/` | Video files |
| `assets.audio` | `assets/audio/` | Audio files |
| `assets.plans` | `assets/plans/` | Plan documents |
| `assets.data` | `assets/data/` | Data files |
| `assets.other` | `assets/other/` | Uncategorized |
| `personas` | `team/personas/` | Agent persona files |
| `team` | `team/` | Team directory |
| `heartbeats` | `heartbeats/` | Agent heartbeat JSON files |
| `inbox` | `inbox/` | Incoming items |
| `projects` | `projects/` | Project markdown files |
| `workflows` | `workflows/` | Definitions, instances, skills |
| `settings` | `settings.json` | Runtime settings |

### Initialization (`initBakinHome()`)
Called by `bakin init` or first run. Creates full directory structure including:
- All asset type directories with `_unlinked/` and `library/` subdirs
- `heartbeats/`, `inbox/`, `plugins/`, `projects/`, `team/personas/`
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
- Tasks plugin: SQLite (`{OPENCLAW_HOME}/flows/registry.sqlite`, via `flow-store.ts`)
- Projects plugin: `projects/*.md`
- Assets plugin: `assets/{type}/{taskId}/`
- Schedule plugin: `schedule/`
- Memory plugin: `MEMORY-LOG.md`

## Key File Formats

### Task Storage (SQLite)
Tasks are stored in OpenClaw's `flow_runs` SQLite table, accessed via `plugins/tasks/lib/flow-store.ts` using `better-sqlite3`. Each task is a row filtered by `owner_key LIKE 'bakin:task:%'`. Task metadata (title, agent, description, log entries, dependencies) is stored in the `state_json` column. Column mapping uses `status` + disambiguating fields. See `.claude/knowledge/tasks-plugin.md` for the full column ↔ status mapping.

The `src/lib/taskboard.ts` file is a re-export shim that delegates to `flow-store.ts`.

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
Content files have optional `.meta.json` sidecars:
```
assets/text/task-abc123/
  spec.md              ← content
  spec.meta.json       ← metadata sidecar
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
{"ts":"2026-03-28T10:30:00Z","event":"task.moved","agent":"roscoe","data":{"taskId":"task-abc","from":"todo","to":"inProgress"},"channel":"mcp"}
```

### Settings (`settings.json` at content root)
`BakinSettings` interface defined in `packages/core/src/settings.ts` (re-exported via `src/core/settings.ts`). Deep-merged with hard defaults at load time. Cached with `resetSettingsCache()` for invalidation.

Key sections: `dispatch`, `watchdog`, `messaging`, `sse`, `openclaw`, `models`, `agents`, `antfly`, `doctor`, `service`, `notifications`, `workflow`.

## File Watching

`src/core/watcher.ts` uses Chokidar to watch the content directory. File changes are:
1. Detected by Chokidar
2. Injected via `injectFileEvent(path, event, content)` into the event bus
3. Broadcast via SSE to connected clients
4. Clients update their Zustand stores

Plugins can request watch patterns via `ctx.watchFiles(['projects/*.md'])`.

## Antfly Search Integration

Antfly is the search index layer. The filesystem (and SQLite for tasks) remains the source of truth — Antfly is never the primary store.

### Dual-write pattern
Mutations write to the source (filesystem or SQLite) **and** fire `ctx.search.index(key, doc)` to update the Antfly index. Indexing is fire-and-forget — a failure does not block the mutation. The index may be stale; it is always reconstructable via `def.reindex()`.

### Deletion sync
When the file watcher detects an unlink event, `ctx.search.remove(key)` is called to remove the document from Antfly. This keeps the index consistent without a scheduled scan.

### Orphan cleanup
`src/core/search-cleanup.ts` runs a periodic scan (interval from `settings.antfly.cleanupInterval`). For each registered content type it calls `def.verifyExists(key)` per indexed document and removes any whose source no longer exists. This is a safety net for missed unlink events or external deletions.

### Not a replacement
Antfly is the search index, not a database. Do not read authoritative state from Antfly — always read from the filesystem or SQLite and treat Antfly results as pointers to source documents.

Configured in `BakinSettings.antfly`. See `.claude/knowledge/search-system.md` for the full architecture.

## Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/content-dir.ts` | Content directory resolution, path constants, init |
| `src/core/content-dir.ts` | Re-export shim for backward compat |
| `src/lib/storage/markdown-adapter.ts` | StorageAdapter implementation |
| `src/lib/taskboard.ts` | Re-export shim delegating to flow-store.ts (naming is historical) |
| `src/lib/parsers/` | Markdown parsing utilities |
| `src/core/audit.ts` | Audit JSONL writing + broadcast |
| `src/core/settings.ts` | Settings loading with defaults |
| `src/core/watcher.ts` | Chokidar file watcher |
| `src/core/antfly.ts` | AntflyClient SDK wrapper |
| `src/core/search-registry.ts` | Search content type registry, ctx.search provider |
| `src/core/search-cleanup.ts` | Periodic orphan cleanup for search indexes |
| `plugins/projects/lib/parser.ts` | Project file parsing |
| `plugins/assets/` | Asset management with sidecars |
