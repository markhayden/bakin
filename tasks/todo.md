# TODO: Team plugin canonical main-agent ids

**Spec:** `.claude/specs/issue-90-team-main-agent-canonical.md`
**Plan:** `tasks/plan.md`
**Issue:** https://github.com/madeinwyo/bakin/issues/90
**Branch:** `fix/issue-90-team-main-agent`

## Phase 1 — Refactor prelude (solo)

- [ ] **Spec patch** — update spec section 4 & 7: doctor/migration code cannot auto-mutate openclaw.json, but user-initiated CRUD (existing `addAgent`/`removeAgent`) is allowed per CLAUDE.md's adapter principle.
- [ ] **T3** — create `packages/core/src/openclaw-config.ts`; migrate the three duplicate mtime-cached readers from `main-agent.ts` / `openclaw-adapter.ts` / `settings.ts` to import from it. Pure refactor, no behavior change. _(commit: `refactor(core): centralize openclaw.json reader into openclaw-config module`)_
- [ ] ✅ **Phase 1 checkpoint:** `typecheck` + full `test` pass. Team page and `/api/settings` are unchanged from pre-refactor.

## Phase 2 — Parallel fan-out (6 commits, any order)

**All six tasks below touch disjoint files.** Execute as six concurrent sub-agents or serially in any order. Each lands as its own commit.

- [ ] **T1** — `packages/core/src/main-agent.ts` only. `getMainAgentId()` always returns `"main"`; delete detection heuristic and the old `mainAgentId` setting reference. _(commit: `refactor(core): getMainAgentId always returns "main"`)_
- [ ] **T2** — `packages/core/src/settings.ts` + `cli/bakin.ts` only. Delete `BakinSettings.agents` and `BakinSettings.mainAgentId` fields; migrate cli consumers to `openclaw-config.getAgentIds()`. _(commit: `refactor(core): drop stale settings.agents + mainAgentId fields`)_
- [ ] **T4** — `plugins/team/lib/openclaw-adapter.ts` only. `listAgents()` validates + dedupes (reject duplicate ids, duplicate workspaces, missing `main`). Read-only, never mutates openclaw.json. _(commit: `feat(team): validate and dedupe openclaw agent list`)_
- [ ] **T5** — `plugins/team/components/team-grid.tsx` only. `buildGraph()` roots the pyramid at the main agent; `reportsTo ?? mainAgentId` resolution; drop `topAgentIds` heuristic for the root. _(commit: `feat(team): pyramid root is always the main agent`)_
- [ ] **T6** — `plugins/team/index.ts` (writer route) only. Normalize `reportsTo === mainAgentId` → null on write; reader treats unknown `reportsTo` strings as null with a warning log. _(commit: `feat(team): normalize team.json writes to drop implicit main reportsTo`)_
- [ ] **T7** — `src/core/onboarding/openclaw.ts` only. Doctor check validates missing `main`, duplicate ids, duplicate workspaces. Reports only, non-zero exit on failure, never auto-fixes. _(commit: `feat(onboarding): doctor validates openclaw.json integrity`)_
- [ ] ✅ **Phase 2 checkpoint:** `typecheck` + full `test` pass. Team page on imitation-crab fixture shows founder → Crab → 7 subagents (no dupes). Null-reportsTo Creators team renders under Crab. `bakin check openclaw` flags a deliberately-broken fixture.

## Phase 3 — Docs (solo)

- [ ] **T8** — update `.claude/knowledge/agent-system.md`, create/append `.claude/knowledge/team-plugin.md`, verify `CLAUDE.md` is still accurate. _(commit: `docs: update agent-system and team-plugin knowledge notes`)_
- [ ] ✅ **Phase 3 checkpoint:** all tests green, docs match shipped code.

## Phase 4 — Manual cleanup (runbook, no commit)

- [ ] **T9** — runbook execution on this machine per `tasks/plan.md` Phase 4. Backup → edit openclaw.json (merge roscoe into main) → move avatars → delete heartbeats → edit team.json → edit settings.json → `bakin check openclaw` → restart → visually verify one Roscoe card at the pyramid top with Creators + Builders under it.

## Post-merge

- [ ] Close issue #90 with a comment linking the PR and summarizing: "canonical id is `main`, display name from `identity.name`, team page derives roster from OpenClaw with dedupe + validation, doctor catches future regressions."
- [ ] Archive `tasks/plan.md` and `tasks/todo.md` to match the convention used for the Health Plugin Overhaul work.
