# Search API Reference

## REST Endpoints

### GET /api/search — Cross-plugin search (the ⌘K overlay's backend)

Backed by `src/core/api-search-handler.ts`.

Query params:
- `q` (required) — search query text
- `plugin` — limit to a specific plugin (tasks, assets, workflows, schedule, team, memory, …)
- `types` — comma-separated content types (logical table shorthand) to include; the ⌘K type chips use this
- `limit` — max results (default: 20)
- `offset` — skip N results for pagination
- `facets` — comma-separated facet fields for aggregation counts

`offset` and `facets` are honored in **both** branches. In the all-tables branch, each table is asked for up to `limit + offset` candidates, hits merge into one score-ordered list, and `offset` paginates the merged ordering. Facets merge per-table buckets summed into one map (`mergeFacetCounts` in `src/core/search-query.ts`).

**Degradation contract:** when the search engine is unavailable the endpoint returns **`503 { "error": "search_unavailable" }`** (the per-plugin routes do the same). The `useSearch` hook maps this to `status: 'unavailable'`; UIs render the shared `SearchUnavailable` component. There are no silent-fallback responses.

Response:
```json
{
  "results": [
    {
      "id": "task-abc",
      "table": "bakin_tasks",
      "score": 0.87,
      "fields": { "title": "...", "status": "done" },
      "indexScores": { "full_text": 0.35, "embeddings": -0.21 },
      "rerankScore": 0.94,
      "_table": "bakin_tasks"
    }
  ],
  "aggregations": { "status": [{ "value": "done", "count": 5 }] },
  "rawAggregations": null,
  "meta": { "query": "hero image", "total": 8, "took_ms": 12, "source": "antfly" }
}
```

**Result fields:**
- `score` — final fused score (RSF by default; see `search-tuning.md`). Use rank order, not magnitude.
- `indexScores` — per-leg breakdown with **neutral keys**: `full_text` for the keyword leg, the declared leg names for embedding legs (`assets_text`, `assets_visual`, `embeddings`, …). Embedding legs report `-cosine_distance` (negative; closer to 0 is better). The shared `ScoreOverlay` SDK component renders whatever legs appear — no engine-specific keys exist anywhere upstream of the adapter.
- `rerankScore` — cross-encoder score, present only when the content type has `rerankField` and reranking was requested (per-query opt-in).
- `aggregations` / `rawAggregations` — term-bucket facets / raw advanced aggregations (the latter only via `ctx.search.query()`).

### POST /api/reindex — Blue/green rebuild

Rebuilds are **blue/green**: a fresh physical table backfills in the background while queries keep answering from the current one; the pointer flips only after convergence. Search stays available throughout.

Query params:
- `table` — rebuild a specific logical table only (optional; omit for all)

Response:
```json
{ "ok": true, "errors": 0, "parked": 0, "tables": [ { "table": "bakin_tasks", "result": "migrated" } ] }
```

