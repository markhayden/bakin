# Search System — Deep Reference

## Overview

Search goes through `AppServices.search` / `ctx.search`. Antfly is the current
search adapter implementation in `packages/adapter-antfly/`, backing UI search
and agent queries. It is **optional**: Bakin runs fully without it. When
`settings.search.settings.enabled` is `false` (or Antfly is unreachable),
search silently degrades — indexing calls are no-ops, queries return empty
results.

**Install & runtime (antfly v0.2, zig):** `bakin install search` direct-downloads the pinned release tarball from releases.antfly.io (SHA256-verified against `packages/adapter-antfly/src/pin.ts` — no brew/npm/python/sudo) into `~/.antfly/bin/antfly`. Bakin runs a **private instance**: `antfly swarm` bound to `127.0.0.1:3738` (health `3739`) with `--data-dir ~/.bakin/antfly` — never the shared `~/.antfly/data`. Readiness via `GET /readyz`. Embedded inference is pinned to the CPU/ONNX backend (`TERMITE_PREFERRED_BACKEND=onnx`) because the Metal backend crashes at v0.2.0-rc.2. A non-default `settings.url` means an externally managed server (guest mode: connect only, never spawn, never touch its disk). Known upstream limitations at this pin are tracked in [#456](https://github.com/markhayden/bakin/issues/456).

Bakin's search pipeline supports multimodal content: text embeddings via BGE, image embeddings via CLIP (running through antfly's embedded inference runtime), hybrid BM25 + semantic fusion via RRF, and optional cross-encoder reranking on single-modality tables. File content for PDFs and text formats is extracted **server-side in Bakin** (via pdf-parse and `fs.readFileSync`) and passed to Antfly as a pre-resolved `content` field rather than dereferenced via Antfly's `{{remotePDF}}` / `{{remoteText}}` template helpers. See **Multimodal Architecture** below and `.claude/knowledge/multimodal-search.md` for the full rationale.

## Architecture

```
Plugin activate()
  → ctx.search.registerContentType(def)             — bare registration, plugin owns sync
  → ctx.search.registerFileBackedContentType(def)   — helper: also wires watcher hooks + reconcile
  → SearchRegistry stores definition (globalThis-backed)

Mutation (create/update)
  → ctx.search.index(key, doc)
  → Bakin extracts file content (if applicable) into doc.content
  → Bakin computes image_url (file://) for raster images
  → SearchAdapter upserts into bakin_{contentType} table
  → Antfly's embedding enricher chunks, embeds via BGE/CLIP, writes to indexes

Deletion
  → plugin calls ctx.search.remove(key)
  → SearchAdapter deletes document

Periodic backstop scan (default 7d)
  → SearchCleanup scans all registered content types
  → Calls def.verifyExists() per document
  → Removes orphans that the watcher unlink hook missed

Query
  → ctx.search.query(params)
  → Registry looks up per-table index names and rerankField
  → SearchAdapter hybrid query: full-text (Bleve) + semantic (embeddings) via RRF
  → Cross-encoder reranker scores top-K if the content type opted in
  → Returns ranked results with per-index score breakdown

Boot-time migration (every start)
  → search-migration.ts reads ~/.bakin/.search-state.json
  → If stored < SCHEMA_VERSION, drop all bakin_* tables
  → Registry recreates tables via createRegisteredTables()
  → Fire-and-forget full reindex populates the new tables
  → Write new version to the state file
```

### Auto-registered `/search` route (canonical wiring path)

Plugins **no longer register their own `/search` route**. When a plugin
calls `ctx.search.registerContentType()` or
`ctx.search.registerFileBackedContentType()` during `activate()`, the
search registry's `buildSearchAPI(pluginId, { registerRoute })` helper
automatically wires a `GET /search` route on the plugin's router. The
route handler resolves the plugin's table via `getTableForPlugin()`,
forwards the query params (`q`, `limit`, `offset`, `facets`, `filters`)
to `ctx.search.query()`, and returns the standard `SearchResponse`
shape. Registration is idempotent — calling `registerContentType` twice
for the same plugin doesn't double-register the route. The catch-all
plugin dispatch path uses `BuildSearchAPIOptions.skipFileBackedWiring`
to avoid double-wiring file-backed hooks when the API is constructed
outside the plugin activation phase.

`getTableForPlugin(pluginId)` (formerly `getPluginTable`) returns the plugin's
**primary** content-type table — the one a plugin registers via
`registerContentType` and targets with bare `ctx.search.index/remove/transform/query`,
and what the auto-wired `/search` route + MCP plugin-param routing resolve to. A plugin
has exactly one primary (a second *direct* registration throws early); **file-backed
content types register as secondary** and are indexed into their own table directly, so a
plugin like `team` can register a direct primary (`agents`) plus a file-backed secondary
(`agent-lessons`) without the resolver misrouting. `getTableForPlugin` returns the primary
(or null) and no longer throws on multi-content plugins.

### Three consistency paths

The search index stays in sync with source data through three layered paths.
Higher-numbered paths exist as backstops for the lower ones.

