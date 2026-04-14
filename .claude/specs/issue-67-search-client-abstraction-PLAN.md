# Issue #67 — Build Plan (commit-by-commit)

_Created: 2026-04-13 | Status: DRAFT (awaiting build-phase kickoff)_
_Spec: `.claude/specs/issue-67-search-client-abstraction.md` v3_

This is the executable build plan. Spec sections are referenced by number (`§2`, `§5.1`, etc.) — not repeated.

---

## Commit Summary

| Phase | Commits | Theme | Parallelizable |
|---|---|---|---|
| 1 | C1–C11 (11) | Server foundation: auto-reg, cleanups, audit move, brainstorm content type, MCP swap | High after C1 |
| 2 | C12–C14 (3) | Client hook rename, brainstorm consumer, calendar local filter | Medium |
| 3 | C15 (1) | Health route rewire | Fully independent — runs parallel with Phase 2 |
| 4 | C16–C27 (12) | Production-quality test coverage | High after C16 |
| 5 | C28–C29 (2) | Docs | Low (final) |
| **Total** | **29** | | |

Matches spec §9 estimate (29–33). No commit in the plan is estimated above 30 minutes of focused work; anything that looks larger is noted inline with a split recommendation.

---

## Phase 1 — Server Foundation

Ref: spec §5, Phase 1. All Phase 1 commits land on `main` before Phase 2 begins. Phase 1's internal layering is the biggest parallelism win in the whole plan.

| ID | Commit message | Files touched | Spec ref | Parallelism |
|---|---|---|---|---|
| **C1** | `feat(core): auto-register plugin /search route from ctx.search.registerContentType` | `src/core/search-registry.ts`; `src/lib/plugin-types.ts` (minimal plumbing if needed); `packages/core/src/plugin-types.ts` (if the search API type lives there) | §5.1a | **Blocker — serial** |
| **C2** | `refactor(tasks): remove manual /search route (now auto-registered)` | `plugins/tasks/index.ts` | §5.1b | Parallel layer 2 |
| **C3** | `refactor(projects): remove manual /search route` | `plugins/projects/index.ts` | §5.1b | Parallel layer 2 |
| **C4** | `refactor(workflows): remove manual /search route` | `plugins/workflows/index.ts` | §5.1b | Parallel layer 2 |
| **C5** | `refactor(schedule): remove manual /search route` | `plugins/schedule/index.ts` | §5.1b | Parallel layer 2 |
| **C6** | `refactor(assets): remove manual /search route` | `plugins/assets/index.ts` | §5.1b | Parallel layer 2 |
| **C7** | `refactor(team): remove manual /search route` | `plugins/team/index.ts` | §5.1b | Parallel layer 2 |
| **C8** | `refactor(memory,core): move audit content type registration from core to memory plugin` | `src/core/audit.ts` (remove registerContentType call; audit writer stays); `plugins/memory/index.ts` (add registerContentType with audit schema, facets, chunking) | §5.1c | Parallel layer 2 |
| **C9** | `feat(messaging): add Antfly brainstorm search content type` | `plugins/messaging/index.ts`; `plugins/messaging/lib/brainstorm-search.ts` _(new)_ | §5.1d | Parallel layer 2 |
| **C10** | `refactor(core): add getTableForPlugin helper to search registry` | `src/core/search-registry.ts` | §5.1e | Parallel layer 2 — but note C1 and C10 both touch `search-registry.ts`; C10 runs after C1, serialized on that file only |
| **C11** | `refactor(mcp): swap search tool \`table\` param for \`plugin\`` | `scripts/lib/search-tools.ts` | §5.1e | Serial after C10 |

### Per-commit acceptance criteria

**C1 — auto-registration helper**
- Unit-level: mock plugin context, call `ctx.search.registerContentType({ table: 'foo', ... })`, assert a `GET /search` route appears in the plugin's captured routes table.
- Integration-level: activate a real plugin (e.g., tasks) in a test harness, assert `/api/plugins/tasks/search?q=...` responds.
- **Assumption check:** A1 — cleanup scan still enumerates content types post-auto-registration.
- **Assumption check:** A3 — design leaves room for per-plugin override hook without current wiring.
- `npm test -- tests/core/search-registry.test.ts` passes (no regressions).

**C2–C7 — per-plugin /search route removal**
- The commit message MUST quote the pre-deletion route block to prove it was pure boilerplate (per spec §6 R1 mitigation).
- Post-commit: `rg "path: '/search'" plugins/{tasks,projects,workflows,schedule,assets,team}/index.ts` returns zero.
- Route still callable: `npm run dev` → `curl http://localhost:3737/api/plugins/{plugin}/search?q=test` returns JSON shape identical to pre-commit.
- Existing plugin route tests still pass: `npm test -- tests/plugins/{plugin}/routes.test.ts`.

**C8 — audit ownership move**
- `src/core/audit.ts` contains no `registerContentType` call for audit.
- `plugins/memory/index.ts` registers audit with the schema, facets, and chunking config copied verbatim from the old core location.
- `bakin_audit` still appears in `getAllContentTypes()` output at runtime.
- `search-cleanup.ts` orphan scan still finds `bakin_audit` (extend an existing cleanup test as part of C8 or call it out as a C16 test item).
- **Assumption check:** A1 verified in this commit.

