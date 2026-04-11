# AntflyDB Search System — Implementation Plan

**Spec:** `.claude/specs/antfly-search-system.md`
**Issue:** madeinwyo/bakin#3
**Date:** 2026-04-10

---

## Dependency Graph

```
                        ┌─────────────────────┐
                        │  T1: Settings +      │
                        │  Types + SDK Client  │
                        └──────────┬──────────┘
                                   │
                        ┌──────────▼──────────┐
                        │  T2: ctx.search      │
                        │  Provider + Registry │
                        └──────────┬──────────┘
                                   │
                        ┌──────────▼──────────┐
                        │  T3: Watcher Unlink  │
                        │  + Orphan Cleanup    │
                        └──────────┬──────────┘
                                   │
               ════════════════════╪══════════════════ CHECKPOINT 1
                                   │
        ┌──────────┬──────────┬────┴────┬──────────┬──────────┬──────────┐
        ▼          ▼          ▼         ▼          ▼          ▼          ▼
    ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐
    │ T4:  │  │ T5:  │  │ T6:  │  │ T7:  │  │ T8:  │  │ T9:  │  │ T10: │
    │Tasks │  │Assets│  │Proj  │  │ WF   │  │Sched │  │ Team │  │Audit │
    └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘
       └─────────┴────────┴────┬────┴─────────┴─────────┴──────────┘
                               │
               ════════════════╪══════════════════ CHECKPOINT 2
                               │
                    ┌──────────▼──────────┐
                    │  T11: Cross-Table   │
                    │  Search API + Per-  │
                    │  Plugin Routes      │
                    └──────────┬──────────┘
                               │
               ════════════════╪══════════════════ CHECKPOINT 3
                               │
                    ┌──────────▼──────────┐
                    │  T12: useAntfly-    │
                    │  Search Hook        │
                    └──────────┬──────────┘
                               │
        ┌──────────┬──────────┬┴────┬──────────┬──────────┬──────────┐
        ▼          ▼          ▼     ▼          ▼          ▼          ▼
    ┌──────┐  ┌──────┐  ┌──────┐ ┌──────┐ ┌──────┐  ┌──────┐  ┌──────┐
    │ T13: │  │ T14: │  │ T15: │ │ T16: │ │ T17: │  │ T18: │  │ T19: │
    │Tasks │  │Assets│  │Proj  │ │ WF   │ │Sched │  │Memory│  │Facets│
    │  UI  │  │  UI  │  │  UI  │ │  UI  │ │  UI  │  │  UI  │  │Agg  │
    └──┬───┘  └──┬───┘  └──┬───┘ └──┬───┘ └──┬───┘  └──┬───┘  └──┬───┘
       └─────────┴────────┴───┬───┴────────┴─────────┴──────────┘
                              │
               ═══════════════╪══════════════════ CHECKPOINT 4
                              │
                   ┌──────────▼──────────┐
                   │  T20: Health Plugin │
                   │  + Doctor + Metrics │
                   └─────────────────────┘
                              │
               ═══════════════╪══════════════════ CHECKPOINT 5
```

---

## Phase 1: Foundation (T1–T3)

### T1: Settings, Types, and SDK Client

**Goal:** New settings fields, SearchAPI types in PluginContext, and rewrite `antfly.ts` to use `@antfly/sdk`.

**Files to modify:**
- `packages/core/src/settings.ts` — add `search`, `embedder`, `chunking`, `auditTtl`, `cleanupInterval` to `BakinSettings.antfly` + defaults
- `packages/core/src/plugin-types.ts` — add `SearchAPI`, `SearchContentTypeDefinition` (with `reindex()` generator, `verifyExists()` callback, `chunker?` config), `SchemaField`, `SearchQueryParams`, `SearchResponse` interfaces; add `search: SearchAPI` to `PluginContext`; add `transform()` method to `SearchAPI` for atomic field updates
- `src/core/antfly.ts` — full rewrite: replace raw `fetch()` with `AntflyClient` from `@antfly/sdk`; replace `TABLES` const with dynamic registry; keep `enabled()`, `initialize()`, `search()` public API but rewrite internals; remove `beacon_*` references; add `wipeBeaconTables()` for cleanup; add table creation from `SearchContentTypeDefinition` with chunker + embedder config; add `indexDocument()`, `removeDocument()`, `transformDocument()`, `searchTable()`, `multiQuery()`, `getTableStats()`, `scanTable()`, `rebuildIndexes()` that the ctx.search provider will delegate to; add embedder config change detection on startup

