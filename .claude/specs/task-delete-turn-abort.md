# Spec: Task Delete → Abort In-Flight Agent Turn

**Status:** Draft — pending approval
**Date:** 2026-07-05
**Issue:** #604 (all three parts: delete→abort, orphan-turn sweep, step-tool fail-closed papercut)
**Origin:** Observed live 2026-07-04 during gate/Discord validation — task `df6cba8d` deleted mid-dispatch; ghost turn ran ~10 min of fail-closed tool calls, held the agent's dispatch slot, and was invisible to the watchdog.

## Objective

Deleting a task cleanly tears down everything attached to it — including the in-flight agent turn. Success looks like:

- Deleting a dispatched task fires a real server-side abort (OpenClaw gateway `chat.abort`) and releases the agent's dispatch slot promptly.
- A ghost turn that survives abort (hung gateway, lost frame) is swept by the watchdog and force-released after a grace period — an agent can never deadlock until restart.
- `bakin_exec_get_step` / `bakin_exec_submit_step` fail closed for a deleted task, matching `bakin_exec_tasks_get`.
- All three delete entry points (REST, MCP, plugin SDK) converge on ONE canonical cleanup path in `deleteTask`.
- Every abort leaves a structured audit trail; no ledger schema changes.

This machine is the only user. **No backwards compatibility, no shims** — divergent delete behavior is unified outright, not bridged.

## Context (verified against code + live OpenClaw docs, 2026-07-05)

- **In-flight turn registry:** `src/core/dispatch-turns.ts:211` — module-private `Map<marker, InFlightTurn>`. Marker = `task.id` (regular) or `` `${task.id}:${stepId}` `` (workflow step). Entry (`src/core/dispatch-types.ts:114-121`) holds `{agentId, taskId, threadId, startedAt, settled}` — **no abort handle exists**. Only `getInFlightTurnCount` / `awaitDispatchIdle` are exported. Registry is documented advisory, process-memory only; restart orphans are handled by the ledger boot sweep (`markPriorBootRunsLost`).
- **deleteTask** (`src/core/task-store.ts:332-349`): removes the task file, invokes the `workflows.cancelInstance` hook (sets instance `status='cancelled'`, keeps the file), and `purgeTaskRows(task.id)` (hard-deletes runs/completions/costs — including the live `running` row). It never touches the in-flight registry.
- **Delete entry points diverge:** REST `DELETE /:taskId` (`plugins/tasks/lib/routes.ts:194-224`) additionally invokes `workflows.deleteInstance` (removes the instance file). MCP `bakin_exec_tasks_delete` (`plugins/tasks/lib/exec-tools.ts:355-374`) and SDK `ctx.tasks.remove` (`src/lib/plugin-context-services.ts:103-106`) do not — they leave a lingering `cancelled` instance file. This lingering file is the root of the get_step papercut.
- **get_step papercut root cause:** `getCurrentStep` (`plugins/workflows/lib/step-context.ts:89-91`) returns a truthy `{status:'complete'}` for BOTH `complete` and `cancelled` instances, so `bakin_exec_get_step` (`plugins/workflows/lib/exec-tools.ts:172-190`) reports ok for a deleted task.
- **No adapter cancel surface:** `AgentRuntimeAdapter.messaging.send` (`packages/core/src/adapters/runtime/concepts.ts:604-607`) takes no AbortSignal; `MessageArgs` has none. The OpenClaw adapter's internal `requestAbort` (`packages/adapter-openclaw/src/runtime.ts:1382-1401`) is caller-side only — `gateway-rpc.ts` abort rejects locally without sending any cancel frame; the server-side run keeps executing.
- **OpenClaw gateway HAS a real abort:** protocol docs list `chat.abort` (params `sessionKey`, optional `runId`) and `sessions.abort` — the machinery behind the `/stop` command ("abort the current run"). The adapter already computes a per-thread session id: `openClawCliSessionId(agentId, threadId)` (`runtime.ts:1339`), sent as `params.sessionId` on the `agent` RPC.
- **Watchdog is board-scoped:** `src/core/watchdog.ts:142-147` scans `columns.inProgress` only; `watchdog.ts:375` explicitly skips instances whose task is off the board. A deleted task's turn is invisible to it. Confirmed by the issue's live observation.
- **RuntimeError kinds** (`packages/core/src/adapters/runtime/errors.ts:11-21`): `transport | timeout | session_death | provider_cooldown | runtime_failed`. An aborted request today surfaces as `transport` (transient → retry territory). Dispatch classifies on `kind` exclusively — architecture-test enforced.
- **Gateway idempotency caveat:** the `agent` RPC carries an idempotencyKey the gateway dedupes for ~5 min (`runtime.ts:1345-1356`). Not a blocker here (deleted tasks are never re-dispatched), but noted for the abort path.

