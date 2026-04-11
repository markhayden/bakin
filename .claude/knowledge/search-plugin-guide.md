# Making a Plugin Searchable — Guide

## Overview

Any Bakin plugin can register its content for Antfly-powered hybrid search by calling `ctx.search.registerContentType()` during `activate()`. This registers a table schema, sets up indexing hooks, and enables the plugin's data to appear in cross-table search results.

## Step-by-Step

### 1. Define the schema

Pick fields that users and agents will search or filter by. Each field has a type:

| Type | Use for | Indexed for full-text? |
|------|---------|----------------------|
| `text` | Searchable prose (titles, descriptions, content) | Yes |
| `keyword` | Exact-match filters (status, agent, type) | No (facet only) |
| `number` | Numeric values (progress, count) | No |
| `datetime` | Timestamps (created_at, updated_at) | No |

### 2. Register in activate()

```typescript
activate(ctx: PluginContext) {
  ctx.search.registerContentType({
    table: 'my_content',           // becomes bakin_my_content in Antfly
    schema: {
      title: { type: 'text' },
      status: { type: 'keyword' },
      body: { type: 'text' },
      updated_at: { type: 'datetime' },
    },
    searchableFields: ['title', 'body'],        // included in BM25 full-text index
    embeddingTemplate: '{{title}} {{body}}',     // text sent to embedder for vectors
    facets: ['status'],                           // fields available for facet filtering
    // Optional:
    chunker: { enabled: true, targetTokens: 200, overlapTokens: 25 },
    reindex: async function* () { /* yield all docs */ },
    verifyExists: async (key) => { /* return true if source exists */ },
  })
}
```

### 3. Index on mutations

After every create or update mutation:
```typescript
ctx.search.index(documentKey, {
  title: item.title,
  status: item.status,
  body: item.body,
  updated_at: new Date().toISOString(),
}).catch(() => {})
```

After every delete:
```typescript
ctx.search.remove(documentKey).catch(() => {})
```

For metadata-only updates (no re-embedding needed):
```typescript
ctx.search.transform(documentKey, [
  { op: '$set', field: 'status', value: 'done' },
]).catch(() => {})
```

### 4. Implement reindex()

The `reindex()` async generator yields `{ key, doc }` pairs for every document in the plugin's data source. Called by `POST /api/reindex`.

```typescript
reindex: async function* () {
  const items = readAllItems()
  for (const item of items) {
    yield { key: item.id, doc: itemToSearchDoc(item) }
  }
},
```

### 5. Implement verifyExists()

Called by the orphan cleanup timer to detect stale index entries.

```typescript
verifyExists: async (key) => {
  return existsSync(join(contentDir, `${key}.json`))
},
```

Return `true` if the source data for this key still exists. Return `false` to have the entry cleaned up.

For ephemeral data sources (OpenClaw jobs, agents), return `true` always — these items are managed externally and indexed on load.

## Patterns by Data Source

### Filesystem-backed (assets, projects, workflows)
- `reindex()`: scan directories, read files, yield docs
- `verifyExists()`: check if file exists on disk
- Index on file write, remove on file delete

### SQLite-backed (tasks)
- `reindex()`: read all rows from table, yield docs
- `verifyExists()`: query table for existence
- Index on every CRUD operation

### OpenClaw-backed (schedule, team)
- `reindex()`: empty generator (data loaded at runtime)
- `verifyExists()`: return `true` always
- Batch-index on data load (e.g., `onReady()`)
- Use `transform()` for frequent status-only updates

### Core module (audit)
- Registered directly from `server.ts` using `buildSearchAPI('_audit')`
- `reindex()`: stream `audit.jsonl` line by line
- TTL configured via `settings.antfly.auditTtl`

## Currently Registered Content Types

| Plugin | Table | Source | Chunker |
|--------|-------|--------|---------|
| tasks | `bakin_tasks` | SQLite `flow_runs` | Yes (log_text) |
| assets | `bakin_assets` | `.meta.json` sidecars | No |
| projects | `bakin_projects` | Markdown files | Yes (body) |
| workflows | `bakin_workflows` | YAML definitions + JSON instances | No |
| schedule | `bakin_schedule` | OpenClaw cron jobs | No |
| team | `bakin_team` | OpenClaw agents | No |
| _audit | `bakin_audit` | `audit.jsonl` | No (TTL-managed) |

## Common Pitfalls

1. **Always `.catch(() => {})` on index/remove calls** — search is best-effort, never block the main operation
2. **Use `transform()` for status-only changes** — avoids expensive re-embedding when only metadata changed
3. **Document keys must be stable** — use the item's unique ID, not a path that might change
4. **Don't forget both REST and MCP paths** — plugins typically register both route handlers and exec tools; both need indexing calls
5. **Empty reindex for ephemeral sources is OK** — OpenClaw-backed plugins batch-index at load time instead