**Acceptance criteria:**
- `BakinSettings` includes `antfly.search.strategy`, `antfly.search.defaultLimit`, `antfly.embedder.{provider,model}`, `antfly.chunking.{defaultTargetTokens,defaultOverlapTokens}`, `antfly.auditTtl`, `antfly.cleanupInterval`
- `PluginContext` has `search: SearchAPI` with `registerContentType()`, `index()`, `remove()`, `transform()`, `query()`
- `SearchContentTypeDefinition` requires `reindex()` async generator and `verifyExists()` callback
- `antfly.ts` uses `AntflyClient` for all operations
- Old `beacon_*` tables are wiped on startup (no migration)
- Embedder config mismatch on startup detected and logged
- `antfly.ts` exports: `initialize()`, `enabled()`, `indexDocument()`, `removeDocument()`, `transformDocument()`, `search()`, `multiQuery()`, `createTable()`, `getTableStats()`, `scanTable()`, `rebuildIndexes()`
- All existing tests pass (mock adjustments as needed)

**Verification:**
- `pnpm tsc --noEmit` passes
- Existing `tests/core/antfly.test.ts` passes (updated mocks)
- Manual: start Bakin with Antfly enabled, verify connection log

---

### T2: ctx.search Provider and Content Type Registry

**Goal:** Implement the `SearchAPI` that gets injected into every plugin's context. Central registry tracks all registered content types.

**Files to modify:**
- `src/core/search-registry.ts` — NEW file: `SearchContentTypeRegistry` class. Stores definitions, delegates to `antfly.ts` for table creation. Provides `register()`, `getAll()`, `getByTable()`, `getByPluginId()`. Singleton on `globalThis.__bakinSearchRegistry`.
- `src/lib/plugin-registry.ts` — in `buildContext()` (~line 143): create `SearchAPI` instance scoped to `pluginId`, inject as `ctx.search`
- `server.ts` — after `antfly.initialize()` (~line 89), pass registry reference; after plugin activation, call registry to ensure all tables created

**Acceptance criteria:**
- Any plugin can call `ctx.search.registerContentType(def)` during `activate()`
- `ctx.search.index(key, doc)` delegates to `antfly.indexDocument()` with the plugin's table
- `ctx.search.remove(key)` delegates to `antfly.removeDocument()`
- `ctx.search.query(params)` delegates to `antfly.search()` scoped to plugin's table
- If Antfly disabled, all operations are no-ops / return empty
- Registry is queryable: `getAllContentTypes()` returns all registered types (needed for cross-table search and health)

**Verification:**
- Unit test: register content type, verify table creation called
- Unit test: index/remove/query delegate correctly
- Unit test: disabled Antfly = no-op
- `pnpm tsc --noEmit` passes

---

### T3: Watcher Unlink Handler + Orphan Cleanup

**Goal:** Wire file deletion events to search removal. Add periodic orphan cleanup.

**Files to modify:**
- `src/core/watcher.ts` — add `UnlinkHook` type, `unlinkHooks[]` array, `registerUnlinkHook()` export; in `start()`, add `watcher.on('unlink', ...)` handler that fires unlink hooks with the relative path
- `src/core/antfly.ts` — add `syncFileUnlink(relativePath)` that determines table from path and calls `removeDocument()`
- `src/core/search-cleanup.ts` — NEW file: `startCleanupTimer(intervalMs)`, `runCleanup()`. For each registered content type with a `verifyExists` callback, scan the Antfly table and remove documents whose source no longer exists. Track metrics (`lastCleanupAt`, `lastCleanupRemoved`).
- `server.ts` — register unlink hook (~line 92); start cleanup timer after plugin activation

**Acceptance criteria:**
- Deleting a file in `~/.bakin/` triggers `unlink` event → search removal
- Cleanup runs on configurable interval (default 24h)
- Cleanup logs removed count per table
- Cleanup metrics available via export for health endpoint