## Decisions (interview, 2026-07-05)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Scope | All three parts of #604 in one effort |
| 2 | Adapter cancel API | `signal?: AbortSignal` on `MessageArgs` (no new interface method); adapter maps signal-abort → gateway `chat.abort` + local reject |
| 3 | Abort trace | Audit event only (`task.turn_aborted`); `purgeTaskRows` semantics unchanged |
| 4 | Orphan sweep | Watchdog cycle sweeps the registry; abort once, then **force-release after grace** (one cycle, hardcoded constant) if the entry survives |
| 5 | Delete paths | Full unification into `deleteTask` (abort → cancel instance → delete instance file → purge → remove task file); `getCurrentStep` returns `null` for `cancelled` so step tools fail closed |
| 6 | Validation | Mock tests (Imitation Crab learns `chat.abort`) **plus** a live validation phase against real OpenClaw |
| 7 | Config | No new settings; hardcoded grace constant, sweep rides the existing watchdog cadence |

Spec-level decision (not interviewed, structural): add a new `RuntimeErrorKind` **`'aborted'`** so dispatch recognizes intentional cancellation structurally — an aborted turn must exit the settle chain cleanly: no recovery ladder (salvage/re-dispatch would resurrect work for a deleted task), no session-death forensics, no fail-noise.

## Scope — four workstreams

### WS1 — Adapter cancel capability (`packages/core`, `packages/adapter-openclaw`, mock)

1. `MessageArgs` gains `signal?: AbortSignal` (`packages/core/src/adapters/runtime/concepts.ts`).
2. New `RuntimeErrorKind` `'aborted'` with doc comment ("caller intentionally cancelled the turn — terminal, never retried, never diagnosed").
3. OpenClaw adapter plumbs `signal` through `messaging.send` → `chatCompletion` → `runOpenClawAgentGateway`. On signal abort:
   - fire-and-forget gateway `chat.abort` with the session key (verify exact key form against the live gateway during build — `cliSessionId` vs raw `sessionKey`; the protocol doc says `sessionKey` required, `runId` optional),
   - abort the existing internal `requestAbort` so the local awaiter rejects immediately,
   - map the rejection to `RuntimeError` kind `'aborted'` (not `transport`).
   - Listener cleanup: remove the abort listener when the request settles normally (no leak per turn).
4. Imitation Crab mock: handle a `chat.abort` RPC (settle any pending `agent` request for that session with an aborted outcome) and make `slow` mode abort-responsive — this is the test hook for WS2/WS3 tests.
5. Testing stub adapter (`packages/core/src/adapters/runtime/testing.ts`): honor `signal` (reject with kind `'aborted'`).

### WS2 — Registry abort handles + delete→abort (`src/core`)

1. `InFlightTurn` gains `abort: AbortController` and `abortedAt?: number` (`src/core/dispatch-types.ts`).
2. `fireDispatchTurn` creates the controller, passes `signal` to `messaging.send`, stores it in the registry entry.
3. New exports from `dispatch-turns.ts` (re-exported via `dispatch.ts`):
   - `abortTurnsForTask(taskId: string, reason: 'task-deleted' | 'orphan-sweep'): number` — fires `abort.abort(reason)` on every entry whose `taskId` matches (covers regular AND workflow-step markers), stamps `abortedAt`, idempotent. Returns count aborted.
   - `getInFlightTurnsSnapshot(): ReadonlyArray<...>` — for the watchdog sweep (and tests).
   - `forceReleaseTurn(marker: string): boolean` — removes the entry outright (registry is advisory); used only by the sweep after grace.
4. Settle chain in `fireDispatchTurn`: on `RuntimeError` kind `'aborted'` → audit `task.turn_aborted` `{taskId, agentId, runId: threadId, reason}` + log, then clean exit — skip failure classification, recovery ladder, and reconcile (the task is gone).
5. `deleteTask` (`src/core/task-store.ts`) calls `abortTurnsForTask(task.id, 'task-deleted')` as its FIRST effect (before purge, so ledger state is still coherent while the turn unwinds).

