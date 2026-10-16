# Implementation Plan: Task Dependency Liveness

Spec: `task-dependency-liveness.md` (rev 2). Branch: `fix/task-dependency-liveness` in the MAIN checkout (3737 serves it for Mark's live test). One PR, merge only — no release in this work (spec D8).

Build status (2026-10-16): all ten slices committed on `fix/task-dependency-liveness` in plan order (C1 7e2e0d6b9 → C10 78d92511a, plus `test(tasks): health-checks mock carries DependencyRejectedError` c78ccf89d folded in after C9). Deviations from the plan as written: the CLI resolver lives in its own module `src/cli/actor.ts` (not `http.ts`) so tests can mock the HTTP client and run the real resolver; the usage token is `[--as=<actor>]` because the CLI reference renderer split `<agent|human>` into a bogus choice row; the tasks/workflows manifests' `contributes.cliCommands` usage strings also carry the flag (the docs validator renders the CLI tables from the manifests, not the registry); the internal `Task` view's `recoveries` is optional (hand-built UI fixtures) while the store record's is required; the roster lookup is not memoized (one CLI invocation = one command). Checkpoint D: typecheck, lint, check:cycles, docs:check green; full suite result recorded in the PR.

Code review round (Codex, PR #975, 2026-10-16): six findings, all verified and fixed in one commit — (1) restart recovery re-reads the row AFTER its awaited re-assessment and skips a candidate whose `version` changed; (2) the watchdog validates the fresh row (exists, `inProgress`, same `version` as the snapshot) BEFORE superseding or aborting a stale live run, and everything from that read to the store write is synchronous; (3) the same version rule covers a workflow whose topology hooks were in flight; (4) a malformed `--as` (no value, empty, option-shaped) is a usage error that posts nothing; (5) the e2e fixture returns a schema-valid empty budget policy; (6) stale `countRecoveries` sentence removed from dispatch.md, user docs exclude blocking from the reset promise, spec D11 scoped to the stuck-task scan.

Plan rev 2 (2026-10-16): Codex reviewed rev 1 (`codex exec --sandbox read-only`); its eleven findings were verified against the code and folded in, marked **(P#)**. The biggest changes: the author-based heuristics land BEFORE the operator log line (P4), continuation reconciles under the state lock (P3), the recovery mutation is one synchronous write after fresh validation (P2), CLI identity reaches the server contracts (P1), and generated docs ride the slice that changes their source (P10).

## Overview
Ten commits, each a vertical slice that leaves the tree green with every later commit reverted. Order: validator → settle park + locked continuation → author-based heuristics → counter storage (additive) → counter switch + clock + fresh re-read → operator reset/log → CLI actor (client + server contracts) → agent wording → end-to-end reproduction → knowledge docs. Checkpoints after commits 3, 6, 7 and 10.

## Architecture Decisions (spec, restated for the implementer)
- One completion predicate `isCompleteColumn(column)` in `dispatch-board.ts`; dispatch and the dependency validator call it (D1).
- Settle park: ONE action (`moveStoredTask` to todo + one log line), THREE triggers/lines — open `dependsOn` ("Waiting on …"), complete/missing `dependsOn` (clear + "already complete — re-queued"), decomposition record with no `dependsOn` (existing "Decomposition complete — parked in Todo …" line, kept verbatim for its pinned test) (D2, P7).
- Continuation's read-decide-mutate runs under `withStateLock`, releases, THEN calls `dispatchSingleTask` (which takes the same non-reentrant lock) (P3).
- `recoveries` lives on the store record (`packages/core`) and the internal view; `recoverTask()` lives in `src/core/task-store.ts` (facade — `columnPatch`/`assertTransitionAllowed` are private there) and writes `{ ...columnPatch('todo'), recoveries: (task.recoveries ?? 0) + 1 }` in one synchronous `updateSync` (D3, P11 legacy JSON, Codex Q2).
- Recovery boundary: async assessment first (workflow hooks, supersede), THEN fresh re-read + predicates + synchronous `recoverTask`/block, THEN the log line (D9, P2). Applies to watchdog recover, watchdog escalate, restart-recovery recover/block/manual-hold.
- Operator predicate at the service boundary is the conjunction `channel === 'human' && agent === 'human'`; `operatorMove.from` comes from the service's own `before.column` snapshot, never from the client (D4, P5).
- `updatedAt` is the only staleness clock (D5).
- No message-prefix reads survive (D3, D10, D11). `shouldBlockAfterDispatchFailure` inspects `log.slice(initialLogCount)` for entries authored by the target agent (P6).
- CLI actor resolver order: `--as` → `.bakin-run.json` via `readRunSidecar()` walking up from cwd → roster main. Identity reaches the server: `tasks create` sends `createdBy`, `tasks depend` sends `agent` (new optional field on `dependencyBody`; route logs that author, service audits it instead of the fixed `'api'`), move/log/block/complete send `agent`/`author` + `channel` (D12, P1, Codex Q1).
- Two existing readers count ANY log entry — the store's "no log entries ⇒ cannot move to done" guard and the tasks health check's `progress-missing` warning. An operator line satisfying them is accepted and documented (an operator who moved the card has looked at it); no change (Codex Q3).

## Dependency Graph
```
C1 validator ──► C2 settle park + locked continuation ──► C3 author-based heuristics
                                                            │
C4 recoveries storage (additive) ──► C5 counter switch + clock + fresh re-read ──► C6 operator reset + log line
                                                                                     │
C7 CLI actor (client + server contracts)   ── independent of C1–C6
C8 agent wording                            ── independent
C9 end-to-end reproduction                  ── needs C1–C6
C10 knowledge docs                          ── last
```
C6 depends on C3 (the operator line must never count as agent progress before it exists). C7 and C8 can run at any point after C1.

## Commit Strategy
One conventional commit per slice, all on the branch. Each commit message ends with the attribution line in effect. Gate before EVERY commit: `bun run typecheck && bun run lint` + the slice's test files with `--isolate`; slices that change exec-tool descriptions or CLI registry text also run `bun run docs:generate` and commit the generated output in the same commit (P10 — CI's gate is `docs:check`, which regenerates and diffs). Never commit `generated-version.ts`. Mark decides at merge whether to keep the ten commits as rollback points or squash.

| # | Commit | Reverting it alone leaves |
|---|--------|---------------------------|
| C1 | `fix(tasks): refuse dependencies on complete, missing or self targets` | tool/REST accept anything; nothing else moves |
| C2 | `fix(dispatch): park at settle on a registered dependency; continuation reconciles under the state lock` | #937 settle behavior; C1 still refuses |
| C3 | `refactor(dispatch): classify watchdog skip and progress heuristics by log author` | prefix skip + log-growth heuristic return; nothing depends on it yet |
| C4 | `feat(tasks): persist a recoveries counter on the task record and view` | field unused; pure additive |
| C5 | `fix(watchdog): count recoveries from the task record, clock on updatedAt, validate fresh before mutating` | log-prefix counting returns; C4 field stays |
| C6 | `fix(tasks): operator moves reset recoveries and log the move` | counter never resets; C3 heuristic still author-based |
| C7 | `feat(cli): resolve the acting agent from --as, the run sidecar, or the roster` | CLI attributes to main again; server accepts the new fields harmlessly |
| C8 | `docs(agents): dependency pattern tells agents not to wait on finished tasks` | wording only |
| C9 | `test(dispatch): reproduce the margo dependency loop end to end` | test only |
| C10 | `docs(dispatch): registered-dependency hand-off, recovery counter, operator moves, CLI --as` | knowledge/docs prose only — generated contract docs already landed with C1/C7 |

## Task List

### Phase 1 — The loop

#### Task 1 (C1): One completion predicate + dependency validator
**Description:** Add `isCompleteColumn(column: string): boolean` (done | archived) to `src/core/dispatch-board.ts`; build `completedTaskIds` in `dispatch-cycle.ts` and `dispatch-single.ts` through it. In `task-service.ts` add `DependencyRejectedError { reason: 'missing' | 'self' | 'complete'; dependsOn }`; `setDependencyWithEffects` validates (self → `getTaskWithColumn(dependsOn)` → `isCompleteColumn`) before `setStoredDependency`. Exec tool: `instanceof DependencyRejectedError` → `ok:false` with the per-reason agent message; rewrite the tool `description` + success message. REST route → `409`. Add the class to the task-service mocks in `tests/plugins/tasks/helpers/tasks-routes-harness.ts` and `tests/plugins/tasks/task-edit-safety.test.ts` (P6). Run `bun run docs:generate` — the tool description is embedded in `reference/generated/exec-tools.mdx` and the `docs:exec-tools` blocks (P10) — and commit the diff.
**Acceptance:**
- [ ] Refusals write no `dependsOn`/`blockedBy`, emit no `task.dependency_set` audit; `complete` message tells the agent to continue now and not wait.
- [ ] Open targets (todo/inProgress/blocked/review) accepted as before; archived targets refused like done.
- [ ] `bun run docs:validate` green with the regenerated blocks.
**Verify:** `bun test tests/core/task-service.test.ts tests/plugins/tasks/exec-tools.test.ts tests/plugins/tasks/routes-rest.test.ts tests/plugins/tasks/task-edit-safety.test.ts tests/core/dispatch.test.ts --isolate && bun run docs:generate && bun run docs:validate`
**Files:** `src/core/dispatch-board.ts`, `dispatch-cycle.ts`, `dispatch-single.ts`, `src/core/task-service.ts`, `plugins/tasks/lib/exec-tools.ts`, `plugins/tasks/lib/routes.ts`, two mock files, generated docs. **Size:** M. **Dependencies:** none.

#### Task 2 (C2): Settle park on a registered dependency; continuation under the lock
**Description:** `dispatch-turns.ts` settle block (~L885–935): keep the owned-run / fresh-snapshot-inProgress / no-live-replacement guards and the reassignment branch; replace the decomposition-only gate with: `fresh.task.dependsOn` set OR `completedDecomposition`. One `moveStoredTask(id, 'todo', 'inProgress')`, one line chosen by: target open → `Waiting on <id> — parked in Todo; re-dispatched when it completes.`; target complete (`isCompleteColumn`) or not found → `clearDependency` + `Dependency <id> already complete — re-queued for dispatch.`; no `dependsOn` (decomposition) → the existing decomposition line verbatim (P7). Exactly one park/log when triggers overlap. `continuation.ts`: wrap read-board → decide → `clearDependency`/`moveTask`/`addTaskLog` in `withStateLock` (import from `dispatch-state`); in-progress dependents WITH a live run are skipped without clearing; release the lock, then call `dispatchSingleTask` for each re-queued dependent (P3).
**Acceptance:**
- [ ] Settle-shape matrix passes with CLAIMED runs for every negative case (C6 of the spec review): workflow step, superseded/lost attempt, live replacement, same-owner-no-trigger.
- [ ] Three completion orderings pass: before registration (D1 refuses, decomposition record still parks), between registration and settle (continuation leaves `dependsOn`; settle parks + clears), after settle (continuation re-dispatches from todo). Plus one real interleaving: continuation blocked on the lock while a settle holds it, both complete, task ends in todo exactly once.
- [ ] `dispatch-session-death.test.ts` decomposition test still green (P7).
**Verify:** `bun test tests/core/dispatch-handoff.test.ts tests/core/continuation.test.ts tests/core/dispatch-session-death.test.ts --isolate`
**Files:** `src/core/dispatch-turns.ts`, `src/core/continuation.ts`, three test files. **Size:** M. **Dependencies:** Task 1.

#### Task 3 (C3): Author-based heuristics
**Description:** `DispatchTask.log` entries gain `author?: string` (`dispatch-types.ts`; the board read already carries it) (P6). `shouldBlockAfterDispatchFailure(snapshot, initialLogCount, targetAgent)` returns true only if `log.slice(initialLogCount)` holds an entry with `author === targetAgent`; the caller in `dispatch-session-death.ts` passes the agent. `checkBypassPatterns` skips `entry.author === 'watchdog'`; the three prefix checks go.
**Acceptance:**
- [ ] A system/watchdog line after dispatch never blocks a rejected turn; an agent-authored line still does; existing block-on-progress tests pass with an author added.
- [ ] `grep -rn "startsWith('ALERT\|startsWith('Auto-recovered" src` is empty.
**Verify:** `bun test tests/core/watchdog.test.ts tests/core/dispatch-session-death.test.ts tests/core/dispatch.test.ts --isolate`
**Files:** `src/core/dispatch-types.ts`, `dispatch-board.ts`, `dispatch-session-death.ts`, `watchdog.ts`, three test files. **Size:** S. **Dependencies:** none (ordered before C6).

### Checkpoint A — after Task 3
- [ ] `bun run typecheck && bun run lint && bun run check:cycles`; Phase 1 test files green.
- [ ] Manual on 3737 (dev server restarted): dependency on a done task via the tool → refusal message, agent continues; open dependency, agent stops → task in Todo with the waiting line.
- [ ] Review with Mark before Phase 2.

### Phase 2 — Recovery counter

#### Task 4 (C4): Recoveries storage (additive)
**Description:** `packages/core/src/tasks/store.ts`: `recoveries: number` on `BakinTask` + `BakinTaskPatch`; `createEmptyBakinTask` sets 0. `src/core/task-store.ts`: `Task.recoveries: number` in the view (`task.recoveries ?? 0` — raw JSON is cast without normalization, P11); new `recoverTask(identifier)` = `assertTransitionAllowed(task, 'todo', false)` + `updateSync(id, { ...columnPatch('todo'), recoveries: (task.recoveries ?? 0) + 1 })` in one write, synchronous under the hood (exported async-shaped like its siblings). Nothing reads the field yet.
**Acceptance:**
- [ ] A legacy task file without `recoveries` (and with old `Auto-recovered:` lines) reads as 0 in the view and persists 1 after one `recoverTask`.
- [ ] `recoverTask` refuses a transition the table forbids (e.g., done → todo for a system caller) exactly like `moveTask`.
**Verify:** `bun test tests/core/task-store.test.ts --isolate`
**Files:** `packages/core/src/tasks/store.ts`, `src/core/task-store.ts`, `tests/core/task-store.test.ts`. **Size:** S. **Dependencies:** none.

#### Task 5 (C5): Counter switch, updatedAt clock, fresh validation before mutating
**Description:** Watchdog: `lastActivity = task.updatedAt` (drop `getLastLogTimestamp` from the staleness path; it may stay only if the manual-hold helper still needs it — otherwise delete). After the async assessment (manual hold, workflow hooks, supersede-first) and immediately before mutating: re-read via `getTaskWithColumn`; require still `inProgress`, `now - updatedAt > stuckThresholdMs`, and liveness recomputed (plain task: `getLiveRun(id) === null`; workflow task: `assessWorkflowRuns` with the already-fetched active agents/descendants) (P2); then `recoveries >= max` ⇒ `blockTask` (reason uses the fresh count) else `recoverTask`; the log line is appended AFTER the write. Delete `countAutoRecoveries`. Restart recovery: `recoveryCount` from the view field; delete `countRecoveries` + both prefix constants; the same fresh re-read before recover, block AND the manual-hold write (P11); recover via `recoverTask`, then log. The `restart-recovery` health check keeps reading `candidate.recoveryCount` unchanged.
**Acceptance:**
- [ ] `recoveries = 3` + fresh `updatedAt` ⇒ untouched; ancient log lines + fresh `updatedAt` ⇒ untouched; stale ⇒ `recoveries` 1, 2, 3 then blocked, each as one store write before its log line.
- [ ] Mid-scan race: the snapshot says stale, the fresh row was moved (or reset) during an awaited hook ⇒ no mutation this tick — for watchdog AND restart recovery (recover, block, manual-hold).
- [ ] Real-store round trip in a temp dir: watchdog recover → reload → restart recovery and the health check (existing `restart-recovery.test.ts` ~L404 coverage) read the same count.
**Verify:** `bun test tests/core/watchdog.test.ts tests/core/restart-recovery.test.ts --isolate`
**Files:** `src/core/watchdog.ts`, `src/core/restart-recovery.ts`, two test files. **Size:** M. **Dependencies:** Task 4.

#### Task 6 (C6): Operator moves reset the counter and log the move
**Description:** `moveTaskWithEffects`: when `opts.channel === 'human' && agent === 'human'`, the stored move write also sets `recoveries: 0` (extend the facade's `moveTask` with an optional `{ resetRecoveries: true }` or a sibling verb — one write), then `appendTaskLog(taskId, 'human', 'Moved to <to> by operator', { operatorMove: { from: before.column, to } })` using the service's own `before` snapshot (P5). Completion-suppression and the block route are untouched.
**Acceptance:**
- [ ] UI-shaped move (channel human + agent human) ⇒ `recoveries 0` + structured line; `rest` channel, agent `main`, or `human` agent without the channel ⇒ no reset, no line; edit ⇒ nothing; block route ⇒ nothing.
- [ ] The operator line releases a restart-recovery manual hold (newer entry).
- [ ] With Task 3 in place, a rejected turn after an operator line does NOT block (criterion 8).
**Verify:** `bun test tests/core/task-service.test.ts tests/plugins/tasks/routes-rest.test.ts tests/core/dispatch-session-death.test.ts tests/core/watchdog.test.ts --isolate`
**Files:** `src/core/task-service.ts`, `src/core/task-store.ts`, three test files. **Size:** S. **Dependencies:** Tasks 3, 4.

### Checkpoint B — after Task 6
- [ ] typecheck + lint + Phase 2 test files + `check:cycles`.
- [ ] Manual on 3737: move a blocked card to Todo by hand → `recoveries 0`, operator line, no re-block within a tick; let an agent strand a task → recovered with `recoveries 1`.

### Phase 3 — CLI, wording, reproduction, docs

#### Task 7 (C7): CLI actor identity, client and server
**Description:** Client: replace `getCliAgent()` in `src/cli/http.ts` with `resolveCliActor(args): Promise<{ agent: string; channel?: 'human'; rest: string[] }>` — strips `--as <v>` / `--as=<v>` anywhere in `args`; `human` ⇒ `{ agent: 'human', channel: 'human' }`; other ⇒ that agent; no flag ⇒ walk up from `process.cwd()` with `readRunSidecar(dir)` (lazy `import('../core/run-workspace')`, zod-validated, no AppServices pull — verified by Codex) until found or root ⇒ `agentId`; else roster main. `tasks create` sends `createdBy`; `move/log/block/complete` send `agent`/`author` (+ `channel` when human); `depend` sends `agent`; `workflows submit` sends `agentId`. Server: `dependencyBody` gains optional `agent`; the route logs that author (else `system`) and passes it to `setDependencyWithEffects(taskId, dependsOn, channel, actor)` whose audit uses `actor ?? 'api'` (P1). Update the `tasks-team.test.ts` http mock (P6). Registry usage strings gain `[--as <agent|human>]`; run `bun run docs:generate` (CLI command blocks in `using/tasks.md`, `using/workflows.md`, `reference/generated/cli.mdx`, LLM bundles) and commit (P10).
**Acceptance:**
- [ ] For every mutation command: `--as patch` / `--as human` / sidecar in cwd or a parent / none ⇒ the expected `agent`/`author`/`createdBy`/`agentId` (+ `channel`) in the posted body; positionals unaffected by the flag's position.
- [ ] Route test: `POST /:taskId/dependency` with `agent: 'patch'` audits `task.dependency_set` with agent `patch` and logs activity as `patch`; without it, `api`/`system` as today.
- [ ] A bare command outside any run dir attributes to roster main; `docs:validate` green.
**Verify:** `bun test tests/cli/tasks-actor.test.ts tests/cli/tasks-team.test.ts tests/plugins/tasks/routes-rest.test.ts tests/core/task-service.test.ts --isolate && bun run docs:generate && bun run docs:validate && bun run docs:validate:routes`
**Files:** `src/cli/http.ts`, `src/cli/commands/tasks.ts`, `src/cli/commands/workflows.ts`, `src/core/cli/registry.ts`, `plugins/tasks/lib/task-schemas.ts`, `plugins/tasks/lib/routes.ts`, `src/core/task-service.ts`, `tests/cli/tasks-actor.test.ts` (new; HTTP client mocked, temp cwd with a sidecar written through `allocateRunWorkspace` or a hand-written schema-valid file), generated docs. **Size:** M–L (split C7a client / C7b server + docs if the diff passes ~400 lines; each half green alone). **Dependencies:** Task 1 (service signature).

### Checkpoint C — after Task 7
- [ ] Manual: `bakin tasks move <blocked-id> todo --as human` ⇒ operator line + reset; from inside `~/.bakin/run-workspaces/<agent>/<run>/` `bakin tasks log <id> hi` attributes to that agent.

#### Task 8 (C8): Dependency Pattern wording
**Description:** `SUBAGENT_DEFAULT_RULES` `## Bakin Dependency Pattern` gains "If their task is already done, do not register a dependency — do the work now." Prompt builders untouched. Add a direct assertion of the sentence in `tests/core/team-context.test.ts` (the existing comparison is against the same constant and would pass vacuously, P11).
**Acceptance:** sentence present; prompt byte fixtures unchanged.
**Verify:** `bun test tests/core/team-context.test.ts tests/core/dispatch-prompts.test.ts --isolate`
**Files:** `src/core/team-context-defaults.ts`, `tests/core/team-context.test.ts`. **Size:** XS. **Dependencies:** none.

#### Task 9 (C9): End-to-end reproduction
**Description:** New `tests/integration/dispatch-dependency-loop.test.ts`. Real task store, task-service, continuation, dispatch-turns and execution ledger in a temp dir (both content-dir mocks, OpenClaw-home mock, `getBakinPaths().db`, `closeDb()` before `rmSync`); runtime from `installFilesystemRuntimeAppServices` with a scripted `sendMessage` that invokes the tasks plugin's exec-tool handlers (`activatePlugin`/`callTool` from `tests/plugins/test-helpers.ts`) as the agent would (P8). Scenario A (margo): X done; Y's turn calls `set_dependency(Y, X)` → refused → `log_progress` → `complete`. Assert: one dispatch, Y done, no `task.auto_recovered` audit, `recoveries` 0. Scenario B: Y depends on open Z, agent stops after registering → Y in todo with the waiting line; complete Z → continuation re-dispatches Y once. Scenario C: Z completes while Y's turn is still open → Y parked at settle, cleared, and the next `runDispatchCycle` dispatches it (P11). Wait with `waitUntil`, never sleeps.
**Acceptance:** A, B, C green; zero recovery increments in all three.
**Verify:** `bun test tests/integration/dispatch-dependency-loop.test.ts --isolate`
**Files:** one new test file (+ a small harness helper if `callTool` needs the agent id threaded). **Size:** M. **Dependencies:** Tasks 1–6.

#### Task 10 (C10): Knowledge docs
**Description:** `.claude/knowledge/dispatch.md`: hand-off section (three lines, two triggers, one action), continuation (locked reconciliation; live-run dependents keep `dependsOn`), watchdog (updatedAt clock, `recoveries`, fresh validation order, author-based skip), restart recovery (field-based count; delete the `countRecoveries` prefix paragraph). `.claude/knowledge/tasks-plugin.md`: `recoveries` in the store shape, validator semantics + 409, `recoverTask`, operator log line, `dependencyBody.agent`, `--as`. `docs/src/content/docs/using/tasks.md`: one sentence on operator moves in the activity log and `--as human` (prose only — the generated command blocks already landed in C7). Re-check CLAUDE.md CLI bullet and README (expected unchanged). Run `bun run docs:check` once at the end (the CI gate).
**Acceptance:** success criterion 11; `bun run docs:check` green.
**Verify:** `bun run docs:check && git diff --stat`
**Files:** three docs. **Size:** S. **Dependencies:** Tasks 1–9.

### Checkpoint D — PR ready
- [ ] `bun run typecheck && bun run lint && bun run check:cycles && bun run docs:check`
- [ ] Full `bun run test` (alone — never beside `ui:conformance`).
- [ ] Mark's live test on 3737 covers criteria 1, 2, 4, 5, 9, and 12 including watching the agent **proceed and finish** after the refusal (P11).
- [ ] PR opened with spec + plan linked; body ends with the attribution line. Merge only after Mark approves; no release.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Settle park racing continuation | Med | Both now reconcile under `withStateLock` (C2, P3); the settle checks `getLiveRun` before moving; pinned by the interleaving test. |
| Await between validation and mutation in recovery | Med | C5 orders async assessment → fresh re-read → synchronous write → log (P2); race tests for watchdog and restart recovery. |
| Operator line read as agent progress | Med | C3 lands before C6 (P4); criterion 8 test in C6. The done guard and `progress-missing` check still count any entry — accepted and documented (Codex Q3). |
| Legacy JSON without `recoveries` | Low | `?? 0` at both the view and `recoverTask` (P11); legacy-fixture test in C4. |
| Hand-off tests pass vacuously (no ledger claims) | Med | C2 adds `claimRun` to every negative case before touching the settle code. |
| Generated docs drift fails `docs:check` | Low | C1 and C7 regenerate and commit; C10 runs the full gate. |
| CLI sidecar walk-up finds a settled run dir | Low | Identity is the agent, which is still correct; documented. |
| `tests/cli/bakin.test.ts` cannot test flag stripping | Low | Flag parsing is tested in the new `tasks-actor.test.ts` through the command modules' `run(args)`. |

## Open Questions
None. Mark decides at merge whether to keep the ten commits or squash.
