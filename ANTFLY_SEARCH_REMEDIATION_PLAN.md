# Antfly Search Branch Remediation Plan

This is a handoff for another implementation agent. The branch under review is `feat/antfly-zig-migration`. Its goal is to eliminate transient search failures around the AntflyDB v0.2 migration. Do not treat this as a cleanup pass. The fixes below are correctness work and should block merge until complete.

Note: the file name intentionally follows the current branch terminology, but the repository package is `adapter-antfly`.

## Current Verdict

Do not merge this branch as-is.

The review found real wire-contract mismatches against the vendored `@antfly/sdk` plus stale tests. The most serious issues can make full-text search silently dead, semantic search disappear during backfill, or vector-only queries ask Antfly to execute a request with no search criteria.

## Authoritative Antfly Source

Public AntflyDB docs were not useful for this SDK during review. Use the vendored SDK as the source of truth:

- `vendor/antfly-sdk-0.2.0-rc.2.tgz`
- Extracted review copy used during review: `/private/tmp/antfly-sdk-review/package`

If the extracted copy is missing, recreate it:

```sh
mkdir -p /private/tmp/antfly-sdk-review
tar -xzf vendor/antfly-sdk-0.2.0-rc.2.tgz -C /private/tmp/antfly-sdk-review
```

Relevant SDK contracts:

- `QueryRequest.full_text_search` is an Antfly `Query`, not an Elasticsearch-style object.
- `MatchQuery` shape is `{ match: string, field?: string }`.
- `BooleanQuery.should` shape is `{ disjuncts: Query[] }`.
- `QueryRequest.indexes` is required when using `semantic_search`.
- `QueryRequest.offset` is only available for full-text search, not semantic search.
- Full-text and embeddings stats expose `total_indexed`; embeddings also expose `wal_backlog` and `rebuilding`.

## Baseline Verification From Review

Commands run:

```sh
bun run typecheck
bun test --isolate tests/adapter-antfly/search.test.ts tests/adapter-antfly/server.test.ts
bun test --isolate tests/core/search-migration.test.ts tests/core/onboarding/search-url-correction.test.ts tests/core/onboarding/legacy-cleanup.test.ts tests/core/settings.test.ts
bun test --isolate --path-ignore-patterns "**/dev/**"
```

Results:

- `bun run typecheck`: passed.
- Core migration/onboarding/settings targeted tests: 37 passed.
- Adapter targeted tests: 2 failed.
- Full suite: 5157 passed, 9 skipped, 4 failed.

Failing full-suite tests at review time:

- `tests/adapter-antfly/search.test.ts:381`
- `tests/adapter-antfly/search.test.ts:567`
- `tests/core/search-registry.test.ts:907`
- `tests/plugins/health/routes.test.ts:317`

Some of these are stale expectations, but they still block merge. Do not ignore them.

## Phase 1: Fix Full-Text Query Shape

### Problem

`packages/adapter-antfly/src/query-translation.ts:33` builds field-scoped full-text queries as:

```ts
request.full_text_search = {
  bool: { should: searchableFields.map((field) => ({ match: { field, text: q.text } })) },
} as unknown as QueryRequest['full_text_search']
```

That shape is not valid per the vendored SDK.

The SDK contract is:

```ts
MatchQuery: {
  match: string
  field?: string
}

BooleanQuery: {
  should?: { disjuncts: Query[] }
}
```

Current impact: real plugin searches pass `searchableFields`, so they take this invalid branch. Tests mostly cover the fallback `{ query: text }`, which is why this bug survived.

### Recommended Fix

Add a small helper in `query-translation.ts`:

```ts
function buildFieldScopedFullTextSearch(text: string, fields: string[]): QueryRequest['full_text_search'] {
  if (fields.length === 1) return { match: text, field: fields[0] } as QueryRequest['full_text_search']
  return {
    should: {
      disjuncts: fields.map((field) => ({ match: text, field })),
    },
  } as QueryRequest['full_text_search']
}
```

Then replace the invalid `bool` block with this helper.