**Verification:**
- Unit test: unlink hook fires on file deletion
- Unit test: `syncFileUnlink` maps paths to correct tables
- Unit test: cleanup removes orphaned documents
- Manual: delete a file, verify it disappears from Antfly

---

### T3b: Phase 1 Documentation

**Goal:** Document the search foundation before moving on.

**Files to create/update:**
- `.claude/knowledge/search-system.md` — NEW: architecture overview of ctx.search API, content type registry, indexing pipeline (filesystem vs SQLite vs OpenClaw), hybrid search (BM25 + semantic), graceful degradation, cross-table search via multiquery, embedder config, chunking, transforms, orphan cleanup. The "how search works in Bakin" reference doc.
- `.claude/knowledge/storage-model.md` — UPDATE: replace 3-line "Antfly Indexing" section with proper summary + pointer to search-system.md. Add deletion sync. Note that tasks are SQLite-backed (not file-watched).
- `.claude/knowledge/plugin-system.md` — UPDATE: add `ctx.search` to PluginContext documentation alongside registerExecTool, registerRoute, etc.
- `CLAUDE.md` — UPDATE: architecture section (replace one-liner with paragraph), key patterns (add Search Indexing), directory map (add new files), plugin system section (mention ctx.search)

**Acceptance criteria:**
- `search-system.md` is self-contained — reader understands the full search architecture without reading the spec
- Includes code examples for every ctx.search method
- Covers error/fallback behavior
- All file paths referenced are accurate

---

### CHECKPOINT 1

**Gate:** Before proceeding to plugin indexing:
- [ ] `pnpm tsc --noEmit` passes
- [ ] `pnpm test` passes (all existing + new tests)
- [ ] Manual verification: Bakin starts with Antfly enabled, tables created, no errors in log
- [ ] `ctx.search` API works end-to-end (index → search → find)
- [ ] `search-system.md` knowledge doc written and accurate

---

## Phase 2: Plugin Indexing (T4–T10)

These tasks are **independent** and can be implemented in parallel. Each wires a single plugin's content to the search index.

### T4: Tasks Plugin Indexing

**Goal:** All tasks (any status) indexed on every mutation. Source: SQLite via task-service.

**Files to modify:**
- `plugins/tasks/index.ts` — in `activate()`, call `ctx.search.registerContentType()` with tasks schema (title, description, status, priority, agent, column, project, tags, log_text, created_at, updated_at). Facets: status, agent, priority, project. Embedding: `{{title}} {{description}} {{log_text}}`. Add `verifyExists` callback that checks flow-store.
- `src/core/task-service.ts` — add search index calls after existing side effects:
  - `createTaskWithEffects` (~line 237): `search.index()`
  - `moveTaskWithEffects` (~line 107): replace `indexCompletedTask()` with `search.index()` for ALL statuses
  - `blockTaskWithEffects` (~line 163): `search.index()`
  - `logProgress` (~line 69): `search.index()` (log content now searchable)
  - Delete handler: `search.remove()`
- `src/core/task-service.ts` — remove import of `indexCompletedTask` from `antfly.ts` (replaced by ctx.search)
- `plugins/tasks/index.ts` — add `reindex` hook or expose function for `reindexAll`

**Acceptance criteria:**
- Creating a task indexes it immediately
- Moving a task re-indexes with new status
- Logging progress re-indexes with log content
- Deleting a task removes from index
- All task fields are searchable (title, description, log text)
- Facets return correct counts for status, agent, priority

**Verification:**
- Unit test: mock ctx.search, verify index/remove called on each mutation
- Manual: create task, search for it by title and by description

---

### T5: Assets Plugin Indexing

**Goal:** Asset sidecar metadata indexed on write/delete/trash.

**Files to modify:**
- `plugins/assets/index.ts` — in `activate()`, call `ctx.search.registerContentType()` with assets schema. Add `verifyExists` callback that checks file exists.
- `plugins/assets/index.ts` — add `ctx.search.index()` after audit calls in: upload handler (~line 126), link handler (~line 156), exec tool save (~line 276)
- `plugins/assets/index.ts` — add `ctx.search.remove()` after audit in: delete handler (~line 140), exec tool delete (~line 298)
- `plugins/assets/index.ts` — remove reliance on watcher sync hook for asset indexing (direct indexing is more immediate and carries structured metadata)

