# Spec: Completion-row invariant hardening (#482) + dockerized-rig fixes (#467)

**Date:** 2026-06-10 · **Status:** Approved (spec + plan); plan at `tasks/plan.md`

> **Plan-phase amendments (approved with plan):** (1) Workflow done-moves must also RECORD
> completion rows — `recordCompletion` had exactly one caller, so workflow-completed tasks are
> done-without-row on an ongoing basis; `moveTaskInStore` becomes ledger-symmetric via a
> `syncLedgerForStoreMove` helper, which is a prerequisite for retiring the legacy
> `readTaskOutcome` fallback. (2) Store `blockTask` treats `blocked→blocked` as an idempotent
> reason update (retry semantics preserved); channel is a new 4th param. (3) WS2 scope widening
> must reconcile REUSED rig state idempotently (`widenDeviceScopes` in `ensureApprovedDevice`'s
> existing-identity branch) — fresh-only widening would not fix #467's actual scenario.
> (4) `archiveOldTasks` gains the `purgeTaskRows` call it was missing (orphaned-row family);
> `ctx.tasks.move` documented as an unvalidated escape hatch, no code change.
**Scope decision:** Of the four candidate cleanup issues, #482 and #467 are in scope. #462 (run
liveness classification) is deferred — it's a feature whose heuristics should be designed against
real ledger-era incident data. #471 (recovered channel-delivery failures) stays deferred per its
own documented revisit-trigger. Neither issue gets a GitHub comment (owner decision).

---

## 1. Objective

Two independent workstreams, two branches, two PRs:

**WS1 (#482):** Restore the execution-ledger invariant *"a completions row implies the task is
effectively done; every exit from done except archive deletes the row."* Today two exit families
violate it (block-from-done, workflow reopen/gate moves), so Run History renders a green `done`
badge on tasks that are blocked or re-running, and stale rows accumulate in `bakin.db`. Also land
the three minor follow-ups enumerated in #482.

**WS2 (#467):** Remove two known rig defects that break the cron→dispatch e2e path (device scopes
too narrow for OpenClaw 2026.5.28; stale host `agentDir` in reused rig state) and document the
`BAKIN_URL` port-rewiring gotcha.

**User impact:** WS1 — the task drawer / Run History stops lying about completion state; ledger
data stays trustworthy for every current and future reader. WS2 — rig e2e sessions work without
hand-editing container JSON.

## 2. Design decisions (interview outcomes)

| Decision | Outcome |
|---|---|
| Block a done task | **Reject.** `done→blocked` stays forbidden. REST/kanban → 409 (matching the already-guarded `POST /:taskId/block`); MCP `bakin_exec_tasks_block` returns a **soft non-error** "task already complete, block ignored" response, matching the ledger's retry philosophy (`alreadyComplete: true`, never an error). |
| Workflow exits from done | **Surgical reopen-delete, not full routing.** `moveTaskInStore` (plugins/workflows/lib/runtime.ts:59) has ~11 call sites including moves *to* done; routing through `moveTaskWithEffects` would trip the workflow done-guard and duplicate audits. Instead: a shared `reopenIfLeavingDone(taskId, to, agent, channel)` helper exported from task-service, containing the exact logic of task-service.ts:137-140 (delete row + `task.reopened` audit when target is active, i.e. not done/archived), called by both `moveTaskWithEffects` and `moveTaskInStore`. |
| #482 minors | **All three in scope:** pre-ledger backfill + legacy-branch removal, `relativeTime()` year, `useTaskRunHistory` reset/abort. |
| Backfill mechanics | Boot-time idempotent reconcile in the ledger init path: for each done-column task without a completions row, insert a synthetic row (`completedAt` = task `updatedAt`, agent `system`), audited once as `task.completion_backfilled`. Idempotent by construction (insert-if-missing), so no marker file. Then delete the legacy no-row fallback branch in `readTaskOutcome`. |
| Store-level guard | `blockTask` (src/core/task-store.ts:364) calls the same `assertTransitionAllowed` as `moveTask` — defense in depth under the service guard. **Verify during build:** the human-channel bypass semantics in `assertTransitionAllowed`; if human bypasses the table, the service-level `hasCompletion` rejection is the load-bearing guard for the kanban path (and must be). |
| Rig agentDir fix | Normalize on `instance up` (per the issue's recommendation): rewrite stored agent paths matching the host pattern to `/home/node/.openclaw/...` before the gateway starts. Mechanism details resolved in plan phase from `scripts/instance/*`. |
| Rig scopes | `OPERATOR_SCOPES` (scripts/instance/device-approve.ts:17) widens to `['operator.read', 'operator.write', 'operator.admin', 'operator.pairing']`. Dev-rig only; never ships. |

## 3. Changes — WS1 (#482), branch `fix/completion-row-invariant`

1. **Shared reopen helper** in `src/core/task-service.ts`; `moveTaskWithEffects` refactored to use
   it (behavior-identical).
2. **Service guard:** `blockTaskWithEffects` rejects when `hasCompletion(taskId)` — same 409
   semantics as `taskEditGuard` on `POST /:taskId/block`.
3. **Entry points:** `POST /:taskId/move` with `to=blocked` (plugins/tasks/index.ts:440-445) and
   MCP `bakin_exec_tasks_block` (≈:860) surface the rejection — 409 for REST, soft non-error
   payload for MCP.
4. **Store guard:** `blockTask` enforces `VALID_TRANSITIONS`.
5. **Workflows:** `moveTaskInStore` calls the shared reopen helper before the store move.
6. **Backfill + legacy-branch removal** as decided above.
7. **Minors:** `relativeTime()` in `task-run-history.tsx` includes year for >11-month-old
   timestamps; `useTaskRunHistory` resets state on `taskId` change + aborts in-flight fetch.
8. **Docs:** `.claude/knowledge/execution-ledger.md` — invariant statement + the new guards;
   check `run-history` / tasks knowledge docs for stale claims. README unaffected (verify).

## 4. Changes — WS2 (#467), branch `fix/rig-scopes-agentdir`

1. Widen `OPERATOR_SCOPES` in `scripts/instance/device-approve.ts`.
2. Path-normalization step on `instance up` for stored `agentDir` (and sibling agent paths) in
   rig state.
3. Docs: `.claude/knowledge/dockerized-openclaw-rig.md` hard-won list gains the scope
   requirement, the agentDir translation note, and the `BAKIN_URL`-baked-at-`up`-time gotcha.

## 5. Commands

- Full suite: `bun run test` (must pass before every commit below)
- Single file: `bun test tests/core/completion-gate.test.ts --isolate`
- Rig manual verification (WS2): `bun run instance up` — **isolated mode only** for any test
  flows (`--mode isolated`); native mode touches the real `~/.bakin`.
- Never `git add -A` after a local `bun run build` (generated version stamp trap).

## 6. Testing strategy

TDD prove-it per invariant path — each test written to fail against current code first:

- `tests/core/completion-gate.test.ts` additions:
  - block (service path) on done task → rejected, row survives, task stays done
  - MCP-shape block retry on done → soft response, no error, no state change
  - store `blockTask` done→blocked → throws transition error
  - workflow-style `moveTaskInStore` off done → row deleted, `task.reopened` audited
  - gate-move done→inProgress → row deleted
  - backfill: done task without row → synthetic row inserted, idempotent on second run,
    archived/non-done tasks untouched
- Plugin tests via `tests/plugins/test-helpers.ts` (`callRoute`, `callTool`) for the two entry
  points.
- `useTaskRunHistory`: taskId-change reset test.
- WS2: unit-test the path-normalization function (pure); scopes change verified by inspection +
  rig smoke if a rig session is feasible.
- All tests mock both content-dir resolvers + OpenClaw home per CLAUDE.md testing rules; ledger
  tests call `closeDb()` before temp-dir cleanup.

## 7. Commit strategy (rollback checkpoints)

**WS1, `fix/completion-row-invariant`** — each commit independently green:
1. `refactor(core): extract reopenIfLeavingDone helper` (behavior-identical, covered by existing
   completion-gate tests)
2. `fix(core): enforce VALID_TRANSITIONS in store blockTask` (+ its test)
3. `fix(tasks): reject block-on-done across move/block/MCP entry points` (+ tests; MCP soft
   response)
4. `fix(workflows): delete completion row when workflow moves leave done` (+ tests)
5. `feat(core): backfill pre-ledger completions and retire legacy outcome branch` (+ tests)
6. `fix(tasks): run-history year display + useTaskRunHistory reset/abort` (+ test)
7. `docs(knowledge): execution-ledger invariant + guard updates`

**WS2, `fix/rig-scopes-agentdir`:**
1. `fix(rig): widen pre-approved operator scopes for OpenClaw 2026.5.28 cron CLI`
2. `fix(rig): normalize stored agent paths to container home on instance up` (+ unit test)
3. `docs(knowledge): rig hard-won list — scopes, agentDir translation, BAKIN_URL gotcha`

PRs: `Fixes #482` / `Fixes #467`. WS1 first; WS2 has no dependency on it.

## 8. Boundaries

**Always:** mock content-dir + OpenClaw home in every test; keep the completion gate's
first-write-wins and never-error-on-retry semantics; conventional commits with scope; update
`.claude/knowledge/` alongside behavior changes.
**Ask first:** any change to `VALID_TRANSITIONS` beyond enforcing it; any new audit event kind
beyond `task.completion_backfilled`; anything touching dispatch/watchdog behavior.
**Never:** backwards-compat shims (single-user machine); touch #462/#471 code paths; weaken or
bypass the ledger; write to real `~/.bakin`/`~/.openclaw` from tests; `git add -A` after a build.
