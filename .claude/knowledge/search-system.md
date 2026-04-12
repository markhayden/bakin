# Search System — Deep Reference

## Overview

Antfly is the vector database backing all search in Bakin — UI search and agent queries. It is **optional**: Bakin runs fully without it. When `settings.antfly.enabled` is `false` (or Antfly is unreachable), search silently degrades — indexing calls are no-ops, queries return empty results.

## Architecture

```
Plugin activate()
  → ctx.search.registerContentType(def)
  → SearchRegistry stores definition (globalThis-backed)

Mutation (create/update)
  → ctx.search.index(key, doc)
  → AntflyClient upserts into bakin_{contentType} table

Deletion
  → plugin calls ctx.search.remove(key)
  → AntflyClient deletes document

Periodic cleanup timer
  → SearchCleanup scans all registered content types
  → Calls def.verifyExists() per document
  → Removes orphans from Antfly

Query
  → ctx.search.query(params)
  → AntflyClient hybrid search (BM25 + embeddings via RRF)
  → Returns ranked results
```

### Key files

| File | Purpose |
|------|---------|
| `src/core/antfly.ts` | `AntflyClient` from `@antfly/sdk` — SDK wrapper, connection, settings |
| `src/core/search-registry.ts` | `SearchRegistry` singleton, ctx.search provider, globalThis-backed |
| `src/core/search-cleanup.ts` | Periodic orphan scan, configurable interval |
| `packages/core/src/plugin-types.ts` | `SearchAPI`, `SearchContentTypeDefinition` interfaces |
| `src/hooks/use-antfly-search.ts` | Client-side hook for search queries + `reorderByAntflyResults` utility |

## Table Naming

All Antfly tables use the `bakin_` prefix: `bakin_tasks`, `bakin_assets`, `bakin_projects`, etc.

**Registered tables:** tasks, audit, assets, projects, workflows, schedule, team (7 total). Audit is registered in `server.ts` (not a plugin); the other 6 are registered by their respective plugins.

**Legacy cleanup:** On startup, any `beacon_*` tables are wiped automatically. The `beacon_` prefix is from a prior naming scheme — it is retired.

## SearchContentTypeDefinition

```typescript
interface SearchContentTypeDefinition {
  table: string                                    // e.g. 'tasks' — auto-prefixed to 'bakin_tasks'
  schema: Record<string, SearchSchemaField>        // { type: 'text' | 'keyword' | 'number' | 'boolean' | 'datetime' | 'array' }
  searchableFields: string[]                       // fields included in full-text index (x-antfly-include-in-all)
  embeddingTemplate: string                        // Handlebars template for vector embedding, e.g. '{{title}} {{description}}'
  facets?: string[]                                // fields available for facet/aggregation filtering
  ttl?: string                                     // Go duration format: '90d', '24h'. Empty to disable.
  ttlField?: string                                // field holding the TTL timestamp (default: 'created_at')
  chunker?: {                                      // chunking config for long documents
    enabled: boolean
    targetTokens?: number                          // default from settings.antfly.chunking.defaultTargetTokens
    overlapTokens?: number                         // default from settings.antfly.chunking.defaultOverlapTokens
  }
  reindex(): AsyncGenerator<{ key: string; doc: Record<string, unknown> }>  // full reindex source
  verifyExists(key: string): Promise<boolean>      // orphan check — does source still exist?
}
```

**Note:** All non-text field types (`number`, `boolean`, `datetime`, `array`) map to `keyword` in Antfly. They support exact-match filtering and faceting but not range queries or date math.

Registered by plugins during `activate()` via `ctx.search.registerContentType(def)`.

## SearchAPI (per plugin)

Exposed on `PluginContext` as `ctx.search`:

```typescript
interface SearchAPI {
  registerContentType(def: SearchContentTypeDefinition): void
  index(key: string, doc: Record<string, unknown>): Promise<void>   // upsert; fire-and-forget safe
  remove(key: string): Promise<void>                                // delete document
  transform(key: string, ops: SearchTransformOp[]): Promise<void>   // atomic field update, skips re-embed
  query(params: SearchQueryParams): Promise<SearchResponse>
}
```