**Acceptance criteria:**
- Uploading an asset indexes it immediately with all sidecar fields
- Trashing removes from index
- Restoring re-indexes
- Search by filename, description, tags all work

**Verification:**
- Unit test: mock ctx.search, verify calls on upload/delete/trash/restore
- Manual: upload asset, search by description

---

### T6: Projects Plugin Indexing

**Goal:** Project markdown files indexed on create/update/delete.

**Files to modify:**
- `plugins/projects/index.ts` — in `activate()`, call `ctx.search.registerContentType()`. Add `verifyExists` callback.
- `plugins/projects/lib/project-service.ts` — add `ctx.search.index()` after `appendAudit()`/`broadcast()` in: `createProject` (~line 124), `updateProject` (~line 159), checklist mutations. Add `ctx.search.remove()` in `deleteProject` (~line 176).

**Acceptance criteria:**
- Creating/updating a project indexes title, description, body, status, checklist counts
- Deleting removes from index
- Full markdown body is searchable for deep content search

**Verification:**
- Unit test: mock ctx.search, verify calls
- Manual: create project, search for content in body

---

### T7: Workflows Plugin Indexing

**Goal:** Workflow templates and instances indexed on save/step/complete.

**Files to modify:**
- `plugins/workflows/index.ts` — in `activate()`, register content type with workflow schema (name, description, doc_type, status, steps_total, steps_done, agent). Add `verifyExists` callback.
- `plugins/workflows/lib/runtime.ts` — add `ctx.search.index()` after `saveInstance()` in: `createInstance` (~line 223), `completeStep` (~line 516), `approveGate` (~line 605), `rejectGate` (~line 803)
- `plugins/workflows/index.ts` — add index calls in template save routes

**Acceptance criteria:**
- Saving a template indexes it
- Starting an instance indexes it
- Step completion re-indexes with progress
- Completion/failure re-indexes with final status

**Verification:**
- Unit test: mock ctx.search, verify calls on instance lifecycle
- Manual: start workflow, verify searchable

---

### T8: Schedule Plugin Indexing

**Goal:** Cron jobs indexed on CRUD + periodic sync from OpenClaw.

**Files to modify:**
- `plugins/schedule/index.ts` — in `activate()`, register content type with schedule schema. Add `verifyExists` callback.
- `plugins/schedule/index.ts` — add `ctx.search.index()` after audit/log in: `createJobHandler` (~line 271), `updateJobHandler` (~line 312), `pauseHandler` (~line 409). Add `ctx.search.remove()` in `deleteJobHandler` (~line 366).
- `plugins/schedule/index.ts` — on job list fetch (GET / route), batch-index all jobs for periodic freshness

**Acceptance criteria:**
- Creating/updating/pausing a job indexes it
- Deleting removes from index
- Job prompt text is searchable (important for semantic search)
- Periodic refresh ensures OpenClaw-side changes are reflected

**Verification:**
- Unit test: mock ctx.search, verify calls on CRUD
- Manual: create scheduled job, search by display name and prompt

---

### T9: Team Plugin Indexing

**Goal:** Agent data from OpenClaw indexed on load/heartbeat.

**Files to modify:**
- `plugins/team/index.ts` — in `activate()`, register content type with team schema. Add `verifyExists` callback.
- `plugins/team/index.ts` — on agent list fetch (GET / route), batch-index all agents
- `plugins/team/index.ts` — on heartbeat update, re-index the agent

**Acceptance criteria:**
- Agent list load indexes all agents
- Heartbeat updates refresh index entry
- Agent name, role, status, model all searchable

**Verification:**
- Unit test: mock ctx.search, verify batch index on agent load
- Manual: search for agent by role

---

### T10: Audit Indexing (with TTL)

**Goal:** Audit events indexed with TTL. Replaces current `indexAuditEvent()`.

