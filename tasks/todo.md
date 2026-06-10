# TODO — Task Outcome in Run History (#476)

Branch: `feat/task-outcome-run-history` off `main`. One commit per task; each ends green. See `tasks/plan.md` for detail.

## Phase 1 — Server derivation
- [x] **T1** `readTaskOutcome` + `TaskOutcome` type + table-driven unit tests (7 derivation cases) — `feat(tasks): add readTaskOutcome derivation over completions + column` ✅ e4b6e3b5
- [x] **T2** runs route returns `{ runs, outcome }` + hook mirror + SDK type re-export + route tests (mock task-store via BOTH specifiers) — `feat(tasks): return task outcome from the runs route` ✅ 8f454d94
- [x] **— CHECKPOINT A** — API contract complete, full suite green (4803 pass)

## Phase 2 — UI
- [x] **T3** header outcome badge + settled green→blue + component test — `feat(tasks): show task outcome in run history header, demote settled to blue` ✅ 0c95cf9d
- [x] **— CHECKPOINT B** — feature complete, full suite green (4809 pass), plugins build clean

## Phase 3 — Docs
- [x] **T4** `.claude/knowledge/execution-ledger.md` consumers-table update + stale-mention sweep (no other doc references the runs response or badge colors; README unaffected) — `docs(ledger): note run-history outcome join in execution-ledger knowledge`

## Final gate
- [x] Coverage audit: archived-badge component test added; all 4 outcome states covered at unit + component level
- [x] `bun run test` green (4801 pass / 0 fail), typecheck + lint clean
- [ ] PR references #476 with rollback ladder
