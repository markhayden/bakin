# Issue #67 — Tighten Client-Side Search Abstraction (Full Scope)

_Created: 2026-04-13 | Owner: Mark | Status: DRAFT v3 (awaiting final approval)_

**Issue:** https://github.com/markhayden/bakin/issues/67
**Feeds:** `/agent-skills:plan` → `/agent-skills:build` → `/agent-skills:test`

---

## 1. Objective

Remove every client-side coupling to AntflyDB naming and raw table identifiers, raise plugin search integration to a level where any new plugin gets a searchable HTTP route **for free** by calling a single API (`ctx.search.registerContentType`), and extend messaging plugin with first-class search across planned messages and brainstorm conversations. Production-quality test coverage across every layer.

North star: AntflyDB remains the sole search engine (vector + text), but no plugin or UI code should know the word "Antfly" or the `bakin_` table prefix. The MCP surface for search is a small, fixed set of generic tools that take a `plugin` parameter — adding a new plugin never adds a new MCP tool.

## 2. Success Criteria (End-State)

1. **Zero client-side references to hardcoded table names.** Grep for `table: '[a-z]+'` in `plugins/**/components/**` and `plugins/**/hooks/**` returns nothing.
2. **Zero client-side references to "Antfly" naming.** Grep for `Antfly` in `src/hooks/**`, `plugins/**/*.tsx`, `plugins/**/*.ts` returns nothing except the Phase 3 health status endpoint where the name is allowed.
3. **`ctx.search.registerContentType()` is the single entry point** — it auto-registers the plugin's `/search` HTTP route with no further plugin-side boilerplate.
4. **No plugin manually registers `ctx.registerRoute({ path: '/search', ... })`** — those 6 boilerplate blocks are deleted.
5. **Memory plugin owns audit** — audit content type registration lives in `plugins/memory/index.ts`, not core.
6. **Messaging plugin gains Antfly search for brainstorm sessions only:**
   - `bakin_messaging_brainstorm` (brainstorm sessions from `~/.bakin/messaging/sessions/*.json`) — full semantic search with embeddings on message bodies.
   - Calendar items get a **local substring filter** (same pattern as health plugin's per-section filters) — NOT Antfly-backed. This avoids the multi-content-type-per-plugin complication entirely; larger plugin/subplugin search architecture is a future concern.
7. **`/api/antfly/health` raw handler is deleted from `server.ts`.** Health UI fetches a new plugin-scoped route.
8. **MCP search surface stays flat as plugins grow.** The existing 7 generic `bakin_exec_search_*` tools accept `plugin` (plugin ID) instead of `table` (raw table name). Adding a new plugin with search never adds a new MCP tool.
9. **Full test coverage:**
   - Auto-registration path (unit + integration)
   - Per-plugin `/search` route test for all 8 Antfly-backed plugins (tasks, workflows, assets, projects, schedule, team, memory, messaging/brainstorm)
   - `useSearch` hook unit tests (debounce, abort, fallback, aggregations, error states, plugin vs. cross-plugin routing)
   - Component smoke test for each of the 7 Antfly-backed consumers (6 existing + brainstorm) plus a unit test for the new calendar local filter
   - `/api/search` cross-plugin route test with `plugin=` param
   - Updated MCP `bakin_exec_search_*` tool tests for the new `plugin` param
   - Team, memory, and messaging plugins gain plugin-level test suites
10. **Docs updated:** `.claude/knowledge/search-system.md`, `.claude/knowledge/search-plugin-guide.md`, `CLAUDE.md` Search Indexing section, `README.md` if impacted.
11. **All existing tests still pass.** No regressions in the 80 core search-registry tests.

## 3. Non-Goals (Global)

What this work will **not** touch:

- **Models and health plugins getting search.** Health keeps its local substring filters for per-section `pluginSearch` and `toolSearch`. Models is a config surface, not content.
- **Removing `/api/search` cross-plugin handler.** It stays. It will back a future global-search UI and is used by MCP.
- **Removing the 7 generic `bakin_exec_search_*` MCP tools.** They stay — they get one param rename (`table` → `plugin`).
- **Adding per-plugin MCP exec tools** (e.g., `bakin_exec_tasks_search`). Previous draft proposed this; user flipped to the generic-tool-with-plugin-param approach to keep the MCP surface flat.
- **Health plugin's per-section local filters** (`pluginSearch`, `toolSearch` in `health-page.tsx`). Explicit user directive: "seems better to have the search separate like it is today by component."
- **Backwards compatibility / shims / deprecation aliases.** Single-user machine, clean breaks only.
- **Semantic search tuning** (ranking model changes, reranker adjustments, embedder swaps).
- **Refactoring unrelated code adjacent to the files being touched.**
- **New global search UI bar.** The plumbing exists; the UI is a separate effort.
- **E2E browser tests (Playwright) for search.** Vitest component smoke is the bar here.
- **Multimodal search beyond today's assets implementation.** Brainstorm sessions get text embeddings only.

## 4. Assumptions to Confirm Before Plan Phase

Load-bearing. If wrong, spec changes.

- **A1.** Audit can be moved from core to memory plugin without breaking `search-cleanup.ts`. The cleanup scan enumerates registered content types at runtime — it should pick up memory's registration automatically. Verify in Phase 1.
- **A2.** The 6 existing plugin-scoped `/search` routes are byte-identical pass-throughs. Any plugin with customized behavior needs hand-migration. Research says all 6 are identical; confirm during Phase 1 diff.
- **A3.** Auto-registered `/search` routes do not need per-plugin customization today. If one does in the future, the registration API should support an override hook — design should not preclude this.
- **A4.** Renaming `useAntflySearch` → `useSearch` does not collide with an existing export elsewhere. Pre-Phase-2 grep check.
- **A5.** Every search consumer component survives a hook rewire without functional changes — the hook's external contract stays identical, only the fetch URL and the option name (`table` → `plugin`) change.
- **A6.** Brainstorm sessions can be indexed with message bodies flattened into a single searchable text blob (concatenated by role+content) AND embedded semantically. Per-message hit highlighting is NOT required in v1.
- **A7.** Brainstorm sessions (`~/.bakin/messaging/sessions/*.json`, one file per session) fit `registerFileBackedContentType()` cleanly.
- **A8.** Brainstorm embedding cost on realistic fixture data is tolerable on the Mac mini. If reindex perf is painful in Phase 1 smoke tests, we fall back to embedding title + proposal summaries only and keyword-indexing message bodies — plan phase gets a bail-out branch for this.
- **A9.** The 7 existing MCP search tools can swap `table` → `plugin` in one commit without breaking any existing agent workflow. (No agent memory/prompt today hardcodes the old param name based on spot-check — the plan phase does a targeted grep.)
- **A10.** Calendar's local substring filter can live entirely in the messaging calendar page component state — no new plugin-side code needed, no new routes, no new types. Pattern is lifted directly from health plugin's `pluginSearch`/`toolSearch`.

---

## 5. Phase Breakdown

### Phase 1 — Core Auto-Registration + Per-Plugin Cleanup + Audit Ownership + Brainstorm Search + MCP Param Swap

**Goal:** Single API (`ctx.search.registerContentType`) yields a plugin `/search` route with zero per-plugin boilerplate. Messaging gains Antfly search on brainstorm sessions (calendar local filter is Phase 2 UI work). The MCP search tools accept `plugin` instead of `table`.

#### 1a. Auto-registration helper

**Files:**
- `src/core/search-registry.ts` — extend `registerContentType`/`registerFileBackedContentType` to call an auto-registration helper that registers a `GET /search` route on the calling plugin's router.
- `src/lib/plugin-types.ts` — if needed, thread plugin ID or plugin router reference into the registry call. Minimal surface change.

**What and why:** When a plugin calls `ctx.search.registerContentType({ table: 'tasks', ... })`, the registry ALSO registers `GET /search?q=&limit=&offset=&facets=` on that plugin's routes, handler is a pass-through to `ctx.search.query()`. `registerFileBackedContentType` inherits this because it wraps `registerContentType`.

**Acceptance:** The helper is covered by a Phase 4 unit test that spins up a mock plugin context, calls `registerContentType`, and verifies a `/search` route appears in the plugin's registered routes.

**Non-goals:** No MCP tool registration from this helper (MCP is handled separately in 1e). No per-plugin customization hooks yet.

#### 1b. Manual /search route cleanup (6 plugins)

**Files (each is a self-contained commit):**
- `plugins/tasks/index.ts`
- `plugins/projects/index.ts`
- `plugins/workflows/index.ts`
- `plugins/schedule/index.ts`
- `plugins/assets/index.ts`
- `plugins/team/index.ts`

**What and why:** Delete the ~15-line `ctx.registerRoute({ path: '/search', ... })` block. The auto-registration layer from 1a provides it now.

**Acceptance:** Each plugin's `/search` route still works end-to-end (validated by existing plugin route tests where they exist, and by Phase 4 new tests). Before deleting, each agent must diff the old block against the canonical boilerplate and quote it in the commit message — if it deviates, STOP and escalate.

#### 1c. Audit ownership move

**Files:**
- `src/core/audit.ts` (or wherever core registers the audit content type) — remove the `registerContentType` call but keep audit writing/broadcasting behavior.
- `plugins/memory/index.ts` — add `ctx.search.registerContentType({ table: 'audit', ... })` with the same schema, facets, and chunking that lived in core.

**What and why:** Memory plugin owns the audit UI; it should own the search content type too. After this, memory gets its `/api/plugins/memory/search` route automatically (fixing today's gap). The audit writer stays in core — only the search registration moves.

**Acceptance:**
- `plugins/memory/index.ts` registers the audit content type.
- Core no longer registers it.
- `search-cleanup.ts` orphan scan still finds `bakin_audit` (extend an existing cleanup test to cover this).
- `/api/plugins/memory/search?q=...` returns audit results.

#### 1d. Messaging plugin — add Antfly search for brainstorm sessions

**Files:**
- `plugins/messaging/index.ts` — add one `ctx.search.registerFileBackedContentType()` call.
- `plugins/messaging/lib/brainstorm-search.ts` _(new)_ — reindex helper and file-to-doc builder kept in a sibling file to keep `index.ts` readable.

**Content type: `bakin_messaging_brainstorm`**
- Registration: `ctx.search.registerFileBackedContentType({ table: 'messaging_brainstorm', ... })` (file-backed — one file per session).
- Source: `~/.bakin/messaging/sessions/*.json`
- Schema fields: `id`, `title`, `agentId`, `status`, `createdAt`, `updatedAt`, `message_body`, `proposal_summaries`
- Searchable: `title`, `message_body` (flattened concatenation of `messages[].content` joined with newlines), `proposal_summaries` (concatenation of `proposals[].title + proposals[].brief`)
- Embedding template: `{{ title }} — {{ message_body }} — {{ proposal_summaries }}` (full semantic embeddings per OQ3 resolution → "full")
- Facets: `status`, `agentId`
- Key: session ID (filename without `.json`)
- File pattern: `messaging/sessions/*.json` → `{ key: basename(file, '.json'), doc: buildDoc(session) }`
- Chunking: enabled (200 tokens) to handle long conversations within Antfly's embed window.

**Acceptance:**
- Content type registers at plugin activation.
- Create/update/delete of a brainstorm session reflects in search via the watcher path within ~300ms.
- `/api/plugins/messaging/search?q=...` returns brainstorm results.
- Semantic queries work — fixture-level smoke test: indexing a session with message content about "sourdough" returns a hit on query "bread fermentation".
- If reindex performance is unacceptable on realistic fixture (A8 bail-out), fall back to keyword-only on `message_body` and semantic only on `title` + `proposal_summaries`.

**Non-goals for Phase 1d:**
- NO calendar indexing. Calendar gets a local substring filter in Phase 2c — no plugin-side code.
- No per-message granularity, no hit highlighting within a session.
- No cross-session conversation linking.

#### 1e. MCP search tools — swap `table` for `plugin`

**Files:**
- `scripts/lib/search-tools.ts` — the 7 tools currently accept `table`. Rename the param to `plugin`. The tool implementation resolves plugin ID → table name by looking up the content type registered by that plugin.
- `src/core/search-registry.ts` — expose a `getTableForPlugin(pluginId: string): string | null` helper so the MCP tools can resolve plugin → table without direct registry access.

**What and why:** Keep the MCP surface flat — one generic tool family that takes a `plugin` parameter rather than N per-plugin tools. The registry handles plugin → table mapping internally. Since we dropped calendar-as-content-type, every plugin is 1:1 with its table and no disambiguator is needed.

**Acceptance:**
- All 7 MCP tools accept `plugin` instead of `table`. Omitting `plugin` triggers cross-plugin search (same as today's omitting `table`).
- Existing MCP tool tests updated to the new param name.
- `bakin_exec_search_stats` returns the plugin → table mapping so agents can discover what's searchable.
- Passing a `plugin` ID that has no registered content type returns a clear error, not silent cross-plugin fallback.

#### Phase 1 file summary

| Area | File | Change |
|---|---|---|
| Auto-reg helper | `src/core/search-registry.ts` | Extend register methods to auto-wire route |
| Auto-reg helper | `src/lib/plugin-types.ts` | Minimal plumbing for plugin router access |
| Cleanup | `plugins/tasks/index.ts` | Delete manual /search block |
| Cleanup | `plugins/projects/index.ts` | Delete manual /search block |
| Cleanup | `plugins/workflows/index.ts` | Delete manual /search block |
| Cleanup | `plugins/schedule/index.ts` | Delete manual /search block |
| Cleanup | `plugins/assets/index.ts` | Delete manual /search block |
| Cleanup | `plugins/team/index.ts` | Delete manual /search block |
| Audit move | `src/core/audit.ts` | Remove registerContentType |
| Audit move | `plugins/memory/index.ts` | Add registerContentType (audit) |
| Brainstorm search | `plugins/messaging/index.ts` | Add 1 registerFileBackedContentType call |
| Brainstorm search | `plugins/messaging/lib/brainstorm-search.ts` _(new)_ | File-to-doc builder + embedding template |
| MCP | `scripts/lib/search-tools.ts` | Swap `table` → `plugin` param |
| MCP | `src/core/search-registry.ts` | Add `getTableForPlugin()` helper |

**Non-goals for Phase 1:** No client-side changes. No hook rename. No changes to `/api/search` or `/api/antfly/health`. No new test writing (Phase 4).

**Dependencies:** None — Phase 1 is the foundation.

---

### Phase 2 — Client Hook Rename + Consumer Migration + Brainstorm Consumer + Calendar Local Filter

**Goal:** The client no longer knows "Antfly" or raw table names. Every search consumer routes through its own plugin's `/search` endpoint. Brainstorm page gets Antfly-backed search; calendar page gets a local substring filter.

**Files affected:**

#### 2a. Hook rename
- `src/hooks/use-antfly-search.ts` → **rename** to `src/hooks/use-search.ts`.
- Exported names:
  - `useAntflySearch` → `useSearch`
  - `AntflySearchResult` → `SearchResult`
  - `AntflySearchResponse` → collision with server-side type; rename to `UseSearchResponse` or namespace-qualify
  - `UseAntflySearchOptions` → `UseSearchOptions`
  - `UseAntflySearchReturn` → `UseSearchReturn`
  - `reorderByAntflyResults` → `reorderBySearchResults`
- Hook option shape change:
  - Remove `table?: string`
  - Add `plugin?: string` (plugin ID)
- Fetch URL:
  - `plugin` → `/api/plugins/{plugin}/search?q=...`
  - No `plugin` → `/api/search?q=...&plugin=...` (cross-plugin uses `plugin` query param now, not `table`)

#### 2b. Migrate 6 existing consumers
- `plugins/assets/components/assets-page.tsx:~81` — `table: 'assets'` → `plugin: 'assets'`
- `plugins/tasks/hooks/use-task-filters.ts:~57` — `table: 'tasks'` → `plugin: 'tasks'`
- `plugins/workflows/components/workflows-page.tsx:~33` — `table: 'workflows'` → `plugin: 'workflows'`
- `plugins/projects/components/project-grid.tsx:~48` — `table: 'projects'` → `plugin: 'projects'`
- `plugins/schedule/components/schedule-page.tsx:~51` — `table: 'schedule'` → `plugin: 'schedule'`
- `plugins/memory/components/audit-timeline.tsx:~27` — `table: 'audit'` → `plugin: 'memory'`
- Rename local `antfly` variables to `search` where used.

#### 2c. Brainstorm consumer (Antfly) + calendar local filter
- `src/app/messaging/brainstorm/page.tsx` (or the brainstorm component if the page is a thin wrapper) — add `useSearch({ plugin: 'messaging', facets: ['status', 'agentId'] })`. Wire a search input; results filter the session list. This is the 7th Antfly consumer.
- `src/app/messaging/calendar/page.tsx` (or the calendar component) — add **local substring filter** state: `calendarSearch` (string), `filteredItems = items.filter(i => matches(i, calendarSearch))`. Match on `title`, `brief`, `draft.caption`, `draft.agentNotes`. Render a `ListSearch` input (existing component used by health plugin). No Antfly wiring, no new types, no new routes.

**UX patterns:**
- Brainstorm: matches the existing 6-consumer Antfly pattern — per-page search box + facet chips, results filter the session list.
- Calendar: matches health plugin's per-section filter pattern — plain `ListSearch` input with substring match. No facets, no reordering by score.

**Why the split:** Calendar filter UX is already heavily shaped by month navigation + status filters. Adding full-text substring filter is a ~15-line addition. Upgrading calendar to Antfly later (if we need semantic search for planned captions) is a clean follow-up with no plumbing work wasted.

**Acceptance:**
- `rg "useAntflySearch" src/ plugins/` returns zero matches.
- `rg "table: '" plugins/**/components/ plugins/**/hooks/ src/app/` returns zero matches for search contexts.
- `useSearch` accepts `plugin` (no `type` param).
- `src/hooks/use-antfly-search.ts` no longer exists.
- Dev server starts cleanly, no TypeScript errors, no runtime errors on any of the 8 affected pages (6 existing consumers + brainstorm + calendar).
- Brainstorm search returns semantic hits on fixture data; calendar local filter narrows the visible list on keystrokes.

**Non-goals:**
- No server-side changes (Phase 1 set them up).
- No changes to health plugin (Phase 3 owns that).
- No new tests (Phase 4).
- No redesign of messaging UI beyond adding a search input consistent with existing patterns.

**Dependencies:** Phase 1 complete — all server routes must exist before client calls them.

---

### Phase 3 — Health Antfly-Status Route Rewire

**Goal:** The raw `/api/antfly/health` handler in `server.ts` is gone. Health UI fetches its status data through the standard plugin route pattern.

**Files:**
- `server.ts` lines 369–379 — delete `/api/antfly/health` raw handler block.
- `plugins/health/index.ts` — register `GET /antfly-status` → `getSearchHealth()` from `src/core/search-registry.ts`. Final path: `/api/plugins/health/antfly-status`.
- `plugins/health/components/health-page.tsx:332` — update fetch from `/api/antfly/health` → `/api/plugins/health/antfly-status`.
- `cli/bakin.ts` — verify and update if it calls the old path.

**Route naming rationale:** Not `/search` because health doesn't register a search content type. Not `/status` because health has many status endpoints. `antfly-status` is narrow and descriptive — consistent with the convention that health routes name what's being probed.

**Acceptance:**
- `rg "/api/antfly/health"` returns zero matches in source (exceptions: git history, spec docs).
- New route returns the same JSON shape as the old one.
- Health page renders the Antfly status panel correctly.
- CLI commands depending on the old path still work.

**Non-goals:** No changes to `getSearchHealth()`, no UI redesign, no touching health's per-section local filters.

**Dependencies:** None. Can run in parallel with Phase 2.

---

### Phase 4 — Production-Quality Test Coverage

**Goal:** Every layer of the search stack has real tests. Team, memory, and messaging plugins get their first plugin-level test suites.

**New / extended test files:**

**Core:**
- `tests/core/search-auto-registration.test.ts` _(new)_ — Auto-registration wires a `/search` route when `registerContentType` is called from a mock plugin context. Covers collision handling (two content types from same plugin), idempotence, error paths.
- `tests/core/search-registry.test.ts` — Extend for `getTableForPlugin()` helper.

**Per-plugin `/search` route tests (8 files):**
- `tests/plugins/tasks/routes.test.ts` — Add search route test.
- `tests/plugins/projects/routes.test.ts` — Add.
- `tests/plugins/workflows/routes.test.ts` — Add (create file if missing).
- `tests/plugins/schedule/routes.test.ts` — Add.
- `tests/plugins/assets/routes.test.ts` — Add.
- `tests/plugins/team/routes.test.ts` _(new — team has zero tests today)_ — Activation + search route.
- `tests/plugins/memory/routes.test.ts` _(new — memory has zero tests today)_ — Activation covering audit registration + search route.
- `tests/plugins/messaging/routes.test.ts` _(new or extended)_ — Activation + brainstorm search route + file-backed reconcile smoke.
- `tests/plugins/messaging/brainstorm-search.test.ts` _(new)_ — Unit test the file-to-doc builder against fixture brainstorm JSON files.

**Cross-plugin HTTP:**
- `tests/integration/api-search-route.test.ts` _(new)_ — `/api/search` handler: missing `q` → 400, valid `q` → results, `plugin` param scopes correctly, facets thread through, error path → 500.

**MCP:**
- `tests/core/search-tools-mcp.test.ts` (new if not exists, or extend existing) — Verify the 7 tools accept `plugin` and resolve correctly. Verify messaging disambiguator behavior (whatever OQ2 settles on).

**Client hook:**
- `tests/hooks/use-search.test.ts` _(new)_ — `useSearch` unit tests: debounce, abort on unmount, plugin routing, cross-plugin routing, fallback invocation, aggregations, error states, `clear()` reset.
- `tests/hooks/reorder-by-search-results.test.ts` _(new)_ — Reorder utility: score ordering, unmatched items, empty results.

**Component smoke (8 files):**
- `tests/plugins/assets/assets-page.test.tsx` _(new)_ — Render with mocked `useSearch`, verify search input wires up, verify filtered rendering.
- `tests/plugins/tasks/use-task-filters.test.ts` _(new)_ — Filter hook with mocked `useSearch`.
- `tests/plugins/workflows/workflows-page.test.tsx` _(new)_
- `tests/plugins/projects/project-grid.test.tsx` _(new)_
- `tests/plugins/schedule/schedule-page.test.tsx` _(new)_
- `tests/plugins/memory/audit-timeline.test.tsx` _(new)_
- `tests/plugins/messaging/brainstorm-consumer.test.tsx` _(new)_ — Brainstorm page with mocked `useSearch`.
- `tests/plugins/messaging/calendar-local-filter.test.tsx` _(new)_ — Calendar page local substring filter (no `useSearch` — tests the pure local filter logic).

**Test infrastructure:**
- `tests/plugins/test-helpers.ts` — Extend mocked `ctx.search` with a `seedResults(results)` helper for realistic response injection, and extend the mock route registry so auto-registered routes appear in the captured list.

**Acceptance:**
- New test count: approximately 50–70 new tests across layers.
- Every new test mocks `getContentDir`, logger, watcher, openclaw-client per CLAUDE.md CRITICAL rules.
- Team, memory, and messaging plugins each have a plugin-level test suite.
- `npm test` exits 0 with the new suite.
- Coverage target: >80% line coverage on `src/core/search-registry.ts`, `src/hooks/use-search.ts`, and each plugin's search-touching code paths. Final numeric targets set by plan phase.

**Non-goals:** No E2E browser tests. No real Antfly integration. No perf benchmarks. No visual regression tests.

**Dependencies:** Phases 1, 2, 3 complete.

---

### Phase 5 — Documentation

**Goal:** `.claude/knowledge/` and `CLAUDE.md` reflect the new patterns, not the old ones.

**Files:**
- `.claude/knowledge/search-system.md` — Update to describe auto-registration; note audit is memory-owned; add messaging content types to the list; note MCP takes `plugin` param.
- `.claude/knowledge/search-plugin-guide.md` — Update the helper API walkthrough with a minimal example: "to add search to your plugin, call `ctx.search.registerContentType({ ... })` in `activate()`. You get `/api/plugins/{yourId}/search` for free."
- `CLAUDE.md` Search Indexing section — Reflect auto-registration, client `plugin` option, memory plugin's new audit ownership, messaging search coverage.
- `CLAUDE.md` Directory Map — Mention `src/hooks/use-search.ts`.
- `CLAUDE.md` Plugin System — Mention `plugins/messaging/lib/search-indexers.ts` if it fits naturally.
- `README.md` — Check for top-level search description; update if impacted.

**Acceptance:**
- Zero `useAntflySearch` or `AntflySearchResult` references in any `.md` file.
- Walkthrough example in `search-plugin-guide.md` compiles against the new API.
- `CLAUDE.md` mentions auto-registration and the `plugin` option.

**Dependencies:** Phases 1–4 complete.

---

## 6. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **R1. Auto-registration masks a subtle per-plugin quirk** — a plugin silently loses custom behavior from its old `/search` route. | Medium | Phase 1 cleanup agents must quote the pre-deletion route block in their commit message. If it deviates from boilerplate, STOP and escalate. |
| **R2. Hook rename misses a consumer.** A `useAntflySearch` import outside the known 6 breaks. | Medium | Phase 2 opens with a full-repo `rg "useAntflySearch\|AntflySearch"` pre-rename and repeats post-rename to assert zero hits. |
| **R3. Audit move breaks `search-cleanup.ts`.** Orphan scan may assume audit is core-registered. | Medium | Phase 1 extends a cleanup test to seed `bakin_audit` via memory plugin activation and assert orphan detection still works. |
| **R4. Name collision on `useSearch` / `SearchResult`.** | Low | Pre-Phase-2 grep check. Fall back to `useClientSearch` / `ClientSearchResult` if collision. |
| **R5. Brainstorm embedding cost.** Sessions with long conversations may be expensive to embed on every reindex. | Medium | Phase 1 smoke tests index a realistic fixture and measure. If painful, fall back per A8: embed title + proposal summaries only, keyword-index message bodies. Plan phase owns the fallback decision. |
| **R6. MCP `table` → `plugin` param swap breaks in-flight agent workflows.** | Low (single-user machine) | Grep for `bakin_exec_search_*` call sites in prompts/memory/skills/fixtures. Update together. |
| **R7. File-backed brainstorm indexing + Phase 1 audit move happen in same phase — watcher may double-fire or miss.** | Low | Watcher integration is battle-tested for projects/workflows/assets. Brainstorm uses the same helper. Audit is non-file-backed so no watcher involvement. Not a real conflict. |
| **R8. Calendar local filter drifts from future Antfly upgrade path.** A later switch to Antfly for calendar would require wiring that v1 explicitly skips. | Low (accepted) | Calendar local filter is ~15 lines of state and a `ListSearch` input — no wasted plumbing on the upgrade path. Accepted tradeoff in exchange for sidestepping the multi-content-type-per-plugin architectural question. |

---

## 7. Resolved Decisions (from v2 → v3 revision)

- **OQ1 (multi-content-type plugin routing):** **Dissolved.** Calendar dropped from Antfly scope; messaging is now 1:1 plugin:content-type (brainstorm only). No path disambiguator needed.
- **OQ2 (MCP disambiguator):** **Dissolved.** Same reason — no need for a `type` param on MCP tools.
- **OQ3 (brainstorm embedding depth):** **Resolved to (a) full embeddings.** Brainstorm `message_body` gets full semantic embeddings. Phase 1 smoke tests measure reindex perf on realistic fixtures; if painful, per assumption A8 we fall back to embedding title + proposal summaries only and keyword-indexing message bodies — plan phase owns the bail-out path.
- **Calendar subplugin architecture:** **Deferred.** Plugin/subplugin search (when one plugin has multiple distinct content surfaces) is a larger architectural question punted to a follow-up spec. v1 calendar uses a local substring filter that the user can redirect later without any wasted Antfly plumbing.

---

## 8. Code Style, Testing, and Boundaries

### Code style
- TypeScript strict. No `any` escapes. Zod at system boundaries for any new params.
- Auto-registration helper lives in `src/core/search-registry.ts` unless it gets unwieldy — plan phase decides whether to split.
- Route handler bodies remain functional, one function each.
- `const log = createLogger('module-name')` for any new logging. No `console.log`.
- Messaging search indexers live in `plugins/messaging/lib/search-indexers.ts` as a sibling to existing lib files.

### Testing
- Every new test file mocks `getContentDir`, logger, watcher, and openclaw-client per CLAUDE.md mandatory rules.
- Use `tests/plugins/test-helpers.ts` (extended with `seedResults`) for plugin tests.
- Client hook and component tests use React Testing Library + Vitest (existing stack).
- Auto-registration integration test spins up a real plugin activation in-memory and asserts the route exists in the plugin's route table.

### Boundaries — always, ask, never

**Always:**
- Mock `getContentDir` to a temp directory in every new test.
- Use `ctx.search.*` exclusively on the server.
- Route all client search through `useSearch` — never `fetch('/api/search')` from a component.
- Create new commits per phase / per plugin for rollback checkpoints.
- Use `getOpenClawPath()` for any OpenClaw path reference.

**Ask first:**
- If a plugin's existing `/search` route deviates from boilerplate — don't silently delete.
- If the hook rename grep turns up a consumer outside the known 6 (plus the 2 new messaging).
- If Phase 4 test writing reveals a real production bug.
- If removing `/api/antfly/health` breaks the CLI unexpectedly.
- If auto-registration requires non-trivial changes to `src/lib/plugin-types.ts`.
- If messaging reindex perf is painful — OQ3 fallback.

**Never:**
- Add backwards-compat aliases for `useAntflySearch`, `AntflySearchResult`, or the old `table` option.
- Add search to models or health plugins ("because it seems useful").
- Remove the 7 generic `bakin_exec_search_*` MCP tools.
- Add per-plugin MCP exec tools — user flipped away from this approach.
- Touch health plugin's per-section local filters.
- Bypass hooks (`--no-verify`) on commits.
- Skip per-plugin commit checkpoints in Phase 1 or Phase 4.

---

## 9. Commit Strategy Summary

Full commit-by-commit plan is produced in `/agent-skills:plan`. Spec-level shape:

- **Phase 1:** ~11 commits (1 auto-reg helper + 6 per-plugin cleanups + 1 audit move + 1 brainstorm content type + 1 MCP param swap + 1 registry helper).
- **Phase 2:** ~4 commits (1 hook rename + 1 existing-consumer sweep + 1 brainstorm consumer + 1 calendar local filter).
- **Phase 3:** ~1 commit (health rewire).
- **Phase 4:** ~12–15 commits (per-plugin test files + hook tests + auto-reg test + cross-plugin route test + MCP test + component smoke tests).
- **Phase 5:** ~1–2 commits (docs).

**Total estimate: 29–33 commits.** Every phase boundary is a viable rollback point.

---

**End of spec v3.** Awaiting final approval. All open questions resolved.

Next step: `/agent-skills:plan` → commit-by-commit plan with parallelism orchestration.