**Files to modify:**
- `src/core/audit.ts` — replace `indexAuditEvent(entry)` call (~line 47) with new search registry approach. The audit "plugin" is really core, so either: (a) register audit content type during server startup, or (b) have a lightweight audit search module.
- `src/core/antfly.ts` — remove `indexAuditEvent()` (replaced by ctx.search)

**Design decision:** Since audit isn't a plugin but core infrastructure, register the audit content type in `server.ts` after plugin activation, using the search registry directly rather than ctx.search.

**Acceptance criteria:**
- Audit events indexed with structured fields (event, agent, channel)
- TTL set from `settings.antfly.auditTtl` (default 90d)
- Old entries auto-cleaned by Antfly
- Audit search supports filtering by event type, agent, channel

**Verification:**
- Unit test: verify audit indexing with TTL config
- Manual: search audit by event type

---

### T10b: Phase 2 Documentation

**Goal:** Document the plugin indexing patterns and create the "add search to plugin" skill.

**Files to create/update:**
- `.claude/knowledge/search-plugin-guide.md` — NEW: how to make any plugin searchable. Covers: `registerContentType()` with full schema example, `reindex()` async generator patterns (SQLite, filesystem, OpenClaw sources), `verifyExists()`, chunking decision tree, transforms vs full re-index, facet selection, embedding template design. Includes complete before/after example for a hypothetical addon plugin.
- `.claude/skills/add-search-to-plugin.md` — NEW: step-by-step skill (parallels `create-plugin.md`). Steps: 1) Design schema, 2) Choose searchable fields, 3) Write embedding template, 4) Implement reindex generator, 5) Wire mutation hooks, 6) Register search route, 7) Test.
- `.claude/knowledge/tasks-plugin.md` — UPDATE: replace "Completed tasks are indexed in Antfly" with accurate description of all-status indexing, rich schema, facets, transform usage for status changes.
- `.claude/knowledge/assets-plugin.md` — UPDATE: structured sidecar indexing, trash removal from index, type/agent/tool facets.

---

### CHECKPOINT 2

**Gate:** Before proceeding to search API:
- [ ] All 7 content types registered and indexing on mutations
- [ ] `pnpm tsc --noEmit` passes
- [ ] `pnpm test` passes
- [ ] Manual: `POST /api/reindex` indexes all content, returns correct counts
- [ ] Manual: verify each content type appears in Antfly tables
- [ ] `search-plugin-guide.md` and `add-search-to-plugin` skill written

---

## Phase 3: Search API, MCP Tools & CLI (T11–T11b)

### T11: Cross-Table Search API + Per-Plugin Routes

**Goal:** Enhanced `/api/search` with cross-table support (using multi-query for efficiency), structured filters, aggregations. Per-plugin search routes. Reindex with rebuild support.

**Files to modify:**
- `server.ts` — rewrite `/api/search` handler (~lines 159-175): use `client.multiquery()` for cross-table search; add `filters` param; add aggregations; add `meta` with timing
- `server.ts` — rewrite `/api/reindex` handler (~lines 251-259): use content type registry `reindex()` generators; add `?table=` and `?rebuild=` params
- `server.ts` — add `/api/antfly/health` endpoint
- Each plugin's `index.ts` — register a `/search` route via `ctx.registerRoute()`

**Key implementation detail:** Cross-table search uses Antfly `multiquery()` to execute all table queries in a single HTTP request instead of N serial calls.

**Response shape for `/api/search`:**
```typescript
{
  results: [{ id, table, score, fields }],
  aggregations: { [field]: [{ value, count }] },
  meta: { query, total, took_ms, source, tables_searched }
}
```

**Acceptance criteria:**
- `/api/search?q=test` returns results from ALL tables, merged by score
- `/api/search?q=test&table=tasks` scopes to one table
- Each plugin has `/api/plugins/{id}/search` with its own filter params
- Aggregations returned for declared facets
- `/api/reindex?table=tasks&rebuild=true` drops indexes, recreates, reindexes
- `/api/antfly/health` returns table stats and metrics

**Verification:**
- Unit test: cross-table search merges results correctly
- Unit test: per-plugin route maps filters correctly
- Unit test: reindex with rebuild drops and recreates indexes
- Manual: `curl /api/search?q=test` returns mixed results

