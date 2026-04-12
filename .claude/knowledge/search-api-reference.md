# Search API Reference

## REST Endpoints

### GET /api/search — Cross-table or per-table search

Query params:
- `q` (required) — search query text
- `table` — limit to a specific table (tasks, assets, projects, workflows, schedule, team, audit)
- `limit` — max results (default: 20)
- `offset` — skip N results for pagination
- `facets` — comma-separated facet fields for aggregation counts

Response:
```json
{
  "results": [
    {
      "id": "task-abc",
      "table": "bakin_tasks",
      "score": 0.87,
      "fields": { "title": "...", "status": "done" },
      "indexScores": {
        "/path/to/full_text_index_v0": 0.35,
        "embeddings": 0.91
      },
      "rerankScore": 0.94,
      "_table": "bakin_tasks"
    }
  ],
  "aggregations": {
    "status": [{ "value": "done", "count": 5 }, { "value": "inProgress", "count": 3 }]
  },
  "rawAggregations": null,
  "meta": { "query": "hero image", "total": 8, "took_ms": 12, "source": "antfly" }
}
```

**Result fields:**
- `score` — final merged RRF score (or reranker score when reranker is attached). Lower is *better* for distance-based embeddings, higher is better for RRF. Don't rely on the absolute magnitude — use rank order.
- `indexScores` — per-index score breakdown. The Bleve full-text key is an absolute filesystem path (legacy Antfly quirk). Embedding indexes use their declared names (`embeddings`, `assets_text`, `assets_visual`, …). A result with a `bleve`/full-text key in `indexScores` means the query matched by keyword; a result with only embedding-index keys means only semantic similarity matched.
- `rerankScore` — cross-encoder score, present only when the queried content type had `rerankField` set and the reranker ran. Skipped for multi-modality tables like `bakin_assets`.
- `aggregations` — term-bucket facets (from `facets` query param). Convenience shape.
- `rawAggregations` — Antfly's raw aggregation response when the query used the advanced `aggregations` API (date histograms, range buckets, sub-aggregations). Not populated by `GET /api/search` since it doesn't expose the raw aggregations input — use `ctx.search.query()` from a plugin route when you need non-term aggregations.

### POST /api/reindex — Reindex content types

Query params:
- `table` — reindex a specific table only (optional)
- `rebuild=true` — drop and recreate indexes before reindexing
- `verify=true` — re-query tables after reindex to verify doc counts (opt-in, adds latency)

Response:
```json
{
  "ok": true,
  "total": 142,
  "errors": 0,
  "enrichmentErrors": 0,
  "tables": [
    {
      "table": "bakin_tasks",
      "pluginId": "tasks",
      "indexed": 45,
      "enrichment": {
        "indexes": [
          { "name": "search", "type": "full_text", "totalIndexed": 45, "walBacklog": 0, "rebuilding": false },
          { "name": "embeddings", "type": "embeddings", "totalIndexed": 45, "walBacklog": 0, "rebuilding": false }
        ],
        "healthy": true
      }
    }
  ]
}
```

`ok` is `true` only when both `errors === 0` and `enrichmentErrors === 0`. Per-table failures appear as an `error` string on the corresponding `tables[]` entry. `enrichment` surfaces Antfly's async enrichment status per index — `healthy: false` when any index has an `error` or non-zero `walBacklog`. When `verify=true`, each table entry also includes `verified` (actual doc count) and `verifyDiscrepancy` (difference from indexed count).

### GET /api/antfly/health — Search system health

Response:
```json
{
  "enabled": true,
  "tables": [
    {
      "table": "bakin_tasks",
      "pluginId": "tasks",
      "stats": { "num_docs": 45, "num_shards": 1 },
      "indexHealth": [
        { "name": "search", "type": "full_text", "totalIndexed": 45, "walBacklog": 0, "rebuilding": false },
        { "name": "embeddings", "type": "embeddings", "totalIndexed": 45, "walBacklog": 0, "rebuilding": false }
      ],
      "healthy": true
    }
  ]
}
```

