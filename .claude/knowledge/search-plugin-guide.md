# Making a Plugin Searchable — Guide

## Overview

Any Bakin plugin can register its content for Antfly-powered hybrid search by
calling one of two methods on `ctx.search` during `activate()`:

| Method | When to use |
|---|---|
| `registerFileBackedContentType(def)` | **Default for any plugin whose source of truth is files on disk under `~/.bakin/`.** Auto-wires the watcher sync/unlink hooks AND registers a startup mtime reconcile. |
| `registerContentType(def)` | Bare registration for plugins whose data isn't filesystem-backed (task-store-backed `tasks`, runtime-adapter-backed `team`/`schedule`, the audit JSONL log). The plugin owns its own sync calls. |

This guide focuses on the file-backed helper. See `search-system.md` for the
"Three consistency paths" architecture and the rationale.

**One call wires everything.** As of issue #67, calling either method during
`activate()` auto-registers a `GET /search` route on the plugin's router
(`/api/plugins/{pluginId}/search`). You do **not** need to call
`ctx.registerRoute({ path: '/search', ... })` yourself — that boilerplate is
gone. The auto-wired route resolves the plugin's table via
`getTableForPlugin(pluginId)` and forwards `q`, `limit`, `offset`, `facets`,
and `filters` to `ctx.search.query()`. The MCP search exec tools (`search_query`,
`search_table`, etc.) all take a `plugin: <pluginId>` parameter and reach the
same backend, so registering a content type also makes the plugin's data
agent-searchable.

`getTableForPlugin(pluginId)` (formerly `getPluginTable`) throws if a single
plugin registers more than one content type, since the auto-wired `/search`
route can't disambiguate. Plugins with multiple content types must register
their own custom route.

## Step-by-Step (file-backed plugins)

### 1. Define the schema

Pick fields that users and agents will search or filter by. Each field has a type:

| Type | Use for | Indexed for full-text? |
|------|---------|----------------------|
| `text` | Searchable prose (titles, descriptions, content) | Yes |
| `keyword` | Exact-match filters (status, agent, type) | No (facet only) |
| `number` | Numeric values (progress, count) | No |
| `datetime` | Timestamps (created_at, updated_at) | No |

### 2. Register in activate() with file patterns

```typescript
activate(ctx: PluginContext) {
  ctx.search.registerFileBackedContentType({
    table: 'notes',
    schema: {
      title: { type: 'text' },
      status: { type: 'keyword' },
      body: { type: 'text' },
      updated_at: { type: 'datetime' },
    },
    searchableFields: ['title', 'body'],
    embeddingTemplate: '{{title}} {{body}}',
    facets: ['status'],

    // ─── File-backed wiring ─────────────────────────────────────
    filePatterns: [
      {
        pattern: 'data/*.md',
        fileToId: (rel) => rel.replace(/^data\//, '').replace(/\.md$/, ''),
        fileToDoc: async (rel) => {
          const id = rel.replace(/^data\//, '').replace(/\.md$/, '')
          const note = readNote(id)
          return note ? noteToSearchDoc(note) : null
        },
      },
    ],
    // excludePatterns: ['data/**/.trash/**'],  // optional

    // Required: full reindex generator (used by `/api/reindex`)
    reindex: async function* () {
      for (const note of listAllNotes()) {
        yield { key: note.id, doc: noteToSearchDoc(note) }
      }
    },

    // Required: source-of-truth check (used by orphan backstop scan)
    verifyExists: async (key) => ctx.storage.exists(`data/${key}.md`),
  })

  // The plugin's REST/MCP routes still call ctx.search.index() directly
  // for the authoritative immediate path. The watcher hooks are only
  // for filesystem writes that bypass the REST path.
}
```

The helper does three things on top of `registerContentType()`:

1. Registers a `registerSyncHook` that, on every `add` / `change`, finds the
   matching `filePatterns` entry, calls `fileToId` + `fileToDoc`, and indexes
   the result with an `_mtime_ms` field for drift detection.
2. Registers a `registerUnlinkHook` that, on every `unlink`, calls `fileToId`
   and removes the matching key from search.
3. Schedules a startup reconcile via `performStartupReconcile()` that
   compares filesystem mtimes against indexed `_mtime_ms` and re-indexes
   only what changed (or removes orphans).

### 3. Glob patterns

Patterns are matched against paths relative to the content dir. Supported syntax:

- `*` — any chars except `/`
- `**` — any chars including `/`
- `{a,b}` — alternation (e.g. `*.{yaml,yml}`)
- Anything else is a literal

Examples:
- `workflows/definitions/*.{yaml,yml}` — both yaml extensions
- `assets/**/*` — every file under assets, recursively
- `plugins/<plugin-id>/data/*.md` — plugin-scoped markdown files

`excludePatterns` use the same syntax. Useful for `.trash/` and other
non-canonical locations.

### 4. Multiple file patterns under one table

A single content type can register more than one `filePatterns` entry —
useful when one logical table is backed by files in different shapes or
locations (the `workflows` plugin uses this for definitions vs instances):

