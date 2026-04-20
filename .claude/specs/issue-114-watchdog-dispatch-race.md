# Spec — issue #114: Watchdog/dispatch race auto-recovers a task that was just dispatched

_Created: 2026-04-20 | Issue: https://github.com/madeinwyo/bakin/issues/114_

## Objective

Stop the watchdog from auto-recovering a task that dispatch has just moved to `inProgress`. The race causes the card to flip back to `todo` within milliseconds of dispatch, the next dispatch tick re-sends to an agent already processing the first message, the gateway rejects the concurrent send with `fetch failed`, and dispatch lands in the 30-minute structural cooldown (false positive). The task then sits un-dispatchable while the agent silently finishes or aborts.

Single-user, Mac-mini-hosted install. No backwards-compat burden; tech-debt-reducing fix preferred.

## Bug Summary

`src/core/watchdog.ts` takes a taskboard snapshot once per tick and then loops the `inProgress` column, computing `lastActivity = lastLogTs ?? task.updatedAt ?? now`. If dispatch moves a task `todo → inProgress` mid-tick, the watchdog reads a pre-move snapshot (log still old, `updatedAt` possibly old) and auto-recovers it 7 ms later. Dispatch has already sent the agent message, so the agent processes it, but the UI column is wrong and the next dispatch cycle re-sends.

Audit trail from live reproduction on 2026-04-20 (task `8ba3a224`, agent `jessica-fetcher`):

```
06:21:00.361Z  task.moved          agent=dispatch    from:todo to:inProgress
06:21:00.368Z  task.auto_recovered agent=watchdog    minutesStuck=31
06:21:11.712Z  exec.bakin_exec_tasks_log_progress.ok agent=jessica-fetcher
06:26:01.879Z  task.dispatch_failed error="fetch failed"
```

Root-cause lines: `src/core/watchdog.ts:117-120`.

## Chosen Fix

**Option 2 — time-window guard on `task.updatedAt`.**

Before the watchdog auto-recovers a task, require `now - task.updatedAt >= AUTO_RECOVERY_GUARD_MS`. If `updatedAt` is inside the window, skip auto-recovery for this tick; the next tick (5 min later, by default) re-evaluates against fresh state.

**Guard window:** `60 * 1000` ms (60 s), as a module-level constant in `watchdog.ts`.

Why 60 s:
- Watchdog and dispatch both default to a 5-minute interval. 60 s is ≤ 1% of either loop, so at most one extra tick of delay for a genuinely stuck task.
- Absorbs clock drift, fs write latency, and hook invocation delay well beyond the observed 7 ms race.
- Auto-recovery only fires when `stuckMs > stuckThresholdMs` (30 min default). The only way `stuckMs > 30 min` AND `updatedAt` within 60 s can both be true is that something just mutated the task — exactly the race we want to catch. So the guard is strictly orthogonal to the stuck check and cannot mask a real stall.

Hardcoded as a constant rather than a new setting — no operator tuning need has been identified, and an extra knob is tech debt. We promote it later only if needed.

### Why not option 1 or 3

- **Option 1 (re-read the task from the board before `moveTask`)**: costs an extra hook round-trip for every candidate recovery and still has a TOCTOU window. Strict subset of what the `updatedAt` guard catches for this race.
- **Option 3 (share `withStateLock` between dispatch and watchdog)**: real architectural change — new coupling between two independent loops, new failure modes if the lock is forgotten. Overkill for a race the guard window closes.

We pick **option 2 alone**; options 1 and 3 remain as future hardening if a new race shape surfaces.

## Invariant

> The watchdog never auto-recovers a task whose `updatedAt` is within `AUTO_RECOVERY_GUARD_MS` of the current tick's `now`.

Applies to both the move-back-to-`todo` path and the escalate-to-`blocked` path.

## Scope of Change

### `src/core/watchdog.ts`