`transform()` is for metadata-only updates (e.g. status change) where re-generating embeddings would be wasteful. Each op is `{ op: '$set' | '$inc' | '$push', field: string, value: unknown }`.

## Hybrid Search

Queries combine full-text (BM25) and semantic (vector) results via Reciprocal Rank Fusion (RRF). Strategy is configurable per query and globally:

| Strategy | Behavior |
|----------|----------|
| `rrf` (default) | Merge BM25 + semantic results via RRF |
| `semantic_only` | Vector similarity only |
| `full_text_only` | BM25 only, no embeddings required |

Global default: `settings.antfly.search.strategy`.

**Important implementation detail:** In Antfly query requests, `full_text_search` implicitly uses the full-text index. The `indexes` array should only list embedding indexes (e.g., `['embeddings']`). Including the full-text index name in `indexes` alongside `full_text_search` causes errors.

The BM25 index key in `_index_scores` is a full filesystem path (e.g. `/path/to/full_text_index_v0`), not the short name `'search'`. The semantic key is `'embeddings'`.

### Reranker

Optional cross-encoder reranking after initial retrieval. Configured globally via `settings.antfly.search.reranker` (provider, model, threshold, enabled flag), and **opted into per content type** via `SearchContentTypeDefinition.rerankField`.

**How rerank attachment works:**
- The registry looks up `rerankField` for the queried table via `getRerankField(tableName)`
- `buildRerankerConfig()` in `src/core/antfly.ts` only attaches a reranker to the `QueryRequest` when **all three** are true: global `enabled: true`, per-query `rerank !== false`, and `rerankField` is set on the content type
- Tables that don't set `rerankField` get pure RRF hybrid fusion (Bleve full-text + semantic embeddings), no cross-encoder pass
- Antfly rejects reranker configs that don't include `field` or `template` with a 400, so a missing `rerankField` MUST translate to "no reranker" — not "reranker without field"