### GET /api/plugins/{pluginId}/search — Per-plugin search

Each searchable plugin exposes a `/search` route. Same query params as `/api/search` but scoped to that plugin's table.

Available at:
- `/api/plugins/tasks/search?q=...`
- `/api/plugins/assets/search?q=...`
- `/api/plugins/projects/search?q=...`
- `/api/plugins/workflows/search?q=...`
- `/api/plugins/schedule/search?q=...`
- `/api/plugins/team/search?q=...`

## MCP Tools (Agent-Facing)

### bakin_exec_search_query
Cross-table or single-table search. Primary tool for agents to find information.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| q | string | yes | Search query |
| table | string | no | Limit to specific table |
| limit | number | no | Max results (default: 20) |
| offset | number | no | Pagination offset |

### bakin_exec_search_table
Search a specific table with facet counts. Use when the agent knows which content type to search.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| table | string | yes | Table to search |
| q | string | yes | Search query |
| facets | string | no | Comma-separated facet fields |
| limit | number | no | Max results |

### bakin_exec_search_lookup
Look up a specific document by key. Direct retrieval, not a search.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| table | string | yes | Table name |
| key | string | yes | Document key |

### bakin_exec_search_facets
Get facet value distributions for a table without searching. Useful for understanding data shape.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| table | string | yes | Table name |
| facets | string | yes | Comma-separated facet fields |

### bakin_exec_search_similar
Semantic similarity search. Finds documents with similar meaning to the given text.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| text | string | yes | Text to find similar docs for |
| table | string | no | Limit to specific table |
| limit | number | no | Max results (default: 10) |

### bakin_exec_search_reindex
Trigger a full reindex. Use after bulk data changes or schema updates.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| table | string | no | Specific table (omit for all) |
| rebuild | boolean | no | Drop and recreate indexes first |

### bakin_exec_search_stats
Get search system health and per-table stats. No parameters.

## CLI Commands

### bakin search `<query>` [options]
```bash
bakin search "hero image"                    # cross-table search
bakin search "blocked" --table=tasks         # search only tasks
bakin search "logo" --table=assets --limit=5 # limit results
bakin search "done" --facets=status,agent    # include facet counts
```

### bakin reindex [options]
```bash
bakin reindex                          # reindex all tables
bakin reindex --table=tasks            # reindex only tasks
bakin reindex --rebuild                # drop indexes + reindex
bakin reindex --table=assets --rebuild # rebuild specific table
```

### bakin search:stats
```bash
bakin search:stats   # show Antfly status and per-table doc counts
```

## Tables

| Table | Plugin | Facets | Chunker | Indexes | Reranker field |
|---|---|---|---|---|---|
| `bakin_tasks` | tasks | status, agent, created_by, project_id | Yes (200/25) | `embeddings` (BGE) | `description` |
| `bakin_assets` | assets | asset_type, agent, tool | Yes (200/25 on text) | `assets_text` (BGE), `assets_visual` (CLIP) | — (skipped, multimodal) |
| `bakin_projects` | projects | status | Yes (200/25) | `embeddings` (BGE) | `body` |
| `bakin_workflows` | workflows | type, status | No | `embeddings` (BGE) | `description` |
| `bakin_schedule` | schedule | agent, enabled | No | `embeddings` (BGE) | `command` |
| `bakin_team` | team | model, status | No | `embeddings` (BGE) | `soul` |
| `bakin_audit` | _audit (core) | event, agent, channel | No (TTL) | `embeddings` (BGE) | `content` |

**`bakin_assets` is the only multi-index table.** See `.claude/knowledge/multimodal-search.md` for why it has separate `assets_text` and `assets_visual` indexes, how server-side content extraction feeds the text index, and the format support matrix for which file types land in which index.
