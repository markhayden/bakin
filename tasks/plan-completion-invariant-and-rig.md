# Plan: Completion-row invariant hardening (#482) + rig fixes (#467)

Spec: `.claude/specs/cleanup-completion-invariant-and-rig.md` (approved 2026-06-10).
Two independent branches/PRs. WS1 first. Every commit lands green (`bun run test`), TDD prove-it
per invariant path (test fails against current code first).

## Context

The execution ledger's invariant — *a completions row implies the task is effectively done; every
exit from done except archive deletes the row* — has confirmed violations: block-from-done (3
unguarded entry points) and workflow moves off done keep the row, so Run History shows a green
`done` badge on blocked/re-running tasks and stale rows accumulate in `bakin.db`. Separately, the
dockerized rig has two known defects breaking the cron→dispatch e2e path. Owner approved: fix #482
(+ its three minor follow-ups) and #467; defer #462/#471 untouched.

## Vetting-driven design adjustments (vs. spec §2 — surfaced for approval here)

1. **Workflow done-moves must also RECORD completions (new).** `recordCompletion` has exactly one
   caller (`moveTaskWithEffects`); the workflow engine completes tasks via raw store moves
   (`runtime.ts:134, :933, :1501`) → **every workflow-completed task is done-without-row, ongoing,
   not just pre-ledger**. Without fixing this, removing the legacy fallback in `readTaskOutcome`
   would regress workflow completions to `in_progress`, and the boot backfill would mask a live
   leak. Fix: `moveTaskInStore` becomes ledger-symmetric via one task-service helper —
   `syncLedgerForStoreMove(taskId, to, agent, channel?)` = reopen-delete when leaving done to an
   active column + `recordCompletion` (insert-if-missing, agent `workflow`) after a successful
   move to done.
2. **`blocked→blocked` stays idempotent.** Store `blockTask` skips the transition check when
   already blocked (reason update still applies) — preserves MCP block-retry semantics and the
   parent-reason-overwrite in `blockTaskWithEffects`. Channel arrives as a NEW 4th param (don't
   overload `agent`).
3. **WS2 scopes must reconcile reused state.** `ensureApprovedDevice` early-returns when identity
   exists, so widening `OPERATOR_SCOPES` alone never reaches the exact reused-rig scenario #467
   describes. Add pure `widenDeviceScopes(...)` applied idempotently in the existing-identity
   branch (union into `scopes`, `approvedScopes`, `tokens.operator.scopes`; keypair/token
   preserved).
4. **`archiveOldTasks` orphans completion rows** (`task-store.ts:482` deletes without
   `purgeTaskRows`, unlike `deleteTask`) — fold the one-line purge into WS1 commit 5 (same
   stale-row family). `ctx.tasks.move` (unused, unvalidated) gets documented as an invariant
   escape hatch in the knowledge doc, no code change.

Known fail-soft edge (flag in PR, no code): watchdog step-timeout escalation can attempt
`review→blocked` if a human moved the task during a stuck step; store guard now rejects it into
the existing catch + `log.error`.

---

## WS1 — branch `fix/completion-row-invariant` (PR "Fixes #482")

### Commit 1 — `refactor(core): extract reopenIfLeavingDone + syncLedgerForStoreMove helpers`
- `src/core/task-service.ts`: extract `reopenIfLeavingDone(taskId, to, agent, channel?)` from
  lines 137-140 (delete row + `task.reopened` audit when target ≠ done/archived);
  `moveTaskWithEffects` calls it (behavior-identical). Add `syncLedgerForStoreMove` (reopen on
  leave + record-on-enter-done, agent `workflow`) — exported, unused until commit 4.
- **Accept:** existing `tests/core/completion-gate.test.ts` passes unchanged; new unit tests for
  both helpers against the real temp-dir ledger (reopen deletes + audits; record is
  insert-if-missing; archive leaves row).
- **Verify:** `bun test tests/core/completion-gate.test.ts --isolate` then full suite.

### Commit 2 — `fix(core): enforce transitions in store blockTask (idempotent re-block)`
- `src/core/task-store.ts`: `blockTask(identifier, reason, agent?, channel?)` — when current
  column ≠ `blocked`, call `assertTransitionAllowed(task, 'blocked', isHuman)` (isHuman =
  channel === 'human', matching `moveTask`); `blocked→blocked` = idempotent reason update.