1. **REST/MCP mutation path (authoritative, immediate).** When a route or
   exec tool mutates data, it calls `ctx.search.index()` /
   `ctx.search.remove()` directly. This is the only path that's truly
   synchronous with the user's request. Awaiting the watcher's ~300ms
   `awaitWriteFinish` lag would race the response — every plugin that
   writes via REST/MCP must call the search mutators inline.
2. **Watcher hook path (filesystem-driven, eventually consistent).** For
   writes that bypass the REST path — manual `cp`, `rsync`, restored
   backups, another agent writing to disk, an MCP server in another
   process — the chokidar watcher fires sync/unlink hooks ~300ms after
   the write settles. Plugins opt into this by using
   `registerFileBackedContentType()`, which auto-wires the hooks and
   classifies events into the plugin's index/remove calls.
3. **Startup reconcile + 7d backstop scan (recovery).** On every boot
   `performStartupReconcile()` walks the filesystem, compares mtimes
   against the indexed `_mtime_ms` field, and re-indexes drift or
   removes orphans. Then a periodic backstop scan runs every 7d
   (`settings.search.settings.cleanupInterval`) calling `verifyExists()` for
   every indexed key — this catches the rare cases where the process
   was down during a delete or the fs event was lost. The 7d cadence
   is intentional: the backstop is a safety net, not the primary path.

### Key files

| File | Purpose |
|---|---|
| `packages/adapter-antfly/src/search.ts` | `AntflySearchAdapter` implementation: write path, query builder, reranker mapping, index health, transient shard retry |
| `packages/core/src/adapters/search/` | Search adapter contract and testing helper |
| `src/core/search-registry.ts` | `SearchRegistry` singleton, ctx.search provider, multi-index registration, query routing, file-backed helper |
| `src/core/search-reconcile.ts` | Startup mtime-aware reconcile, glob matcher, file walker |
| `src/core/search-cleanup.ts` | Periodic orphan backstop scan (default 7d), configurable interval |
| `src/core/watcher.ts` | Chokidar wrapper, `registerSyncHook` / `registerUnlinkHook` contract |
| `src/core/search-migration.ts` | `SCHEMA_VERSION` constant, state file I/O, migrate-or-noop on boot |
| `src/core/embedder-resolver.ts` | Pure function: resolve `embedderRef: 'default' \| 'visual' \| ...` → concrete provider+model config |
| `packages/core/src/plugin-types.ts` | `SearchAPI`, `SearchContentTypeDefinition`, `SearchIndexDefinition` interfaces |
| `plugins/assets/lib/content-extractor.ts` | Server-side text extraction for PDFs (pdf-parse) and plain text formats |
| `plugins/assets/lib/asset-url.ts` | `buildAssetFileUrl()` — produces `file://` URLs for CLIP's visual index |
| `src/hooks/use-search.ts` | Client-side hook for search queries (`useSearch`, types `SearchResult` / `SearchResponse` / `UseSearchOptions` / `UseSearchReturn`) + `reorderBySearchResults` utility. Plugins import this via `@bakin/sdk/hooks`, which re-exports it under the canonical author surface. |
| `src/core/api-search-handler.ts` | Cross-plugin `/api/search` request handler (extracted from `server.ts` for testability) |

## Table Naming

All Antfly tables use the `bakin_` prefix: `bakin_tasks`, `bakin_assets`, `bakin_projects`, etc.

**Registered tables:** core tables are registered by their owning core plugin. Official external plugins add tables when installed; for example Projects owns `bakin_projects` and Messaging owns `bakin_messaging_brainstorm` plus `bakin_messaging_deliverables`. The **memory** plugin owns `bakin_memory` — a single unified table with a `tier` facet that discriminates across 7 memory tiers (audit, session, turn, checkpoint, daily_note, durable, dream). This replaced the former `bakin_audit` table during the memory-plugin-rebuild (2026-04-18) — the old table was dropped with no shim.

**Multi-index tables:** `bakin_assets` is currently the only table with more than one embedding index — it has `assets_text` (BGE over sidecar metadata + extracted PDF/text content) and `assets_visual` (CLIP over raster image pixels). All other tables use a single default embedding index named `embeddings`.

## SearchContentTypeDefinition

```typescript
interface SearchContentTypeDefinition {
  table: string                              // e.g. 'tasks' — auto-prefixed to 'bakin_tasks'
  schema: Record<string, SearchSchemaField>  // { type: 'text' | 'keyword' | 'number' | 'boolean' | 'datetime' | 'array' }
  searchableFields: string[]                 // fields included in full-text index (x-antfly-include-in-all)

  /** Used when `indexes` is NOT set — the default single-index path. */
  embeddingTemplate: string

  /** Optional: declare multiple vector indexes for this table. Each
   *  entry produces one embedding index in Antfly with its own
   *  embedder (via embedderRef) and its own Handlebars template. */
  indexes?: SearchIndexDefinition[]

  /** Optional: field name the cross-encoder reranker scores against.
   *  Unset → reranker skipped for this content type. Required for
   *  reranker to run — Antfly rejects reranker configs that lack a
   *  field or template. See "Reranker" below. */
  rerankField?: string

  facets?: string[]                          // fields available for facet/aggregation filtering
  ttl?: string                               // Go duration format: '90d', '24h'. Empty to disable.
  ttlField?: string                          // field holding the TTL timestamp (default: 'created_at')
  chunker?: {                                // chunker applied to the synthesized default index
    enabled: boolean
    targetTokens?: number
    overlapTokens?: number
  }
  reindex(): AsyncGenerator<{ key: string; doc: Record<string, unknown> }>
  verifyExists(key: string): Promise<boolean>
}

interface SearchIndexDefinition {
  name: string            // e.g. 'assets_text', 'assets_visual'
  embedderRef: string     // key into settings.search.settings.embedders
  embeddingTemplate: string
  chunker?: { enabled: boolean; targetTokens?: number; overlapTokens?: number }
}
```

