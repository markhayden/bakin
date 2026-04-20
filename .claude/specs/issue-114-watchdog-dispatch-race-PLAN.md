# Issue #114 — Build Plan (commit-by-commit)

_Created: 2026-04-20 | Status: DRAFT (awaiting build-phase kickoff)_
_Spec: `.claude/specs/issue-114-watchdog-dispatch-race.md`_

Targeted bug fix. Scope: one constant + one guard clause in `src/core/watchdog.ts`, one new test in `tests/core/watchdog.test.ts`, optionally one line of knowledge-doc copy. Approach is already decided in the spec — this plan is execution only.

---

## Branch

**Name:** `fix/issue-114-watchdog-dispatch-race`
**Parent:** `main` — branch **off main**, land via PR, no rebase-to-master chains.

Create it in Task 1 before any other work. All subsequent commits land on this branch.

---

## Commit Summary

| # | Commit message | Files touched | Rollback role |
|---|---|---|---|
| C1 | `test(watchdog): failing test for dispatch-race auto-recovery (#114)` | `tests/core/watchdog.test.ts` | Reverting reverts only the test — no behavior change. |
| C2 | `fix(watchdog): skip auto-recovery when task updatedAt is within guard window (#114)` | `src/core/watchdog.ts` | Reverting re-exposes the race; C1 test goes red again. Clean bisect target. |
| C3 (optional) | `docs(watchdog): note auto-recovery guard window` | `.claude/knowledge/agent-system.md` | Pure doc — trivially revertible. |

Three commits max. If C3 adds nothing beyond what the code comment already says, skip it.

### Conventional commit scope

Project uses `<type>(<scope>): <summary>` per CLAUDE.md and recent git log. Scope for all three is `watchdog` (the subsystem), matching existing commits like `fix(workflows): …` and `test(workflows): …`.

---

## Tasks

### Task 1 — Branch + baseline
**Goal.** Cut a clean branch off `main` and confirm the existing test suite is green before any edits.
**Files touched.** None (git only).
**Steps.**
1. `git fetch origin && git switch main && git pull --ff-only` — ensure local main matches remote.
2. `git switch -c fix/issue-114-watchdog-dispatch-race` — branch off main.
3. Pre-flight smoke: `pnpm exec vitest run tests/core/watchdog.test.ts` — should pass on clean main.
**Verification.**
- `git branch --show-current` prints `fix/issue-114-watchdog-dispatch-race`.
- `git log --oneline -1` matches the tip of `origin/main` (no stray commits).
- Watchdog test file passes green.
**Expected outcome.** Fresh branch, baseline green. Any failure here means the environment — not our change — is the problem; stop and fix before proceeding.

### Task 2 — Verify the fix's load-bearing assumption
**Goal.** Confirm `task.updatedAt` is bumped by the write paths that race with the watchdog, so the guard has a real signal to key off. Flagged as risk (b) in the kickoff brief.
**Files touched.** None — read-only inspection.
**Steps.**
1. Confirm `plugins/tasks/lib/flow-store.ts` writes `updated_at = ?` on `moveTask`, `moveTaskToInProgress`, and the other mutation paths (already grep-verified during planning — re-confirm before edit).
2. Confirm `flowToTask` surfaces `flow.updated_at` as `task.updatedAt` on reads (plugins/tasks/lib/flow-store.ts:173).
**Verification.**
- Both writes + read path confirmed in code.
**Expected outcome.** Assumption holds; fix is not a no-op. If it turns out a mutation path does NOT bump `updated_at`, STOP and revisit the spec — don't ship a silent no-op.

### Task 3 — Write the failing test (C1)
**Goal.** Lock the invariant in the test harness before touching behavior.
**Files touched.** `tests/core/watchdog.test.ts`.
**Steps.**
1. Add a new `it(...)` case modeled on the existing tests in the file. Fixture:
   - Settings: `stuckThresholdMs = 30 * 60 * 1000`, `autoRecover: true`.
   - One in-progress task: `id: 'race-task'`, `updatedAt = Date.now() - 1000` (1 s), `log: [{ timestamp: <now - 35 min>, message: '...' }]`, `agent: 'someone'`.
   - `tasks.readTaskboard` hook returns `{ columns: { inProgress: [raceTask], todo: [], … } }`.
   - `isAgentHeartbeatStale` returns true for the agent (legacy path or leave `getAgentLastReply` at null + no heartbeat file).
