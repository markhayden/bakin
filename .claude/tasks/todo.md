# AntflyDB Search System — Task List

**Plan:** `.claude/tasks/plan.md`
**Spec:** `.claude/specs/antfly-search-system.md`
**Branch:** `feat/antfly-search`

---

## Phase 1: Foundation

- [x] **T1.1: Extend BakinSettings** ✓ `b4badd3`
- [x] **T1.2: Add SearchAPI Types to PluginContext** ✓ `022994a`
- [x] **T1.3: Rewrite antfly.ts with @antfly/sdk** ✓ `08cffa8`
- [x] **T2: ctx.search Provider and Content Type Registry** ✓ `abd41bb`
- [x] **T3: Watcher Unlink Handler + Orphan Cleanup** ✓ `b5679ad`

- [ ] **T3b: Phase 1 Documentation**
  - Create `.claude/knowledge/search-system.md` — full architecture overview
  - Update `.claude/knowledge/storage-model.md` — replace Antfly stub, add deletion sync
  - Update `.claude/knowledge/plugin-system.md` — add ctx.search to PluginContext docs
  - Update `CLAUDE.md` — architecture section, key patterns, directory map

### --- CHECKPOINT 1 --- `git tag search-checkpoint-1`
- [ ] `pnpm tsc --noEmit` passes
- [ ] `pnpm test` passes
- [ ] Bakin starts with Antfly, tables created, ctx.search works end-to-end
- [ ] `search-system.md` knowledge doc written

---

## Phase 2: Plugin Indexing (parallelizable)

Each plugin: register content type with schema + `reindex()` generator + `verifyExists()` + optional `chunker`. Wire `ctx.search.index/remove/transform` on every mutation.

- [x] **T4: Tasks Plugin Indexing** (SQLite source) ✓ `4a3005c`
  - Register content type with `reindex()` that reads all flow_runs from SQLite
  - Index on: create, move, block, logProgress, delete (in task-service.ts)
  - Replace `indexCompletedTask()` — index ALL statuses
  - Use `transform()` for status-only changes (high frequency)
  - Enable chunker for log_text field
  - Files: `plugins/tasks/index.ts`, `src/core/task-service.ts`

- [x] **T5: Assets Plugin Indexing** (filesystem source) ✓ `8815c2f`
  - Register with `reindex()` that scans `~/.bakin/assets/**/*.meta.json`
  - Index on upload/link, remove on delete/trash, re-index on restore
  - Files: `plugins/assets/index.ts`

- [x] **T6: Projects Plugin Indexing** (filesystem source) ✓ `a116d7b`
  - Register with `reindex()` that scans `~/.bakin/projects/*.md`
  - Index on create/update, remove on delete
  - Enable chunker for long markdown bodies
  - Files: `plugins/projects/index.ts`, `plugins/projects/lib/project-service.ts`

- [x] **T7: Workflows Plugin Indexing** (filesystem source) ✓ `569e8a2`
  - Register with `reindex()` that scans workflow definitions + instances
  - Index templates on save, instances on start/step/complete
  - Files: `plugins/workflows/index.ts`, `plugins/workflows/lib/runtime.ts`

- [x] **T8: Schedule Plugin Indexing** (OpenClaw source) ✓ `f69d6f5`
  - Register with `reindex()` that fetches all jobs from OpenClaw
  - Index on CRUD, batch-refresh on list fetch
  - Files: `plugins/schedule/index.ts`

- [x] **T9: Team Plugin Indexing** (OpenClaw source) ✓ `4b84cfd`
  - Register with `reindex()` that fetches all agents from OpenClaw
  - Batch-index on load, use `transform()` for heartbeat updates
  - Files: `plugins/team/index.ts`

- [x] **T10: Audit Indexing with TTL** ✓ `651a54b`
  - Register audit content type in `server.ts` with TTL from settings
  - Replace `indexAuditEvent()` in `audit.ts`
  - Register `reindex()` that scans `audit.jsonl`
  - Files: `server.ts`, `src/core/audit.ts`, `src/core/antfly.ts`