### WS3 — Watchdog orphan-turn sweep (`src/core/watchdog.ts`)

1. Each cycle, after the board scan: `getInFlightTurnsSnapshot()`; for each turn whose task no longer exists **in the task store** (store lookup, NOT board presence — done-column tasks exist off-board):
   - not yet aborted → `abortTurnsForTask(taskId, 'orphan-sweep')`,
   - aborted longer than `ORPHAN_TURN_FORCE_RELEASE_GRACE_MS` (hardcoded, 60s) ago and still registered → `forceReleaseTurn(marker)` + audit `task.turn_force_released`.
2. Worst case after force-release: OpenClaw still burns a turn server-side while Bakin dispatches the next one — accepted trade-off vs. agent deadlock until restart.
3. Catches the delete-vs-register race too: a turn registered after its task's delete is swept next cycle.

### WS4 — Delete-path unification + step-tool fail-closed (`src/core`, `plugins/tasks`, `plugins/workflows`)

1. `deleteTask` becomes the ONE canonical cleanup path: abort turns → `workflows.cancelInstance` hook → `workflows.deleteInstance` hook (instance file removed) → `purgeTaskRows` → task file removal.
2. REST route drops its now-redundant separate `deleteInstance` hook call; MCP and SDK paths inherit full cleanup for free. Caller-level effects (audit `deleted`, search remove, SSE) stay at callers.
3. `getCurrentStep` (`plugins/workflows/lib/step-context.ts`): `cancelled` returns `null` (only genuine `complete` keeps the `{status:'complete'}` shape) → `bakin_exec_get_step` and `bakin_exec_submit_step` fail closed with the same "Task not found" error shape as `bakin_exec_tasks_get`. Two independent guards: even a lingering cancelled file (pre-existing debris) now fails closed.

## Testing strategy

All tests follow the CLAUDE.md testing rules (mock both content-dir resolvers + OpenClaw home; temp dirs; cleanup; `--isolate`).

- **Unit — dispatch:** `tests/core/dispatch-concurrency.test.ts` + new `tests/core/dispatch-abort.test.ts`: abort mid-flight frees the slot; `task.turn_aborted` audited; kind `'aborted'` skips the recovery ladder; workflow-step markers (`taskId:stepId`) abort by taskId; `settleRun` no-op after purge stays silent.
- **Unit — task-store:** extend `tests/core/task-store.test.ts` `describe('deleteTask')`: abort invoked, instance file deleted (all entry points), purge ordering.
- **Unit — watchdog:** extend `tests/core/watchdog.test.ts`: orphan detected via store lookup (done-column task NOT treated as orphan), abort-once semantics, force-release only after grace, audit events.
- **Unit — step tools:** `plugins/workflows` tests: `get_step`/`submit_step` fail closed on cancelled instance; genuine `complete` unchanged.
- **Unit — adapter:** signal plumbing → `chat.abort` frame emitted with correct session key, local reject maps to kind `'aborted'`, listener cleanup on natural settle.
- **Integration — mock:** Imitation Crab `slow` mode + `chat.abort`: end-to-end create→dispatch→delete→assert abort, slot free, no fail-noise, audit trail.
- **Live validation (post-merge to branch, pre-PR-merge):** scripted pass against real OpenClaw — dispatch a deliberately slow task, delete mid-turn, verify: gateway run actually stops (trajectory/`openclaw` session evidence), slot freed, `task.turn_aborted` audited, `get_step` fails closed. Written up as a validation report like the US3 reject-cycle report (f417fde7).

## Documentation coverage

- `.claude/knowledge/dispatch.md` — registry entry shape (abort handle), delete→abort flow, `'aborted'` kind semantics, force-release.
- `.claude/knowledge/execution-ledger.md` — note: delete purges rows BEFORE the turn settles; aborted settle is a silent no-op by design; audit is the trace.
- `.claude/knowledge/session-forensics.md` — aborted turns are exempt from the recovery ladder.
- `.claude/knowledge/adapter-architecture.md` — `MessageArgs.signal` capability + fail-open contract (adapter without server-side cancel still rejects locally).
- `CLAUDE.md` — one-line updates to the Dispatch key-pattern bullet (delete→abort + orphan sweep) and RuntimeError kinds if enumerated.
- `README.md` — checked; no user-facing surface changes expected (internal behavior fix). Re-verify at build time.
- Issue #604 — close with a summary comment linking the PR + validation report.

