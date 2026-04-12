# SPEC: Reindex Enrichment Observability (#74)

## Objective

Close the observability gap between "Antfly accepted the batch" and "Antfly actually enriched the documents." Today, Bakin's reindex pipeline reports success the moment `batchIndex()` returns — but Antfly's async enrichment (chunking, embedding, indexing) can silently fail for individual documents, leaving partial/empty embeddings in the search index with no log line or API response surfacing the failure.

This has caused real diagnostic dead ends three times on the multimodal-search branch (PDF extraction failures, SVG decode errors, shard-init races). Each required curling Antfly directly to diagnose.

**Target user:** The single operator of this Bakin instance (via health page + server logs).

**Non-goal:** This is not about UI polish or new pages. It's about making the existing reindex pipeline honest about what actually landed in the index.

## Scope

Four layers, ordered by value-to-effort:

### Layer 1: Post-batch enrichment audit (highest value)

After each reindex completes, poll Antfly's `indexes.list()` for every table that was reindexed. The SDK returns per-shard stats including `error`, `wal_backlog`, `rebuilding`, and `backfill_progress` for each index. Log any anomalies as Bakin-level errors (not warnings) so they surface in `server.log` and the audit trail.

**What to check per index:**
- `error` is non-empty -> log as error with table + index + shard ID + message
- `wal_backlog > 0` -> log as warning (enrichment still in progress)
- `backfill_progress < 1.0` when `rebuilding === true` -> log as info (expected during rebuild)

**New function:** `getIndexHealth(tableName)` in `src/core/antfly.ts` — wraps `client.indexes.list()` and returns a structured per-index health summary.

### Layer 2: Enriched reindex response

Change the `/api/reindex` response and `reindexContentTypes()` return type to include post-batch enrichment status:

```typescript
// Current per-table result
{ table: string; pluginId: string; indexed: number; error?: string }

// Proposed per-table result
{
  table: string
  pluginId: string
  indexed: number          // docs Antfly accepted into the batch
  error?: string           // batch-level error (unchanged)
  enrichment?: {           // NEW — per-index enrichment status
    indexes: Array<{
      name: string
      totalIndexed: number
      walBacklog: number
      error?: string
      rebuilding: boolean
      backfillProgress?: number
    }>
    healthy: boolean       // true when all indexes have no errors and wal_backlog === 0
  }
}
```

The `/api/reindex` response shape changes from `{ok, total, errors, tables}` to:

```typescript
{
  ok: boolean              // false if any table had batch errors OR enrichment errors
  total: number            // total docs accepted
  errors: number           // tables with batch-level errors (unchanged)
  enrichmentErrors: number // NEW — tables with enrichment-level errors
  tables: [...]            // per-table results with enrichment field
}
```

### Layer 3: Verified reindex mode (`?verify=true`)

Add an opt-in verification pass to `/api/reindex?verify=true`. After the full reindex completes for a table, query the table for the inserted keys and count how many are actually findable. Only count verified docs in a separate `verified` field. This is slow but honest — intended for smoke tests and CI, not routine reindexes.

**Implementation:** After all batches for a table complete, do a `matchAll` query with `limit: 0` to get the doc count. Compare against the `indexed` count. If they diverge significantly, log the discrepancy. Also spot-check a sample of inserted keys via individual queries.

**New fields in per-table result:**
```typescript
{
  verified?: number        // only present when verify=true — docs actually findable
  verifyDiscrepancy?: number // difference between indexed and verified
}
```

### Layer 4: Enrichment status on health endpoint

Extend `GET /api/antfly/health` to include per-index enrichment status alongside the existing per-table stats. The health page can then show "7 docs in `bakin_assets` but 2 had enrichment failures" at a glance.

**Health response changes:**
```typescript
// Current per-table entry
{ table: string; pluginId: string; stats: Record<string, unknown> | null }

// Proposed per-table entry
{
  table: string
  pluginId: string
  stats: Record<string, unknown> | null  // unchanged
  indexHealth?: Array<{                   // NEW
    name: string
    type: string                         // 'full_text' | 'embeddings'
    totalIndexed: number
    walBacklog: number
    error?: string
    rebuilding: boolean
    backfillProgress?: number
  }>
  healthy: boolean                        // NEW — aggregate: all indexes clean
}
```

**Health page UI changes:** Add an indicator to each table card:
- Green checkmark when `healthy === true`
- Amber warning icon when `walBacklog > 0` (enrichment in progress)
- Red error icon when any index has `error` set, with tooltip showing the error message

## Files to Modify

