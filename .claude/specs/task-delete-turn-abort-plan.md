# Plan: Task Delete → Abort In-Flight Agent Turn

**Spec:** `.claude/specs/task-delete-turn-abort.md` · **Issue:** #604 · **Date:** 2026-07-05
**Branch:** `feat/task-delete-turn-abort` off `main` · One PR.
**Status:** Draft — pending approval

## Dependency graph

```
T1 core capability (signal + 'aborted' kind)
 └─→ T2 adapter (signal → chat.abort) + mock gateway
      └─→ T3 dispatch registry abort + delete→abort
           ├─→ T4 watchdog orphan sweep
           └─→ T5 delete-path unification
T6 step-tools fail-closed          (independent — can land any time)
T3+T4+T5+T6 ─→ T7 mock e2e ─→ T8 live validation ─→ T9 docs ─→ PR
```

Each task is a vertical slice: code + its tests land together, suite green, one commit. Any commit is independently revertable without leaving a broken intermediate state (earlier commits are strictly additive capabilities).

---

## T1 — Core cancel capability

**Commit:** `feat(core): add AbortSignal to MessageArgs and 'aborted' RuntimeError kind`

1. `packages/core/src/adapters/runtime/concepts.ts` — `MessageArgs` gains `signal?: AbortSignal` (doc comment: best-effort cancel; adapters reject the local awaiter with kind `'aborted'` and, when the provider supports it, cancel server-side).
2. `packages/core/src/adapters/runtime/errors.ts` — add `'aborted'` to `RuntimeErrorKind`: "caller intentionally cancelled the turn — terminal; never retried, never diagnosed, never enters the recovery ladder."
3. `packages/core/src/adapters/runtime/testing.ts` — stub adapter honors `signal`: already-aborted or abort-during-send rejects `RuntimeError(kind:'aborted')`.

**Acceptance:** stub send with pre-aborted signal rejects kind `'aborted'`; abort mid-send rejects promptly; no-signal behavior unchanged.
**Verify:** new unit test file `tests/core/runtime-testing-abort.test.ts` (or extend existing stub tests); `bun run test` green; typecheck green.

## T2 — OpenClaw adapter abort + Imitation Crab support

**Commit:** `feat(adapter-openclaw): map signal abort to gateway chat.abort`