## Boundaries

- **Always:** classify failures by `RuntimeError.kind`, never message text (architecture-test enforced). Keep provider details behind the adapter (`chat.abort` is OpenClaw-private; core only sees AbortSignal). Mock content dirs in every test.
- **Ask first:** any ledger schema change (none planned); any new settings surface (none planned); touching the gateway idempotency-key scheme.
- **Never:** retry or recovery-ladder an `'aborted'` turn; let the sweep touch turns whose task still exists; delete workflow-instance files for tasks that still exist.

## OpenClaw release check (2026-07-05)

Installed: **2026.6.9**; latest stable: **2026.6.11**; 2026.7.1 in beta.

- **`chat.abort` / `sessions.abort` surface is stable.** The 2026.7.1-beta abort work (openclaw#99753 "consolidate abort primitives") is an internal refactor with explicitly no intended behavior change; no gateway protocol changes to the abort RPCs in 2026.6.10/6.11 release notes.
- **2026.6.11 ships an abort-reliability fix** (openclaw#96201, related #88838): "/stop and abort commands now keep stopping active runs, clearing queued followups, and ending related subagents promptly even when session keys need canonicalizing or abort metadata cannot be saved." On 2026.6.9 an abort can partially fail on session-key canonicalization edge cases. **Action: upgrade OpenClaw to 2026.6.11 (`brew upgrade --cask openclaw`) before the live validation phase**, and run live validation against 2026.6.11. Bakin's session keys (`task:<id>:d<seq>`-derived, lowercase) likely avoid the canonicalization path, but validating on the fixed release removes the variable.

## T2 gate outcome (live probes, 2026-07-05, OpenClaw 2026.6.11)

**Backend `agent` RPC runs are NOT server-side abortable on current OpenClaw.** Probed against a live run (real turn on a scratch `explicit:` session):
- `chat.abort` / `sessions.abort` returned `aborted:false` / `no-active-run` for every key form (raw session UUID, canonical `agent:<id>:explicit:<uuid>`, runId=idempotencyKey) while the run was verifiably in flight — the abort registry only tracks channel auto-reply runs.
- `/stop` sent via the `agent` RPC is serialized *behind* the active run by the command queue (probe essay completed in full, 12k chars).
- `tasks.cancel` is documented registry-intent-only for CLI-tracked runs ("the running agent operation continues independently").

**Re-scope per the plan's T2 checkpoint:** WS1 = local-reject (the deadlock/slot fix, fully effective) + a best-effort `chat.abort` frame with the canonical explicit session key (no-op today, auto-heals if upstream starts tracking embedded runs; consider filing an OpenClaw issue). Residual ghost spend is bounded by OpenClaw's own turn timeout with every Bakin tool failing closed — exactly the issue's stated fallback.

## Risks / open verification items

1. **`chat.abort` session-key form** — protocol doc says `sessionKey`; the adapter sends `sessionId` (= `openClawCliSessionId(...)`) on the `agent` RPC. Verify the exact param the gateway resolves during WS1 against the live gateway (`openclaw gateway call chat.abort --params ...`). If mismatch, `sessions.abort` (`key` or `runId`) is the fallback.
2. **Backend-mode sessions** — confirm `chat.abort` works for `deliver:false` backend-mode agent runs, not just chat-channel sessions. Live validation covers this.
3. **Abort-vs-settle race** — turn settles naturally between delete and abort fire: `abort()` on a settled controller is a no-op; `.finally()` unregister already ran. Benign; tests pin it.
4. **Delete-vs-register race** — turn fired but not yet registered when delete runs: WS3 sweep catches it next cycle. Accepted (window is milliseconds; sweep is the designed net).

## Commit strategy (detailed sequencing in the plan doc)

One PR off `main`, branch `feat/task-delete-turn-abort`, conventional commits, one commit per landable checkpoint — each workstream lands green (build + suite) and is independently revertable: WS1 adapter capability → WS2 delete→abort → WS3 sweep → WS4 unification/papercut → tests already inside each WS commit → docs commit last.