- `src/core/task-service.ts`: `blockTaskWithEffects` threads channel to both `blockStoredTask`
  calls; parent-propagation catch comment names the done-parent skip; log bumped to info.
- **Accept (TDD, in `tests/core/task-store.test.ts` — completion-gate mocks the store so it
  cannot host these):** done→blocked throws for non-human; blocked→blocked succeeds + updates
  reason; human channel bypass preserved (existing todo→blocked cases still green).
- **Verify:** task-store + completion-gate files, then full suite.

### Commit 3 — `fix(tasks): reject block-on-done across move/block/MCP entry points`
- `src/core/task-service.ts`: `blockTaskWithEffects` returns `{ alreadyComplete: boolean }` —
  checks `hasCompletion(taskId)` FIRST (before store call): if set, no side effects, return
  `{ alreadyComplete: true }`.
- `plugins/tasks/index.ts`: move route's blocked branch → 409 `{ error }` when alreadyComplete
  (was 500-on-throw); MCP `bakin_exec_tasks_block` → `{ ok: true, alreadyComplete: true, note:
  'Task is already completed — block ignored. Reopen it (move it out of Done) first if it truly
  needs blocking.' }` (matches `bakin_exec_tasks_complete` contract). `POST /:taskId/block`
  unchanged (taskEditGuard already 409s).
- **Accept (TDD, `tests/plugins/tasks/` via `callRoute`/`callTool` helpers):** move-to-blocked on
  completed task → 409, row survives, column stays done, no parent block fired; MCP block on
  completed task → soft payload, no error; block on inProgress task still works end-to-end.
- **Verify:** plugin tests + full suite.

### Commit 4 — `fix(workflows): keep ledger in sync for workflow store moves`
- `plugins/workflows/lib/runtime.ts`: `moveTaskInStore` calls `syncLedgerForStoreMove` (reopen
  before store move; record after successful done move).
- **Accept (TDD):** real-ledger semantics in `tests/core/completion-gate.test.ts` (workflow-style
  move off done deletes row + audits reopen; move to done inserts row; cancel/child paths
  idempotent). Call-wiring in `tests/plugins/workflows/runtime.test.ts` — add the helper as a spy
  to the existing task-service mock (lines ~90-93); drive `reopenFromStep` on a completed
  instance + a workflow-completion scenario; assert spy ordering around the existing
  `moveTaskHook`.
- **Verify:** both files + full suite.

### Commit 5 — `feat(core): backfill pre-ledger completions, retire legacy outcome branch`
- `src/core/task-service.ts`: `backfillMissingCompletionRows()` — for each done-column task
  (`getTasksByColumn('done')`) without `hasCompletion`, `recordCompletion(taskId, { agent:
  'system', now: task.updatedAt })` + audit `task.completion_backfilled`. Done-column only
  (archived-without-row is ambiguous: humans/createTask can archive directly).
- `server.ts` (~777, after `markPriorBootRunsLost`, before `runRestartRecovery`): call it in its
  own try/catch (idempotent; failure must not block boot).
- `plugins/tasks/lib/runs-reader.ts`: remove the `done → { state: 'done' }` no-row fallback
  (blocked/archived/in_progress fallbacks stay).
- `src/core/task-store.ts`: `archiveOldTasks` calls `purgeTaskRows` per deleted task (same
  advisory try/catch as `deleteTask`).
- **Accept (TDD):** backfill inserts for done-without-row, second run no-ops, archived/non-done
  untouched, completed_at = task updatedAt; runs-reader test pins workflow-completed task (row
  present post-commit-4) reads `done` and a hypothetical done-without-row now reads in_progress;
  archiveOldTasks purges rows.
- **Verify:** completion-gate + runs-reader + task-store files, full suite.

### Commit 6 — `fix(tasks): run-history year display + useTaskRunHistory reset/abort`
- `plugins/tasks/components/task-run-history.tsx`: `relativeTime()` appends year for
  non-current-year dates.
- `src/hooks/use-task-run-history.ts`: reset runs/outcome/loading on `taskId` change;
  AbortController cleanup on unmount/change.
