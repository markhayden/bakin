# PLAN — Task Outcome in Run History (#476)

> Derived from `SPEC.md`. Plan-mode artifact: ordering, vertical slices, acceptance + verification, checkpoints, and the commit/rollback strategy.
> Branch: `feat/task-outcome-run-history` off `main`. One commit per task; each task ends green (full suite).
> Prior plan archived at `tasks/plan-bakin-owned-scheduler.md`.

## Dependency graph

```
T1 readTaskOutcome + TaskOutcome type (+unit tests)
 │
 ├─► T2 route returns { runs, outcome } + hook/SDK mirror (+route tests)
 │        │
 │        └─► T3 UI: header outcome badge + settled→blue (+component test)
 │
 └─► T4 docs: execution-ledger.md consumers table   (independent after T1)
```

Critical path: T1 → T2 → T3. T4 can land any time after T1; sequenced last.

## Slicing principle

Each task is a vertical slice that compiles, tests, and commits on its own.
T1 is a pure addition (nothing consumes it); T2 changes the API contract while
the UI remains tolerant (it ignores unknown keys); T3 is the user-visible
payoff. Reverting T3 leaves a useful API; reverting T2–T3 leaves a harmless
helper.

---

## T1 — `readTaskOutcome` derivation + `TaskOutcome` type

**Files:** `plugins/tasks/lib/runs-reader.ts`, `plugins/tasks/types.ts`,
`tests/plugins/tasks/runs-reader.test.ts` (new; mirrors
`tests/plugins/schedule/runs-reader.test.ts` placement).

**Change:**
- `TaskOutcome` interface in `plugins/tasks/types.ts` (per SPEC §2 Types).
- `readTaskOutcome(taskId: string): TaskOutcome | undefined` in
  `runs-reader.ts`:
  - `getCompletion(taskId)` via the existing relative import path
    (`../../../src/core/execution-ledger`).
  - `getTaskWithColumn(taskId)` from `../../../src/core/task-store`.
  - Normative derivation (SPEC §2): completion row → `done` with
    `completedAt` (ISO) + `agent`; else column `blocked`/`archived` →
    same-named state; column `done` → `done` without completion fields;
    other columns → `in_progress`; unknown task (no row, no board entry)
    → `undefined`.

**Tests (table-driven, mock `src/core/execution-ledger` + `src/core/task-store`
via BOTH the relative and `@/` specifiers, plus logger; no real ledger):**
1. completion + column done → `done` with `completedAt`/`agent`
2. completion + column archived → `done` (completion wins)
3. no completion + blocked → `blocked`
4. no completion + archived → `archived`
5. no completion + done (legacy) → `done`, no `completedAt`
6. no completion + each of inProgress/todo/backlog/review → `in_progress`
7. unknown task → `undefined`

**Acceptance:** all 7 derivation cases pass; no behavior change anywhere else.
**Verify:** `bun test tests/plugins/tasks/runs-reader.test.ts --isolate`, then
`bun run test` green.
**Commit:** `feat(tasks): add readTaskOutcome derivation over completions + column`

---

## T2 — Route returns `{ runs, outcome }` + client mirror

**Files:** `plugins/tasks/index.ts` (`/:taskId/runs` handler),
`src/hooks/use-task-run-history.ts`, `packages/sdk/src/hooks/index.ts`,
`tests/plugins/tasks/routes.test.ts`.

**Change:**
- Handler: `Response.json({ runs: readTaskRuns(...), outcome: readTaskOutcome(params.taskId) })`.
  `outcome: undefined` serializes to an absent key — unknown tasks keep
  returning `{ runs: [] }` with status 200.
- Hook: mirror `TaskOutcome` (keep-in-sync comment, same as `TaskRunEntry`),
  add `outcome` state, return `{ runs, outcome, loading }`.
- SDK: `export type { TaskOutcome }` beside the existing `TaskRunEntry`
  re-export (`packages/sdk/src/hooks/index.ts:33`).

**Tests (extend `routes.test.ts`):**
- Existing ledger fake gains `getCompletion` (reads `completionsFake`); the
  `@/core/task-store` mock gains `getTaskWithColumn` — and the same mock is
  registered for the relative specifier `../../../src/core/task-store` (the
  ledger mock already does both; missing one is a leak surface).
- Runs + completion seeded → body has `outcome.state === 'done'` with
  `completedAt`/`agent`; runs + no completion + column blocked → `blocked`;
  unknown task → `runs: []`, no `outcome` key, status 200.
