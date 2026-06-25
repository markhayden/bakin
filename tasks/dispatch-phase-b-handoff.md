# dispatch.ts fire-path split — LIVE-MACHINE stress & verification plan

**Status:** the split is **implemented + merged-pending** (built, full-suite green, docker boot/
create-task smoke clean). This doc is no longer implementation instructions — it's the protocol for
the machine with a **bare-metal live OpenClaw** to *beat the shit out of* the merged code and confirm
exactly-once dispatch behavior under real conditions. That live run is the authoritative gate; the
relocation passes unit tests but a split-mutex / cross-module-singleton bug only manifests under real
concurrency + session death, which is exactly what this plan exercises.

## What was split (so you know the seams under test)

`src/core/dispatch.ts` (2,095 lines) → a 29-line public barrel + 11 modules:
`dispatch-types`, `dispatch-failures`, `dispatch-state` (**sole owner of the `stateQueue` mutex**),
`dispatch-board`, `dispatch-context-blocks` (owns `lessonBlockCache`), `dispatch-prompts`,
`dispatch-turns` (owns `inFlightTurns` + `pendingLadderRedispatches`, `fireDispatchTurn`,
`scheduleLadderRedispatch`), `dispatch-session-death` (the recovery ladder; re-dispatches via a **lazy
`import('./dispatch-single')`** to break the cycle), `dispatch-cycle` (owns `dispatching`/`dispatchTimer`,
`dispatchTasks`), `dispatch-single` (`dispatchSingleTask`), `dispatch-workflow`.

The risk the live run is hunting for: **duplicate fires** (split mutex / leaked claim), **missed
dispatch** (broken wiring), or a **hung recovery ladder** (`pendingLadderRedispatches` / dynamic-import
re-dispatch wired wrong).

## Setup

- Pull the merged branch. `bun run build` (or run from source). Use a **throwaway `BAKIN_HOME`** so you
  don't churn the real board, but the **real `~/.openclaw`** so agents actually run turns.
- Capture a **pre-merge baseline** for the same scenarios if you can (run them on the commit before
  the split), so you diff behavior, not just eyeball it.

## The hammer (run all; each must show EXACTLY-ONCE)

For every scenario, the evidence is in two places — confirm both:
- **Ledger** `$BAKIN_HOME/bakin.db`: one run-claim per dispatch attempt (`threadId` = `task:<id>:d<seq>`),
  one completion row per completed task, NO duplicate claims for the same `(task, seq)`.
- **Audit** `$BAKIN_HOME/audit.jsonl`: one `task.dispatched` per attempt; any `*_suppressed` event is a
  real duplicate that was caught — investigate it. `bakin check execution-safety` (or the health page's
  execution-safety check) must be clean.

1. **Single fire.** Create one task for a real agent; watch it dispatch, run, and complete. Exactly one
   claim, one completion, zero suppressions.
2. **Burst concurrency.** Create ~10 tasks across several agents simultaneously. Confirm
   `settings.dispatch.maxConcurrentTurns` / `maxTurnsPerAgent` are respected and **each task gets exactly
   one claim/fire** — this is the mutex-under-contention test (the split's #1 risk).
3. **Session-death recovery ladder.** Force a session death (a task whose prompt makes the agent emit
   oversized chat output is the natural repro; or kill the agent's turn mid-flight). Confirm the ladder
   advances **corrective → decomposition → block**, with **exactly one re-dispatch per rung**, and that
   `awaitDispatchIdle` actually drains (no hang). This exercises the lazy-dynamic-import re-dispatch +
   the `pendingLadderRedispatches` counter living solely in `dispatch-turns`.
4. **Watchdog supersede.** Let a turn exceed the watchdog timeout; confirm it's superseded, not
   double-fired.
5. **Restart recovery.** Kill the server mid-dispatch (with in-flight turns), restart. Confirm the
   startup sweep marks prior-boot runs lost and each affected task re-dispatches **exactly once** — a
   stale claim must not suppress the legitimate re-dispatch, and a lost sweep must not double-fire.
6. **Workflow steps.** Run a multi-step workflow (incl. a nested workflow) end-to-end; confirm each step
   dispatches once and gates/continuations behave as before (`dispatch-workflow` path).
7. **Soak.** Leave it running with periodic task creation for a while; watch for any drift in
   `getInFlightTurnCount` / the dispatch-info nextRun, leaked timers, or growing suppression counts.

## Pass criteria

Every scenario shows exactly-once in both the ledger and audit, the recovery ladder drains, restart
re-dispatches once, and `execution-safety` stays clean — matching the pre-split baseline. **Any**
duplicate fire, missed dispatch, or hung ladder = a relocation bug; revert the split commit and report
which scenario + the ledger/audit evidence.

## Follow-up (separate, after this passes): the dedup

`prepareAndFireRegularDispatch` — the ~120 lines copy-pasted between `dispatchTasks` (dispatch-cycle)
and `dispatchSingleTask` (dispatch-single): roster + main-agent resolution, completedTaskIds/knownTaskIds
sets, eligibility + dangling-dep logging, failure cooldown/max-retry, and the
claim→lesson→assets→message→move→audit→fire sequence. This is **behavior-touching**, so it gets its own
commit and a full re-run of the hammer above. Note the pre-existing usage-recording drift (single path
via `onSettled`, workflow-single inline, cycle path none) — unify or preserve **deliberately**. Also the
deferred `saveDispatchState` atomic temp-then-rename (in `dispatch-state.ts`) belongs in this pass.
