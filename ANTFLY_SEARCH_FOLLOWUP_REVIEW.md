# Antfly Search Remediation Follow-Up Review

Review target: commit `6cc97456` (`fix(search): correct antfly v0.2 query AST, readiness, and model health`)

Local status while reviewing:

- Search remediation commit is cleanly committed.
- Dev-exit work is still uncommitted and should remain a separate commit.
- `packages/host/src/api/_embedded-assets-static.ts` is generated churn and should not be committed with either fix.

## Bottom Line

The remediation fixed the normal full-text term shape, readiness gating, offset gating, migration versioning, and reranker-disabled health behavior. Those changes are directionally right.

It is not done yet. Two search semantics are still leaky:

1. `q: '*'` match-all requests are now likely broken by the field-scoped `MatchQuery` conversion.
2. Filter-only/facet-only empty-query requests are now guaranteed empty because of the new no-leg guard.

Those are not theoretical. The codebase uses both patterns in memory routes/tools. These paths are exactly the kind of "works sometimes, zeros sometimes" search behavior this branch is supposed to eliminate.

## Finding 1: `q: '*'` Was Accidentally Converted From Match-All Into Literal Match

Severity: critical

Files:

- `packages/adapter-antfly/src/query-translation.ts:32`
- `packages/adapter-antfly/src/query-translation.ts:77`
- `plugins/memory/lib/routes/status.ts:39`
- `plugins/memory/lib/routes/recent.ts:128`

The remediation now field-scopes every full-text query when searchable fields are known:

```ts
{ match: text, field }
```

That is correct for normal user terms like `build feature`. It is not correct for the existing `q: '*'` convention.

The memory status and recent routes explicitly rely on `q: '*'` meaning match all:

- `/status` uses `q: '*'` to count rows by tier.
- `/recent` fans out `q: '*'` by tier/agent/kind and sorts by timestamp.

Before this commit, `q: '*'` could travel as the query-string shape `{ query: '*' }`, which is plausibly interpreted as match-all. After this commit, it becomes:

```ts
{
  should: {
    disjuncts: [
      { match: '*', field: 'title' },
      { match: '*', field: 'content' }
    ]
  }
}
```

Antfly's SDK exposes an explicit `MatchAllQuery` shape:

```ts
{ match_all: {} }
```

A `MatchQuery` for `'*'` is not a defensible match-all representation. It will either tokenize to nothing, search for a literal asterisk, or otherwise diverge from the route's intended semantics.

Recommended fix:

1. In `buildQueryRequest`, special-case `q.text.trim() === '*'` before `buildFieldScopedFullTextSearch`.
2. Emit Antfly's explicit match-all AST:

```ts
request.full_text_search = { match_all: {} } as QueryRequest['full_text_search']
```

3. Do not add `semantic_search` for `'*'`, even under default hybrid strategy. Match-all/count/list routes should be full-text/filter execution only, not vector search for a wildcard token.
4. Add query translation tests:

```ts
it('maps q:* to MatchAllQuery even when searchable fields are configured', () => {
  const req = buildQueryRequest('bakin_memory', {
    text: '*',
    strategy: 'fts',
    adapterOptions: { searchableFields: ['title', 'content'] },
  }, settings)
  expect(req.full_text_search).toEqual({ match_all: {} })
})
```

5. Add adapter-level tests proving `q: '*'` still has a search leg after readiness filtering and is sent to Antfly.

## Finding 2: Filter-Only And Facet-Only Searches Are Now Deterministically Empty

Severity: critical

Files:

- `packages/adapter-antfly/src/search.ts:547`
- `packages/adapter-antfly/src/search.ts:601`
- `packages/adapter-antfly/src/search.ts:770`
- `plugins/memory/mcp/list-agents.ts:31`
- `plugins/memory/mcp/status.ts:39`
- `plugins/memory/lib/routes/sessions.ts:138`
- `plugins/memory/lib/routes/checkpoints.ts:46`
- `plugins/memory/lib/routes/audit.ts:47`
- `plugins/memory/lib/routes/dreams.ts:65`

The new no-leg guard is correct for one case: semantic-only queries whose vector indexes were stripped because they are not ready. In that case, sending a no-criteria request to Antfly is dangerous.

But the guard now treats every request without `full_text_search` or `semantic_search` as invalid, even when the request has filters, facets, or aggregations.

The codebase already sends these:

- `bakin_exec_memory_list_agents`: `q: ''`, `filters: { tier }`, `facets: ['agent']`
- `bakin_exec_memory_status`: `q: ''`, `filters: { tier }`, `limit: 0`
- `turnsListRoute`: `q: ''`, filters for turn listing
- `checkpointsListRoute`: `q: sessionId ?? ''`
- `auditRoute`: `qText` can be empty for listing audit rows
- `dreamsListRoute`: `qTerms.join(' ')` can be empty for listing all dreams for an agent

After this commit, these produce a request with only `filter_query` and maybe `aggregations`, then `hasSearchLeg()` returns false, and the adapter returns an empty result without calling Antfly.

Recommended fix:

Prefer a central adapter policy instead of patching callsites one by one:

1. Define empty-query search semantics in the adapter:
   - Empty `text` plus filters/facets/aggregations means match-all full-text query with filters.
   - Empty `text` with no filters/facets/aggregations can remain empty result.
2. In `buildQueryRequest`, when `q.text` is blank and the request has filters/facets/aggregations, emit:

```ts
request.full_text_search = { match_all: {} } as QueryRequest['full_text_search']
```

3. Force this path away from semantic search. Do not produce `semantic_search: ''`.
4. Keep `offset` allowed only for full-text-only/match-all requests.
5. Update `hasSearchLeg()` only after the request builder has had a chance to create a match-all leg.

Add tests:

- `buildQueryRequest` with `text: ''`, filters, and facets emits `{ match_all: {} }`.
- The same request preserves `filter_query` and `aggregations`.
- Adapter `query()` calls Antfly for filter-only/facet-only requests rather than returning empty.
- Empty request with no text, no filters, no facets, no aggregations still returns empty and does not call Antfly.

Also update obvious callers to be explicit where appropriate:

- `plugins/memory/mcp/list-agents.ts`: use `q: '*'`, `strategy: 'full_text_only'`.
- `plugins/memory/mcp/status.ts`: use `q: '*'`, `strategy: 'full_text_only'`.
- `plugins/memory/lib/routes/audit.ts`: for empty `qText`, rely on match-all semantics or explicitly set `q: '*'`, `strategy: 'full_text_only'`.
- `plugins/memory/lib/routes/dreams.ts`: same for list-all.
- `plugins/memory/lib/routes/checkpoints.ts`: same when `sessionId` is missing.

## Finding 3: `turnsListRoute` Requires `sessionId` But Does Not Use It

Severity: high

File:

- `plugins/memory/lib/routes/sessions.ts:194`

`turnsListRoute` requires `sessionId`, then calls:

```ts
const filters: Record<string, string> = { agent }
return queryTurns(ctx, filters, limit, offset)
```

`queryTurns()` uses `q: ''` and never receives `sessionId`. Before the guard, this could return all turns for the agent. After the guard, it returns empty. Neither behavior satisfies "List turns by (agent, sessionId)".

Recommended fix:

1. Pass `sessionId` into the query text or add a real indexed/faceted `sessionId` field.
2. If `sessionId` only exists inside JSON `meta`, the current `sessionTurnsRoute` pattern is safer:

```ts
q: sessionId,
filters: { tier: 'turn', agent, ...(eventType ? { eventType } : {}) }
```

3. Add tests that `GET /turns?agent=a&sessionId=s` sends `q: 's'`, not `q: ''`.

## Finding 4: Search Model Onboarding Still Uses Default Settings, Not Active Settings

Severity: high

Files:

- `src/core/search-adapter-factory.ts:50`
- `src/core/search-adapter-factory.ts:53`
- `src/core/onboarding/search-models.ts:18`
- `packages/adapter-antfly/src/setup.ts:22`

The remediation correctly added:

```ts
requiredModelsForSettings(settings)
```

But the actual onboarding setup is still created as:

```ts
return createAntflySearchSetup(logger)
```

That means `bakin check search-models` and `bakin install search-models` are based on `DEFAULT_SETTINGS`, not the user's active settings.

Runtime health uses active settings, so this creates a bad loop:

1. User enables reranker or configures a custom Antfly embedder.
2. User runs `bakin install search-models`.
3. Onboarding installs/checks only default models.
4. Runtime health still reports missing models.
5. Indexing/querying can still fail because the model actually used by the table was never pulled.

Recommended fix:

1. Change `getSearchAdapterSetup` to accept settings:

```ts
export function getSearchAdapterSetup(
  name: SearchAdapterName,
  logger?: AdapterLogger,
  settings?: SearchAdapterSettings,
): SearchAdapterSetup
```

2. Pass active settings from onboarding lazily, not at module load:

```ts
function setup() {
  return getSearchAdapterSetup(
    'antfly',
    createLogger('onboarding:search-models'),
    getSettings().search.settings,
  )
}
```