Keep the existing fallback `{ query: q.text }` only for the no-fields case. `{ query: string }` is a valid query-string query shape, but it is not field-scoped.

### Tests To Add

In `tests/adapter-antfly/search.test.ts` or a focused query-translation test:

- `buildQueryRequest` with `adapterOptions.searchableFields = ['title', 'body']` emits:

```ts
{
  should: {
    disjuncts: [
      { match: 'build feature', field: 'title' },
      { match: 'build feature', field: 'body' },
    ],
  },
}
```

- Single-field searchable fields emit `{ match: text, field }`, or keep multi-field shape if the team prefers one shape everywhere.
- Assert the request does not contain `bool`, `match: { text }`, or `match: { field, text }`.
- Add an adapter-level test that calls a real registered table query path with searchable fields so this cannot regress.

### Acceptance Criteria

- No production code emits the old `bool.should[].match.field/text` shape.
- Tests fail if the invalid shape returns.
- Full-text-only, hybrid, and multi-query paths all receive the fixed shape.

## Phase 2: Fix Semantic Index Readiness And Stats Counts

### Problem

`packages/adapter-antfly/src/search.ts:509` decides whether an embeddings index is queryable using:

```ts
const docCount = typeof st.query_visible_doc_count === 'number'
  ? st.query_visible_doc_count
  : typeof st.doc_count === 'number' ? st.doc_count : 0
```

The vendored SDK documents embeddings stats as `total_indexed`, `wal_backlog`, and `rebuilding`. It does not document `query_visible_doc_count` or `doc_count` for embeddings. A live server may expose extra fields, but the code must handle the documented field.

Current impact: a rebuilding index with `total_indexed > 0` but no `doc_count` is treated as empty and stripped from semantic search. That is directly in the failure class this branch is supposed to eliminate.

The table stats path has the same issue at `packages/adapter-antfly/src/search.ts:367`, where it reports zero documents if the full-text index status only has `total_indexed`.

### Recommended Fix

Add a helper near the existing index status helpers:

```ts
function readIndexedCount(status: Record<string, unknown>): number {
  const candidates = [
    status.query_visible_doc_count,
    status.doc_count,
    status.total_indexed,
  ]
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return 0
}
```

Use it in:

- `tables.stats`
- `filterRequestToReadyIndexes`
- Any health code that needs document counts, unless it already uses `total_indexed`.

Keep the current conservative readiness rule unless live testing proves otherwise:

- If index status exists and `rebuilding !== true`, consider it queryable.
- If `rebuilding === true`, consider it queryable only when `readIndexedCount(status) > 0`.
- If `indexes.list` fails, leave the request unchanged, as the current code does.

Also clear `readyIndexCache` when table/index topology changes:

- after `tables.create`
- after `tables.drop`
- after `tables.rebuildIndexes`

The TTL is only 5 seconds, but clearing it makes tests and operator behavior less surprising.

### Tests To Add

Add tests covering:

- Rebuilding embeddings index with `{ total_indexed: 12, rebuilding: true }` remains in `request.indexes`.
- Rebuilding embeddings index with `{ total_indexed: 0, rebuilding: true }` is stripped.
- Existing live-only fields still work: `{ query_visible_doc_count: 12, rebuilding: true }`.
- `tables.stats` returns `documents` from `total_indexed` when `doc_count` is absent.
- `readyIndexCache` is invalidated by create/drop/rebuild operations.

### Acceptance Criteria

- The readiness filter recognizes documented v0.2 stats.
- A partially rebuilt but queryable semantic index is not silently removed.
- Health/stats no longer report zero docs for indexes that only expose `total_indexed`.

## Phase 3: Prevent Empty Search-Leg Requests

### Problem

Vector-only queries can lose all search criteria:

1. `buildQueryRequest` emits only `semantic_search` and `indexes` for `strategy: 'vector'`.
2. `filterRequestToReadyIndexes` deletes `semantic_search` and `indexes` if no requested semantic index is ready.
3. `query` and `multiQuery` still send the request to Antfly.

This can produce an error, match-all behavior, or other undefined behavior. It should not hit Antfly.