- Existing run-history assertions keep passing untouched (they don't pin
  response keys).

**Acceptance:** API serves the sibling outcome object per SPEC; empty-task
behavior unchanged.
**Verify:** `bun test tests/plugins/tasks/routes.test.ts --isolate`, then
`bun run test` green.
**Commit:** `feat(tasks): return task outcome from the runs route`

— **CHECKPOINT A** — API contract complete and tested; UI untouched. Safe
rollback point: reverting everything after this still leaves a correct API.

---

## T3 — UI: header outcome badge + demote settled green → blue

**Files:** `plugins/tasks/components/task-run-history.tsx`,
`tests/plugins/tasks/task-run-history.test.tsx` (new; follows
`task-card.test.tsx` component-test pattern).

**Change (per SPEC UI mock):**
- Consume `outcome` from `useTaskRunHistory`.
- Header line gains an outcome badge after the summary text:
  done → green (`✓ done` + relative completedAt when present), blocked → red,
  in_progress → amber, archived → zinc. Label text: `done` / `blocked` /
  `in progress` / `archived` (display form of the enum).
- `STATUS_CLASS.settled` green → blue (`bg-blue-500/10 text-blue-400
  border-blue-500/20`); `lost`/`running`/`superseded` unchanged.
- No-runs early return unchanged (outcome never renders without runs).

**Tests:**
- Header shows the outcome badge per state (done/blocked/in_progress);
  settled badge no longer carries green classes; zero runs renders nothing
  even when outcome would be `done`.

**Acceptance:** acceptance criteria 1 & 3 of the issue — a settled run on an
in-progress task shows blue `settled` + amber `in progress`; green appears
only for task-done.
**Verify:** component test green; full `bun run test`; visual spot-check via
`bun run dev:mock` (imitation-crab seeds run-history data).
**Commit:** `feat(tasks): show task outcome in run history header, demote settled to blue`

— **CHECKPOINT B** — feature complete and user-visible; full suite green.

---

## T4 — Docs: knowledge alignment

**Files:** `.claude/knowledge/execution-ledger.md` (consumers table, the
"Run history (read-only)" row) — note the tasks drawer now joins
`getCompletion` + task column into a task-outcome line. Sweep for other stale
mentions (`grep -rn "runs-reader\|run history" .claude/knowledge/`):
`shared-ui-patterns.md` references the schedule drawer only — untouched
unless wording drifts. README verified unaffected (no run-history mention).

**Acceptance:** knowledge docs describe the outcome join accurately; no other
doc contradicts the new behavior.
**Verify:** re-read the touched doc section; `bun run test` still green
(docs-only).
**Commit:** `docs(ledger): note run-history outcome join in execution-ledger knowledge`

---

## Final gate (before PR)

- Full suite: `bun run test` green.
- `SPEC.md` + `tasks/plan.md` + `tasks/todo.md` committed on the branch
  (first commit, or alongside T1).
- Never `git add -A` after a local build (generated-version build-stamp trap).
- PR references #476; body maps commits to the rollback ladder.

## Docker gold-standard verification (isolated mode) — PASSED 2026-06-09

Run against a real OpenClaw container + live Bakin server (`instance up/dev
--mode isolated`), driving the user stories end-to-end via CLI + API:

| Story | Result |
|---|---|
| Agent turn settles, task still open | ✅ run `settled/turn ok` while `outcome: in_progress` — the false-success read is gone |
| Block after settled run | ✅ `outcome: blocked`, run badge stays `settled` |
| Human completes (log + move to done) | ✅ `outcome: done` + `completedAt` + `agent` from the completions row |
| Archive after done | ✅ outcome stays `done` (completion wins) |
| Agent completes via MCP (`bakin_exec_tasks_complete`) | ✅ `outcome: done` with agent attribution |
| Unknown task | ✅ `{"runs":[]}`, no outcome key, HTTP 200 |
| Served UI bundle | ✅ `/api/plugins/tasks/assets/client.js` maps `settled` → blue, `done` outcome → green, "in progress" label present |

Incidental finds (pre-existing board guards, working as designed): blocked →
done is an invalid transition (must pass through todo), and moves to done
require at least one log entry.

## Rollback strategy

| Revert | Leaves |
|---|---|
| T4 | feature intact, docs stale (re-do docs) |
| T3 | correct `{ runs, outcome }` API, old UI |
| T3+T2 | unused-but-tested helper, zero surface change |
| all | clean main |