```typescript
filePatterns: [
  {
    pattern: 'workflows/definitions/*.{yaml,yml}',
    fileToId: (rel) => `def:${basename(rel)}`,
    fileToDoc: async (rel) => loadDefinition(...),
  },
  {
    pattern: 'workflows/instances/*.json',
    fileToId: (rel) => `inst:${basename(rel)}`,
    fileToDoc: async (rel, content) => JSON.parse(content),
  },
],
```

The watcher hook routes events to the first matching pattern.

### 5. Escape hatches: onSync / onUnlink

When the default `fileToId + fileToDoc + index` flow doesn't fit cleanly —
e.g. the asset plugin's sidecar/binary pairing where one watcher event
needs to update both an in-memory tracker AND the search index — use the
escape hatches:

```typescript
filePatterns: [{ pattern: 'assets/**/*', fileToId: (rel) => rel, fileToDoc: async () => null }],
excludePatterns: ['assets/**/.trash/**'],
onSync: async (rel, content) => {
  // full ownership: do whatever you need
  upsertAsset(rel)
  await indexAsset(rel)
},
onUnlink: async (rel) => {
  removeAsset(rel)
  await ctx.search.remove(rel)
},
```

When `onSync` / `onUnlink` are set, they take over completely — the default
`fileToDoc + index` flow is skipped. The `filePatterns` array is still
required because it controls scope (which paths the hooks fire for) via
`excludePatterns`.

### 6. Index on REST/MCP mutations (still required)

The watcher hooks are eventually consistent (~300ms `awaitWriteFinish`
lag). For routes and exec tools that respond synchronously to a user
request, **also** call the search mutators inline:

```typescript
ctx.search.index(documentKey, { ... }).catch(() => {})
ctx.search.remove(documentKey).catch(() => {})
ctx.search.transform(documentKey, [{ op: '$set', field: 'status', value: 'done' }]).catch(() => {})
```

The watcher path is the safety net for writes that bypass REST entirely
(`cp`, `rsync`, restored backups, agents in other processes).

## Patterns by Data Source

### Filesystem-backed (assets, workflows, file-backed external plugins)
- Use `registerFileBackedContentType()`
- `filePatterns` for the file shapes
- `reindex()` scans directories, yields docs
- `verifyExists()` checks file existence
- REST/MCP routes still call `ctx.search.index()` for immediate consistency

### Bakin task-store-backed (tasks)
- Use `registerContentType()`
- Plugin owns sync via task-store wrapper functions
- `verifyExists()` queries the task store
- No watcher hooks; the task store subscription drives taskboard SSE and plugin routes call search directly

### Runtime-adapter-backed (schedule, team)
- Use `registerContentType()`
- `reindex()` is empty (data loaded at runtime)
- `verifyExists()` returns `true` always
- Batch-index on data load

### Memory plugin (audit)
- Registered by the **memory** plugin via `ctx.search.registerContentType()`
  (moved out of `server.ts` during the issue #67 cleanup — `_audit` is no
  longer a synthetic plugin id)
- TTL configured via `settings.search.settings.auditTtl`

### Official external plugins
- Messaging and Projects live in `bakin-bits-official`. When installed,
  they register search content types through the same `ctx.search` API.
- Their file patterns are relative to their scoped `plugin-data/<id>/`
  storage root, not top-level core paths.

## Currently Registered Content Types

| Plugin | Table | Source | Helper used |
|--------|-------|--------|---|
| tasks | `bakin_tasks` | Bakin task JSON store | `registerContentType` |
| assets | `bakin_assets` | `.meta.json` sidecars + binaries | `registerFileBackedContentType` (escape hatches) |
| workflows | `bakin_workflows` | YAML defs + JSON instances | `registerFileBackedContentType` (two filePatterns) |
| schedule | `bakin_schedule` | runtime cron jobs | `registerContentType` |
| team | `bakin_team` | runtime agents | `registerContentType` |
| memory | `bakin_memory` | `audit.jsonl` + runtime sessions/workspace memory | `registerContentType` (single table, `tier` facet discriminates across 7 memory tiers) |

Official plugins add their own tables when installed; for example Projects registers `bakin_projects` and Messaging registers `bakin_messaging_brainstorm`.

## Common Pitfalls

1. **Always `.catch(() => {})` on index/remove calls in REST handlers** — search is best-effort, never block the main operation.
2. **Don't rely on the watcher alone for REST responses.** The ~300ms `awaitWriteFinish` lag will race the response. Call `ctx.search.index()` inline AND let the watcher fire.
3. **Use `transform()` for status-only changes** — avoids expensive re-embedding when only metadata changed.
4. **Document keys must be stable** — use the item's unique ID, not a path that might change. For multi-pattern tables, prefix the key (`def:`, `inst:`) so different patterns can't collide.
5. **Test the unlink hook.** The `tests/plugins/<plugin>/unlink-hook.test.ts` files (and the `tests/integration/search-watcher-sync.test.ts` integration test) drive the watcher pipeline end-to-end with mocked chokidar — copy the pattern.