**C9 — brainstorm content type**
- `plugins/messaging/index.ts` registers `bakin_messaging_brainstorm` as file-backed.
- `plugins/messaging/lib/brainstorm-search.ts` exports a `buildDoc(session)` function and the file pattern mapper.
- Embedding template is `{{ title }} — {{ message_body }} — {{ proposal_summaries }}` (spec §5.1d).
- Manual smoke: activate messaging plugin in dev, drop a fixture session JSON into `~/.bakin/messaging/sessions/`, verify it indexes and is queryable.
- **Risk check:** R5 — measure reindex time on a realistic fixture (≥20 sessions, ≥50 messages each). If >5 seconds, apply A8 bail-out (keyword-only on message_body) in the same commit.
- **Assumption check:** A6, A7, A8 all verified here.

**C10 — getTableForPlugin helper**
- `getTableForPlugin(pluginId: string): string | null` exported from `src/core/search-registry.ts`.
- Unit test: seeded registry returns correct table for known plugin, `null` for unknown, errors cleanly on multi-content-type (shouldn't exist post-§5.1d decision, but defensive).
- Write the test in the same commit if it's <20 lines; otherwise defer to C17.

**C11 — MCP param swap**
- All 7 tools in `scripts/lib/search-tools.ts` accept `plugin` instead of `table`.
- Omitting `plugin` → cross-plugin search (same behavior as omitting `table` previously).
- Passing a `plugin` with no registered content type → clear error message, not silent fallback.
- Pre-commit grep: `rg "bakin_exec_search_" .claude/ MEMORY.md memory/` to find any hardcoded call site in agent prompts, skills, or memory. Update as part of this commit if any found.
- **Assumption check:** A9 verified here.
- **Risk check:** R6 — single-commit atomic swap avoids mid-flight agent breakage window.

### Phase 1 dependency graph

```
                    C1 (auto-reg helper)
                    │
          ┌─────────┼─────────┬─────────┬─────────┐
          │    │    │    │    │    │    │    │    │
         C2   C3   C4   C5   C6   C7   C8   C9   C10
       tasks proj wf  sch  ast team mem msg  reg-helper
          │    │    │    │    │    │    │    │    │
          └────┴────┴────┴────┴────┴────┴────┴────┘
                              │
                             C11 (MCP swap — waits for C10)
```

- **Layer 1 (serial, 1 agent):** C1
- **Layer 2 (parallel, 9 agents):** C2, C3, C4, C5, C6, C7, C8, C9, C10
- **Layer 3 (serial, 1 agent):** C11

C10 is the only commit in layer 2 that touches `search-registry.ts`. Since C1 already landed, C10 has no conflict — but it should be the LAST layer-2 commit written, or written by the same agent as C1 to avoid race on the same file. Simpler: assign C10 to the same agent that handled C1.

### Phase 1 rollback checkpoints

- **After C1:** rollback-safe. The helper exists but nothing depends on it yet (plugins still have their manual routes, which continue to work).
- **After any of C2–C9:** rollback-safe. Individual plugin cleanup is self-contained.
- **After C11:** full Phase 1 rollback-safe. This is the first true "phase boundary" — MCP now uses `plugin`, all plugins use auto-reg, audit lives in memory plugin, brainstorm is indexed.

**Non-rollback-safe transitions:** None in Phase 1. Every commit can be reverted independently.

---

## Phase 2 — Client Hook Rename + New Consumers

Ref: spec §5, Phase 2. **Depends on Phase 1 complete** (C11 landed). Runs in parallel with Phase 3.

| ID | Commit message | Files touched | Spec ref | Parallelism |
|---|---|---|---|---|
| **C12** | `refactor(hooks,plugins): rename useAntflySearch to useSearch and migrate all consumers` | `src/hooks/use-antfly-search.ts` (deleted); `src/hooks/use-search.ts` (created); 6 consumer files: `plugins/assets/components/assets-page.tsx`, `plugins/tasks/hooks/use-task-filters.ts`, `plugins/workflows/components/workflows-page.tsx`, `plugins/projects/components/project-grid.tsx`, `plugins/schedule/components/schedule-page.tsx`, `plugins/memory/components/audit-timeline.tsx` | §5.2a, §5.2b | **Serial — single atomic commit** |
| **C13** | `feat(messaging): add brainstorm search consumer` | `src/app/messaging/brainstorm/page.tsx` (or the brainstorm page component) | §5.2c | Parallel with C14, after C12 |
| **C14** | `feat(messaging): add local substring filter to calendar page` | `src/app/messaging/calendar/page.tsx` (or the calendar component) | §5.2c | Parallel with C13, independent of C12 |

### Why C12 is one atomic commit

Spec ground rule: every commit must compile. Splitting the hook rename from consumer updates requires either (a) a backwards-compat alias during an intermediate commit (forbidden by ground rules and spec §3) or (b) two sweeps over the same 6 consumer files (wasteful).

**C12 is the largest single commit in the plan** — ~8 files, ~200 LOC touched. Estimated 45–60 minutes of focused work. If the agent finds it unwieldy mid-execution, they may split by dropping the new hook name as an alias first, then migrating — but only if they re-unite and delete the alias within the same PR boundary.

### Per-commit acceptance criteria

**C12 — hook rename + consumer migration**
- Pre-commit: `rg "useAntflySearch|AntflySearch" src/ plugins/ tests/` — snapshot current count for post-commit comparison.
- Pre-commit: `rg "^export.*useSearch" src/` — must return zero (name-collision guard, spec §6 R4, assumption A4). If collision found, STOP and escalate.
- Post-commit: `rg "useAntflySearch|AntflySearch" src/ plugins/ tests/` returns zero.
- Post-commit: `rg "table: '" plugins/**/components/ plugins/**/hooks/` returns zero matches in search contexts.
- Post-commit: `src/hooks/use-antfly-search.ts` does not exist.
- Post-commit: all 6 consumer files import from `@/hooks/use-search` and pass `plugin:` option.
- `npm run build` succeeds with no type errors.
- `npm test` passes (tests still use the mocked hook — they get updated in Phase 4).
- **Dev server smoke (MANDATORY before marking C12 done):** start `npm run dev`, open each of the 6 pages (`/assets`, `/tasks`, `/workflows`, `/projects`, `/schedule`, `/memory`), type in the search input on each, confirm filtered results render and no console errors.
- **Risk check:** R2 — pre-commit and post-commit grep confirm no stray consumer.
- **Assumption check:** A4, A5 verified here.

**C13 — brainstorm consumer**
- Brainstorm page renders a `useSearch({ plugin: 'messaging', facets: ['status', 'agentId'] })` block.
- Search input wired to `search.search(query)`.
- Session list filters to hook results when `search.results.length > 0`, reorders by score.
- Fallback to local substring filter on title when hook returns empty/error (follows existing 6-consumer pattern).
- **Dev server smoke:** start server, navigate to brainstorm page, enter a query that matches a seeded fixture session, confirm it filters correctly.

**C14 — calendar local filter**
- New local state: `calendarSearch` (string).
- `filteredItems = items.filter(i => matches(i, calendarSearch))` where `matches` checks `title`, `brief`, `draft?.caption`, `draft?.agentNotes` (case-insensitive substring).
- `ListSearch` input (existing component) placed near month navigation controls, placeholder "Search calendar...".
- No `useSearch` import. No Antfly fetch. Zero new types. Pattern = `plugins/health/components/health-page.tsx` pluginSearch lines.
- **Dev server smoke:** start server, navigate to calendar page, enter query, confirm calendar items filter on keystrokes.

### Phase 2 dependency graph

```
       [Phase 1 complete]
              │
             C12 (atomic rename + 6 consumers)
              │
          ┌───┴───┐
          │       │
         C13     C14
       brain    cal
        stm     ndr
```

- **Layer 2a (serial, 1 agent):** C12
- **Layer 2b (parallel, 2 agents):** C13, C14

C14 technically has no dependency on C12 (no `useSearch` import) and could start in Phase 1, but keeping it in Phase 2 is cleaner for logical grouping and reviewer context.

### Phase 2 rollback checkpoints

- **After C12:** Phase boundary — full rollback unit. Reverting C12 alone restores `useAntflySearch` and breaks nothing upstream (the server still accepts both `/api/search?plugin=` and `/api/plugins/{plugin}/search` — the old client just talks to the former).
- **After C13:** brainstorm consumer reverts independently.
- **After C14:** calendar local filter reverts independently.

---

## Phase 3 — Health Route Rewire

Ref: spec §5, Phase 3. **Independent of Phases 1 and 2.** Runs in parallel with Phase 2.

| ID | Commit message | Files touched | Spec ref |
|---|---|---|---|
| **C15** | `refactor(health,core): move /api/antfly/health to plugin route /api/plugins/health/antfly-status` | `server.ts` (delete raw handler block at lines ~369–379); `plugins/health/index.ts` (register `antfly-status` route); `plugins/health/components/health-page.tsx` (update fetch URL at line 332); `cli/bakin.ts` (if any reference to `/api/antfly/health` exists — verify first) | §5.3 |

### Acceptance criteria

- Pre-commit grep: `rg "/api/antfly/health" --type ts --type tsx` — inventory all call sites.
- Post-commit: that grep returns zero hits outside spec/knowledge docs and git history.
- `server.ts` lines 369–379 block is deleted.
- `plugins/health/index.ts` registers `GET /antfly-status` → calls `getSearchHealth()` from `src/core/search-registry`.
- JSON shape of `/api/plugins/health/antfly-status` matches the old `/api/antfly/health` response (diffable).
- **Dev server smoke (MANDATORY):** start `npm run dev`, open `/health`, confirm the Antfly status panel renders without errors.
- If CLI `bakin check` or similar called the old path, verify it still works post-commit.

### Rollback checkpoint

- Single self-contained commit. Fully rollback-safe. Reverting restores the raw handler.

---

## Phase 4 — Test Coverage

Ref: spec §5, Phase 4. **Depends on Phases 1, 2, 3 complete** — tests verify end-state behavior.

Phase 4 is organized as **one test-helper extension + per-plugin test bundles + shared test commits**. The per-plugin bundling (route test + component smoke test in one commit per plugin) collapses the naive 20+ commit count to 12.

| ID | Commit message | Files touched | Spec ref |
|---|---|---|---|
| **C16** | `test(helpers): extend test-helpers with seedResults and auto-route capture` | `tests/plugins/test-helpers.ts` | §5.4 infra |
| **C17** | `test(core): search auto-registration and getTableForPlugin unit tests` | `tests/core/search-auto-registration.test.ts` _(new)_; `tests/core/search-registry.test.ts` (extend for getTableForPlugin) | §5.4 core |
| **C18** | `test(core): MCP search tools plugin param coverage` | `tests/core/search-tools-mcp.test.ts` _(new or extended)_ | §5.4 MCP |
| **C19** | `test(integration): /api/search cross-plugin route coverage` | `tests/integration/api-search-route.test.ts` _(new)_ | §5.4 cross-plugin HTTP |
| **C20** | `test(hooks): useSearch hook unit tests and reorder utility` | `tests/hooks/use-search.test.ts` _(new)_; `tests/hooks/reorder-by-search-results.test.ts` _(new)_ | §5.4 client hook |
| **C21** | `test(tasks): search route + use-task-filters coverage` | `tests/plugins/tasks/routes.test.ts` (extend); `tests/plugins/tasks/use-task-filters.test.ts` _(new)_ | §5.4 per-plugin |
| **C22** | `test(projects): search route + project-grid smoke` | `tests/plugins/projects/routes.test.ts` (extend); `tests/plugins/projects/project-grid.test.tsx` _(new)_ | §5.4 per-plugin |
| **C23** | `test(workflows): search route + workflows-page smoke` | `tests/plugins/workflows/routes.test.ts` (extend/create); `tests/plugins/workflows/workflows-page.test.tsx` _(new)_ | §5.4 per-plugin |
| **C24** | `test(schedule): search route + schedule-page smoke` | `tests/plugins/schedule/routes.test.ts` (extend); `tests/plugins/schedule/schedule-page.test.tsx` _(new)_ | §5.4 per-plugin |
| **C25** | `test(assets): search route + assets-page smoke` | `tests/plugins/assets/routes.test.ts` (extend); `tests/plugins/assets/assets-page.test.tsx` _(new)_ | §5.4 per-plugin |
| **C26** | `test(team,memory): first plugin test suites with search coverage` | `tests/plugins/team/routes.test.ts` _(new)_; `tests/plugins/memory/routes.test.ts` _(new)_; `tests/plugins/memory/audit-timeline.test.tsx` _(new)_ | §5.4 per-plugin — team and memory combined because team has no UI smoke (no team search consumer component; team search surfaces via server route only per research) |
| **C27** | `test(messaging): brainstorm search route + indexer + consumer + calendar filter` | `tests/plugins/messaging/routes.test.ts` _(new or extend)_; `tests/plugins/messaging/brainstorm-search.test.ts` _(new — indexer unit)_; `tests/plugins/messaging/brainstorm-consumer.test.tsx` _(new)_; `tests/plugins/messaging/calendar-local-filter.test.tsx` _(new)_ | §5.4 per-plugin |

### Phase 4 dependency graph

```
          [Phase 3 complete]
                 │
                C16 (test-helpers extension — BLOCKS all plugin tests)
                 │
  ┌──────┬──────┬──────┼──────┬──────┬──────┬──────┬──────┬──────┬──────┐
  │      │      │      │      │      │      │      │      │      │      │
 C17    C18    C19    C20    C21    C22    C23    C24    C25    C26    C27
 core   MCP    /api/  hook   tsk    prj    wf     sch    ast    tm+mem msg
```

- **Layer 4a (serial, 1 agent):** C16 — must land before any other Phase 4 work because it extends the shared helper.
- **Layer 4b (parallel, 11 agents):** C17–C27

C20 (hook tests) technically doesn't use `test-helpers.ts` — it tests a React hook with React Testing Library. It could start before C16. But launching it with the rest keeps the orchestration simple.

### Why per-plugin bundling

Option A (flat split): 1 commit per test file → ~22 commits. Too noisy.
Option B (plugin-bundled, chosen): 1 commit per plugin that touches both route test and component smoke → 8 per-plugin commits + 4 infrastructure commits = 12. Clean rollback boundary per plugin.

### Per-commit acceptance criteria (abbreviated)

Every Phase 4 commit MUST:
- Mock `getContentDir` to a temp directory via `vi.mock('@/core/content-dir', ...)`.
- Mock logger (`vi.mock('@/core/logger', ...)`).
- Mock watcher (`vi.mock('@/core/watcher', ...)`).
- Mock openclaw-client for any plugin that talks to OpenClaw (team, schedule).
- Call `afterAll(() => rmSync(testDir, { recursive: true, force: true }))`.
- All per-commit verification: `npm test -- tests/<path-touched-in-commit>`.

**C16 — test-helpers extension**
- `seedResults(results: SearchResult[])` helper exposed on the mocked `ctx.search`.
- Mock route registry captures auto-registered routes (via C1 wiring).
- Backwards-compatible with existing tests — `npm test` passes fully before and after C16.

**C17 — core auto-reg tests**
- Spin up a mock plugin context, call `registerContentType`, assert a `/search` route appears.
- Cover `registerFileBackedContentType` (inherits via wrapping).
- `getTableForPlugin` returns correct table for registered plugin, null for unknown.
- Re-registration of same plugin is idempotent, not duplicated.

**C18 — MCP tools**
- `bakin_exec_search_query({ plugin: 'tasks', q: '...' })` works.
- `bakin_exec_search_query({ q: '...' })` (no plugin) works as cross-plugin.
- `bakin_exec_search_query({ plugin: 'nonexistent', q: '...' })` returns clear error.
- All 7 tools covered with at least one happy-path test per tool.

**C19 — /api/search cross-plugin route**
- Missing `q` → 400.
- Valid `q` → results from cross-plugin multi-query.
- `plugin=tasks` param scopes to tasks table.
- `facets=status,agent` threads through.
- Backend error → 500 with error payload.

**C20 — useSearch hook**
- Debounce: 3 rapid `search()` calls → 1 fetch.
- Abort on unmount: unmounted hook does not setState (no React warnings).
- `plugin: 'tasks'` → fetches `/api/plugins/tasks/search?q=...`.
- No `plugin` → fetches `/api/search?q=...`.
- Fallback function called when hook returns empty AND query is non-empty.
- Aggregations surfaced from response.
- Error state on fetch 500.
- `clear()` resets all state.

**C21–C27 — per-plugin bundles**
- Route test: `callRoute('/search', { method: 'GET', query: { q: 'foo' } })` returns expected shape via mocked `ctx.search.query()` seeded with `seedResults`.
- Component smoke: render with mocked `useSearch`, verify search input is present, verify filtered list updates when hook results change.
- Edge case per plugin: empty query, error state, zero results, many results.

C27 also covers the indexer unit test (fixture JSON → built doc), brainstorm smoke, and calendar local filter test (no Antfly).

### Rollback checkpoints

- **After C16:** test helpers extended but no new tests yet. Safe to stop.
- **After any of C17–C27:** per-plugin or per-subsystem test commits revert cleanly.
- **Phase boundary after C27:** full test suite green, ready for Phase 5.

---

## Phase 5 — Documentation

Ref: spec §5, Phase 5. **Last — depends on Phases 1–4 complete.**

| ID | Commit message | Files touched | Spec ref |
|---|---|---|---|
| **C28** | `docs(knowledge): update search-system.md and search-plugin-guide.md for auto-registration` | `.claude/knowledge/search-system.md`; `.claude/knowledge/search-plugin-guide.md` | §5.5 |
| **C29** | `docs(core): update CLAUDE.md and README.md for search rearchitecture` | `CLAUDE.md`; `README.md` (only if it currently mentions search) | §5.5 |

### Acceptance criteria

**C28**
- `.claude/knowledge/search-system.md` describes auto-registration as the canonical path.
- `.claude/knowledge/search-plugin-guide.md` example compiles against the new API signatures (check by eye + dry `tsc --noEmit` on any extracted snippet).
- Audit is documented as memory-owned.
- MCP `plugin` param documented.

**C29**
- CLAUDE.md `Search Indexing` section updated (reflects auto-reg, memory-owned audit, brainstorm indexing, `plugin` option on client hook).
- CLAUDE.md `Directory Map` mentions `src/hooks/use-search.ts` if it mentioned the old hook (it doesn't currently — no-op likely).
- `rg "useAntflySearch|AntflySearch"` across all `.md` files (including `.claude/`) returns zero hits.
- README.md updated only if the `Search` feature is described at top level (spot-check first; likely no-op).

### Rollback

- Both commits are doc-only, rollback-safe.

---

## Full Dependency Graph (cross-phase)

```
LAYER 1: C1                                                    [Phase 1 start]
         │
LAYER 2: C2 C3 C4 C5 C6 C7 C8 C9 C10                           [Phase 1 parallel]
         └───────────────────────────┐
                                    C11                        [Phase 1 serial]
                                     │
                     ┌───────────────┴───────────────┐
LAYER 3:            C12                            C15          [Phase 2a + Phase 3]
                     │                              │
                  ┌──┴──┐                           │
LAYER 4:         C13  C14                           │          [Phase 2b]
                     │                              │
                     └──────────────┬───────────────┘
                                    │
LAYER 5:                           C16                         [Phase 4 blocker]
                                    │
      ┌──────┬──────┬──────┬──────┬─┼────┬──────┬──────┬──────┬──────┐
LAYER 6: C17  C18   C19   C20   C21 C22  C23   C24   C25   C26   C27  [Phase 4 parallel]
         └──────┴──────┴──────┴──────┴──────┴──────┴──────┴──────┴────┘
                                    │
LAYER 7:                          C28, C29                     [Phase 5]
```

**Critical path (longest serial chain):** C1 → (one of C2–C10) → C11 → C12 → C16 → (one of C17–C27) → C28 → C29. That's 8 commits on the critical path.

---

## Build Orchestration (how `/agent-skills:build` executes)

This is the concrete execution recipe. Each "layer" is a single gated checkpoint — all agents in a layer must land green before the next layer starts.

### Layer 1: C1 (serial — 1 agent)
Spawn 1 general-purpose agent to implement auto-registration in `src/core/search-registry.ts`. Agent is given:
- Spec §5.1a
- The SearchAPI type from `src/lib/plugin-types.ts`
- The existing `registerRoute` pattern from any plugin as a reference
- Full latitude to shape the helper — the spec says WHAT, not HOW

Gate: `npm test && npm run build` green.

### Layer 2: C2–C10 (parallel — 9 agents)

Spawn **9 parallel general-purpose agents** in a single message. Each agent owns one commit and touches only files in its scope — no collisions. No worktrees needed.

Per-agent prompts are self-contained: each gets spec section reference, exact file paths, commit message template, acceptance criteria, and the instruction to quote pre-deletion code in commit messages (R1 mitigation).

Agent assignment:
- A1: C2 (tasks cleanup)
- A2: C3 (projects cleanup)
- A3: C4 (workflows cleanup)
- A4: C5 (schedule cleanup)
- A5: C6 (assets cleanup)
- A6: C7 (team cleanup)
- A7: C8 (audit move memory ↔ core)
- A8: C9 (brainstorm content type) — this agent has the most work (new file + registration + reindex helper + perf measurement)
- A9: C10 (getTableForPlugin helper)

Gate: `npm test && npm run build` green after all 9 commits merged.

Conflict risk: A9 (C10) and A8 (C9 — if it touches search-registry.ts for any helper access, which it shouldn't) could race on `search-registry.ts`. Mitigation: A9 runs last in layer 2, or is assigned to the same sequential agent as layer 1 (so C1 and C10 are one agent's responsibility). Recommend: same agent handles C1 and C10, which serializes their access to `search-registry.ts` naturally.

**Revised layer 2 orchestration:** 8 parallel agents for C2–C9, then 1 serial commit C10 from the Layer 1 agent continuing its work.

### Layer 3 pre-gate: C11 (serial — 1 agent)
After Layer 2 + C10 green, spawn 1 agent for C11 (MCP param swap). Includes the grep for agent prompts/skills/memory references and the test update.

Gate: `npm test` green. Manual check: launch a real agent via the MCP server and call `bakin_exec_search_query({ plugin: 'tasks', q: 'test' })` — confirm it works.

**Phase 1 complete. Rollback checkpoint. Commit Phase 1 as a logical unit in the build log.**

### Layer 4: C12 + C15 (parallel — 2 agents)

C12 and C15 are in different phases (Phase 2 and Phase 3) but fully independent. Run them in parallel.

- Agent B1: C12 (hook rename + 6 consumers). ~45–60 min. Largest single commit.
- Agent B2: C15 (health route rewire). ~15–20 min.

Gate after C12: **Dev server smoke test mandatory.** Agent B1 starts `npm run dev`, visits all 6 affected pages, verifies search inputs work on each, captures any console errors. Commit only after smoke passes.

Gate after C15: **Dev server smoke test mandatory.** Agent B2 visits `/health`, confirms the Antfly status panel renders.

### Layer 5: C13 + C14 (parallel — 2 agents)

Depends on C12 (both need `useSearch`). C14 technically doesn't, but runs here for phase coherence.

- Agent B3: C13 (brainstorm consumer)
- Agent B4: C14 (calendar local filter)

Gate: dev server smoke on `/messaging/brainstorm` and `/messaging/calendar`.

**Phase 2 and Phase 3 complete. Rollback checkpoint.**

### Layer 6: C16 (serial — 1 agent)

Spawn 1 agent for test-helpers extension. Must complete green before Layer 7 fans out.

Gate: `npm test` still green (helper is backwards-compatible with existing tests).

### Layer 7: C17–C27 (parallel — 11 agents)

Spawn **11 parallel general-purpose agents** in one message. Each agent owns one commit. Test files are fully disjoint — no collisions.

Agent assignment:
- T1: C17 (core auto-reg tests)
- T2: C18 (MCP tool tests)
- T3: C19 (/api/search route test)
- T4: C20 (useSearch hook + reorder utility tests)
- T5: C21 (tasks bundle)
- T6: C22 (projects bundle)
- T7: C23 (workflows bundle)
- T8: C24 (schedule bundle)
- T9: C25 (assets bundle)
- T10: C26 (team + memory bundle)
- T11: C27 (messaging bundle — brainstorm route + indexer + consumer + calendar filter)

Gate after all 11: `npm test` green. Coverage check: `npm run test -- --coverage` — verify coverage goals from spec §5.4 met.

**Phase 4 complete. Rollback checkpoint. All search code paths tested.**

### Layer 8: C28 + C29 (serial — 1 agent)

Single agent handles both docs commits (small, related, no parallelism value).

Gate: docs grep sanity — `rg "useAntflySearch|AntflySearch" **/*.md` returns zero. `rg "ctx.search" .claude/knowledge/*.md` present and describes auto-reg.

**Phase 5 complete. Feature fully shipped.**

---

## Rollback Decision Matrix

| Point | What reverting gets you | Loss |
|---|---|---|
| **Revert C1** | Server auto-registration gone; all plugins need their manual `/search` back (would need to also revert C2–C7). | Layer 2 also reverts. Must be a grouped rollback. |
| **Revert any of C2–C10** | That single plugin's cleanup or that one helper is gone; everything else stays. | Minimal. Per-plugin rollback is safe. |
| **Revert C11** | MCP back to `table` param. Agents re-learn old API. | Small; grep-and-fix for any new callers. |
| **Phase 1 boundary revert** | Clean state pre-issue-67. Server unchanged. | All Phase 1 work lost. |
| **Revert C12** | Client goes back to `useAntflySearch`. Server still handles both old and new paths (it always will — `/api/search?plugin=` alongside `/api/plugins/{id}/search`). | Phase 2 sweep lost. No server-side regression. |
| **Revert C13 or C14** | Brainstorm search or calendar filter gone. | Tiny. |
| **Revert C15** | `/api/antfly/health` resurrected; health page fetches old URL. | One commit of rework. |
| **Phase 2+3 boundary revert** | Back to Phase 1 end state. Server is modern, client is classic. | Interim but functional. |
| **Revert any C16–C27** | That test file's coverage lost. No functional regression. | None. |
| **Phase 4 boundary revert** | No tests for new architecture. Functional code still works. | Bad posture, not broken. |
| **Revert C28 or C29** | Docs stale. | None functional. |

**Grouped rollbacks (non-atomic):**
- Reverting C1 requires also reverting C2–C10 (they depend on it). Treat as "Phase 1 rollback" = single logical operation.
- Everything else reverts cleanly as individual commits.

---

## Risk Checkpoints (maps spec §6 R1–R8 to commits)

| Risk | First detection point | Mitigation commit |
|---|---|---|
| **R1** Auto-reg masks per-plugin quirk | C2–C7 (each agent diffs boilerplate and quotes in commit message) | Escalate before commit if diff shows non-boilerplate code |
| **R2** Hook rename misses a consumer | C12 pre-commit grep | Pre-commit grep is part of C12 acceptance; post-commit grep is part of verification |
| **R3** Audit move breaks cleanup scan | C8 — run `search-cleanup.test.ts` as acceptance | Extend cleanup test to cover memory-registered audit (part of C17 or C26) |
| **R4** Name collision on `useSearch` | C12 pre-commit grep | Fall back to `useClientSearch` if collision found |
| **R5** Brainstorm embedding cost | C9 (perf measurement on fixture) | A8 bail-out: keyword-only on message_body if >5s reindex |
| **R6** MCP param swap breaks in-flight agents | C11 pre-commit grep of prompts/skills/memory | Update all call sites in the same commit |
| **R7** File-backed brainstorm + audit move interaction | C9 + C8 both in layer 2 — verify at Phase 1 boundary | Phase 1 full test run catches this |
| **R8** Calendar local filter drifts from Antfly upgrade path | Accepted tradeoff — no mitigation needed | N/A |

---

## Assumption Verification Map (spec §4 A1–A10)

| Assumption | Verified in | Escalation if wrong |
|---|---|---|
| **A1** cleanup scan enumerates runtime-registered content types | C1 + C8 (test) | Extend cleanup scan registry enumeration in same commit |
| **A2** existing 6 plugin /search routes are identical boilerplate | C2–C7 (pre-commit diff and quote) | STOP — escalate to human before commit |
| **A3** auto-reg design doesn't preclude per-plugin override | C1 (design review in commit message) | Note override hook TODO but don't implement |
| **A4** no `useSearch` name collision | C12 pre-commit grep | Rename to `useClientSearch` |
| **A5** hook rewire preserves external contract | C12 dev server smoke | Debug and fix; do not commit until smoke passes |
| **A6** brainstorm message bodies can flatten to single text blob | C9 (indexer unit test) | A8 bail-out |
| **A7** brainstorm fits registerFileBackedContentType | C9 (activation test) | Shouldn't fail; if does, escalate |
| **A8** brainstorm embedding perf is tolerable | C9 (perf measurement) | Keyword-only fallback |
| **A9** MCP `table` → `plugin` swap is atomic without agent breakage | C11 pre-commit grep | Update call sites in same commit |
| **A10** calendar local filter is self-contained to page component | C14 (implementation check) | Should be trivially true; escalate if storage/plugin changes needed |

---

## Dev Server Smoke Gates

Per CLAUDE.md: _"For UI or frontend changes, start the dev server and use the feature in a browser before reporting the task as complete."_

Mandatory smoke checkpoints:

| Commit | Pages to smoke | What to verify |
|---|---|---|
| **C12** | `/assets`, `/tasks`, `/workflows`, `/projects`, `/schedule`, `/memory` | Each page loads without console errors. Search input accepts text, filters visible results, facets render. |
| **C13** | `/messaging/brainstorm` | Search input filters session list. Semantic query returns relevant sessions. |
| **C14** | `/messaging/calendar` | `ListSearch` input filters calendar items on keystrokes. Month navigation still works. |
| **C15** | `/health` | Antfly status panel renders. Status values populate. |
| **After Phase 2 complete** | All 8 consumer pages | Full-system smoke — nothing broken by the end-to-end rearchitecture. |

Each smoke gate must be performed by the commit's agent before marking the commit done. A failed smoke blocks the commit — agent investigates, fixes, and re-smokes.

---

## Effort Estimates

| Commit | Estimate | Flag |
|---|---|---|
| C1 | 30–45 min | Foundation, one-shot |
| C2–C7 | 10 min each | Trivial deletions |
| C8 | 20–30 min | File move + schema copy |
| C9 | 45–60 min | **New file + reindex logic + perf measurement** |
| C10 | 15–20 min | Helper function |
| C11 | 30 min | Param swap across 7 tools + grep for call sites |
| **C12** | **45–60 min** | **Largest single commit in plan — hook rename + 6 consumers + smoke** |
| C13 | 30 min | New consumer pattern |
| C14 | 15–20 min | Local filter copy pattern |
| C15 | 20–30 min | Route move + fetch update + smoke |
| C16 | 20–30 min | Helper extension |
| C17–C20 | 30–45 min each | New test files, unit-level |
| C21–C27 | 45–60 min each | Per-plugin bundle (route test + component smoke) |
| C28 | 30 min | Knowledge docs updates |
| C29 | 20 min | CLAUDE.md + README |

**Total wall-clock with full parallelism:**
- Layer 1: 45 min
- Layer 2: 60 min (bottlenecked on C9 brainstorm)
- Layer 3 (C11): 30 min
- Layer 4 (C12/C15 parallel): 60 min (bottleneck C12)
- Layer 5 (C13/C14 parallel): 30 min
- Layer 6 (C16): 30 min
- Layer 7 (Phase 4 parallel): 60 min (bottleneck longest per-plugin bundle)
- Layer 8 (docs): 50 min

**Total critical path: ~6 hours of wall-clock time with full parallelism.** Sequential execution would be ~18 hours.

**Commits flagged for possible split:**
- **C12** if it feels too large mid-flight: split into (a) new `useSearch` alongside old hook, (b) migrate consumers one-by-one, (c) delete old hook. Adds ~8 commits but allows single-consumer rollback.
- **C27** if messaging test bundle is unwieldy: split into brainstorm server-side (route + indexer) and brainstorm client-side (consumer + calendar filter) — 2 commits instead of 1.

---

## Ground Rules (non-negotiable, from spec + CLAUDE.md)

1. No backwards-compat shims, no deprecation aliases, no renaming to `_unused`.
2. Every new test file mocks `getContentDir`, logger, watcher, openclaw-client. NO EXCEPTIONS (spec §4 critical rule, CLAUDE.md Testing Rules).
3. No `--no-verify` on commits. Pre-commit hooks must pass.
4. Every commit must compile and pass tests (except explicit "test not yet written" gaps flagged above — there are none in this plan).
5. Dev server smoke test mandatory for any commit touching UI (C12, C13, C14, C15).
6. Per-plugin commit checkpoints in Phase 1 and Phase 4 are the primary rollback surface — do not squash.
7. No worktrees — parallel agents touch disjoint file scopes.
8. Commit messages follow conventional commits (`feat(scope): ...`, `refactor(scope): ...`, etc.).
9. Every Phase 1 cleanup commit (C2–C7) MUST quote the deleted route block in its commit message for R1 audit trail.

---

## Exit Criteria

Phase 5 done when:

- [ ] All 29 commits landed on `main` in topological order.
- [ ] `npm test` green — full test suite.
- [ ] `npm run build` green — no type errors.
- [ ] `rg "useAntflySearch|AntflySearch"` across all source and docs returns zero hits.
- [ ] `rg "table: '" plugins/**/components/ plugins/**/hooks/` returns zero matches in search contexts.
- [ ] `rg "/api/antfly/"` returns zero hits in source.
- [ ] Dev server smoke test passes on all 8 affected consumer pages.
- [ ] Coverage metrics from spec §5.4 met: >80% on `src/core/search-registry.ts`, `src/hooks/use-search.ts`, and each plugin's search handler.
- [ ] `bakin_exec_search_query({ plugin: 'tasks', q: '...' })` callable via MCP and returns results.
- [ ] `.claude/knowledge/search-system.md` and `search-plugin-guide.md` reflect the new architecture.

---

**End of plan.** Awaiting approval to invoke `/agent-skills:build`.
