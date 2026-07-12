# Making a Plugin Searchable — Guide

## Overview

Any Bakin plugin registers its content for hybrid search by calling one of two
methods on `ctx.search` during `activate()`:

| Method | When to use |
|---|---|
| `registerFileBackedContentType(def)` | **Default for any plugin whose source of truth is files on disk under `~/.bakin/`.** Auto-wires the watcher sync/unlink hooks; every hook write journals through the durable search outbox. |
| `registerContentType(def)` | Bare registration for plugins whose data isn't filesystem-backed (task-store-backed `tasks`, runtime-adapter-backed `team`/`schedule`, the memory tailer). The plugin calls the mutators itself. |

There is **no boot-time reconcile**: boot performs zero engine calls when the
blue/green registry matches. Consistency comes from three paths — inline
mutator calls on REST/MCP writes, watcher hooks for filesystem writes, and the
doctor's scheduled sweeps (orphan scan, memory offset stat-check) for
black-swan drift. All three journal through the outbox: engine down = rows
wait durably, never lost. See `search-system.md` for the architecture.

**One call wires everything.** Registration auto-creates the blue/green
versioned table, auto-registers `GET /api/plugins/{pluginId}/search`, joins the
cross-plugin `GET /api/search` (the ⌘K overlay), and makes the data reachable
from the MCP search tools (`plugin: <pluginId>` parameter). No manual route
boilerplate.

`getTableForPlugin(pluginId)` returns the plugin's **primary** content-type
table. A plugin gets one primary — a second *direct* registration throws early —
while file-backed content types register as secondary and index into their own
table (e.g. `team`'s `agents` primary + `agent-lessons` file-backed).

## Step-by-Step (file-backed plugins)

### 1. Define the schema

| Type | Use for | Indexed for full-text? |
|------|---------|----------------------|
| `text` | Searchable prose (titles, descriptions, content) | Yes |
| `keyword` | Exact-match filters (status, agent, type) | No (facet only) |
| `number` | Numeric values (progress, count) | No |
| `datetime` | Timestamps (created_at, updated_at) | No |

### 2. Register in activate()

```typescript
activate(ctx: PluginContext) {
  ctx.search.registerFileBackedContentType({
    table: 'notes',
    // REQUIRED. Bump when the doc shape changes — the table blue/green-
    // migrates in the background (queries stay on the old table until the
    // new one converges; no degraded window, no manual reindex).
    schemaVersion: 1,
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

    // Required: full-enumeration generator. This is the blue/green
    // BACKFILL SOURCE — it must be side-effect free and restartable
    // (each call re-reads sources). If your docs depend on live state
    // (e.g. a runtime adapter), THROW when that state is unavailable so
    // a migration parks instead of converging on a thin table.
    reindex: async function* () {
      for (const note of listAllNotes()) {
        yield { key: note.id, doc: noteToSearchDoc(note) }
      }
    },

    // Required: source-of-truth check (used by the doctor orphan sweep)
    verifyExists: async (key) => ctx.storage.exists(`data/${key}.md`),
  })
}
```

The helper wires two hooks on top of `registerContentType()`:

1. A sync hook that, on every watcher `add`/`change`, finds the matching
   `filePatterns` entry, calls `fileToId` + `fileToDoc`, and **enqueues** the
   result to the search outbox (landed by the drain pump — immediately when
   the engine is up, on retry when it isn't).
2. An unlink hook that enqueues a removal on every `unlink`.

The outbox coalesces last-write-wins per key and dedupes identical content
via an acked-hash — re-indexing an unchanged doc is a no-op. Plugins never
implement their own change-detection caches.

### 3. Glob patterns

Patterns match paths relative to the content dir: `*` (no `/`), `**` (any),
`{a,b}` alternation, everything else literal. `excludePatterns` use the same
syntax (`.trash/` etc.).

### 4. Multiple file patterns under one table

One logical table can have several `filePatterns` entries (workflows uses this
for definitions vs instances). The watcher routes events to the first matching
pattern. Prefix keys (`def:`, `inst:`) so patterns can't collide.

### 5. Escape hatches: onSync / onUnlink

When the default `fileToId + fileToDoc` flow doesn't fit (e.g. assets: one
manifest write updates a tracker AND the index), take full ownership:

```typescript
filePatterns: [{ pattern: 'assets/**/*', fileToId: (rel) => rel }], // fileToDoc optional with onSync
excludePatterns: ['assets/**/.trash/**'],
onSync: async (rel, content) => {
  upsertAsset(rel)
  await ctx.search.index(assetIdFor(rel), toSearchDoc(rel))
},
onUnlink: async (rel) => {
  removeAsset(rel)
  await ctx.search.remove(assetIdFor(rel))
},
```

With `onSync`/`onUnlink` set they take over completely; `filePatterns` still
controls scope. `fileToDoc` is optional in that case.

### 6. Index on REST/MCP mutations (still required)

The watcher is eventually consistent (~300ms `awaitWriteFinish`). Routes and
exec tools that respond synchronously should also call the mutators inline:

```typescript
ctx.search.index(documentKey, { ... }).catch(() => {})
ctx.search.remove(documentKey).catch(() => {})
ctx.search.transform(documentKey, [{ op: '$set', field: 'status', value: 'done' }]).catch(() => {})
```

All three are journal-first: they resolve once the write is durable in the
outbox, and the pump lands it. `transform` has real `$set`/`$inc`/`$push`
semantics (merged into any pending write for the key; read-modify-write at
drain time). The watcher path remains the safety net for writes that bypass
REST (`cp`, `rsync`, agents in other processes).

## Client side: joining the ⌘K overlay

Register a hit renderer in the plugin's `client.tsx` so global-search results
render with the right title/link/thumbnail:

```typescript
registerPlugin({
  id: 'notes',
  navItems: [...],
  slots: [...],
  search: {
    hitRenderers: {
      notes: (hit) => ({
        title: String(hit.fields.title ?? hit.id),
        subtitle: String(hit.fields.status ?? ''),
        href: `/notes/${hit.id}`,
      }),
    },
  },
})
```

Renderers are plain data-mapping functions (title/subtitle/href/thumbnailUrl/
icon), not components — the overlay owns layout, keyboard focus, and debug
badges. Unknown types get a default renderer with `href: null`, which the
overlay renders **inert** (muted, `data-inert`, Enter is a no-op) — a hit
must never look clickable while going nowhere.

**Renderer contract (test-enforced):**
- The renderer key MUST equal the bare table name (registered `table` minus
  the `bakin_` prefix). A renderer keyed under anything else never matches —
  the team plugin shipped this bug as `agents` vs table `team`.
- `href` must be a non-null app path for a schema-shaped hit, and field
  reads must use the schema's exact field names (`agent_id`, not `agent`).
- `tests/plugins/search-hit-renderer-contract.test.ts` activates every core
  plugin, imports every client entry, and fails on a missing renderer, a
  mis-keyed renderer, or a null href — keep it green when adding types.
- **Lazy-load interaction:** renderers register when the plugin's client
  bundle loads, and most clients are lazy (loaded on first page visit).
  Opening the overlay calls `requestAllPlugins()` (SDK) to demand every idle
  client, so hits render with real renderers even for never-visited pages.

## Querying: `useSearch` and honest degradation

`useSearch` returns `status: 'idle' | 'loading' | 'ok' | 'unavailable' | 'error'`
plus `retry()`. When the engine is down the server returns
`503 { error: 'search_unavailable' }` and the hook reports `unavailable` —
render the shared `SearchUnavailable` component (SDK). There are **no silent
fallbacks**: browse/filter listings that don't touch search keep working;
search itself is honestly down.

## Patterns by Data Source

### Filesystem-backed (assets, workflows, file-backed external plugins)
- `registerFileBackedContentType()`; `reindex()` scans directories and yields docs; `verifyExists()` checks file existence; REST/MCP routes also call `ctx.search.index()` inline.

### Bakin task-store-backed (tasks)
- `registerContentType()`; the task-store wrapper functions drive sync; `verifyExists()` queries the store.

### Runtime-adapter-backed (schedule, team)
- `registerContentType()`; batch-index on data load (the outbox acked-hash makes unconditional re-index cheap); `reindex()` enumerates the adapter's current state — and THROWS if the runtime is unreachable (park, don't flip thin).