2. Start the watchdog, advance fake timers by one interval, flush microtasks.
3. Assert:
   - `hookRegistry.invoke` was NOT called with `'tasks.moveTask'` and `{ identifier: 'race-task', to: 'todo' }`.
   - `hookRegistry.invoke` was NOT called with `'tasks.blockTask'` for this task.
   - `appendAudit` was NOT called with event name `'task.auto_recovered'` or `'task.auto_recovery_exhausted'` for this task.
   - `hookRegistry.invoke` was NOT called with `'tasks.addTaskLog'` carrying a message starting with `'Auto-recovered:'`.
**Verification.**
- `pnpm exec vitest run tests/core/watchdog.test.ts -t '<new test name>'` — the new case **fails** against current code (it asserts absence of a call that the current code makes). Failing here is the whole point; do not proceed to Task 4 until this test exists and fails for the right reason (auto-recovery fires).
**Expected outcome.** New red test. **Commit C1** on the branch.

### Task 4 — Implement the guard (C2)
**Goal.** Add the constant and the guard clause so the C1 test goes green.
**Files touched.** `src/core/watchdog.ts`.
**Steps.**
1. Add module constant near `BYPASS_PATTERNS` (top of file):
   ```ts
   const AUTO_RECOVERY_GUARD_MS = 60 * 1000
   ```
2. In the `inProgress` loop, insert the guard **after** the `stuckMs <= settings.watchdog.stuckThresholdMs` early-continue (which runs `checkBypassPatterns` then `continue`) and **before** the `minutesStuck` / `effectiveAgent` / `isAgentHeartbeatStale` block:
   ```ts
   if (task.updatedAt && now - task.updatedAt < AUTO_RECOVERY_GUARD_MS) {
     log.debug('Skipping auto-recovery: updatedAt within guard window', {
       id: task.id, updatedAtAgeMs: now - task.updatedAt,
     })
     continue
   }
   ```
3. Placement check: guard must skip BOTH the move-to-`todo` branch AND the escalate-to-`blocked` branch — a `continue` at this point does that, because both branches live below it inside the same `for` iteration. Confirm by re-reading the block around watchdog.ts:140-164.
4. Do not touch bypass-pattern handling — it already runs in the non-stuck branch above.
**Verification.**
- `pnpm exec vitest run tests/core/watchdog.test.ts` — all watchdog tests pass (new case goes green, existing cases unchanged).
- `pnpm run typecheck` — clean.
- `pnpm run lint -- src/core/watchdog.ts tests/core/watchdog.test.ts` — clean.
**Expected outcome.** Green. **Commit C2** on the branch.

### Task 5 — Full suite verification
**Goal.** Confirm nothing else depended on the old behavior.
**Files touched.** None (CI-equivalent check).
**Steps.**
1. `pnpm run test` (= `vitest run`) — full suite.
2. If any existing test fails: DO NOT adjust it to "make green" without understanding. Risk (a) from the kickoff brief: a test may have inadvertently simulated the race by bumping `updatedAt` and expecting auto-recovery. Diagnose — if the test was genuinely wrong, fix it in C2 with a clear commit note; if it was asserting legitimate recovery behavior, the guard window needs to be tightened or the test's fixture needs a timestamp that's genuinely old.
**Verification.**
- Full suite green on the branch.
**Expected outcome.** No regressions detected. If a regression appears, stop and triage against the spec before shipping.

### Task 6 — Docs sweep (optional C3)
**Goal.** Make sure knowledge docs stay accurate.
**Files touched.** Potentially `.claude/knowledge/agent-system.md`; no other docs.
**Steps.**
1. `agent-system.md:202` reads "Auto-recovery: restart agent or move task back to todo". Append a single line such as:
   > Auto-recovery is suppressed when the task's `updatedAt` is within a 60 s guard window to prevent a race with dispatch-move (issue #114).
