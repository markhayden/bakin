# SPEC — Schedule: blocked tasks must not suppress real fires

> Status: draft for approval · Owner: Mark · Date: 2026-06-08

## 1. Objective

A stalled `blocked` task currently behaves as if a run is still "in flight," which
silently suppresses a job's next genuine scheduled fire. Fix the scheduler so a
`blocked` last-task is treated as *needs human triage*, not *currently running*:
the next real fire proceeds, the job's health (auto-pause) is not falsely
penalized by triage blocks, and catch-up tasks are labeled with the date they
were *supposed* to run.

Target environment: single-user, self-hosted Bakin on a Mac mini. No
backwards-compat or shims. Priority: reduce tech debt; keep it clean and clear.

## 2. Background — confirmed root cause

Triage on the production machine established the chain (not a timezone bug, not a
failing default):

1. Schedule **cutover** ran, then startup **catch-up** created the previous
   period's missed fires directly in `blocked` (`blockedReason: "missed schedule
   window"`). These tasks **never dispatch** (empty log, no execution).
2. **Cascade (the real bug):** at the real fire time, the live scheduler skipped
   the fire as `overlap` because the `blocked` task still existed — so the genuine
   run was silently suppressed until the user hand-moved the task to `todo`.
3. **Cosmetic:** catch-up task titles used `new Date()` (today) instead of the
   occurrence date, so a stale prior-day run masqueraded as "today's" run.

Relevant code, all in `plugins/schedule/index.ts`:
- Overlap guard: `runClaimedFire` lines **404–413** — `activeColumns` includes `'blocked'`.
- Failure tracking: lines **416–428** — any `blocked` last-task calls `recordFailure()`.
- Title/date: line **433** — `const now = new Date()` used for `templateVars.date`.
- Fire callback: line **558** — receives the occurrence as `_occurrence` and **discards it**, so `runClaimedFire` never gets the occurrence.

## 3. Scope

**In scope**
- Overlap guard no longer treats `blocked` as active.
- Failure/auto-pause tracking ignores *triage* blocks; still counts *dispatch-failure* blocks.
- Catch-up task title/date derived from the **occurrence**, not creation time.
- Tests + knowledge-doc update.

**Out of scope (non-goals)**
- The cutover/migration path itself (one-time, already resolved).
- Whether catch-up creates a `blocked` triage task at all (the catch-up *window*
  policy stays as-is — it remains the legitimate "here's a stale run, triage it"
  signal).
- Auto-cleanup/auto-archive of stale blocked triage tasks.
- Any change to dispatch-side block paths (`src/core/dispatch.ts`).

## 4. Functional requirements & acceptance criteria

### FR1 — Overlap guard excludes `blocked`
`activeColumns` becomes `['todo', 'inProgress', 'review']`.

- **AC1.1** Last task in `blocked` → the next fire is **created/dispatched** (not skipped as `overlap`).
- **AC1.2** Last task in `inProgress`, `review`, or `todo` → fire is still skipped as `overlap` (unchanged).
- **AC1.3** `allowOverlap: true` continues to bypass the guard entirely (unchanged).

### FR2 — Triage blocks are not failures
The literal `'missed schedule window'` is extracted to an exported constant
(e.g. `MISSED_WINDOW_REASON`) owned by the schedule plugin and reused at the
creation site. The outcome check (416–428) classifies the `blocked` last-task by
`blockedReason`:

- **AC2.1** Last task blocked with reason === `MISSED_WINDOW_REASON` → **no**
  `recordFailure`, no auto-pause contribution (it's a notification).
- **AC2.2** Last task blocked with any other reason (dispatch failures:
  `"Agent run ended before reporting completion…"`, `"Dispatch failed N times…"`)
  → `recordFailure` as today (can auto-pause after `maxFailures`).
- **AC2.3** Last task in `done`/`archived` → `recordSuccess` (unchanged).
- **AC2.4** Discrimination is by an owned constant compared against the task's
  `blockedReason`, **not** brittle substring matching of external error text.

### FR3 — Catch-up tasks labeled by occurrence date
Thread the occurrence through the fire callback into `runClaimedFire`; use it for
`templateVars.date` and the default title. Manual fires (no occurrence) fall back
to their existing `firedAt`/now.

- **AC3.1** A catch-up task for an occurrence on day *D* has a title/`date` of *D*,
  not the (later) creation day.
- **AC3.2** A normal on-time fire is unchanged (occurrence ≈ now).
- **AC3.3** `runClaimedFire` no longer reads wall-clock `new Date()` for the label;
  the occurrence (or explicit manual `firedAt`) is the single source.

### FR4 — End-to-end regression (the cascade)
- **AC4.1** Given a `blocked` triage task as the job's last task, when the next
  occurrence fires, a new task is created and dispatched, and the job's
  `consecutiveFailures` is unchanged (not incremented).

## 5. Implementation approach

Behavior change is confined to `plugins/schedule/index.ts` plus the fire callback
passing the occurrence. The `SchedulerDeps.fire` signature already carries
`occurrence`, so only the callback body and `runClaimedFire` signature change.

1. Export `MISSED_WINDOW_REASON = 'missed schedule window'`; use it at line 561
   and in the outcome check.
2. `runClaimedFire(meta, jobId, runId, opts)` gains an `occurrence?: Date` (or a
   `firedAtMs`) input; `templateVars.date`/title derive from it; default to now
   for manual fires.
3. Fire callback (≈558) passes the real `occurrence` instead of `_occurrence`.
4. Overlap `activeColumns` → drop `'blocked'`.
5. Outcome check → skip `recordFailure` when `blockedReason === MISSED_WINDOW_REASON`.

Keep functions pure where practical; no new dependencies.

## 6. Code style
Per `CLAUDE.md`: TypeScript strict, no `any` across boundaries, `const` over
`let`, `UPPER_SNAKE_CASE` for the new constant, existing import order, conventional
commits with `fix(schedule):` / `refactor(schedule):` scopes.

## 7. Commands
- Test (file): `bun test tests/plugins/schedule/<file>.test.ts --isolate`
- Full suite: `bun run test`
- `bun run typecheck` · `bun run lint`
- Manual: `bun run dev:mock`

## 8. Testing strategy
TDD (Prove-It): write failing tests first. Use `tests/plugins/schedule/` with the
isolated mock context helpers (`activatePlugin`, `callRoute`) and the mandatory
content-dir / OpenClaw-home mocks (per `CLAUDE.md` testing rules).

- **overlap**: blocked last-task → fire proceeds (AC1.1); inProgress/review/todo → skipped (AC1.2); allowOverlap bypass (AC1.3).
- **failure tracking**: triage block → no recordFailure (AC2.1); dispatch-failure block → recordFailure (AC2.2); done → recordSuccess (AC2.3).
- **date label**: catch-up task titled by occurrence date (AC3.1); on-time unchanged (AC3.2).
- **regression**: cascade scenario end-to-end (AC4.1).

Run: `bun test tests/plugins/schedule/ --isolate`, then full `bun run test`.

## 9. Boundaries
- **Always:** mock both content-dir resolvers + OpenClaw home in tests; keep the
  fix confined to `plugins/schedule/`; update `.claude/knowledge/bakin-owned-scheduler.md`.
- **Ask first:** any change that would alter `src/core/dispatch.ts` block paths,
  the catch-up window policy, or task-store semantics.
- **Never:** classify blocks by external error-message text; write to real
  `~/.bakin`/`~/.openclaw` from tests; add backwards-compat shims.

## 10. Commit checkpoints (carried into /plan)
1. `refactor(schedule): extract MISSED_WINDOW_REASON constant` (no behavior change).
2. `fix(schedule): exclude blocked from overlap guard` + tests (FR1).
3. `fix(schedule): don't count triage blocks toward auto-pause` + tests (FR2).
4. `fix(schedule): label catch-up tasks by occurrence date` + tests (FR3, FR4).
5. `docs(schedule): update bakin-owned-scheduler knowledge for blocked semantics`.

Each checkpoint is independently revertable.

## 11. Docs impacted
- `.claude/knowledge/bakin-owned-scheduler.md` — overlap ignores `blocked`, triage
  blocks don't penalize health, catch-up labels by occurrence.
- `README.md` / `CLAUDE.md` — not expected to change (verify during build).