### Memory plugin
- `registerContentType()`; the byte-offset tailer feeds the outbox as runtime files grow; `reindex()` delegates to the indexer's side-effect-free `enumerateAll()` and fails loudly when the runtime is down; offline file growth is caught by the doctor's stat-level size-vs-offset check.

## Currently Registered Content Types

| Plugin | Table | Source | Helper used |
|--------|-------|--------|---|
| tasks | `bakin_tasks` | Bakin task JSON store | `registerContentType` |
| assets | `bakin_assets` | versioned manifests (+ enrichment fields) | `registerFileBackedContentType` (escape hatches) |
| workflows | `bakin_workflows` | YAML defs + JSON instances | `registerFileBackedContentType` (two filePatterns) |
| schedule | `bakin_schedule` | runtime cron jobs | `registerContentType` |
| team | `bakin_team` | runtime agents | `registerContentType` |
| team | `bakin_agent-lessons` | lesson markdown files | `registerFileBackedContentType` (secondary) |
| memory | `bakin_memory` | `audit.jsonl` + runtime memory tiers | `registerContentType` (single table, `tier` facet) |

(Logical names — the physical tables are blue/green versioned:
`bakin_assets_v2_<fp8>` etc. Plugins never see physical names.)

## Common Pitfalls

1. **Always `.catch(() => {})` on index/remove calls in REST handlers** — search is best-effort, never block the main operation (the enqueue itself only fails if local SQLite is broken).
2. **Don't rely on the watcher alone for REST responses.** The ~300ms `awaitWriteFinish` lag races the response. Call `ctx.search.index()` inline AND let the watcher fire — the outbox dedupes.
3. **Use `transform()` for status-only changes** — avoids re-embedding when only metadata changed.
4. **Keys must be stable** — the item's unique ID, never a mutable path. Prefix multi-pattern keys.
5. **`reindex()` is a backfill source, not a sync mechanism.** Side-effect free, restartable, throws on unavailable dependencies. A generator that yields nothing on failure will let a blue/green migration converge on an empty table.
6. **Test the unlink hook** — copy `tests/integration/search-watcher-sync.test.ts`.

## Surface Obligations (D11 + latency contract)

Any UI that consumes `useSearch` must render ALL of:

- `status === 'loading'` — a visible in-flight indicator.
- `status === 'unavailable'` — the SDK `SearchUnavailable` panel (engine
  down; the hook maps HTTP 503 `search_unavailable`). If the page keeps
  working via a client-side fallback (e.g. substring filtering), SAY SO
  with an inline degraded banner — never silently substitute.
- `meta.partial` — the SDK `SearchPartialChip` (a source missed its query
  budget; tooltip names it).
- Debug mode — `ScoreOverlay` gated on `useDebug()[0]`, optionally with
  `matchedFields: computeMatchedFields(query, hit.fields)` for the
  "matched: title, tags" / "semantic match" line.