**Note:** Non-text field types (`number`, `boolean`, `datetime`, `array`) map to `keyword` in Antfly. They support exact-match filtering and faceting but not range queries or date math.

**Backward compatibility:** Content types that don't set `indexes` get a synthesized single default index named `embeddings` using the top-level `embeddingTemplate` + the default embedder. Every content type registered before multi-index support works unchanged.

## SearchAPI (per plugin)

Exposed on `PluginContext` as `ctx.search`:

```typescript
interface SearchAPI {
  registerContentType(def: SearchContentTypeDefinition): void
  index(key: string, doc: Record<string, unknown>): Promise<void>     // upsert; fire-and-forget safe
  remove(key: string): Promise<void>                                  // delete document
  transform(key: string, ops: SearchTransformOp[]): Promise<void>     // atomic field update, skips re-embed
  query(params: SearchQueryParams): Promise<SearchResponse>
}

interface SearchQueryParams {
  q: string
  filters?: Record<string, string | boolean | number>
  facets?: string[]
  limit?: number
  offset?: number
  /** Per-query reranker disable. Defaults to true (rerank applies)
   *  when the content type has a rerankField set. Pass false to
   *  skip the cross-encoder pass for latency-sensitive calls. */
  rerank?: boolean
  /** Raw Antfly aggregations object. Use for date histograms, range
   *  buckets, stats. Merged with facet-derived aggregations — caller
   *  wins on key collision. Antfly schema docs apply. */
  aggregations?: Record<string, unknown>
}

interface SearchResponse {
  results: SearchResult[]
  aggregations?: Record<string, Array<{ value: string; count: number }>>  // facet term buckets
  rawAggregations?: Record<string, unknown>                                // Antfly's raw response (date_histogram etc.)
  meta: { query: string; total: number; took_ms: number; source: 'search' | 'fallback' }
}
```

`transform()` is for metadata-only updates (e.g. status change) where re-generating embeddings would be wasteful. Each op is `{ op: '$set' | '$inc' | '$push', field: string, value: unknown }`.

## Hybrid Search

Queries combine full-text (BM25) and semantic (vector) results via Reciprocal Rank Fusion (RRF). Strategy is configurable per query and globally:

| Strategy | Behavior |
|---|---|
| `rrf` (default) | Merge BM25 + semantic results via RRF |
| `semantic_only` | Vector similarity only |
| `full_text_only` | BM25 only, no embeddings required |

Global default: `settings.search.settings.search.strategy`.