---

### T11b: MCP Search Tools + CLI Commands

**Goal:** Full search tool surface for agents (MCP) and operators (CLI). Agents won't be wired yet but the tools are ready.

**Files to modify:**
- `scripts/lib/search-tools.ts` — NEW file: register 7 MCP exec tools via `addExecTool()`:
  - `bakin_exec_search_query` — cross-table semantic search with structured filters
  - `bakin_exec_search_table` — per-table search with facets
  - `bakin_exec_search_lookup` — get document by key
  - `bakin_exec_search_facets` — get filter values + counts for a table
  - `bakin_exec_search_similar` — find semantically similar documents
  - `bakin_exec_search_reindex` — trigger reindex (full/per-table/rebuild)
  - `bakin_exec_search_stats` — index health and table stats
- `cli/bakin.ts` — enhance existing `search` command, add `search:facets`, `search:similar`, `search:stats`, `search:cleanup`; add `--table`, `--rebuild`, `--json` flags to `reindex`

**MCP tool parameter design:**
- All tools accept structured `filters` object (not just query string)
- Results return typed `fields` per hit (not raw text blobs)
- `search_facets` lets agents discover what's filterable without prior knowledge
- `search_similar` accepts a document key and returns semantically similar docs

**CLI commands:**
```bash
bakin search "query" [--table X] [--json]
bakin search:facets <table> [--facet <field>]
bakin search:similar <table>:<key> [--limit N]
bakin search:stats
bakin search:cleanup
bakin reindex [--table X] [--rebuild]
```

**Acceptance criteria:**
- All 7 MCP tools registered and callable
- CLI commands work with proper output formatting
- `--json` flag returns machine-readable output
- Tools degrade gracefully when Antfly is disabled

**Verification:**
- Unit test: each MCP tool with mocked search backend
- Manual: `bakin search "test"` returns formatted results
- Manual: `bakin search:stats` shows table counts

---

### T11c: Phase 3 Documentation

**Goal:** Document the full API surface — REST, MCP, CLI.

**Files to create:**
- `.claude/knowledge/search-api-reference.md` — NEW: complete API reference. REST endpoints (request/response shapes, filter syntax, aggregation format). All 7 MCP exec tools (parameters, return types, use cases). CLI commands (flags, output formats). Includes curl examples and expected responses.

---

### CHECKPOINT 3

**Gate:** Before proceeding to UI:
- [ ] All API endpoints working and tested
- [ ] Cross-table search returns results from all 7 tables
- [ ] Aggregations return correct facet counts
- [ ] All 7 MCP tools registered
- [ ] CLI commands functional
- [ ] Health endpoint returns accurate table stats
- [ ] `search-api-reference.md` written
- [ ] `pnpm test` passes

---

## Phase 4: UI Integration (T12–T19)

### T12: useAntflySearch Hook

**Goal:** Shared React hook with debounce, optimistic client-side fallback, aggregation support.

**Files to create:**
- `src/hooks/use-antfly-search.ts` — NEW file

**Implementation:**
```typescript
export function useAntflySearch<T>(
  endpoint: string,
  params: Record<string, string | undefined>,
  options?: {
    debounceMs?: number        // default: 250
    fallbackData?: T[]
    fallbackFilter?: (item: T, query: string) => boolean
    enabled?: boolean
  }
): {
  results: T[]
  isLoading: boolean
  isAntfly: boolean
  aggregations?: Record<string, Array<{ value: string; count: number }>>
  meta?: { took_ms: number; total: number }
}
```

**Behavior:**
1. Immediately apply fallback filter (optimistic)
2. Debounce 250ms, then fetch from endpoint
3. On success, replace with Antfly results
4. On failure, keep fallback (silent degradation)
5. Cancel in-flight requests on new query (AbortController)

**Acceptance criteria:**
- Hook returns instant results from fallback
- After debounce, swaps to Antfly results
- Network failure = fallback stays, no error shown
- `isAntfly` accurately reflects result source
- Aggregations populated when response includes them

**Verification:**
- Unit test: verify debounce timing
- Unit test: verify fallback on fetch failure
- Unit test: verify AbortController cancels stale requests

