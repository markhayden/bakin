# TODO — Task Outcome in Run History (#476)

Branch: `feat/task-outcome-run-history` off `main`. One commit per task; each ends green. See `tasks/plan.md` for detail.

## Phase 1 — Server derivation
- [ ] **T1** `readTaskOutcome` + `TaskOutcome` type + table-driven unit tests (7 derivation cases) — `feat(tasks): add readTaskOutcome derivation over completions + column`
- [ ] **T2** runs route returns `{ runs, outcome }` + hook mirror + SDK type re-export + route tests (mock task-store via BOTH specifiers) — `feat(tasks): return task outcome from the runs route`
- [ ] **— CHECKPOINT A** — API contract complete, full suite green

## Phase 2 — UI
- [ ] **T3** header outcome badge + settled green→blue + component test — `feat(tasks): show task outcome in run history header, demote settled to blue`
- [ ] **— CHECKPOINT B** — feature complete, full suite green, visual spot-check (`bun run dev:mock`)

## Phase 3 — Docs
- [ ] **T4** `.claude/knowledge/execution-ledger.md` consumers-table update + stale-mention sweep — `docs(ledger): note run-history outcome join in execution-ledger knowledge`

## Final gate
- [ ] `bun run test` green; PR references #476 with rollback ladder