### Recommended Fix

Track whether the request still has at least one search leg after readiness filtering:

```ts
function hasSearchLeg(request: QueryRequest): boolean {
  return request.full_text_search != null || (request.semantic_search != null && Array.isArray(request.indexes) && request.indexes.length > 0)
}
```

Use it in both paths:

- `AntflySearchAdapter.query` after `filterRequestToReadyIndexes`
- `AntflySearchAdapter.multiQuery` after each prepared request is filtered

Behavior:

- If no search leg remains, return `emptyQueryResult(query)` for that item.
- Do not send a no-leg request to `client.tables.query` or `client.query`.
- Log a concise warning for vector-only downgrade, but avoid noisy per-keystroke spam if this path is hot.

### Tests To Add

- `query` with `strategy: 'vector'` and no ready indexes returns empty and does not call `tables.query`.
- `multiQuery` with one vector-only no-ready request returns an empty result for that table but still runs other valid table queries.
- Hybrid query with full-text present and no ready semantic indexes still executes as full-text-only.

### Acceptance Criteria

- No request without `full_text_search` or valid `semantic_search + indexes` is sent to Antfly.
- Hybrid downgrade remains functional.
- Vector-only downgrade is explicit and deterministic.

## Phase 4: Stop Sending `offset` With Semantic Queries

### Problem

`packages/adapter-antfly/src/query-translation.ts:20` sets `offset` unconditionally:

```ts
const request: QueryRequest = {
  table,
  limit: q.limit ?? settings.search.defaultLimit,
  offset: q.offset,
}
```

The vendored SDK says `offset` is only available for full-text search and is not supported for semantic search. Hybrid queries include semantic search, so they should not send `offset`.

### Recommended Fix

Only include `offset` when the resolved strategy is full-text-only.

Suggested structure:

```ts
const request: QueryRequest = {
  table,
  limit: q.limit ?? settings.search.defaultLimit,
}

if (q.offset != null && strategy === 'full_text_only') {
  request.offset = q.offset
}
```

Decide explicitly what the API should do when callers request offset with hybrid/vector:

- Preferred: ignore offset for semantic/hybrid and document that semantic results are top-k only.
- Alternative: force such queries to `full_text_only` only when the caller explicitly asks for pagination. This is riskier because it changes ranking semantics.

Do not silently send unsupported wire parameters.

### Tests To Add

- Full-text-only query includes `offset`.
- Hybrid query omits `offset`.
- Vector-only query omits `offset`.
- API route tests that pass `offset` to hybrid/vector do not produce an Antfly request containing `offset`.

### Acceptance Criteria

- `offset` is never present on a request containing `semantic_search`.
- Existing full-text pagination still works.

## Phase 5: Make Schema Migration Retryable On Partial Drop Failure

### Problem

`src/core/search-migration.ts:130` catches per-table drop failures, then `src/core/search-migration.ts:139` still writes `SCHEMA_VERSION`.

Current impact: if one broken table fails to drop during the migration, Bakin records the migration as complete and never retries. This can leave stale v0.2-invalid tables in place forever.

### Recommended Fix

Keep the "attempt every table" behavior, but do not advance state unless every required drop succeeds.

Suggested behavior:

- Read all `bakin_*` tables.
- Attempt every drop, collecting failures and successes.
- If there are no failures, write `SCHEMA_VERSION`.
- If there are failures, do not write `SCHEMA_VERSION`.
- Return `migrated: true` if at least one table was dropped, so startup still reindexes recreated tables.
- Return `migrated: false` only if no table was dropped.
- Log the failed table names in one structured warning/error after the loop.

If changing the return type is acceptable, add failure details:

```ts
{
  migrated: boolean
  from: number
  to: number
  complete: boolean
  failures?: Array<{ table: string; error: string }>
}
```

If changing the return type is too invasive, keep the shape and rely on logs, but still do not advance the state file on failures.

### Tests To Update

Replace `continues migration even when one drop fails` in `tests/core/search-migration.test.ts`.

New expected behavior:

- Both tables are attempted even if one drop fails.
- `readStoredVersion()` remains the old value.
- `result.migrated` is true if any table dropped successfully.
- The failed table will be retried on the next boot.

Also keep the existing list failure test:

- If `tables.list()` throws, state remains unchanged and `migrated` is false.

### Acceptance Criteria

- A failed drop cannot permanently mark a migration complete.
- Partial success still triggers reindex for tables that were recreated.
- Migration remains non-fatal to boot.

## Phase 6: Make Model Health Match Active Settings

### Problem

`packages/adapter-antfly/src/models.ts:34` includes the mxbai reranker in `REQUIRED_MODELS`, but `packages/adapter-antfly/src/defaults.ts:50` has reranking disabled by default.

Current impact: a default install can report "semantic indexing is degraded" because an unused reranker is missing. That creates false health failures and sends users chasing the wrong thing.

### Recommended Fix

Separate required indexing models from optional reranking models.

Suggested model API:

```ts
export const DEFAULT_EMBEDDER_MODELS = [...]
export const DEFAULT_RERANKER_MODELS = [...]

export function requiredModelsForSettings(settings: AntflySettings): InferenceModel[] {
  const models = modelsForConfiguredEmbedders(settings.embedders)
  if (settings.search.reranker.enabled) {
    models.push({
      label: 'mxbai reranker',
      model: settings.search.reranker.model,
      kind: 'reranker',
    })
  }
  return dedupeByModel(models)
}
```

Then:

- `AntflySearchAdapter.getHealthChecks()` should call `checkInferenceModels(requiredModelsForSettings(this.settings))`.
- Setup/onboarding can still offer to install optional reranker if desired, but missing optional reranker must not degrade semantic search.
- Health messages should distinguish "semantic indexing is degraded" from "reranking unavailable".

### Tests To Add Or Update

- Default settings with text and visual embedders present but reranker absent reports model health ok.
- Reranker enabled and missing reports warning/missing.
- A custom embedder in settings is included in required model checks.
- `bakin install search-models` messaging does not claim missing disabled reranker breaks semantic indexing.

### Acceptance Criteria

- Default search health does not depend on disabled reranker files.
- Enabled reranker still gets checked.
- Messages describe the actual capability impacted.

## Phase 7: Clean Up Stale Test Expectations

These are not all production bugs, but they must be fixed so the suite is meaningful.

### `tests/adapter-antfly/search.test.ts:381`

Current failure: the test expects semantic search to be sent, but the mock `indexes.list` setup makes the readiness filter strip semantic search.

Fix options:

- If the test is about request construction, make the mock index status ready:

```ts
mockIndexesList.mockResolvedValue([
  { config: { name: 'embeddings', type: 'embeddings' }, status: { total_indexed: 5, rebuilding: true } },
])
```

- If the test is about readiness downgrade, rename it and assert semantic search is stripped.

Preferred: keep this as request construction and add separate readiness downgrade tests.

### `tests/adapter-antfly/search.test.ts:567`

Current failure: the test expects `full_text_index_v0` to be dropped during rebuild. The implementation intentionally skips server-managed full-text, and the comment says that is required.

Fix expectation:

```ts
expect(dropped).toEqual(['assets_visual'])
```

Also assert `mockIndexesCreate` recreates only caller-owned embeddings indexes.

### `tests/core/search-registry.test.ts:907`

Current failure: expected old default limit `10`; branch default is now `20` and adapter options are included.

Fix the expectation to match the current contract, preferably with `expect.objectContaining` for only the behavior under test:

```ts
expect(searchHarness.calls.multiQuery).toHaveBeenCalledWith([
  expect.objectContaining({
    table: 'bakin_tasks',
    query: expect.objectContaining({ text: 'hello', limit: 20 }),
  }),
  expect.objectContaining({
    table: 'bakin_assets',
    query: expect.objectContaining({ text: 'hello', limit: 20 }),
  }),
])
```

Only assert `adapterOptions` here if this test is meant to own that contract.

### `tests/plugins/health/routes.test.ts:317`

Current failure: route now includes `warm: 'cold'`.

