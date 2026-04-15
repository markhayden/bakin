# TODO: Team plugin canonical main-agent ids

**Spec:** `.claude/specs/issue-90-team-main-agent-canonical.md`
**Plan:** `tasks/plan.md`
**Issue:** https://github.com/madeinwyo/bakin/issues/90
**Branch:** `fix/issue-90-team-main-agent`

## Phase 1 — Refactor prelude (solo)

- [ ] **Spec patch** — update spec section 4 & 7: doctor/migration code cannot auto-mutate openclaw.json, but user-initiated CRUD (existing `addAgent`/`removeAgent`) is allowed per CLAUDE.md's adapter principle.
- [x] **T3** — create `packages/core/src/openclaw-config.ts`; migrate the three duplicate mtime-cached readers from `main-agent.ts` / `openclaw-adapter.ts` / `settings.ts` to import from it. Pure refactor, no behavior change. _(commit: `refactor(core): centralize openclaw.json reader into openclaw-config module` — 773ed59)_
- [x] ✅ **Phase 1 checkpoint:** `typecheck` (no new errors) + full `test` (139 files, 2076 passing) pass. Team page and `/api/settings` are unchanged from pre-refactor.

## Phase 2 — Parallel fan-out (6 commits, any order)

**All six tasks below touch disjoint files.** Execute as six concurrent sub-agents or serially in any order. Each lands as its own commit.

- [x] **T1** — `packages/core/src/main-agent.ts`. `getMainAgentId()` always returns `"main"`; deleted detection heuristic and old `mainAgentId` setting reference. _(commit: `refactor(core): getMainAgentId always returns "main"` — cb62901)_
- [x] **T2** — `packages/core/src/settings.ts` + cli/dispatch/doctor/mcporter/agents consumers. Deleted `BakinSettings.agents` and `BakinSettings.mainAgentId` fields; migrated all consumers to `openclaw-config.getAgentIds()`. _(commit: `refactor(core): drop stale settings.agents + mainAgentId fields` — 704d37b)_
- [x] **T4** — `plugins/team/lib/openclaw-adapter.ts`. `listAgents()` validates + dedupes (rejects duplicate ids, duplicate resolved workspaces, returns empty roster when `main` missing). Read-only, never mutates openclaw.json. _(commit: `feat(team): validate and dedupe openclaw agent list` — 7202c41)_
- [x] **T5** — `plugins/team/components/team-grid.tsx` + extracted `plugins/team/lib/build-graph.ts`. `buildGraph()` roots the pyramid at the main agent; `reportsTo ?? mainAgentId` resolution with unknown-id fallback; dropped `topAgentIds` heuristic. _(commit: `feat(team): pyramid root is always the main agent` — aaf2aba)_
- [x] **T6** — `plugins/team/index.ts` (writer route) + types.ts + team-manager.tsx + routes.test.ts. Normalizes `reportsTo === mainAgentId` → null on write; reader degrades unknown `reportsTo` strings to null with warning log. _(commit: `feat(team): normalize team.json writes to drop implicit main reportsTo` — 7765585)_
- [x] **T7** — `src/core/onboarding/openclaw.ts`. Doctor check validates missing `main`, duplicate ids, duplicate workspaces. Reports only, never auto-fixes, collects all violations in one pass. _(commit: `feat(onboarding): doctor validates openclaw.json integrity` — 8abffa6)_
- [x] **Test mock migration** — doctor/mcporter/usage-wiring tests were still mocking `BakinSettings.agents`; migrated to `@bakin/core/openclaw-config.getAgentIds` and added openclaw-home pins. _(commit: `test(core): migrate stale settings.agents mocks to openclaw-config` — 84d1b94)_
- [x] ✅ **Phase 2 checkpoint:** typecheck clean on Phase 2 surface (pre-existing errors in antfly-reranker/search-auto-registration/search-tools-mcp/brainstorm/project-grid are unrelated). Full test suite: 141 files, 2108 passing, 1 skipped.

## Phase 3 — Docs (solo)

- [ ] **T8** — update `.claude/knowledge/agent-system.md`, create/append `.claude/knowledge/team-plugin.md`, verify `CLAUDE.md` is still accurate. _(commit: `docs: update agent-system and team-plugin knowledge notes`)_
- [ ] ✅ **Phase 3 checkpoint:** all tests green, docs match shipped code.

## Phase 4 — Manual cleanup (runbook, no commit)

- [ ] **T9** — runbook execution on this machine per `tasks/plan.md` Phase 4. Backup → edit openclaw.json (merge roscoe into main) → move avatars → delete heartbeats → edit team.json → edit settings.json → `bakin check openclaw` → restart → visually verify one Roscoe card at the pyramid top with Creators + Builders under it.

## Post-merge

- [ ] Close issue #90 with a comment linking the PR and summarizing: "canonical id is `main`, display name from `identity.name`, team page derives roster from OpenClaw with dedupe + validation, doctor catches future regressions."
- [ ] Archive `tasks/plan.md` and `tasks/todo.md` to match the convention used for the Health Plugin Overhaul work.
