# Plan: Reindex Enrichment Observability (#74)

**Spec:** `.claude/specs/reindex-enrichment-observability.md`
**Branch:** `fix/issue-74-reindex-enrichment-observability`

## Dependency Graph

```
T1: getIndexHealth() in antfly.ts
 ├── T2: enrichment audit + enriched response in search-registry.ts
 │    └── T3: server.ts reindex handler update
 ├── T4: getSearchHealth() enrichment extension
 │    └── T5: health page UI indicators
 └── T6: verify mode in search-registry.ts + server.ts
T7: knowledge doc update (after all implementation)
```

T1 is the foundation. T2 and T4 can start after T1. T3 depends on T2. T5 depends on T4. T6 depends on T1 but is otherwise independent. T7 is last.

## Commit Strategy

Each task maps to exactly one commit. This gives clean rollback points:

| Commit | Task | Rollback impact |
|--------|------|-----------------|
| C1 | T1: `getIndexHealth()` + tests | Zero — new function, nothing calls it yet |
| C2 | T2: enrichment audit in reindex + tests | Reindex response shape changes — revert C2 to restore old shape |
| C3 | T3: server.ts handler update | Reverts the API surface — C2 still works but response isn't exposed via HTTP |
| C4 | T4: health endpoint enrichment + tests | Independent of C2/C3 — revert without affecting reindex |
| C5 | T5: health page UI indicators | Pure frontend — revert without affecting any API |
| C6 | T6: verify mode + tests | Opt-in feature behind `?verify=true` — revert cleanly |
| C7 | T7: knowledge doc | Docs only |

**Safe rollback to any checkpoint:** Commits are ordered so reverting later commits never breaks earlier ones. The only "breaking" change is C2+C3 together (response shape change), but per spec we're not maintaining backwards compat.

## Task Details

### T1: Add `getIndexHealth()` to antfly.ts

**What:** New exported function that wraps `client.indexes.list()` and returns a structured, typed health summary per index.

**Where:** `src/core/antfly.ts` (after `rebuildIndexes()` at ~line 664)

**Interface:**
```typescript
export interface IndexHealthEntry {
  name: string
  type: string           // from config.type: 'full_text' | 'embeddings'
  totalIndexed: number
  walBacklog: number
  error?: string
  rebuilding: boolean
  backfillProgress?: number
}

export interface IndexHealth {
  indexes: IndexHealthEntry[]
  healthy: boolean
}

export async function getIndexHealth(tableName: string): Promise<IndexHealth | null>
```

**Implementation notes:**
- Calls `client.indexes.list(tableName)` (already used in `rebuildIndexes()` at line 645)
- Iterates each index entry, reads the aggregate `status` field (not per-shard — aggregate is sufficient for observability)
- Sets `healthy = true` when no index has `error` set and all `walBacklog === 0`
- Returns `null` when client unavailable (matches `getTableStats` pattern)
- Swallows errors with `log.warn` — never throws

**Tests:** `tests/core/antfly.test.ts`
- Export exists and is a function
- Returns `null` when Antfly disabled (existing pattern)
- Returns structured health when indexes are healthy (mock `indexes.list` with clean data)
- Surfaces errors from shard stats (mock with `error` field set)
- Reports WAL backlog (mock with `wal_backlog > 0`)

**Verification:** `npx vitest run tests/core/antfly.test.ts`

---

### T2: Enrichment audit in `reindexContentTypes()`

**What:** After all batches complete for each table, call `getIndexHealth()` and:
1. Log any enrichment errors at ERROR level
2. Log WAL backlog at WARN level
3. Attach enrichment status to the per-table result

**Where:** `src/core/search-registry.ts`, inside the `for` loop at ~line 461, after line 504 (`broadcast reindex.complete`)

**Changes:**
- Import `getIndexHealth` from `./antfly`
- After `broadcast({ type: 'reindex.complete', ... })`, call `getIndexHealth(tableName)`
- Log anomalies via the existing `log` instance
- Extend the result object with `enrichment?: IndexHealth`
- Update the return type annotation

**Also update `server.ts` reindex handler** (line 337-350):
- Parse `verify` query param (used in T6, but wire it now)
- Add `enrichmentErrors` count to response (count of tables where `enrichment?.healthy === false`)
- Update `ok` to also check enrichment health

**Tests:** `tests/core/search-registry.test.ts`
- Mock `antfly.getIndexHealth` to return healthy status — verify result includes `enrichment.healthy: true`
- Mock `getIndexHealth` with errors — verify result includes the errors and `enrichment.healthy: false`
- Mock `getIndexHealth` returning `null` (Antfly unavailable) — verify enrichment field is omitted, no crash
- Verify `reindex.complete` broadcast still fires before enrichment audit (no regression)

