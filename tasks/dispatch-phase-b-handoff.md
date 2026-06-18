# Handoff: dispatch.ts Phase B — split the dangerous fire-path core

**For:** Claude on the test machine (live OpenClaw available).
**Author:** prior session (Phase A author).
**Spec:** `.claude/specs/audit-2026-06/APPENDIX-cohesion.md` § `src/core/dispatch.ts` (the canonical seam map + risk notes).

This is the **most dangerous refactor in the audit** — `dispatch.ts` is the live, exactly-once
task-dispatch loop. A subtle mistake here causes **duplicate task fires** or **stuck dispatch** in a
running system. Treat the verification protocol (§5) as the actual deliverable; the code move is the
easy part.

---

## 0. Starting state (verify before you begin)

- **PR #513 (Phase A) must be merged.** Confirm `src/core/dispatch.ts` is ~1,652 lines and these
  siblings already exist: `dispatch-types.ts`, `dispatch-prompts.ts`, `dispatch-board.ts`,
  `dispatch-context-blocks.ts`, `dispatch-failures.ts`. If not, stop — Phase B builds on them.
- `git checkout main && git pull` (with #513 merged), then `git checkout -b refactor/dispatch-fire-path`.
- **Capture a behavioral baseline first** (§5.0) on the UNMODIFIED code, so you can diff Phase B against it.
- Read the APPENDIX risk notes in full before touching anything.

## 1. What Phase B is

Relocate the remaining fire-path code out of `dispatch.ts` into sibling modules (same pattern Phase A
used: `dispatch-*.ts` files; `dispatch.ts` imports back + re-exports so `@/core/dispatch` and the
3 mock-the-path test files are unchanged), preserving behavior **exactly**. Then, as a **separate
commit after the split verifies**, the `prepareAndFireRegularDispatch` dedup (§6, behavior-touching).

Do NOT do the dedup and the relocation together. Relocation must be a provable no-op.

## 2. Target modules (sibling files; line refs are pre-Phase-A and approximate — find by symbol)

- **`dispatch-state.ts`** — the `.dispatch-state.json` layer. `stateQueue` + `withStateLock`,
  `getStateFile`/`loadDispatchState`/`saveDispatchState`, `trimDispatched`, dispatch-marker helpers
  (`getDispatchMarkerTaskId`/`removeDispatchMarkersForTask`), `getFailureRecord`/`cooldownForFailure`,
  `clearDispatchMarker`. **SOLE owner of the `stateQueue` mutex.** While here, make `saveDispatchState`
  atomic (temp-then-rename) per the APPENDIX — but do that as its own labeled change, not silently.
- **`dispatch-turns.ts`** — the concurrent-dispatch engine. `sendDispatchMessage`, `claimDispatchRun`,
  `auditDispatchSuppressed`, the `InFlightTurn` registry + `getInFlightTurnCount` + `concurrencyGate`,
  `pendingLadderRedispatches` + `awaitDispatchIdle` + a **new `scheduleLadderRedispatch()` helper**
  (so the counter is mutated only inside this module), `fireDispatchTurn`, plus the per-turn helpers
  `resolveDispatchRouting`/`recordTurnCost`/`budgetGate`/`deferForBudget`/`auditBudgetOnce`.
- **`dispatch-session-death.ts`** — the recovery ladder. `stripSalvage`, `salvageSessionDeathOutput`,
  `handleSessionDeath`, `reconcileRejectedDispatch`, `shouldBlockAfterDispatchFailure`. **The
  `dispatchSingleTask` re-dispatch (the setTimeout in `handleSessionDeath`) MUST be injected** (see §3.2).
- **`dispatch-workflow.ts`** — `dispatchWorkflowTask` + `buildWorkflowDispatchMessage` (each other's
  only real coupling; keep together).
- **`dispatch-cycle.ts`** — the periodic cycle. `dispatching`/`dispatchStartedAt`/`dispatchTimer` +
  `DISPATCH_TIMEOUT_MS`, `dispatchTasks` (the collect-then-fire loop), `start`/`stop`, `getDispatchInfo`.
- **`dispatch-single.ts`** — `dispatchSingleTask` (kick/subtask/continuation/recovery sources).
- **`dispatch.ts`** — becomes the thin **barrel**: re-export the full public surface (see §4) from the
  sibling modules. Keep the existing `export { classifyDispatchError, ... }` and the Phase-A re-exports.

## 3. The hazards (this is where it breaks)

**3.1 The mutex must be a single instance.** Only `dispatch-state.ts` declares `stateQueue` /
`withStateLock`. EVERY caller (`fireDispatchTurn`'s settle handlers, `dispatchTasks`,
`dispatchSingleTask`) imports `withStateLock` from `dispatch-state.ts`. If two modules each declare a
`stateQueue`, the `.dispatch-state.json` lock silently splits and concurrent dispatch double-writes →
duplicate fires. The settle handlers reload state under `withStateLock` and must share the one lock.

**3.2 The import cycle (session-death ⇄ single).** `handleSessionDeath` schedules `dispatchSingleTask`
via `setTimeout`; `dispatchSingleTask` → `fireDispatchTurn` → `reconcileRejectedDispatch` →
`handleSessionDeath`. Break it with a late-bound setter: `dispatch-session-death.ts` exports
`setRedispatch(fn)` and a module-local `redispatch` var it calls instead of importing
`dispatchSingleTask` directly. The barrel (`dispatch.ts`) wires it once after all modules load:
`setRedispatch(dispatchSingleTask)`. (Alternative: pass `dispatchSingleTask` as a param down the call
chain — messier. The setter is cleaner.) Add a guard so calling `redispatch` before it's wired throws
a clear error rather than silently no-op'ing.

**3.3 `pendingLadderRedispatches` lives in `dispatch-turns.ts` only.** It's incremented by the ladder
re-dispatch (today in `handleSessionDeath`) and read by `awaitDispatchIdle`. Move the increment behind
`scheduleLadderRedispatch()` in `dispatch-turns.ts`; `handleSessionDeath` calls that helper instead of
touching the counter. If the counter ends up duplicated across modules, `awaitDispatchIdle` drains the
wrong one and tests/recovery hang or race.

**3.4 Other singletons each in exactly one module:** `dispatching`/`dispatchStartedAt`/`dispatchTimer`
→ `dispatch-cycle.ts`; `inFlightTurns` → `dispatch-turns.ts`; `lessonBlockCache` already sole-owned by
`dispatch-context-blocks.ts` (Phase A).

**3.5 Cross-package ledger contract (DO NOT TOUCH).** `packages/core/src/execution/ledger.ts` reads
`.dispatch-state.json` directly for its seq-watermark migration. The file path and the `dispatchSeq`
field are a contract — do not rename the file or change its JSON shape.

**3.6 Barrel + mocks.** 3 test files mock the module path (`tests/core/continuation.test.ts` mocks
BOTH `../../src/core/dispatch` and `@/core/dispatch`; `doctor-delegate.test.ts` and `lifecycle.test.ts`
mock the relative path). The barrel must stay at `src/core/dispatch.ts`. Internal modules import each
other **directly** (e.g. `./dispatch-state`), NEVER via the barrel, or you get self-cycles.

**3.7 Consumers that must keep working via the barrel:** `server.ts` namespace-imports the module and
uses `dispatchTasks`, `getDispatchInfo`, `start`, `loadDispatchState`; watchdog/task-service/etc. import
named symbols. Grep `from '@/core/dispatch'` and `from '.../dispatch'` and confirm every imported name
is re-exported.

## 4. Public surface the barrel MUST re-export (grep to confirm none missing)

`start`, `stop`, `dispatchTasks`, `dispatchSingleTask`, `clearDispatchMarker`, `getDispatchInfo`,
`loadDispatchState`, `isTaskDispatchEligible`, `classifyDispatchError`, `classifyDispatchFailureDetail`,
`formatSanitizedRuntimeFailure`, `buildDispatchMessage`, `buildDispatchAssetBlock`,
`buildDispatchLessonBlock`, `__resetLessonBlockCache`, `awaitDispatchIdle`, `getInFlightTurnCount`,
`budgetGate`, and the types `DispatchEligibility`, `DispatchIneligibleReason`,
`DispatchContinuationContext`, `DispatchRosterAgent`, `ConcurrencyGate`. (Most types already live in
`dispatch-types.ts` from Phase A — re-export from there.)

## 5. Verification protocol (the real deliverable)

### 5.0 Baseline (BEFORE any change, on merged-#513 main)
Run §5.1–5.4 once on the unmodified code and **save the outputs** (ledger row counts, audit event
sequence, log). Phase B must reproduce these exactly.

### 5.1 Static + suite (after EACH module extraction, not just at the end)
- `bun run typecheck` clean.
- `bunx eslint` the touched files clean (trim import-backs that go unused in the barrel).
- `bun test tests/core/dispatch.test.ts dispatch-error-classification continuation budget task-service
  restart-recovery watchdog --isolate` green.
- At the end: full `bun run test` (baseline 5106/0) + `bun run build` (3 binaries; revert the
  build-stamp files `packages/core/src/generated-version.ts` + `_embedded-assets-static.ts` after).

### 5.2 Live dispatch E2E (the point of this machine — real OpenClaw)
Use a **throwaway `BAKIN_HOME`** (don't risk the live board) but the **real OpenClaw**:
```
BAKIN_HOME=/tmp/phaseb OPENCLAW_HOME=<your live openclaw home> bakin start    # or the built binary
```
Then, in another shell (point the CLI at it):
1. **Single fire, exactly once.** Create a task assigned to a real agent (`bakin tasks create "phase-b smoke" <agent>`). Watch it dispatch and the agent run a turn to completion/settle.
   - **Ledger check:** open `$BAKIN_HOME/bakin.db` and confirm: exactly ONE run claim for the dispatch attempt (`threadId` = `task:<id>:d<seq>`), exactly ONE completion row, no duplicate-claim rows.
   - **Audit check:** `$BAKIN_HOME/audit.jsonl` — exactly one `task.dispatched` per attempt; any
     `*_suppressed` events are legit (a real duplicate would be a bug). The doctor `execution-safety`
     check (`bakin check execution-safety` if available, or the health page) must be clean.
2. **Concurrency.** Create several tasks at once across agents. Confirm `settings.dispatch.maxConcurrentTurns` / `maxTurnsPerAgent` are respected and EACH task gets exactly one claim/fire — no double-dispatch under the mutex.
3. **Session-death → recovery ladder.** Trigger a session death (a task that emits oversized chat output is the natural repro; or kill the agent's turn mid-flight). Confirm the ladder advances **corrective → decomposition → block**, with EXACTLY ONE re-dispatch per rung, `awaitDispatchIdle` drains, and no duplicate fires. This is the cycle/`pendingLadderRedispatches` path — the riskiest part of the split.
4. **Watchdog supersede.** Let a turn time out; confirm it's superseded (not double-fired).
5. **Restart recovery.** Stop the server mid-dispatch, restart; confirm the startup sweep marks prior runs lost and re-dispatches each task exactly once (no duplicate from a stale claim).

### 5.3 Diff against baseline
Every ledger/audit count + the recovery sequence must match the §5.0 baseline. ANY extra fire, missed
dispatch, or hung `awaitDispatchIdle` = STOP and revert.

## 6. The dedup (separate commit, only after §5 passes clean)

`prepareAndFireRegularDispatch`: extract the ~120 lines copy-pasted between `dispatchTasks` and
`dispatchSingleTask` — runtime roster + main-agent resolution, `completedTaskIds`/`knownTaskIds` set
building, eligibility + dangling-dependency logging, failure cooldown/max-retry checks, and the
claim→lesson→assets→message→move→audit→fire sequence. **This is behavior-touching** — re-run the FULL
§5.2 live E2E afterward. Note the pre-existing drift the APPENDIX flags: the single path records usage
via `onSettled`, the workflow-single path records it inline, and the cycle path records none — decide
to unify or preserve **deliberately** and document the choice. Also fold `buildDecompositionMessage`'s
local `mc` helper onto `mcporterHelpers` (it re-implements it).

## 7. Rollback / safety

- One commit per module; one commit for the dedup. Revert any single one cleanly.
- If the live E2E shows a duplicate fire, a missed dispatch, or a recovery hang: **revert and do not
  ship.** A passing unit suite is necessary but NOT sufficient for this file — the live exactly-once
  behavior is the gate.
- PR it as `refactor(dispatch): split fire-path core (Phase B)`; in the body, paste the §5.2 ledger/
  audit results so the reviewer sees the exactly-once evidence, not just "tests pass".

## 8. Why this is split from Phase A

Phase A (merged, #513) moved only the pure/no-fire-path modules — verifiable by tests + a boot smoke.
Phase B moves the mutex, the fire loop, the recovery cycle, and the concurrency counters: code where a
relocation bug doesn't fail a unit test but DOES double-fire a real task. That's why it gets the live
OpenClaw E2E on real hardware, not just the docker happy-path.