- Add `const AUTO_RECOVERY_GUARD_MS = 60 * 1000` near the other module constants (top of file, next to `BYPASS_PATTERNS`).
- In the `inProgress` loop, after the `stuckMs <= settings.watchdog.stuckThresholdMs` early-continue and before the `isAgentHeartbeatStale` call, add:
  ```ts
  if (task.updatedAt && now - task.updatedAt < AUTO_RECOVERY_GUARD_MS) {
    log.debug('Skipping auto-recovery: updatedAt within guard window', {
      id: task.id, updatedAtAgeMs: now - task.updatedAt,
    })
    continue
  }
  ```
- Guard must apply before the `settings.watchdog.autoRecover && agentStale` branch — the whole recovery decision is deferred, not just the move.
- Do NOT run bypass-pattern checks in the guard-skip path — those already run in the fresh-activity branch above; the guard covers the "task moved recently by dispatch" case.

### `tests/core/watchdog.test.ts`

- New test `does not auto-recover a task whose updatedAt is within the guard window` (or similar).
- Fixture: task in `inProgress`, a log entry timestamped 35 min in the past, `updatedAt = Date.now() - 1000` (1 s), agent heartbeat stale. Run one watchdog tick.
- Assert: `tasks.moveTask` hook NOT invoked for this task; `appendAudit` NOT called with `task.auto_recovered`; `tasks.addTaskLog` NOT called with the "Auto-recovered:" message.
- Existing tests continue to pass unchanged. Expected: no existing test both sets `updatedAt` within 60 s AND requires auto-recovery to fire, so behavior is preserved. Verified by running the full watchdog test file plus the full project test suite.

## Acceptance Criteria

1. New test in `tests/core/watchdog.test.ts` simulates the race and asserts no auto-recovery fires.
2. Full watchdog test file still passes (no regressions to existing cases).
3. Full project test suite (`npm test` / `vitest run`) still passes.
4. Manual verification in `~/.bakin/audit.jsonl` after deploy: no `task.auto_recovered` within 60 s of a preceding `task.moved` on the same task id. Proof can wait for the first naturally occurring dispatch; no synthetic run required.

## Out of Scope

- The 30-minute structural cooldown behavior in `src/core/dispatch.ts` (`classifyDispatchError`). Separate concern; fixing the race removes the false-positive trigger that currently exercises it.
- Changes to `dispatch`'s `withStateLock` or any locking refactor.
- Broader watchdog cleanup, renaming, or behavioral changes.
- New plugin settings, UI, or CLI surface.
- Changes to `tests/plugins/test-helpers.ts` or the mocking harness beyond the new test case.

## Risks & Mitigations

- **Delayed legitimate recovery.** If something repeatedly bumps `updatedAt` without writing a log entry, the guard could keep rebasing. Mitigation: every normal task mutation path also adds a log entry (feeds `lastLogTs`, fallback #1), so this scenario isn't realistic in the current codebase. If it ever happens, the non-recovery branch's `ALERT:` path still fires.
- **Missed race if `updatedAt` is not bumped on move.** Mitigation: `tasks.moveTask` currently bumps `updatedAt` (verified by the existing `task.moved` audit behavior). If a future mutation path forgets to, the race symptom reappears in audit and routes us back here.
- **Constant drift.** If watchdog/dispatch intervals drop far below 60 s, the guard becomes proportionally larger. Not a current concern — both default to 5 min. Revisit if defaults change.

## Commit Strategy (preview — finalized in the plan skill)

Two commits for natural rollback points:

1. `test(watchdog): failing test for dispatch-race auto-recovery (#114)` — adds the new test; it fails against current code.
2. `fix(watchdog): skip auto-recovery when task updatedAt is within guard window (#114)` — adds the constant and the guard; test passes.

A tiny optional third commit if any knowledge doc needs the new invariant recorded: `docs(watchdog): note auto-recovery guard window`.

## References

- Issue: https://github.com/madeinwyo/bakin/issues/114
- File under change: `src/core/watchdog.ts:117-164`
- Existing watchdog tests: `tests/core/watchdog.test.ts`
- Related context (not blockers): #112, #113, #115