3. Have `searchModelsComponent.check()` and `.install()` call `setup()` inside the function so changes to settings are reflected.
4. Add tests with a temporary settings override:
   - reranker enabled means search-models check includes reranker.
   - custom embedder model means install pulls the custom model.
   - reranker disabled means missing reranker is not reported.

## Finding 5: Static `REQUIRED_MODELS` Is Now A Catalog, But It Is Still Used Like The Active Requirement Set

Severity: medium

Files:

- `packages/adapter-antfly/src/models.ts:33`
- `src/core/search-adapter-factory.ts:59`
- `src/core/onboarding/search-models.ts:12`

`REQUIRED_MODELS` still includes the reranker. That is fine as a static known-model catalog, but it is no longer the active required set for default settings.

The code now has two concepts with the same name:

- Static catalog: BGE, clipclap, reranker.
- Active requirement set: configured Antfly embedders plus reranker only when enabled.

Recommended fix:

1. Rename or document the static export as `KNOWN_MODELS` or `DEFAULT_MODEL_CATALOG`.
2. Add `getSearchAdapterRequiredModels(name, settings?)` and derive from active settings when settings are provided.
3. Audit any UI/onboarding copy that says "all 3 models" under default settings. Default should be 2 required models unless reranker is enabled.

## Finding 6: Missing-Model Copy Is Wrong When Only The Reranker Is Missing

Severity: medium

Files:

- `packages/adapter-antfly/src/models.ts:145`
- `packages/adapter-antfly/src/search.ts:275`

The message says semantic indexing/search is degraded or dead. That is accurate when an embedder is missing. It is misleading when the only missing model is an enabled reranker.

Recommended fix:

1. Split missing models by kind.
2. If any embedder is missing, say semantic indexing/search is degraded and recommend `bakin reindex`.
3. If only reranker is missing, say reranking is unavailable/degraded. Do not imply indexing is broken.

## Finding 7: Phase 8 Still Needs Live Antfly Verification

Severity: medium

File:

- `packages/adapter-antfly/src/query-translation.ts:134`

The `remoteMedia` template was deliberately left untouched. That is the correct restraint, but it still needs closure before calling this branch finished.

Recommended verification:

1. Use a running Antfly instance with the current pinned binary.
2. Create a tiny assets table with the visual index template:

```hbs
{{#if media_url}}{{remoteMedia url=media_url}}{{/if}}
```

3. Index one known remote image URL and one text-only asset.
4. Confirm table status shows visual index progress and no template/render error.
5. Run a visual/text query that should retrieve the image-backed row.
6. Only change the template if live behavior proves the current helper syntax is wrong.

## Tests To Add Before This Is Mergeable

Minimum new tests:

- `buildQueryRequest` maps `q: '*'` to `{ match_all: {} }`.
- `buildQueryRequest` maps empty filter/facet-only requests to `{ match_all: {} }` plus `filter_query`/`aggregations`.
- Empty no-criteria requests still do not call Antfly.
- `plugins/memory/lib/routes/status.ts` and `recent.ts` still send valid match-all requests through the real adapter translation.
- `plugins/memory/mcp/list-agents.ts` and `status.ts` no longer use `q: ''` without an explicit match-all policy.
- `plugins/memory/lib/routes/sessions.ts` uses `sessionId` in `turnsListRoute`.
- `search-models` onboarding uses active settings for custom embedders and enabled reranker.

Recommended live smoke test:

1. Start `bakin dev`.
2. Wait for Antfly to report all indexes with nonzero `total_indexed`.
3. Hit memory status/recent/list-agents paths and confirm counts are nonzero.
4. Run a normal term query and confirm full-text contributes.
5. Temporarily set `search.reranker.enabled = true`, run `bakin check search-models`, and confirm reranker is required only then.
6. Temporarily configure a custom Antfly embedder model, run `bakin check/install search-models`, and confirm the custom model is checked/pulled.

## Dev-Exit Commit Recommendation

The dev-exit fix should be committed separately from search remediation.

Include:

- `src/core/cli.ts`
- `src/core/lifecycle.ts`
- `scripts/dev-shutdown.ts`
- `tests/core/lifecycle.test.ts`
- `tests/scripts/dev-shutdown.test.ts`
- `tests/core/cli-dev.test.ts`

Do not include:

- `packages/host/src/api/_embedded-assets-static.ts`
- `ANTFLY_SEARCH_REMEDIATION_PLAN.md`
- this review doc unless you intentionally want review docs committed

Suggested commit message:

```text
fix(dev): wait for child shutdown on interrupt
```