> **Upstream limitation (v0.2.0-rc.2):** the `_all` field — the default target for bare-term full-text queries — is never populated in swarm mode ([#456](https://github.com/markhayden/bakin/issues/456); root cause is `_all` population, not term extraction: **field-qualified** queries like `title:foo` work fine, and `term_count: 0` is a separate cosmetic stats gap). Bare-term FTS returns nothing, so `rrf` rides the semantic leg and `full_text_only` is effectively empty. Bakin keeps sending the bare `full_text_search` leg; when upstream fixes `_all` population a reindex will likely be needed to backfill it. Potential interim follow-up: field-qualify the FTS leg across each content type's `searchableFields` to restore exact-token matching today.

**v0.2 protocol notes:** there is no strategy field on the wire — Bakin's strategy setting maps to which fields are populated (`semantic_search`, `full_text_search`, or both; RRF is implied when both are present). The vector `indexes` array is only sent alongside `semantic_search`. Tables are created **without a `schema`** (a create-time schema permanently breaks query parsing at this RC) and without a full-text index entry (the server always creates its own `full_text_index_v0`). Dense embeddings indexes carry an explicit `dimension`. `multiQuery` fans out as sequential single global queries — the NDJSON multiquery endpoint rejects its own framing, and request concurrency aggravates inference crashes.

**Per-table index routing:** when a table has multiple embedding indexes declared via `def.indexes`, the registry's `getIndexNames(tableName)` resolves the effective index list (e.g. `['assets_text', 'assets_visual']`) and passes it to `antfly.queryTable()`. The client sends the array in `QueryRequest.indexes`, and Antfly runs semantic search across all of them — results from each index are merged into the final RRF ranking with a per-index score breakdown in `_index_scores`.

**Implementation detail:** In Antfly query requests, `full_text_search` implicitly uses the full-text index. The `indexes` array should only list embedding indexes. Including the full-text index name alongside `full_text_search` causes errors.

The BM25 index key in `_index_scores` is a full filesystem path (e.g. `/path/to/full_text_index_v0`) — the short name isn't used. Semantic keys are the ones declared in the content type's `indexes[]` (or `embeddings` for the legacy single-index path).

### Reranker

> **Disabled by default at v0.2.0-rc.2:** invoking the mxbai reranker SIGABRTs the antfly server on both the Metal and ONNX inference backends ([#456](https://github.com/markhayden/bakin/issues/456)). All plumbing below stays wired — re-enable with one settings flip (`search.reranker.enabled: true`) once upstream stabilizes.

Optional cross-encoder reranking after initial retrieval. Configured globally via `settings.search.settings.search.reranker` (provider, model, enabled flag — the v0.2 RerankerConfig has no `threshold`), and **opted into per content type** via `SearchContentTypeDefinition.rerankField`.

**How rerank attachment works:**
- The registry looks up `rerankField` for the queried table via `getRerankField(tableName)`
- `buildRerankerConfig()` in `packages/adapter-antfly/src/query-translation.ts` only attaches a reranker to the `QueryRequest` when **all three** are true: global `enabled: true`, per-query `rerank !== false`, and `rerankField` is set on the content type
- Tables that don't set `rerankField` get pure RRF hybrid fusion (Bleve full-text + semantic embeddings), no cross-encoder pass
- Antfly rejects reranker configs that don't include `field` or `template` with a 400, so a missing `rerankField` MUST translate to "no reranker" — not "reranker without field"

**Structural limitation of `rerankField`:** the cross-encoder reranker scores a query against the value of a **single document field**. It never sees the embedding, the full-text index, or any other field. This is fine for single-modality text tables but creates inversions on multi-modality tables where different modalities live in different fields.

**Per-plugin choices (current):**

| Table | rerankField | Reason |
|---|---|---|
| `bakin_tasks` | `description` | Richest text field in the schema |
| `bakin_projects` | `body` | Main document content |
| `bakin_workflows` | `description` | Workflow purpose text |
| `bakin_schedule` | `command` | The thing you actually search for |
| `bakin_team` | `soul` | Agent persona text |
| `bakin_memory` | `content` | Memory observability body — full text across 7 tiers (audit, session, turn, checkpoint, daily_note, durable, dream), owned by **memory** plugin |
| `bakin_messaging_brainstorm` | `message_body` | Brainstorm session messages (owned by **messaging** plugin) |
| `bakin_messaging_deliverables` | `brief`, `draft_caption` | Planned and quick-post deliverables (owned by **messaging** plugin) |
| **`bakin_assets`** | **(unset)** | **Intentionally skipped — see below** |

**Why `bakin_assets` skips the reranker**

The assets table mixes modalities: PDF body text goes into `content` (extracted server-side), image data goes through the `assets_visual` index (CLIP embeddings of pixel data), and metadata lives in `description`/`tags`/`file_name`. No single field captures a doc's full semantic signal. During T6 manual smoke testing we observed consistent inversions — a query for `"tzatziki"` (a term in a PDF body) found the PDF via full-text on `content`, but the reranker scoring `"tzatziki"` against `description` rated an unrelated image higher because the cross-encoder happened to score the image description well against arbitrary queries.

The fix was a one-line deletion: remove `rerankField` from the assets plugin registration. Multimodal tables get **raw RRF fusion** of Bleve + text embeddings + visual embeddings, and the cross-encoder pass is skipped entirely. Single-modality tables keep their reranker because it materially improves their ranking.

The underlying issue is the single-field limitation of Antfly's reranker API. A future fix could pass a `template` instead of a `field` (e.g. `{{description}} {{content}}` so the cross-encoder sees both metadata and extracted body), or wait for Antfly to support multi-field reranking. Revisit when either path becomes viable.

## Embedders

Bakin's text and visual embeddings use different models. Both run locally via antfly's embedded inference runtime — no cloud dependency by default.

### Current models

| Purpose | ref name | Provider | Model | Dims | Stored path |
|---|---|---|---|---|---|
| Default text | `default` | antfly | `BAAI/bge-small-en-v1.5` | 384 | `~/.antfly/inference/models/BAAI/bge-small-en-v1.5` |
| Visual / multimodal | `visual` | antfly | `Xenova/clip-vit-base-patch32` | 512 | `~/.antfly/inference/models/Xenova/clip-vit-base-patch32` |

Plus `mixedbread-ai/mxbai-rerank-base-v1` for the (currently disabled) reranker. Models are pulled from HuggingFace via `antfly inference pull <owner/name>` (`bakin install search-models`). The CLIP ref is the **Xenova ONNX mirror** — the upstream `openai/` HF repo ships no ONNX exports and cannot be pulled ([#456](https://github.com/markhayden/bakin/issues/456)).

**Prefetch matters:** at v0.2.0-rc.2 index-time embedding does NOT lazy-download a missing model — the embeddings backfill fails with `ModelNotFound`. Recovery is cheap: once the model is on disk, **any write to the table heals the index** (previously-failed docs get embedded too). If models were missing while content was indexed: `bakin install search-models` then `bakin reindex`.

**`dimension` is required** on every embedder entry: the v0.2 server demands declared dims for dense embeddings indexes at table-create time (no auto-probe at this RC). Dims feed the embedder rebuild hash, so changing them triggers an index rebuild.

**BGE over MiniLM:** The default text embedder was upgraded from Antfly's builtin `all-MiniLM-L6-v2` to BGE in T7. BGE is measurably stronger on retrieval tasks, especially for longer documents with diverse vocabulary — task descriptions, markdown notes, PDF bodies, audit trails. Runs locally, no cost beyond disk (~130MB).

**Model names MUST be the qualified HuggingFace-style names** (e.g. `BAAI/bge-small-en-v1.5`, not just `bge-small-en-v1.5`) — they map directly to the `{owner}/{name}` directory layout under the inference models root.

### Per-index embedder selection

Each `SearchIndexDefinition` declares an `embedderRef` string. The registry's table-creation path passes the ref to `resolveEmbedder()` which looks it up in `settings.search.settings.embedders` and returns the concrete `{ provider, model }` config. Add a new provider by:

1. Adding a named entry to `settings.search.settings.embedders` (e.g. `highres: { provider: 'vertex', model: 'multimodalembedding@001' }`)
2. Adding adapter/provider support in `packages/adapter-antfly/src/search.ts` if Antfly's built-in provider support is not enough
3. Referencing the new name from a content type's `indexes[].embedderRef`

No plugin code changes needed. The `visual` ref is only consumed by `bakin_assets.assets_visual` today; every other table uses `default`.

## Content Extraction (Server-Side)

For PDFs and plain-text file formats (`.md`, `.txt`, `.json`, `.csv`, `.yaml`, `.rtf`, `.xml`, `.tsv`), Bakin extracts the body text **before** sending the document to Antfly for indexing. The extracted text lives in a `content` field on the search doc, and the `assets_text` embedding template references `{{content}}` directly.

### Why server-side instead of Antfly helpers

Antfly ships `{{remotePDF url=...}}` and `{{remoteText url=...}}` template helpers that fetch and extract content at enrichment time. On paper those would be cleaner than wiring fs I/O into Bakin. In practice:

1. **PDF extraction is broken upstream.** Antfly's Go PDF library (`ajroetker/pdf`, a fork of `rsc.io/pdf`) silently fails on any PDF with complex font subsetting, CID fonts, or matrix-positioned text — which is every design-tool PDF. See Bakin issue #72 for the full trace.
2. **Loopback fetch is blocked.** Antfly's scraping layer hardcodes a private-IP block (#72 again), so `file://` URLs are the only local path that works — and `{{remoteText}}` via `file://` still routes through the broken fetch resolver.
3. **Node has better tools.** `pdf-parse` uses the same `pdfjs-dist` engine Firefox ships. It handles the font edge cases Antfly's Go library can't.

The server-side approach also means extracted content is stored as a first-class document field that shows up in Bleve full-text hits. Antfly's `{{remotePDF}}` output goes into the embedding but not the full-text index, so you can't keyword-search for terms inside a PDF via Antfly's helpers even when they work.

### Supported formats

`plugins/assets/lib/content-extractor.ts` `extractAssetContent(absPath, filename)` routes on extension:

| Extension | Path | Notes |
|---|---|---|
| `.md`, `.txt`, `.rtf` | `fs.readFileSync` | Zero deps, plain text |
| `.json`, `.csv`, `.tsv`, `.xml` | `fs.readFileSync` | Read as UTF-8, not parsed |
| `.yaml`, `.yml` | `fs.readFileSync` | Same |
| `.pdf` | `pdf-parse` (lazy-imported) | pdfjs engine, handles complex PDFs |
| (anything else) | `''` | Returns empty string |

Extraction is capped at **50K chars** with a word-boundary-safe truncate. Large PDFs are capped at **100 pages** via `pdf-parse`'s `last` option. Errors return an empty string and log a warning — never throw — so a malformed file doesn't block indexing.

### How it reaches the embedding

The assets plugin's `assetToSearchDoc()` reads the asset file (via the content dir + relative path), calls `extractAssetContent()`, and populates the resulting string on a `content` schema field:

```typescript
schema: {
  description: { type: 'text' },
  tags:        { type: 'text' },
  file_name:   { type: 'text' },
  content:     { type: 'text' },  // ← extracted body
  image_url:   { type: 'keyword' }, // ← file:// for raster images only
  // ...
}

indexes: [
  {
    name: 'assets_text',
    embedderRef: 'default',
    embeddingTemplate: '{{description}} {{tags}} {{file_name}} {{content}}',
    chunker: { enabled: true, targetTokens: 200, overlapTokens: 25 },
  },
  {
    name: 'assets_visual',
    embedderRef: 'visual',
    embeddingTemplate: '{{#if image_url}}{{remoteMedia url=image_url}}{{/if}}',
  },
]
```

The text index embeds `description + tags + filename + content` — sidecar metadata concatenated with the extracted body. The visual index only runs when `image_url` is populated (raster formats that CLIP can decode). SVG and ICO are excluded — Antfly's image processor uses Go's stdlib image library which can't handle vector or indexed-palette formats.

## Visual Indexing (CLIP via the inference runtime)

For raster images, the `assets_visual` index uses CLIP via antfly's embedded inference runtime. The path is Antfly's `{{remoteMedia url=image_url}}` helper pointing at a `file://` URL.

**Why `file://` and not `http://`:** Antfly's `DownloadContent` dispatches on URL scheme. For `http://`, it runs `validateURLSecurity` which hardcodes a private-IP block (see #72). For `file://`, it calls `validatePathSecurity` which is a no-op unless `AllowedPaths` is configured. So `file://` bypasses the broken SSRF defense entirely. Since Antfly runs as the same user as Bakin on the same host, local filesystem access is already permitted — the security layer is the OS user boundary, not the URL scheme.

`plugins/assets/lib/asset-url.ts` `buildAssetFileUrl(relPath)` builds the URL — takes a relative path under the assets root, resolves to an absolute path, percent-encodes path segments, returns `file://<abs>`. The encoding step is important: filenames with spaces or special characters round-trip correctly through Antfly's URL parser.

**Format filtering:** only `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp` get `image_url`. Vector and indexed-palette formats (`.svg`, `.ico`) are excluded because CLIP needs raster pixel data and Antfly's image processor can't decode them anyway.

## Schema Migration

`src/core/search-migration.ts` owns a `SCHEMA_VERSION` constant (currently `5`) and a state file at `~/.bakin/.search-state.json` with `{ version: N }`. On every boot, after `antfly.initialize()` connects:

1. Read the stored version (or `0` if the file doesn't exist — fresh install)
2. If stored < `SCHEMA_VERSION`, drop every `bakin_*` table via `antfly.dropTable()` and write the new version
3. Plugins have already called `registerContentType()` earlier in the boot sequence, so when `createRegisteredTables()` runs next, it recreates all tables with the current schema
4. If migration ran, the server triggers a background reindex via `reindexContentTypes()` to populate the fresh tables from source — fire-and-forget, Bakin is usable immediately with empty tables, indexing completes in the background

### When to bump `SCHEMA_VERSION`

Bump when a change requires an existing table to be dropped and recreated with new schema, indexes, or embedder config. Examples:

- Added or removed a schema field (rename counts as remove + add)
- Changed the default embedder's provider or model
- Added or removed an entry in a content type's `indexes[]`
- Changed a content type's `embeddingTemplate` in a way that affects chunking
- Changed chunker config

Pure data additions (no schema change, no embedder change) do **not** need a bump — those flow through the existing `/api/reindex` endpoint without dropping tables.

### Version history

- **1** — initial schema. Single `embeddings` index per table. Global `all-MiniLM-L6-v2` embedder via Antfly's builtin provider.
- **2** — multi-index support. `bakin_assets` gains `assets_text` + `assets_visual`. `content` field populated server-side. Default embedder swapped to `BAAI/bge-small-en-v1.5`.
- **3** — `bakin_assets` gains `tags_facet` + generation provenance fields; assets embedding template adds `{{surface}}`.
- **4** — antfly v0.2 migration: embeddings indexes carry explicit `dimension`; provider naming `termite` → `antfly`.
- **5** — drop create-time `schema` (breaks all queries on the table at v0.2.0-rc.2, [#456](https://github.com/markhayden/bakin/issues/456)); visual embedder moved to the Xenova ONNX mirror.

## Retry on Transient Shard Errors

Antfly's `createTable` returns as soon as table metadata is written, but the shards backing the table spin up **asynchronously** via Antfly's reconciler (typically 300–1500ms later). Writes that land before the shards are ready fail with one of:

- `shard {hex} not found on store 1`
- `shard is still initializing`
- `Failed to forward batches: ... shard is still initializing`

`retryTransientBatch()` in `packages/adapter-antfly/src/search.ts` wraps every batch write (`indexDocument`, `removeDocument`, `transformDocument`, `batchIndex`, `batchRemove`) with exponential backoff on those specific error messages:

- **5 retries max** — ~3.1 seconds total (100ms → 200ms → 400ms → 800ms → 1600ms)
- **Transient only** — non-matching errors bubble through on the first attempt
- **After the last retry** — the original error is rethrown and the caller's `try` logs it as "Antfly batch index failed"

The migration path is the common trigger — 7 tables recreated, reindex fires immediately, first batches hit the race, retries absorb it, subsequent attempts succeed. The reindex counter uses the actual return value from `batchIndex` (0 on failure, real insertion count on success) so the reported `total` reflects reality.

## Chunking

Long documents are split before embedding. Configured per content type via `chunker: { enabled, targetTokens, overlapTokens }`. Defaults from settings:

```
settings.search.settings.chunking.defaultTargetTokens   — target tokens per chunk (default 200)
settings.search.settings.chunking.defaultOverlapTokens  — overlap between chunks (default 25)
```

If a content type has no `chunker` (or `chunker.enabled` is false), the `embeddingTemplate` output is embedded whole. For tables with `indexes[]`, each index's chunker config is applied independently — `assets_text` chunks at 200/25, `assets_visual` does not chunk (image embeddings are whole-doc).

## Orphan Cleanup (Backstop Scan)

`src/core/search-cleanup.ts` runs a periodic backstop scan. Since the
watcher unlink hook (path 2 in "Three consistency paths" above) handles
the vast majority of deletes within ~300ms, this scan is no longer the
primary mechanism — it's a safety net for the rare cases where the
process was down during a delete or the fs event was lost.

1. For each registered content type, list all indexed document keys from Antfly
2. Call `def.verifyExists(key)` for each key (checks source: filesystem, task store, runtime adapter, etc.)
3. Remove any document whose source no longer exists

Interval controlled by `settings.search.settings.cleanupInterval` (Go duration string,
default `'7d'`). Backstop scan does not run if Antfly is disabled. The
default was demoted from 24h → 7d in the issue #73 PR because the watcher
unlink hook now does the immediate work.

## Reindexing

`reindexContentTypes()` in `search-registry.ts` iterates all registered content types and runs their `reindex()` generators. Documents are batch-indexed (50 per batch) via `antfly.batchIndex()`, which applies the retry-on-transient-error wrapper.

SSE events broadcast during reindex:
- `reindex.batch_start` — once at the start of the whole run, with the table list
- `reindex.start` — emitted when each table begins
- `reindex.progress` — emitted after each 50-doc batch *and* after the trailing partial batch (so tables with `< BATCH_SIZE` documents always emit at least one progress tick)
- `reindex.complete` — emitted when each table finishes (carries `indexed` count and any `error`)
- `reindex.batch_pulse` — coarse heartbeat for the whole run, useful for keeping a UI spinner alive
- `reindex.batch_complete` — once at the end of the whole run

The health page consumes these via the global SSE connection — it subscribes with `usePluginEvent('reindex.start'|'reindex.progress'|'reindex.complete', …)` (the shell fans the per-table reindex frames out from its singleton connection) and keeps the per-card live counts in local component state, so per-card live counts work without opening a second `EventSource`.

**Counter accuracy:** `count += await antfly.batchIndex(...)` — the actual inserted count from Antfly's response, not the batch size. If a batch fails after retries, `batchIndex` returns 0 and the counter doesn't advance for that batch, so the reported `indexed: N` matches what's actually in the table.

## Enrichment Observability (#74)

Antfly's enrichment (chunking, embedding, indexing) is **async** — documents land in the WAL before enrichment completes. The reindex pipeline previously only reported whether Antfly accepted the batch, not whether enrichment succeeded. Four layers close this gap:

### Post-batch enrichment audit (Layer 1)

After all batches complete for each table, `reindexContentTypes()` calls `antfly.getIndexHealth(tableName)` which wraps the SDK's `client.indexes.list()`. This returns per-index stats including:

- `error` — enrichment error (e.g. "embedder model not found") → logged as ERROR
- `wal_backlog` — docs pending enrichment → logged as WARN
- `rebuilding` / `backfill_progress` — active rebuild status → logged as INFO

The audit is best-effort: it never fails the reindex pipeline. If `getIndexHealth()` throws, the error is caught and logged.

### Enriched reindex response (Layer 2)

`reindexContentTypes()` returns `ReindexTableResult[]` which includes an optional `enrichment` field:

```typescript
interface ReindexTableResult {
  table: string
  pluginId: string
  indexed: number           // docs Antfly accepted
  error?: string            // batch-level error
  enrichment?: IndexHealth  // per-index enrichment status
  verified?: number         // docs actually findable (verify mode only)
  verifyDiscrepancy?: number // indexed - verified (verify mode only)
}
```

The `/api/reindex` HTTP response includes `enrichmentErrors` (count of tables where enrichment is unhealthy) alongside the existing `errors` count. The `ok` flag is `false` when either count is non-zero.

### Verify mode (Layer 3)

`POST /api/reindex?verify=true` adds a post-reindex verification pass. After all batches for a table complete, it calls `getTableStats()` to get the actual doc count in the table and compares against the `indexed` count. If they diverge, it logs the discrepancy as an error and includes `verified` and `verifyDiscrepancy` in the result.

This is opt-in because it adds one query per table. Intended for smoke tests and CI, not routine reindexes.

### Health endpoint enrichment status (Layer 4)

`GET /api/plugins/health/antfly-status` (the health plugin owns this route post-issue-#67 — formerly `/api/antfly/health` in `server.ts`) includes `indexHealth` (array of per-index status) and `healthy` (aggregate boolean) for each table. The health page shows visual indicators:

- Green `CircleCheck` — all indexes healthy
- Amber `Clock` — WAL backlog (enrichment in progress)
- Red `AlertCircle` — enrichment error, tooltip shows the message

### Key types

The foundation shape is the adapter index health result from `packages/adapter-antfly/src/search.ts`:

```typescript
interface IndexHealthEntry {
  name: string           // e.g. 'embeddings', 'assets_text'
  type: string           // 'full_text' | 'embeddings'
  totalIndexed: number   // docs in the index
  walBacklog: number     // docs pending enrichment
  error?: string         // enrichment error message
  rebuilding: boolean    // active rebuild
  backfillProgress?: number // 0.0 to 1.0
}

interface IndexHealth {
  indexes: IndexHealthEntry[]
  healthy: boolean       // true when no errors and no WAL backlog
}
```

These map directly from the Antfly SDK's `IndexStatus.status` fields (`EmbeddingsIndexStats` and `FullTextIndexStats`).

## Client-side Search Pattern

All plugin pages follow the same pattern for search:

1. Use `useSearch({ plugin })` hook for queries — when `plugin` is set,
   the hook fetches `/api/plugins/{plugin}/search?q=...` (the
   auto-registered per-plugin route). When `plugin` is omitted it falls
   back to the cross-plugin `/api/search?q=...` endpoint backed by
   `src/core/api-search-handler.ts`.
2. **Search results are the primary filter** — when results exist, filter the local list to matching IDs
3. **Keyword is the fallback** — only used when search returns no results
4. **Skip manual sort when search is active** — search returns results in relevance order (RRF score). Any post-hoc sort (by date, name, etc.) destroys relevance. Always check `if (search && results.length)` before applying manual sorts.

`reorderBySearchResults<T>()` from `src/hooks/use-search.ts` is a utility that sorts a local array by relevance score order.

The hook exports the `SearchResult`, `SearchResponse`, `UseSearchOptions`, and `UseSearchReturn` types — there are no `Antfly`-prefixed aliases.

## Settings Reference

All under `settings.search.settings`:

| Key | Type | Purpose |
|---|---|---|
| `enabled` | `boolean` | Enable/disable Antfly integration |
| `url` | `string` | Antfly base URL, **no path suffix** (default `http://127.0.0.1:3738` — Bakin's private instance; the SDK owns the `/db/v1` prefix). A non-default URL = externally managed server (guest mode). |
| `auth` | `object?` | Optional basic auth `{ username }` — the password lives in the secret store (`providers.antfly` in `~/.bakin/secrets.json`; env `ANTFLY_PASSWORD` overrides) and is injected into `auth.password` at adapter init by `createAppServices`, never stored or served from settings.json |
| `search.strategy` | `string` | Default search strategy (`rrf` \| `semantic_only` \| `full_text_only`) |
| `search.defaultLimit` | `number` | Default result count |
| `search.reranker.enabled` | `boolean` | Master switch for cross-encoder reranking. **Default `false`** — reranking crashes the server at v0.2.0-rc.2 ([#456](https://github.com/markhayden/bakin/issues/456)) |
| `search.reranker.provider` | `string` | Reranker provider (`antfly`) |
| `search.reranker.model` | `string` | Qualified model name (e.g. `mixedbread-ai/mxbai-rerank-base-v1`) |
| `embedders.default.provider` | `string` | Text embedder provider (`antfly`) |
| `embedders.default.model` | `string` | Text embedder model (`BAAI/bge-small-en-v1.5`) |
| `embedders.default.dimension` | `number` | Embedding dims (`384`) — required by the v0.2 server for dense indexes |
| `embedders.visual.provider` | `string` | Visual embedder provider (`antfly`) |
| `embedders.visual.model` | `string` | Visual embedder model (`Xenova/clip-vit-base-patch32`) |
| `embedders.visual.dimension` | `number` | Embedding dims (`512`) |
| `embedders.<custom>` | `object?` | Additional named embedders referenced by `embedderRef` |
| `embedder` | `object?` | **Deprecated.** Legacy single-embedder shape. Migrated to `embedders.default` on load. |
| `chunking.defaultTargetTokens` | `number` | Default chunk target size |
| `chunking.defaultOverlapTokens` | `number` | Default chunk overlap |
| `auditTtl` | `string` | TTL for audit entries (Go duration: `'90d'`) |
| `cleanupInterval` | `string` | Orphan backstop scan interval (Go duration: `'7d'`) |

**Override hygiene:** code that persists settings must write **minimal partials** via `updateSettings()` — never the merged settings object. Persisting merged settings freezes every then-current default into `settings.json` as explicit overrides, silently pinning the install to stale defaults (this bit us during the v0.2 migration).

## Related docs

- `.claude/knowledge/multimodal-search.md` — multimodal architecture, PDF/text extraction, CLIP visual path, how to add a new modality
- `.claude/knowledge/search-api-reference.md` — REST/MCP surface for agent-facing search
- [Bakin issue #456](https://github.com/markhayden/bakin/issues/456) — antfly v0.2.0-rc.2 upstream bugs (schema-at-create breaks queries, FTS dead in swarm, no index-time lazy model download, NDJSON multiquery broken, inference crashes) with workarounds + revisit checklist
- [Bakin issue #72](https://github.com/markhayden/bakin/issues/72) — Antfly v0.1-era upstream bugs documented during T6 (dead `content_security` config, broken PDF library, no loopback HTTP path)