| File | Change |
|------|--------|
| `src/core/antfly.ts` | Add `getIndexHealth()` function |
| `src/core/search-registry.ts` | Add post-batch enrichment audit in `reindexContentTypes()`, add `verify` mode, update `getSearchHealth()` |
| `server.ts` | Update `/api/reindex` handler to pass `verify` param and include `enrichmentErrors` in response |
| `plugins/health/components/health-page.tsx` | Add enrichment status indicators to table cards |
| `tests/core/antfly.test.ts` | Tests for `getIndexHealth()` |
| `tests/core/search-registry.test.ts` | Tests for enrichment audit, verify mode, updated health response |
| `.claude/knowledge/search-system.md` | Document enrichment observability pipeline |

## Files NOT to Modify

- No plugin `index.ts` files — this is all core infrastructure
- No new plugins or pages — enrichment status lives on the existing health page
- No changes to the search query path — this is write-side observability only
- No changes to `SearchContentTypeDefinition` or `SearchAPI` — plugin registration interface is unchanged

## Technical Constraints

1. **Antfly SDK available types:** `indexes.list()` returns per-index `IndexStatus` with `shard_status` map. Each shard has `error?`, `total_indexed?`, `wal_backlog?`, `rebuilding?`, `backfill_progress?`. These are the exact signals we need.

2. **Batch response limitations:** `tables.batch()` returns `{ inserted?, deleted?, transformed? }` — aggregate counts only, no per-document errors. This is why Layer 3 (verify mode) uses a re-query approach rather than parsing batch results.

3. **Timing:** Antfly enrichment is async. After `batchIndex()` returns, the documents are in the WAL but may not be enriched yet. The enrichment audit (Layer 1) runs after ALL batches for a table complete, giving enrichment time to catch up. The verify mode (Layer 3) adds a query after all batches complete.

4. **Performance:** Layer 1 adds one `indexes.list()` call per table after reindex (7 calls for a full reindex). Layer 4 adds the same per health poll. Both are metadata-only calls, not queries. Layer 3 adds one query per table (moderately expensive — hence opt-in).

5. **No Antfly required for tests:** All tests mock the Antfly module. The existing mock infrastructure in `tests/core/` already covers `batchIndex`, `listTables`, `createTable`. We add mocks for the new `getIndexHealth()` function.

## Testing Strategy

### Unit tests (mock Antfly)

**`tests/core/antfly.test.ts`:**
- `getIndexHealth()` returns structured health when indexes have no errors
- `getIndexHealth()` surfaces shard errors when present
- `getIndexHealth()` returns null when client unavailable
- `getIndexHealth()` handles WAL backlog reporting

**`tests/core/search-registry.test.ts`:**
- `reindexContentTypes()` includes enrichment status in results
- `reindexContentTypes()` logs errors when enrichment reports failures
- `reindexContentTypes({ verify: true })` verifies documents post-reindex
- `reindexContentTypes({ verify: true })` reports discrepancies
- `getSearchHealth()` includes per-index health in response
- `getSearchHealth()` sets `healthy: false` when indexes have errors

### Integration validation (requires real Antfly — not in scope for this PR)

- Reindex with a known-bad PDF and verify enrichment error surfaces
- Reindex with embedder model mismatch and verify error surfaces
- Health page shows correct indicators after reindex with errors

## Acceptance Criteria

1. After a reindex, any Antfly enrichment errors appear in `~/.bakin/logs/server.log` as ERROR-level entries with table name, index name, and error message
2. `POST /api/reindex` response includes `enrichment` field per table with index-level health
3. `POST /api/reindex?verify=true` re-queries inserted documents and reports discrepancies
4. `GET /api/antfly/health` response includes `indexHealth` and `healthy` per table
5. Health page table cards show visual enrichment status (green/amber/red)
6. All new code paths have unit tests with mocked Antfly
7. `.claude/knowledge/search-system.md` updated with enrichment observability section

## Boundaries

### Always do
- Mock `getContentDir` in every test
- Use existing `createLogger` for all new log lines
- Return structured data — no string-only error reporting
- Keep enrichment audit non-blocking (log and continue, never fail the reindex)
- Cap verify error lists to prevent unbounded response sizes

### Never do
- Change the plugin registration interface (`SearchContentTypeDefinition`)
- Add new SSE event types (use existing `reindex.*` events, extend payloads)
- Block on enrichment completion (audit is best-effort, not a gate)
- Hardcode Antfly URLs or table names
- Add backwards-compatibility shims for the response shape changes

### Ask first
- If enrichment audit latency becomes noticeable (>2s per table), consider making it opt-in
- If `wal_backlog` is always >0 immediately after batch (expected), consider adding a small delay before the audit poll