**Structural limitation of `rerankField`:** the cross-encoder reranker scores a query against the value of a **single document field**. It never sees the embedding, the full-text index, or any other field. This is fine for single-modality text tables (the reranker's description/body field contains the text that would match the query) but creates inversions on multi-modality tables where different modalities live in different fields.

**Per-plugin choices (current):**

| Table | rerankField | Reason |
|---|---|---|
| `bakin_tasks` | `description` | Richest text field in the schema |
| `bakin_projects` | `body` | Main document content |
| `bakin_workflows` | `description` | Workflow purpose text |
| `bakin_schedule` | `command` | The thing you actually search for |
| `bakin_team` | `soul` | Agent persona text |
| `bakin_audit` | `content` | Audit log entry body |
| **`bakin_assets`** | **(unset)** | **Intentionally skipped — see below** |

**Why `bakin_assets` skips the reranker**

The assets table mixes modalities: PDF body text goes into `content` (extracted server-side), image data goes through the `assets_visual` index (CLIP embeddings of pixel data), and metadata lives in `description`/`tags`/`file_name`. No single field captures a doc's full semantic signal. During T6 manual smoke testing we observed consistent inversions:

- A query for `"tzatziki"` (a term in a PDF body) was correctly found by Bleve full-text on the `content` field, giving the PDF a strong raw hit. But the reranker, scoring `"tzatziki"` against each doc's `description` field only, rated an unrelated image's description ("Outdoor scene test image for CLIP visual search smoke test") higher than the PDF's description ("Recipe PDF — manual smoke test for multimodal search") because the cross-encoder happens to score the image description well against arbitrary queries. The PDF fell from rank 1 (pre-rerank) to rank 2-3.
- Similar inversions on `"autolyse"` (markdown body term) — the markdown doc fell to rank 4 despite a 0.5 Bleve hit.
- CLIP visual queries like `"pumpkin"` worked correctly (image at rank 1) because the reranker happened to score that query well against the image's description too, but this is coincidence, not signal.

The fix was a one-line deletion: remove `rerankField` from the assets plugin registration. Multimodal tables get **raw RRF fusion** of Bleve + text embeddings + visual embeddings, and the cross-encoder pass is skipped entirely. Single-modality tables keep their reranker because it materially improves their ranking.

The underlying issue is the single-field limitation of Antfly's reranker API. A future fix could pass a `template` instead of a `field` (e.g. `{{description}} {{content}}` so the cross-encoder sees both metadata and extracted body), or wait for Antfly to support multi-field reranking. Revisit when either path becomes viable.

## Embedder

Antfly's built-in embedder runs locally: `all-MiniLM-L6-v2` by default. Configurable via:

```
settings.antfly.embedder.provider   — 'built-in' | 'openai' | 'custom'
settings.antfly.embedder.model      — model identifier
```

## Chunking

Long documents are split before embedding. Configured per content type via `chunker: { enabled, targetTokens, overlapTokens }`. Defaults from settings:

```
settings.antfly.chunking.defaultTargetTokens   — target tokens per chunk
settings.antfly.chunking.defaultOverlapTokens  — overlap between chunks
```

If a content type has no `chunker` (or `chunker.enabled` is false), the `embeddingTemplate` output is embedded whole.

## Orphan Cleanup

`src/core/search-cleanup.ts` runs a periodic scan:

1. For each registered content type, list all indexed document keys from Antfly
2. Call `def.verifyExists(key)` for each key (checks source: filesystem, SQLite, etc.)
3. Remove any document whose source no longer exists

Interval controlled by `settings.antfly.cleanupInterval` (Go duration string, e.g. `'24h'`). Cleanup does not run if Antfly is disabled.

## Reindexing

`reindexContentTypes()` in `search-registry.ts` iterates all registered content types and runs their `reindex()` generators. Documents are batch-indexed (50 per batch).

SSE events broadcast during reindex:
- `reindex.start` — emitted when each table begins
- `reindex.progress` — emitted after each 50-doc batch (for health page live counts)
- `reindex.complete` — emitted when each table finishes

The health page opens an EventSource before the POST to `/api/reindex` to avoid missing events from fast tables.

## Client-side Search Pattern

All plugin pages follow the same pattern for search:

1. Use `useAntflySearch({ table })` hook for queries
2. **Antfly results are the primary filter** — when results exist, filter the local list to matching IDs
3. **Keyword is the fallback** — only used when Antfly returns no results
4. **Skip manual sort when Antfly is active** — Antfly returns results in relevance order (RRF score). Any post-hoc sort (by date, name, etc.) destroys relevance. Always check `if (search && antfly.results.length)` before applying manual sorts.

`reorderByAntflyResults<T>()` from `use-antfly-search.ts` is a utility that sorts a local array by Antfly score order.

## Settings Reference

All under `settings.antfly`:

| Key | Type | Purpose |
|-----|------|---------|
| `enabled` | `boolean` | Enable/disable Antfly integration |
| `url` | `string` | Antfly server URL |
| `auth` | `string` | Auth token / credentials |
| `search.strategy` | `string` | Default search strategy (`rrf` \| `semantic_only` \| `full_text_only`) |
| `search.defaultLimit` | `number` | Default result count |
| `search.reranker` | `object?` | Optional reranker config |
| `embedder.provider` | `string` | Embedding provider |
| `embedder.model` | `string` | Embedding model |
| `chunking.defaultTargetTokens` | `number` | Default chunk target size |
| `chunking.defaultOverlapTokens` | `number` | Default chunk overlap |
| `auditTtl` | `string` | TTL for audit entries (Go duration: `'90d'`) |
| `cleanupInterval` | `string` | Orphan cleanup interval (Go duration: `'24h'`) |
