---
title: Search
description: Make plugin content searchable — registration, file-backed sync, hit renderers, and honest degradation.
---

Any plugin registers its content for hybrid (full-text + semantic) search with one call on `ctx.search` during `activate()`. Registration auto-creates the content type's versioned table, auto-registers `GET /api/plugins/{pluginId}/search`, joins the cross-plugin `GET /api/search` (the ⌘K overlay), and makes the data reachable from the MCP search tools. No manual route boilerplate — but remember to declare the auto route in `contributes.apiRoutes` (`bakin plugins sync-manifest` does this for you).

The reference plugin's [`index.ts`](https://github.com/markhayden/bakin/tree/main/examples/reference-plugin) registers a complete working content type.

## Two registration methods

<div class="table-light-full table-label-wrap">

| Method | When to use |
| --- | --- |
| `registerFileBackedContentType(def)` | Default for content whose source of truth is files the plugin owns on disk. Auto-wires file-watcher sync/unlink; every write journals through a durable outbox. |
| `registerContentType(def)` | Content backed by anything else (an external API, a store, a runtime). The plugin calls the mutators itself. |

</div>

Writes never race the engine: `index`/`remove`/`transform` journal first and land asynchronously. If the search engine is down, rows wait durably and land when it returns — a write is never lost, and registering or indexing never blocks activation.

## Defining a content type

```ts
ctx.search.registerFileBackedContentType({
  table: 'notes',
  // REQUIRED. Bump when the doc shape changes — the table migrates in the
  // background (queries stay on the old table until the new one converges;
  // no downtime, no manual reindex).
  schemaVersion: 1,
  schema: {
    title: { type: 'text' },        // searchable prose
    status: { type: 'keyword' },    // exact-match facet
    body: { type: 'text' },
    updated_at: { type: 'datetime' },
  },
  searchableFields: ['title', 'body'],
  embeddingTemplate: '{{title}} {{body}}',
  facets: ['status'],

  // File-backed wiring: patterns match paths relative to the Bakin content
  // directory. Installed plugins' storage lives under plugin-data/<id>/,
  // so include that prefix in your patterns.
  filePatterns: [
    {
      pattern: 'plugin-data/notes/data/*.md',
      // rel is content-dir-relative, e.g. 'plugin-data/notes/data/abc.md'
      fileToId: (rel) => rel.split('/').pop()!.replace(/\.md$/, ''),
      fileToDoc: async (rel) => {
        const id = rel.split('/').pop()!.replace(/\.md$/, '')
        const note = readNote(id)
        return note ? noteToSearchDoc(note) : null
      },
    },
  ],

  // REQUIRED: full-enumeration generator. This is the backfill source when
  // the schema migrates — it must be side-effect free and restartable. If
  // your docs depend on live state that is unavailable, THROW so the
  // migration parks instead of converging on an empty table.
  reindex: async function* () {
    for (const note of listAllNotes()) {
      yield { key: note.id, doc: noteToSearchDoc(note) }
    }
  },

  // REQUIRED: source-of-truth check, used by the doctor's orphan sweep.
  verifyExists: async (key) => ctx.storage.exists(`data/${key}.md`),
})
```

Field types: `text` (full-text indexed), `keyword` (exact-match/facet), `number`, `datetime`.

## Keeping the index fresh

For file-backed types the watcher handles writes that happen on disk. But the watcher is eventually consistent (~300ms settle), so routes and exec tools that mutate data should also call the mutators inline:

```ts
ctx.search.index(id, doc).catch(() => {})
ctx.search.remove(id).catch(() => {})
ctx.search.transform(id, [{ op: '$set', field: 'status', value: 'done' }]).catch(() => {})
```

Rules of thumb:

- **Always `.catch(() => {})`** — search is best-effort; never fail the main operation on an index call.
- **Use `transform()` for metadata-only changes** — it avoids re-embedding unchanged prose.
- **Keys must be stable** — the item's unique id, never a mutable path.
- The outbox dedupes identical content and coalesces per key, so indexing unconditionally after every mutation is cheap and correct. Don't build your own change detection.

When the default `fileToId`/`fileToDoc` flow doesn't fit, pass `onSync`/`onUnlink` to take full ownership of watcher events (`filePatterns` still controls scope).

## Client side: rendering hits

Register a hit renderer in `client.tsx` so your content renders correctly in the ⌘K overlay:

```tsx
registerPlugin({
  id: 'notes',
  // ...
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

Renderers are plain data-mapping functions (`title`, `subtitle?`, `href`, `thumbnailUrl?`, `icon?`) — the overlay owns layout and keyboard behavior. The renderer key must equal the registered `table` name, `href` must be a real app path, and field reads must use the schema's exact field names. A hit without a renderer gets a default, inert rendering — visible but not clickable.

## Querying and honest degradation

`useSearch` (from `@makinbakin/sdk/hooks`) returns `status: 'idle' | 'loading' | 'ok' | 'unavailable' | 'error'` plus `retry()`. When the engine is down, search endpoints return `503 { error: 'search_unavailable' }` and the hook reports `unavailable` — render the SDK's `SearchUnavailable` component. There are no silent fallbacks: listings that don't depend on search keep working, and search itself is honestly down.

## Pitfalls

1. `reindex()` is a backfill source, not a sync mechanism. A generator that silently yields nothing on failure lets a schema migration converge on an empty table — throw instead.
2. Don't rely on the watcher alone for REST responses; call the mutators inline and let the watcher be the safety net.
3. One logical table can serve several `filePatterns`; prefix keys (`def:`, `inst:`) so patterns can't collide.