2. Grep the rest of `.claude/knowledge/` and `README.md` for `watchdog|auto.?recover`. Nothing else documents the auto-recovery behavior at that level of detail — skip.
3. `README.md` references `watchdog.stuckThresholdMs` and "Detects stuck tasks, alerts via Discord" only; no update needed — the guard is an internal detail, not a user-facing setting.
**Verification.**
- `rg 'watchdog|auto.?recover' README.md .claude/knowledge/` — reviewed; only `agent-system.md` merits a line.
**Expected outcome.** Either C3 commit lands or the task is explicitly declined ("no doc update needed — code comment is sufficient"). Either outcome is acceptable.

### Task 7 — Push branch + open PR
**Goal.** Land the fix via PR against `main`.
**Files touched.** None (git/GitHub surface).
**Steps.**
1. `git push -u origin fix/issue-114-watchdog-dispatch-race`.
2. Open PR with:
   - **Title:** `fix(watchdog): prevent race with dispatch from auto-recovering fresh tasks (#114)`
   - **Base:** `main`
   - **Body:**
     - One-paragraph race summary with the 7 ms audit-trail excerpt from the issue.
     - Link: `Closes #114`.
     - The acceptance checklist from the spec, ticked:
       - [x] New test in `tests/core/watchdog.test.ts` simulates the race and asserts no auto-recovery.
       - [x] Full watchdog test file still passes.
       - [x] Full project test suite still passes.
       - [ ] Manual audit-log check after deploy (captured as a post-merge follow-up).
**Verification.**
- `gh pr view --web` opens; CI kicks off.
**Expected outcome.** PR green, ready for merge. Do not auto-merge — hand off to user.

---

## Test Runner Reference

Project uses **vitest** via pnpm (`package.json` scripts). Canonical commands:

| Intent | Command |
|---|---|
| Full suite | `pnpm run test` (= `vitest run`) |
| Single file | `pnpm exec vitest run tests/core/watchdog.test.ts` |
| Single case | `pnpm exec vitest run tests/core/watchdog.test.ts -t '<name>'` |
| Typecheck | `pnpm run typecheck` |
| Lint (scoped) | `pnpm run lint -- <paths>` |

No `npm test` in this repo; it's pnpm. Sticking to pnpm-scripted commands keeps the build skill aligned with the rest of the monorepo.

---

## Risks & Mitigations (carried from the kickoff brief)

- **(a) Hidden dependency on current auto-recovery behavior in an existing test.** Full-suite run in Task 5 is the detector. Mitigation: diagnose, don't paper over. If a test was implicitly simulating the race, its fixture — not the guard — is wrong.
- **(b) `task.updatedAt` not bumped by `tasks.moveTask`.** Would make the fix a silent no-op. Mitigated by Task 2's pre-flight; already grep-verified during planning (write paths hit `updated_at = ?` in `plugins/tasks/lib/flow-store.ts`).
- **(c) Guard value drift.** 60 s is baked as a module constant. Re-evaluate only if watchdog/dispatch intervals drop below ~10× the guard. Out of scope today.

---

## Checkpoints & Rollback Points

| After | Checkpoint | If red, roll back with |
|---|---|---|
| Task 1 | Clean branch, green baseline | `git switch main && git branch -D fix/issue-114-watchdog-dispatch-race` |
| C1 (Task 3) | Failing test committed | `git reset --hard HEAD~1` — unpublished, safe |
| C2 (Task 4) | Guard implemented, new test green, all watchdog tests green | `git reset --hard HEAD~1` — leaves C1 intact for re-try |
| Task 5 | Full suite green | If a single test broke, revert just that test fix; keep C2 |
| C3 (Task 6) | Docs line added | `git reset --hard HEAD~1` — trivial |
| Task 7 | PR open, CI passing | Close PR; branch survives for iteration |

Each commit is a discrete rollback point; no squashing before merge. Merge strategy is the repo default (see recent `Merge pull request #117 from …` — merge commits, not squash).

---

## Done When

- Branch pushed, PR open against `main`, CI green.
- Acceptance checklist in the spec fully ticked except the post-deploy audit-log check (tracked as a PR-body follow-up).
- User has a clear rollback: revert the merge commit on `main`.