- [x] **T10b: Phase 2 Documentation**
  - Create `.claude/knowledge/search-plugin-guide.md` — how to make any plugin searchable
  - Create `.claude/skills/add-search-to-plugin.md` — step-by-step skill
  - Update `.claude/knowledge/tasks-plugin.md` — all-status indexing, rich schema
  - Update `.claude/knowledge/assets-plugin.md` — structured indexing, trash removal

### --- CHECKPOINT 2 --- `git tag search-checkpoint-2`
- [ ] All 7 content types registered and indexing on mutations
- [ ] `POST /api/reindex` triggers all `reindex()` generators, returns correct counts
- [ ] `POST /api/reindex?rebuild=true` drops indexes + re-embeds
- [ ] `search-plugin-guide.md` and skill written
- [ ] `pnpm test` passes

---

## Phase 3: Search API + MCP Tools + CLI

- [x] **T11: Cross-Table Search API + Per-Plugin Routes + Health Endpoint** ✓ `5be3808`
  - Rewrite `/api/search` — use `multiquery()` for cross-table
  - Rewrite `/api/reindex` — per-table, rebuild support
  - Add `/api/antfly/health`
  - Register `/search` route in each plugin
  - Files: `server.ts`, `plugins/{tasks,assets,projects,workflows,schedule,memory}/index.ts`

- [x] **T11b: MCP Search Tools + CLI Commands** ✓ `2030ebe`
  - 7 MCP exec tools: search_query, search_table, search_lookup, search_facets, search_similar, search_reindex, search_stats
  - CLI: enhanced `search`, new `search:facets`, `search:similar`, `search:stats`, `search:cleanup`, enhanced `reindex`
  - Files: `scripts/lib/search-tools.ts` (new), `cli/bakin.ts`

- [x] **T11c: Phase 3 Documentation**
  - Create `.claude/knowledge/search-api-reference.md` — REST + MCP + CLI reference with examples

### --- CHECKPOINT 3 --- `git tag search-checkpoint-3`
- [ ] All API endpoints tested
- [ ] Cross-table + per-plugin search working with aggregations
- [ ] All 7 MCP tools registered
- [ ] CLI commands functional
- [ ] `search-api-reference.md` written
- [ ] `pnpm test` passes

---

## Phase 4: UI Integration (parallelizable after T12)

- [x] **T12: useAntflySearch Hook** ✓ `d22af98`
  - Debounce, fallback, AbortController, aggregations
  - File: `src/hooks/use-antfly-search.ts` (new)

- [x] **T13: Tasks UI Search** ✓ `140d442`
- [x] **T14: Assets UI Search** ✓ `140d442`
- [x] **T15: Projects UI Search** ✓ `140d442`
- [x] **T16: Workflows UI Search** ✓ `140d442`
- [x] **T17: Schedule UI Search** ✓ `140d442`
- [x] **T18: Memory UI Search** ✓ `140d442`

- [x] **T19: FacetFilter Aggregation Integration** ✓ `124f89e`
  - Add `counts` prop to `facet-filter.tsx`, wire in Tasks/Assets/Schedule
  - Files: `src/components/facet-filter.tsx`, plugin components

- [x] **T19b: Phase 4 Documentation**
  - Update `.claude/knowledge/url-state-deep-linking.md` — useAntflySearch hook, search URL params
  - Update `.claude/knowledge/shared-ui-patterns.md` — useAntflySearch pattern, FacetFilter counts

### --- CHECKPOINT 4 --- `git tag search-checkpoint-4`
- [ ] All search bars Antfly-powered with fallback
- [ ] FacetFilter counts from aggregations
- [ ] No visual regressions
- [ ] UI pattern docs updated

---

## Phase 5: Health & Observability

- [ ] **T20: Health Plugin Search Section + Doctor Checks**
  - Search section: status, tables, metrics, actions (reindex/cleanup/clear)
  - Enhanced doctor: table existence, schema verification, stale data warnings
  - Files: `plugins/health/components/health-page.tsx`, `src/core/doctor.ts`

### --- CHECKPOINT 5 (Final) --- `git tag search-checkpoint-5`
- [ ] Full E2E: create → search → update → search → delete → verify gone
- [ ] Health plugin accurate
- [ ] Embedder change → rebuild → reindex works end-to-end
- [ ] `pnpm tsc --noEmit` && `pnpm test` pass
- [ ] Ready to merge `feat/antfly-search` → `main`