Fix expected body:

```ts
expect(body).toEqual({ enabled: false, tables: [], warm: 'cold' })
```

Also consider adding an explicit test for warm states so this endpoint contract is intentional.

### Acceptance Criteria

- Full suite passes.
- Tests describe the current contract, not old behavior.
- No stale test is "fixed" by loosening assertions so far that it stops protecting behavior.

## Phase 8: Optional But Worth Verifying - Media Template Helper

`packages/adapter-antfly/src/query-translation.ts:118` emits:

```ts
{{#if image_url}}{{remoteMedia url=image_url}}{{/if}}
```

The vendored SDK docs clearly list `remoteMedia` for query embedding templates. The embedder template docs seen during review were less clear and mentioned `media` elsewhere. Existing local project knowledge says `remoteMedia` works for image indexing.

Do not change this blindly. Instead, verify with one of:

- live Antfly index test with a remote image URL and `antflydb/clipclap`
- upstream source citation showing `remoteMedia` is supported in index templates
- a test fixture from Antfly's own e2e if present in the vendored package or upstream repo

If live verification fails, switch to the documented helper and update `tests/adapter-antfly/search.test.ts:508`.

## Implementation Order

Recommended commit order:

1. Add/adjust tests for Antfly query request shape, readiness stats, vector-only empty-leg handling, offset rules, and migration retry semantics. Let them fail first if practical.
2. Fix `query-translation.ts` full-text shape and offset behavior.
3. Fix `search.ts` readiness/stats count helper and empty-leg guard in both `query` and `multiQuery`.
4. Fix migration state advancement in `search-migration.ts`.
5. Fix model health to use active settings.
6. Update stale tests that are asserting old contracts.
7. Run targeted tests.
8. Run typecheck.
9. Run the full suite.
10. If available, do a live Antfly smoke test with a small dataset.

## Targeted Verification Commands

Run these before the full suite:

```sh
bun test --isolate tests/adapter-antfly/search.test.ts tests/adapter-antfly/server.test.ts
bun test --isolate tests/core/search-migration.test.ts tests/core/search-registry.test.ts tests/plugins/health/routes.test.ts
bun test --isolate tests/core/onboarding/search-url-correction.test.ts tests/core/onboarding/legacy-cleanup.test.ts tests/core/settings.test.ts
bun run typecheck
```

Then run:

```sh
bun test --isolate --path-ignore-patterns "**/dev/**"
```

If live Antfly is available, run a smoke test that proves all three search modes:

- full-text-only finds a known unique token
- hybrid finds the same token and includes semantic request indexes
- vector-only returns empty without calling Antfly when indexes are absent, and returns hits when a ready embeddings index exists

## Non-Negotiable Acceptance Criteria

- Full suite passes.
- No invalid full-text query AST is emitted.
- No semantic index with documented `total_indexed > 0` is stripped just because `doc_count` is absent.
- No query with zero search legs is sent to Antfly.
- No semantic or hybrid request sends `offset`.
- Search schema state is not advanced after a failed required table drop.
- Default health does not require a disabled reranker.
- Tests cover the exact failure modes above.

## Suggested Prompt For The Implementation LLM

Use this prompt if handing the work to another model:

```text
You are working in /Users/roscoe/go/src/github.com/markhayden/bakin on branch feat/antfly-zig-migration.

Read ANTFLY_SEARCH_REMEDIATION_PLAN.md completely. Implement the remediation plan in order. Treat the vendored SDK package vendor/antfly-sdk-0.2.0-rc.2.tgz as the source of truth for Antfly request and status shapes.

Do not paper over failing tests. Add regression tests for:
- valid field-scoped full-text query AST
- readiness using total_indexed
- vector-only queries with no ready semantic index returning empty without calling Antfly
- offset omitted for hybrid/vector queries
- migration state not advanced when a table drop fails
- disabled reranker not required for default health

After implementation, run the targeted tests listed in the plan, then bun run typecheck, then the full suite:
bun test --isolate --path-ignore-patterns "**/dev/**"

Report every changed file and every command result.
```