`result` per table: `migrated` (flipped), `parked` (never converged — the doctor's search-consistency check surfaces parked migrations with a repair), or `failed` (with `error`). Live progress broadcasts as `search.rebuild.start` / `search.rebuild.progress` / `search.rebuild.complete` SSE events (the health page renders them).

### GET /api/plugins/health/search-status — Search system health

Returns the blue/green-native `SearchHealthSnapshot`:

```json
{
  "enabled": true,
  "outbox": { "pending": 0, "quarantined": 0, "oldestPendingAt": null },
  "tables": [
    {
      "logical": "bakin_tasks",
      "physical": "bakin_tasks_v1_9f2a11c0",
      "schemaVersion": 1,
      "state": "active",
      "phase": null,
      "docCount": 45,
      "legs": [
        { "leg": "full_text_index_v0", "state": "ready", "indexedCount": 45 },
        { "leg": "embeddings", "state": "ready", "indexedCount": 45 }
      ]
    }
  ]
}
```

### GET /api/plugins/health/search-telemetry — Query/drain/enrichment activity

Composes the usage recorder (`search.query`, `search.drain`, `assets.enrich` over 1h/24h windows), outbox stats, the assets enrichment-stats hook, and the search doctor rows. No parallel stat store exists.

### GET /api/plugins/{pluginId}/search — Per-plugin search

Auto-registered by content-type registration. Same params as `/api/search` minus `plugin`; same 503 degradation contract.

## Plugin Maintenance API (ctx.search.maintenance)

Scoped to the caller's registered content type: `available()`, `scan(opts?)`, `batchRemove(keys)`. Scans resolve to the live physical table automatically. **A projection-less scan returns keys only** — consumers that read fields MUST request them (`{ fields: ['updated_at'] }`).

## MCP Tools (Agent-Facing)

All search MCP tools take a `plugin: <pluginId>` parameter — agents pass plugin ids, never raw `bakin_*` names.

| Tool | Purpose | Params |
|---|---|---|
| `bakin_exec_search_query` | Cross-/single-plugin search | `q` (req), `plugin?`, `limit?`, `offset?` |
| `bakin_exec_search_table` | Single plugin + facets | `plugin` (req), `q` (req), `facets?`, `limit?` |
| `bakin_exec_search_lookup` | Fetch one doc by key | `plugin` (req), `key` (req) |
| `bakin_exec_search_facets` | Facet distributions | `plugin` (req), `facets` (req) |
| `bakin_exec_search_similar` | Semantic similarity | `text` (req), `plugin?`, `limit?` |
| `bakin_exec_search_reindex` | **Blue/green rebuild** (search stays available) | `plugin?` |
| `bakin_exec_search_stats` | Health + per-table stats | — |

Asset-specific search-adjacent tools: `bakin_exec_assets_scan_unmanaged` (list unimported files), `bakin_exec_assets_import` (`path?`/`all?`/`type?`/`taskId?`).

## CLI Commands

```bash
bakin search "hero image"                    # cross-table search
bakin search "blocked" --table=tasks         # single table
bakin search "done" --facets=status,agent    # facet counts

bakin reindex                                # blue/green rebuild, all tables
bakin reindex --table=tasks                  # one table

bakin search:stats                           # engine status + per-table doc counts

bakin assets scan                            # list unmanaged (unimported) files
bakin assets import --all                    # import them (explicit — nothing auto-ingests)
bakin assets import inbox/shot.png --type image
bakin assets enrich --all [--force]          # run/backfill vision enrichment (billed)
```

## Tables

| Table (logical) | Plugin | Facets | Chunker | Embedding legs | Reranker field |
|---|---|---|---|---|---|
| `bakin_tasks` | tasks | status, agent, created_by, project_id | Yes (200/25) | `embeddings` | `description` |
| `bakin_assets` | assets | asset_type, agent, tool, tags_facet, provider, model | Yes (200/25 on text) | `assets_text`, `assets_visual` (media: raster + audio via `media_url`) | — (multimodal) |
| `bakin_workflows` | workflows | type, status | No | `embeddings` | `description` |
| `bakin_schedule` | schedule | agent, enabled | No | `embeddings` | `command` |
| `bakin_team` | team | model, status | No | `embeddings` | `soul` |
| `bakin_agent-lessons` | team | agent | No | `embeddings` | — |
| `bakin_memory` | memory | tier, agent, kind, eventType, phase, date | No | `embeddings` | `content` |

Physical names are versioned (`{logical}_v{schemaVersion}_{fp8}`); the registry resolves them — nothing upstream ever addresses a physical name directly.

**Per-leg fusion weights:** declared per leg (`weight`, default 1.0), resolved by the registry, sent as `merge_config` weights. Current defaults (balanced 1.0/1.0, RSF fusion) are the measured winners — see `.claude/knowledge/search-tuning.md` before changing them.