**Verification:** `npx vitest run tests/core/search-registry.test.ts`

---

### T3: Update server.ts reindex handler

**What:** Update the `/api/reindex` HTTP handler to expose the enriched response shape.

**Where:** `server.ts` lines 337-350

**Changes:**
- Add `verify` param parsing: `const verify = url.searchParams.get('verify') === 'true'`
- Pass `verify` to `reindexContentTypes({ table, rebuild, verify })` (verify logic added in T6; passing it now is harmless — it's ignored until T6)
- Compute `enrichmentErrors`: count of tables where `r.enrichment && !r.enrichment.healthy`
- Update `ok`: `errors === 0 && enrichmentErrors === 0`
- Response: `{ ok, total, errors, enrichmentErrors, tables: results }`

**Tests:** No separate test file for server.ts routes — verification is via the search-registry tests (T2) and manual curl. The handler is a thin passthrough.

**Verification:** Read the diff and confirm the handler passes params through correctly.

---

### T4: Extend `getSearchHealth()` with index health

**What:** Add per-index enrichment status to the health endpoint response.

**Where:** `src/core/search-registry.ts`, `getSearchHealth()` function at line 604

**Changes:**
- After getting `stats` via `antfly.getTableStats(tableName)`, also call `antfly.getIndexHealth(tableName)`
- Add `indexHealth` and `healthy` fields to each table entry
- `healthy` is `true` when `indexHealth` reports no errors, or when `indexHealth` is null (Antfly unavailable = skip, don't red-flag)

**Tests:** `tests/core/search-registry.test.ts`
- `getSearchHealth()` includes `indexHealth` array when available
- `getSearchHealth()` sets `healthy: true` for clean indexes
- `getSearchHealth()` sets `healthy: false` when any index has errors
- `getSearchHealth()` handles `getIndexHealth` returning null gracefully

**Verification:** `npx vitest run tests/core/search-registry.test.ts`

---

### T5: Health page UI enrichment indicators

**What:** Add visual enrichment status to each table card on the health page.

**Where:** `plugins/health/components/health-page.tsx`, table card rendering at ~line 557-574

**Changes:**
- Update the `searchHealth` TypeScript interface to include `indexHealth` and `healthy`
- In each table card, add a status indicator:
  - `healthy === true` or `healthy` undefined: green `CircleCheck` icon
  - Any index with `walBacklog > 0`: amber `Clock` icon with "Enriching..." text
  - Any index with `error`: red `AlertCircle` icon with tooltip showing error
- Show per-index breakdown on hover or in an expandable section (keep it minimal — just icon + tooltip)

**Tests:** This is a UI component — verification is visual. No unit test needed for the indicator rendering.

**Verification:** Start dev server, trigger a reindex via the health page button, confirm indicators render. Since we're on Imitation Crab (no real Antfly), the health endpoint will return `enabled: false` and the section won't render with live data — but we can verify the component compiles and doesn't crash.

---

### T6: Verify mode (`?verify=true`)

**What:** Add opt-in post-reindex verification that re-queries inserted documents.

**Where:** `src/core/search-registry.ts`, inside `reindexContentTypes()`

**Changes:**
- Accept `verify?: boolean` in the options parameter
- After all batches for a table complete (and after enrichment audit), if `verify` is true:
  - Call `antfly.queryTable(tableName, matchAll, { limit: 0 })` to get total doc count
  - Compare against `count` (number of docs we inserted)
  - If `indexed > 0` and the table count is significantly lower, log as error
  - Add `verified` and `verifyDiscrepancy` to the result
- Keep it simple: one query per table, compare totals. Don't do per-key lookups (too expensive).

**Tests:** `tests/core/search-registry.test.ts`
- `reindexContentTypes({ verify: true })` queries the table after reindex
- Result includes `verified` count matching the mock query response
- Result includes `verifyDiscrepancy` when counts differ
- `verify: false` (default) does not query — no `verified` field in result

**Verification:** `npx vitest run tests/core/search-registry.test.ts`

---

### T7: Update knowledge doc

**What:** Add an "Enrichment Observability" section to `.claude/knowledge/search-system.md`.

**Where:** After the "Reindexing" section (~line 381)

**Content:**
- Describe the enrichment audit pipeline (Layer 1)
- Document the enriched response shape (Layer 2)
- Document verify mode (Layer 3)
- Document the health endpoint enrichment fields (Layer 4)
- Note which SDK types drive the data (`IndexStatus`, `EmbeddingsIndexStats`, etc.)

**Verification:** Read the doc and confirm accuracy against implementation.