---

### T13–T18: Wire Plugin UI Search Bars

Each task follows the same pattern. **Independent, can parallelize.**

**Pattern per plugin:**
1. Replace `useMemo(() => data.filter(...))` with `useAntflySearch()`
2. Pass existing data as `fallbackData` + `fallbackFilter`
3. Use results from hook instead of local filter
4. Maintain all URL state (`?q=`, `?status=`, etc.)

#### T13: Tasks UI
- `plugins/tasks/components/kanban-board.tsx` / `task-filters.tsx`
- Replace `useTaskFilters` filtering with `useAntflySearch('/api/plugins/tasks/search', ...)`
- Wire status/agent facet counts to aggregations

#### T14: Assets UI
- `plugins/assets/components/assets-page.tsx`
- Replace client-side search + type filter with `useAntflySearch('/api/plugins/assets/search', ...)`
- Wire type/agent facet counts

#### T15: Projects UI
- `plugins/projects/components/project-grid.tsx`
- Replace client-side title search with `useAntflySearch('/api/plugins/projects/search', ...)`
- Wire status facet counts

#### T16: Workflows UI
- `plugins/workflows/components/workflows-page.tsx`
- Replace client-side name/description filter

#### T17: Schedule UI
- `plugins/schedule/components/schedule-page.tsx`
- Replace client-side search with `useAntflySearch('/api/plugins/schedule/search', ...)`
- Wire agent facet counts

#### T18: Memory UI
- `plugins/memory/components/audit-timeline.tsx` + `memory-log.tsx`
- Replace client-side search with `useAntflySearch('/api/plugins/memory/search', ...)`
- Wire event/agent/channel facet counts

**Acceptance criteria (each):**
- Search bar returns Antfly-powered results
- Fallback to client-side filter when Antfly is disabled
- URL state preserved (bookmarkable)
- No UI regression — same look and behavior

**Verification (each):**
- Manual: type in search bar, verify results come from Antfly (check network tab)
- Manual: disable Antfly in settings, verify search still works (client-side)

---

### T19: FacetFilter Aggregation Integration

**Goal:** Wire `FacetFilter` component to use server-side aggregation counts from Antfly.

**Files to modify:**
- `src/components/facet-filter.tsx` — add optional `counts` prop: `Record<string, number>` that overrides client-side counting when provided
- Each plugin using FacetFilter — pass aggregation data from `useAntflySearch` to `FacetFilter.counts`

**Acceptance criteria:**
- FacetFilter shows Antfly-sourced counts when available
- Falls back to client-side counting when aggregations not available
- Counts update reactively as search query changes

**Verification:**
- Manual: apply a search term, verify facet counts update to reflect filtered results (not total)

---

### T19b: Phase 4 Documentation

**Files to update:**
- `.claude/knowledge/url-state-deep-linking.md` — UPDATE: add `useAntflySearch` hook, how search URL params flow to API, debounce behavior.
- `.claude/knowledge/shared-ui-patterns.md` — UPDATE: add `useAntflySearch` hook pattern, FacetFilter `counts` prop from aggregations.

---

### CHECKPOINT 4

**Gate:** Before proceeding to health:
- [ ] All plugin search bars powered by Antfly
- [ ] Fallback works for every plugin when Antfly is disabled
- [ ] FacetFilter counts from aggregations
- [ ] `pnpm tsc --noEmit` passes
- [ ] No visual regressions
- [ ] UI pattern docs updated

---

## Phase 5: Health & Observability (T20)

### T20: Health Plugin Search Section + Doctor Checks

**Goal:** Full Antfly visibility in health plugin. Enhanced doctor checks.

**Files to modify:**
- `plugins/health/components/health-page.tsx` — add "Search" section with: connection status card, table overview (doc counts, index health, last indexed, embeddings), metrics (total docs, avg latency, last reindex, last cleanup), action buttons (Reindex All, Reindex Table, Run Cleanup, Clear Table)
- `src/core/doctor.ts` — enhance `checkAntfly()` (~line 253): add table existence check, schema/index verification, empty-table-with-content warning, orphan sample check
- `src/core/search-cleanup.ts` — expose metrics getter for health endpoint
- `plugins/health/index.ts` — register route for health metrics if not covered by `/api/antfly/health`

