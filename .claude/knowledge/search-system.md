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

Optional cross-encoder reranking after initial retrieval. Configured via `settings.antfly.search.reranker`.

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
