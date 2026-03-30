# Storage Model — Deep Reference

## Overview

Bakin uses the filesystem as its database. All state is stored as markdown files, JSON files, and JSONL logs in a content directory (`~/.bakin/`). There is no database, no ORM, no migrations in the traditional sense. The filesystem IS the data layer.

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
| `taskboard` | `TASKBOARD.md` | Task kanban board |
| `memoryLog` | `MEMORY-LOG.md` | Agent memory log |
| `calendar` | `calendar.json` | Calendar events |
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
- Tasks plugin: `TASKBOARD.md`
- Projects plugin: `projects/*.md`
- Assets plugin: `assets/{type}/{taskId}/`
- Schedule plugin: `schedule/`
- Memory plugin: `MEMORY-LOG.md`

## Key File Formats

### TASKBOARD.md
Markdown kanban board. Columns are H2 headers with emoji prefix:
```markdown
## 🔵 In Progress

### task-abc123
- **title:** Create social media images
- **agent:** @pixel
- **workflow:** social-media-post
- **created:** 2026-03-28
- **log:**
  - [10:30] [START] Beginning image generation
  - [10:35] [PROGRESS] Generated 3 variants

## 📋 Todo
...
```

Parsed by `src/lib/parsers/` and `src/lib/taskboard.ts`.

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
  "agent": "chef",
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
{"ts":"2026-03-28T10:30:00Z","event":"task.moved","agent":"main-operator","data":{"taskId":"task-abc","from":"todo","to":"inProgress"},"channel":"mcp"}
```

### Settings (`settings.json` at content root)
`BakinSettings` interface defined in `packages/core/src/settings.ts` (re-exported via `src/core/settings.ts`). Deep-merged with hard defaults at load time. Cached with `resetSettingsCache()` for invalidation.

Key sections: `dispatch`, `watchdog`, `calendar`, `sse`, `openclaw`, `models`, `agents`, `antfly`, `doctor`, `service`, `notifications`, `workflow`.

## File Watching

`src/core/watcher.ts` uses Chokidar to watch the content directory. File changes are:
1. Detected by Chokidar
2. Injected via `injectFileEvent(path, event, content)` into the event bus
3. Broadcast via SSE to connected clients
4. Clients update their Zustand stores

Plugins can request watch patterns via `ctx.watchFiles(['projects/*.md'])`.

## Antfly Indexing

`src/core/antfly.ts` / `src/core/antfly-server.ts` — full-text search via Antfly SDK.

- Audit entries auto-indexed (fire-and-forget)
- Assets indexed on creation
- Search available via `/api/search` endpoint
- Configured in `BakinSettings.antfly` (enabled, url, auth)

## Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/content-dir.ts` | Content directory resolution, path constants, init |
| `src/core/content-dir.ts` | Re-export shim for backward compat |
| `src/lib/storage/markdown-adapter.ts` | StorageAdapter implementation |
| `src/lib/taskboard.ts` | TASKBOARD.md parsing |
| `src/lib/parsers/` | Markdown parsing utilities |
| `src/core/audit.ts` | Audit JSONL writing + broadcast |
| `src/core/settings.ts` | Settings loading with defaults |
| `src/core/watcher.ts` | Chokidar file watcher |
| `src/core/antfly.ts` | Antfly search client |
| `plugins/projects/lib/parser.ts` | Project file parsing |
| `plugins/assets/` | Asset management with sidecars |