**Acceptance criteria:**
- Health page shows Antfly connection status, mode, version
- Table overview shows all registered tables (core + addon) with doc counts
- Reindex All / Reindex Table buttons work
- Run Cleanup button triggers orphan cleanup
- Doctor reports: missing tables, missing indexes, empty tables with content, stale beacon tables

**Verification:**
- Manual: health page shows all 7 tables with correct counts
- Manual: click Reindex All, verify counts update
- Manual: doctor output includes enhanced Antfly checks
- Manual: with Antfly disabled, health page shows "disabled" gracefully

---

### CHECKPOINT 5 (Final)

**Gate:** Ship-ready:
- [ ] All 7 content types indexed
- [ ] All plugin search bars powered by Antfly with fallback
- [ ] Cross-table search working
- [ ] Aggregation-powered facets
- [ ] Health plugin shows full Antfly state
- [ ] Doctor checks enhanced
- [ ] Orphan cleanup running on schedule
- [ ] Audit TTL configured and working
- [ ] `pnpm tsc --noEmit` passes
- [ ] `pnpm test` passes
- [ ] Manual E2E: create → search → update → search → delete → verify gone

---

## Commit Strategy

Each task gets its own commit on branch `feat/antfly-search`. Large tasks (T1, T11) split into sub-commits. Checkpoints get git tags.

```
feat(search): T1.1 — extend BakinSettings with search/embedder/chunking fields
feat(search): T1.2 — add SearchAPI types to PluginContext
feat(search): T1.3 — rewrite antfly.ts to use @antfly/sdk
feat(search): T2 — ctx.search provider and content type registry
feat(search): T3 — watcher unlink + orphan cleanup
docs(search): T3b — search-system.md, update storage-model, plugin-system, CLAUDE.md
  → git tag search-checkpoint-1
feat(search): T4 — tasks plugin indexing
feat(search): T5 — assets plugin indexing
feat(search): T6 — projects plugin indexing
feat(search): T7 — workflows plugin indexing
feat(search): T8 — schedule plugin indexing
feat(search): T9 — team plugin indexing
feat(search): T10 — audit indexing with TTL
docs(search): T10b — search-plugin-guide.md, add-search-to-plugin skill, update tasks/assets docs
  → git tag search-checkpoint-2
feat(search): T11 — cross-table search API + per-plugin routes
feat(search): T11b — MCP search tools + CLI commands
docs(search): T11c — search-api-reference.md
  → git tag search-checkpoint-3
feat(search): T12 — useAntflySearch hook
feat(search): T13 — tasks UI search
feat(search): T14 — assets UI search
feat(search): T15 — projects UI search
feat(search): T16 — workflows UI search
feat(search): T17 — schedule UI search
feat(search): T18 — memory UI search
feat(search): T19 — facet filter aggregation integration
docs(search): T19b — update url-state, shared-ui-patterns docs
  → git tag search-checkpoint-4
feat(search): T20 — health plugin + doctor checks
  → git tag search-checkpoint-5
```

**Rollback:** `git revert <commit>` per task. `git reset --hard search-checkpoint-N` per phase. Graceful degradation means partial implementation is always safe.

---

## Risk Notes

1. **Task indexing latency** — SQLite reads for index document construction could add latency to task mutations. Mitigation: fire-and-forget indexing, never block the mutation path.

2. **SDK v0.0.14 gaps** — the SDK may not expose all features we need (aggregations, scan, TTL config). Mitigation: fall back to raw HTTP for specific operations if SDK lacks support. Check during T1.

3. **Antfly shard initialization** — current code has a 3-second sleep after table creation. This may need adjustment with 7 tables. Mitigation: parallel table creation + single wait, or health-check polling.

4. **FacetFilter counts with cross-filtering** — aggregation counts need to reflect the CURRENT search query, not just totals. Verify Antfly returns filtered aggregations (not global).

5. **Watcher unlink reliability** — chokidar `unlink` may not fire for all deletion methods (e.g., `rm -rf` of parent directory). Mitigation: orphan cleanup as safety net.