1. Plumb `signal` through `messaging.send` → `chatCompletion` → `runOpenClawAgentGateway` (`packages/adapter-openclaw/src/runtime.ts:454`, `1284`, `1338`; add to `OpenClawAgentTurnOptions`).
2. In `runOpenClawAgentGateway`: register an abort listener on `opts.signal` that (a) fire-and-forget `gateway.request('chat.abort', { sessionKey: <verified key form> })`, (b) `requestAbort.abort()`. Remove the listener when the request settles (no per-turn leak).
3. Disambiguate intentional abort from the internal death-watch abort: in the catch path, `opts.signal?.aborted` → rethrow as `RuntimeError(kind:'aborted')`; death-watch behavior unchanged.
4. **Verify the `chat.abort` param form live** (spec risk #1): probe `openclaw gateway call chat.abort --params '{"sessionKey":"..."}'` against a scratch session on the local gateway; fall back to `sessions.abort` if needed. Record the finding in the commit message.
5. `dev/imitation-crab/gateway.ts` — handle `chat.abort` in `handleGatewayRpcRequest`: return ok, record the call (exported/assertable), and cancel a pending `slow`-mode sleep for that session so aborted mock turns settle immediately.

**Acceptance:** adapter unit test — abort mid-flight emits one `chat.abort` frame with the session key and rejects kind `'aborted'`; natural settle removes the listener; unthreaded (no sessionKey) abort skips the gateway frame and still rejects `'aborted'`.
**Verify:** adapter tests + mock tests; `bun run test` green; live probe result noted.

## T3 — Registry abort handles + delete→abort

**Commit:** `feat(dispatch): abort in-flight turns when their task is deleted`

1. `src/core/dispatch-types.ts` — `InFlightTurn` gains `abort: AbortController`, `abortedAt?: number`.
2. `src/core/dispatch-turns.ts`:
   - `fireDispatchTurn` creates the controller, stores it in the entry (line 381), threads `signal` into `sendDispatchMessage` (line 43) → `runtime.messaging.send`.
   - Catch handler (line 344): new first branch — `RuntimeError` kind `'aborted'` → best-effort `settleRun` (no-op after purge, by design), `appendAudit(contentDir, 'task.turn_aborted', targetAgent, { id, runId: threadId, reason })`, log at info (not error), **skip** `reconcileRejectedDispatch` entirely, `opts.onSettled?.('error', err)`. Reason travels via `signal.reason`.
   - New exports (re-export via `src/core/dispatch.ts`): `abortTurnsForTask(taskId, reason): number` (fires + stamps `abortedAt`, idempotent), `getInFlightTurnsSnapshot()`, `forceReleaseTurn(marker): boolean`, and constant `ORPHAN_TURN_FORCE_RELEASE_GRACE_MS = 60_000`.
3. `src/core/task-store.ts` `deleteTask` — first effect: `abortTurnsForTask(task.id, 'task-deleted')` (lazy import mirror of the hook pattern if needed to avoid an import cycle — dispatch already imports task-store, so **verify direction**; if cyclic, extract the registry into its own module or use dynamic import like `cancelWorkflowInstance` does).

**Acceptance:** delete during an in-flight (mock-slow) turn → send rejects `'aborted'`, slot freed (`getInFlightTurnCount` drops), `task.turn_aborted` audited once, no recovery-ladder re-dispatch scheduled, no reconcile fail-noise; workflow-step marker (`taskId:stepId`) also aborted by taskId; abort-after-natural-settle is a benign no-op (race pinned).
**Verify:** new `tests/core/dispatch-abort.test.ts` + extend `tests/core/task-store.test.ts` deleteTask block; full suite green.

## T4 — Watchdog orphan-turn sweep

**Commit:** `feat(watchdog): sweep in-flight turns whose task no longer exists`

1. `src/core/watchdog.ts` — after the board scan in the interval body (line ~140): iterate `getInFlightTurnsSnapshot()`; task existence via `getTask(turn.taskId)` **store lookup** (done-column tasks exist off-board — must NOT be treated as orphans):
   - orphan + not yet aborted → `abortTurnsForTask(taskId, 'orphan-sweep')`,
   - orphan + `abortedAt` older than `ORPHAN_TURN_FORCE_RELEASE_GRACE_MS` and still registered → `forceReleaseTurn(marker)` + `appendAudit(contentDir, 'task.turn_force_released', 'watchdog', {...})`.
2. Sweep wrapped in its own try/catch — a sweep error never breaks the board scan.

**Acceptance:** orphan turn aborted on first cycle; force-released + audited only after grace on a later cycle; done-column and live tasks untouched; sweep exception doesn't kill the watchdog tick.
**Verify:** extend `tests/core/watchdog.test.ts` (fake timers or injected `now`, stub registry snapshot); suite green.

## T5 — Delete-path unification

**Commit:** `refactor(tasks): unify all delete side effects in deleteTask`

1. `src/core/task-store.ts` `deleteTask` becomes the canonical order: `abortTurnsForTask` → `cancelWorkflowInstance` (await, keep best-effort catch) → **new** `deleteWorkflowInstance` via `workflows.deleteInstance` hook (await, best-effort) → `purgeTaskRows` → `removeSync(task.id)` last (note: today removeSync runs first — flipping order means a mid-delete crash leaves the task visible rather than half-cleaned; that's the correct failure bias).
2. `plugins/tasks/lib/routes.ts:194-224` — drop the route's now-redundant `workflows.deleteInstance` invocation. MCP (`exec-tools.ts:355`) and SDK (`plugin-context-services.ts:103`) paths inherit full cleanup with zero changes.

**Acceptance:** all three entry points produce identical disk state (no task file, no instance file, no ledger rows); REST behavior byte-identical to before; `tests/plugins/tasks/routes-rest.test.ts:533-566` updated (hook now invoked by core, not the route).
**Verify:** task-store + routes-rest + a new MCP-delete instance-file assertion; suite green.

## T6 — Step tools fail closed for cancelled instances

**Commit:** `fix(workflows): get_step/submit_step fail closed once the instance is cancelled`

1. `plugins/workflows/lib/step-context.ts:89-91` — split the conflation: `complete` keeps `{status:'complete'}`; `cancelled` returns `null`.
2. Confirm `bakin_exec_get_step` / `bakin_exec_submit_step` (`plugins/workflows/lib/exec-tools.ts:172,192`) surface the null as the same "Task not found"-shaped error as `bakin_exec_tasks_get`; align the message if it isn't.
3. Audit other `getCurrentStep` callers for reliance on cancelled→complete (grep; engine/UI paths) — fix or note each.

**Acceptance:** cancelled instance → both tools return the fail-closed error; genuine complete unchanged; no other caller regresses.
**Verify:** plugin tests via `tests/plugins/test-helpers.ts` (`activatePlugin`/`callTool`); suite green.

## T7 — Mock end-to-end (checkpoint gate)

**Commit:** `test(dispatch): end-to-end delete-mid-turn abort against the mock gateway`

Integration test: Imitation Crab `slow` mode → create + dispatch task → delete mid-turn → assert: `chat.abort` received by mock, turn settles `'aborted'`, slot freed, `task.turn_aborted` audited, no instance file, `get_step` fails closed, next dispatch for the same agent proceeds (slot actually free).

**Verify:** `bun run test` (full, `--isolate` semantics respected); typecheck; `bun run build` sanity.

## T8 — Live validation (against real OpenClaw 2026.6.11)

**No code commit; report:** `docs(validation): task-delete abort live validation report`

1. `brew upgrade --cask openclaw` → 2026.6.11 (spec: abort-reliability fix openclaw#96201). Verify gateway healthy.
2. Scripted pass (throwaway BAKIN_HOME per the memory gotcha — do **not** set OPENCLAW_HOME): create task with a deliberately slow prompt → dispatch → delete mid-turn → evidence: OpenClaw session/trajectory shows the run stopped (not run-to-completion), slot freed promptly, `task.turn_aborted` in audit.jsonl, `get_step` fails closed, no tool fail-noise after delete.
3. Also probe the spec's risk #2 (backend-mode `deliver:false` abort) — this run IS backend-mode, so the pass itself answers it.
4. Report to `.claude/specs/` (US3-report pattern, f417fde7).

## T9 — Docs sweep

**Commit:** `docs(knowledge): delete→abort turn semantics across dispatch/watchdog/adapter docs`

- `.claude/knowledge/dispatch.md` — registry entry shape, delete→abort flow, `'aborted'` kind, sweep + force-release.
- `.claude/knowledge/execution-ledger.md` — purge-before-settle is by design; audit is the abort trace.
- `.claude/knowledge/session-forensics.md` — aborted turns exempt from the ladder.
- `.claude/knowledge/adapter-architecture.md` — `MessageArgs.signal` contract (fail-open).
- `CLAUDE.md` — Dispatch key-pattern bullet one-liner.
- `README.md` — re-check; expected no change (internal fix).
- Close-out comment on #604 linking PR + validation report.

---

## Checkpoints (stop, verify, then continue)

| After | Gate |
|-------|------|
| T2 | Adapter capability proven in isolation + live `chat.abort` param form confirmed. **If the live probe fails on both `chat.abort` and `sessions.abort`, STOP — re-scope WS1 to local-reject-only (fail-open) and note it.** |
| T4 | Deadlock class eliminated: delete→abort AND sweep both green in unit tests |
| T7 | Full mock e2e green + build green — code-complete gate before touching the live box |
| T8 | Live evidence collected; any surprise → fix commits before docs |
| T9 | PR: `bun run test`, `bun run build`, review pass (`/code-review`), then merge |

## Rollback strategy

Commits are ordered so reverting from the tip inward never strands a caller: T6/T5/T4 revert independently; T3 revert removes all abort call sites along with the exports; T2/T1 are pure additive capability (unused if T3 reverted). Never commit `generated-version.ts` (build mutates it — memory).

## Explicitly out of scope

- Ledger schema changes / new run states (decision #3: audit-only).
- New settings surface (decision #7: hardcoded grace).
- Aborting turns for tasks that still exist (e.g. a user "stop" button) — the machinery enables it later, not built now.
- The gateway idempotency-key scheme.
