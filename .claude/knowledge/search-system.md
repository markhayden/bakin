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

File deleted
  → watcher unlink hook → ctx.search.remove(key)
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

## Table Naming

All Antfly tables use the `bakin_` prefix: `bakin_tasks`, `bakin_assets`, `bakin_projects`, etc.

**Legacy cleanup:** On startup, any `beacon_*` tables are wiped automatically. The `beacon_` prefix is from a prior naming scheme — it is retired.

## SearchContentTypeDefinition

```typescript
interface SearchContentTypeDefinition {
  table: string                              // e.g. 'bakin_tasks'
  schema: Record<string, AntflyFieldSchema>  // field definitions
  searchableFields: string[]                 // fields included in full-text index
  embeddingTemplate: (doc: unknown) => string // text used for vector embedding
  facets?: string[]                          // fields available for facet filtering
  ttl?: number                               // document TTL in seconds (optional)
  ttlField?: string                          // field name holding the TTL timestamp
  chunker?: (doc: unknown) => string[]       // splits large docs for chunked embedding
  reindex(): AsyncGenerator<{ key: string; doc: unknown }>  // full reindex source
  verifyExists(key: string): Promise<boolean>  // orphan check — does source still exist?
}
```

Registered by plugins during `activate()` via `ctx.search.registerContentType(def)`.

## SearchAPI (per plugin)

Exposed on `PluginContext` as `ctx.search`:

```typescript
interface SearchAPI {
  registerContentType(def: SearchContentTypeDefinition): void
  index(key: string, doc: unknown): Promise<void>     // upsert; fire-and-forget safe
  remove(key: string): Promise<void>                  // delete document
  transform(key: string, ops: TransformOps): Promise<void>  // atomic field update, skips re-embed
  query(params: SearchQueryParams): Promise<SearchResult[]>
}
```

`transform()` is for metadata-only updates (e.g. status change) where re-generating embeddings would be wasteful.

## Hybrid Search

Queries combine full-text (BM25) and semantic (vector) results via Reciprocal Rank Fusion (RRF). Strategy is configurable per query and globally:

| Strategy | Behavior |
|----------|----------|
| `rrf` (default) | Merge BM25 + semantic results via RRF |
| `semantic_only` | Vector similarity only |
| `full_text_only` | BM25 only, no embeddings required |

Global default: `settings.antfly.search.strategy`.

### Reranker

Optional cross-encoder reranking after initial retrieval. Configured via `settings.antfly.search.reranker`.

## Embedder

Antfly's built-in embedder runs locally: `all-MiniLM-L6-v2` by default. Configurable via:

```
settings.antfly.embedder.provider   — 'built-in' | 'openai' | 'custom'
settings.antfly.embedder.model      — model identifier
```

## Chunking

Long documents are split before embedding using the registered `chunker`. Defaults:

```
settings.antfly.chunking.defaultTargetTokens   — target tokens per chunk
settings.antfly.chunking.defaultOverlapTokens  — overlap between chunks
```

If a content type provides no `chunker`, the `embeddingTemplate` output is embedded whole.

## Orphan Cleanup

`src/core/search-cleanup.ts` runs a periodic scan:

1. For each registered content type, list all indexed document keys from Antfly
2. Call `def.verifyExists(key)` for each key (checks source: filesystem, SQLite, etc.)
3. Remove any document whose source no longer exists

Interval controlled by `settings.antfly.cleanupInterval` (milliseconds). Cleanup does not run if Antfly is disabled.

## Watcher Integration

The file watcher (`src/core/watcher.ts`) triggers search sync on filesystem events:

- `syncFile(path)` — on write/change: re-index document at path
- `syncFileUnlink(path)` — on delete: remove document from Antfly

Plugins that register content types backed by filesystem files should ensure their watcher patterns are set up so unlink events reach `ctx.search.remove()`.

## Settings Reference

All under `settings.antfly`:

| Key | Purpose |
|-----|---------|
| `enabled` | Enable/disable Antfly integration |
| `url` | Antfly server URL |
| `auth` | Auth token / credentials |
| `search.strategy` | Default search strategy (`rrf` \| `semantic_only` \| `full_text_only`) |
| `search.defaultLimit` | Default result count |
| `search.reranker` | Optional reranker config |
| `embedder.provider` | Embedding provider |
| `embedder.model` | Embedding model |
| `chunking.defaultTargetTokens` | Default chunk target size |
| `chunking.defaultOverlapTokens` | Default chunk overlap |
| `auditTtl` | TTL for indexed audit entries (seconds) |
| `cleanupInterval` | Orphan cleanup interval (milliseconds) |
