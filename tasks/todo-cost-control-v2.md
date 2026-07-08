# TODO: Cost Control v2 (#464)

Plan: `tasks/plan-cost-control-v2.md` · Spec: `.claude/specs/cost-control-v2.md`
Branch: `feat/464-cost-control-v2`. Gates per commit: `bun run test` + `bun run typecheck` (+ build where noted). TDD per task.

## Phase 1 — Spend engine
- [x] T1 `feat(core): run_costs provider + lane columns + cost facets verb`
- [x] T2 `feat(core): usage-history per-model day rollup verb`
- [x] T3 `feat(models): billing context — lane detection + provider resolution`
- [x] T4 `feat(core): assembleBudgetSpend — faceted total-observed spend engine`
- [x] T5 `refactor(core): gate + health check + /spend consume the shared engine`
- [x] CHECKPOINT A: full suite green; zero-unattributed parity pinned

## Phase 2 — Rules, incidents, modes
- [x] T6 `feat(core): BudgetRule policy + rule-based evaluator + gate provider resolution` (incl. one-shot settings migration; routing hoisted above gate)
- [x] T7 `feat(core): budget_incidents ledger table + verbs`
- [x] T8 `feat(core): gate opens incidents; rollover auto-resolve; delete in-memory debounce`
- [x] T9 `feat(core): atCap pause mode`
- [x] T10 `feat(core): dispatch kill switch (settings.dispatch.paused)`
- [x] CHECKPOINT B: verified 2026-07-07 — isolated boot: $1 cap + $2 seeded spend → task held in todo, ONE open budget_incidents row (global|metered|daily|cap|defer), ONE budget.deferred audit with incidentId; kill switch paused dispatch (todo + dispatch.paused audit) and unpause resumed dispatch attempts (task.dispatched rows)

## Phase 3 — Media gate
- [ ] T11 `feat(images): per-call billed-media gate with typed budget_exceeded error`

## Phase 4 — Alerting + onboarding
- [ ] T12 `feat(core): budget-notify — SSE event + main-agent relay on incident open`
- [ ] T13 `feat(host): browser notification for budget incidents`
- [ ] T14 `feat(core): onboarding budget component + unset-budget doctor notice`
- [ ] CHECKPOINT C: fresh install cannot be silently uncapped

## Phase 5 — Surfaces
- [ ] T15 `feat(models): budget/status + incidents routes; rule-list PUT`
- [ ] T16 `feat(models): Spend tab — lane split, utilization, pace, rule editor, incident banner`
- [ ] T17 `feat(health): rule-aware check + attention chips + spend card + kill-switch banner`
- [ ] T18 `feat(tasks): budget-deferred task badges`
- [ ] T19 `feat(cli): bakin spend + bakin budget command group`
- [ ] CHECKPOINT D: full suite + `bun run build` green (revert generated-version.ts)

## Phase 6 — Docs + close-out
- [ ] T20 `docs(knowledge): cost-control v2 across knowledge docs + CLAUDE.md` (spec → IMPLEMENTED; README check)
- [ ] CHECKPOINT E: `/verify` full pass; PR with `Closes #464`