- **Accept:** relativeTime unit cases (today/yesterday/this-year/prior-year); hook test for
  taskId-change reset (pattern-match existing hook tests if present, else minimal).
- **Verify:** targeted tests + full suite.

### Commit 7 — `docs(knowledge): execution-ledger invariant + guard updates`
- `.claude/knowledge/execution-ledger.md`: invariant statement (now biconditional for the
  workflow path), the two-layer guard design (service `hasCompletion` = load-bearing +
  channel-independent; store transition check = non-human defense), block-on-done rejection
  semantics, backfill, exits-from-done inventory incl. `updateTask` column path + `ctx.tasks.move`
  escape hatch. Check `.claude/knowledge/dispatch.md` + tasks-related docs for stale claims;
  README unaffected (verify).
- **Verify:** docs grep for stale invariant wording; full suite (no code).

## WS2 — branch `fix/rig-scopes-agentdir` (PR "Fixes #467")

### Commit 1 — `fix(rig): widen + reconcile pre-approved operator scopes`
- `scripts/instance/device-approve.ts`: `OPERATOR_SCOPES` += `operator.admin`,
  `operator.pairing`; new pure `widenDeviceScopes(paired, deviceAuth, scopes)`; applied
  idempotently in `ensureApprovedDevice`'s existing-identity branch (reused state gets widened
  without `instance reset`).
- **Accept (TDD, `tests/scripts/instance/device-approve.test.ts`):** fresh state carries all 4
  scopes in all 3 encodings; reused narrow-scope state gets unioned, keypair/token untouched;
  second run no-ops.
- **Verify:** that file + full suite.

### Commit 2 — `fix(rig): normalize stored agent paths to container home on up`
- New pure `normalizeAgentPaths(config, hostOpenclawHome)` (rewrites `agents.defaults.workspace`,
  `agents.list[*].{workspace,agentDir}` host-prefix → `/home/node/.openclaw`; prefix-match only
  on `paths.openclawHome`). Wired in `scripts/instance/lifecycle.ts` between the bootstrap-config
  block and gateway start (~:218-220), guarded by `deps.exists(openclaw.json)`, write-only-when-
  changed (don't touch `.bak*` siblings). Host-side rewrite via bind mount = no extra gateway
  restart.
- **Accept (TDD, fakeDeps pattern):** pure-function cases (host paths translated, container paths
  no-op, mixed config, missing fields); lifecycle test asserts rewrite happens before
  `composeUpArgs` and skips on fresh state (no config file).
- **Verify:** instance tests + full suite. Manual rig smoke optional (isolated mode only).

### Commit 3 — `docs(knowledge): rig hard-won list — scopes, agentDir normalization, BAKIN_URL`
- `.claude/knowledge/dockerized-openclaw-rig.md` hard-won section: cron CLI scope requirement
  (2026.5.28: admin+pairing) + reused-state reconcile; agentDir normalization on `up` (mirrors
  shim translation); extend the existing `BAKIN_URL` bullet with the mcporter-baked-at-up-time /
  non-default-port rewiring gotcha from the issue.

## Dependency graph / order

WS1: 1 → {2, 3} → 4 → 5 → 6 (independent) → 7. Commit 5's fallback removal REQUIRES commit 4.
WS2: independent of WS1; commits 1, 2 independent; 3 last. Execute WS1 fully, PR, then WS2, PR.

## Verification (end-to-end)

- Full suite green at every commit: `bun run test`.
- TDD discipline: each new invariant test demonstrably fails against the pre-commit code (run
  before implementing).
- All new tests mock both content-dir resolvers + OpenClaw home; ledger tests `closeDb()` before
  temp-dir cleanup (CLAUDE.md rules).
- Never `git add -A` (build-stamp trap); stage explicit paths.
- PRs: `Fixes #482` / `Fixes #467`, bodies summarize invariant + guards; flag the watchdog
  review→blocked fail-soft edge in WS1's PR body.

## Bookkeeping after approval

- Materialize this plan to `tasks/plan.md` + checklist to `tasks/todo.md` (per planning skill),
  and append the vetting-driven design adjustments to the spec file so spec/plan stay consistent.
