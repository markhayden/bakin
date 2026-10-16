# Spec: Task Dependency Liveness

Status: Rev 2 approved and BUILT on branch `fix/task-dependency-liveness` (2026-10-16, ten slice commits — see the plan's commit table); awaiting Mark's live test on 3737 before merge (D8: merge only, no release). Rev 1 was reviewed independently by Codex (`codex exec --sandbox read-only`); its seven findings are folded in below and marked **(C#)**. Plan: `task-dependency-liveness-plan.md` (written after approval).

## Objective

### Problem (found live on margo, rc.40, task `12939a37`)
The orchestrator wrote a task whose description said "FIRST register dependency on 40fe607e with tasks_set_dependency and exit until it completes". The dependency finished ten minutes after the first dispatch. Every re-dispatch afterwards followed the same shape, confirmed by jessica's Pi transcripts:

1. `bakin_exec_tasks_set_dependency` on the already-**done** task → tool answers "Dependency registered. You will be re-dispatched when 40fe607e completes. Stop now." — a promise that can never fire. Nothing checks whether the target is complete.
2. The agent stops; the run settles `ok` in ~10 s; the task stays `inProgress` with no live run (stranded). Registering a dependency never parks the task — only the decomposition and reassignment cases do (`dispatch-turns.ts`, spec D4 of the health-escalation initiative).
3. The watchdog waits `stuckThresholdMs` (30 min), recovers to todo, dispatch repeats, three strikes → blocked.
4. The operator moved the card blocked → todo at 02:30:33Z; dispatched 02:30:37Z; **re-blocked 02:31:32Z**. Staleness is measured from the newest task-log line (the watchdog's own "Escalated to blocked" line, ten hours old, beats the fresh dispatch), and the recovery count is the number of log lines starting `Auto-recovered:` — it never resets.

Items 1–4 are identical on `main`; #937 only makes the first cycle re-queue ten minutes sooner. Nothing in this spec is fixed by any unreleased change.

A fifth gap surfaced during review: the `bakin` CLI attributes every task command to the runtime's main agent (`getCliAgent()` reads the roster), so neither an agent calling it from a dispatch shell nor Mark at a terminal is identified correctly. Agents on margo ran the CLI 258 times in 30 days (doctor/check/install/onboard) and `bakin tasks …` zero times — they use the MCP exec tools — so this is a correctness gap, not a hot path.

### User
Mark, the single operator. He writes/reads tasks on the board, moves cards by hand when something is stuck, and expects a hand-moved card to get a genuinely fresh set of attempts.

### Success looks like
- An agent told to wait on a finished task is told, by the tool, to continue — and continues.
- An agent that registers a live dependency and stops leaves the task in Todo within one settle, with a log line saying what it waits on — including when the dependency completes while the turn is still running.
- A card the operator moves gets the full grace window and a fresh recovery budget; no watchdog message-text parsing remains anywhere.
- A `bakin tasks` command knows who is acting: the agent whose run directory it runs in, or the operator who says so.

## Decisions

| # | Decision |
|---|----------|
| D1 | **One dependency validator** in `src/core/task-service.ts` (`setDependencyWithEffects`) used by BOTH the exec tool and `POST /:taskId/dependency`. It refuses: a target that does not exist, a self-dependency, and a target that is already complete. "Complete" = `done` or `archived`, the SAME definition the dispatcher uses for `completedTaskIds` (`dispatch-cycle.ts` / `dispatch-single.ts`) — extracted to one shared predicate `isCompleteColumn()` in `dispatch-board.ts` so the two can never drift. Refusals are a typed error (`DependencyRejectedError { reason: 'missing' \| 'self' \| 'complete' }`); the exec tool returns `ok:false` with an agent-facing message ("Task <id> is already complete — continue your task now; do not wait."), the REST route maps it to `409`. Nothing is written on refusal. The SOURCE is resolved the way the store mutators resolve it (`findTaskWithColumn`: id or title) and "self" is judged on resolved ids, so `bakin tasks depend "<title>" <its id>` is refused too (code review round 3); the write goes under the resolved id. A source that does not exist is a plain `Task not found` error, not a dependency refusal. |
| D2 | **Park at settle — two triggers, one action (C1).** In `dispatch-turns.ts`, an owned regular turn that settles with the task still `inProgress` parks it in `todo` when EITHER (a) `task.dependsOn` is set — whatever the target's state — OR (b) the attempt was a decomposition recovery (the existing `failedDispatches[].sessionDeath.stage === 'decomposition'` lookup stays, because the pinned decomposition prompt still says STOP and D1 may have refused the registration when the last child finished first). One `moveStoredTask` under the existing state lock, one log line chosen by the trigger: `Waiting on <id> — parked in Todo; re-dispatched when it completes.` when the target is open; `Dependency <id> already complete — re-queued for dispatch.` (plus `clearDependency`) when the target is complete or missing (a deleted target is "satisfied", matching `dispatch-board.ts`); the existing decomposition line, kept verbatim, when a decomposition record parks a task that holds no `dependsOn` (plan review P7). **Continuation reconciles under `withStateLock`** (read board → decide → clear/move/log), releases, then calls `dispatchSingleTask`, which takes the same lock (plan review P3). Existing guards stay: workflow step turns never park; a non-owning (superseded/lost) attempt never mutates; a live replacement run skips the park. **Continuation changes to match (C1):** an in-progress dependent WITH a live run keeps its `dependsOn` (today `clearDependency` runs first and the settle would then see nothing) — the settle rule parks and clears it; dependents in todo/blocked and stranded in-progress dependents behave as today. **Clears are conditional (code review round 3):** `clearDependency(taskId, dependsOn)` clears only while the task still waits on THAT id (synchronous read-compare-write in the store, returns whether it cleared). The dependency route takes no dispatch lock, so a replacement target registered between a snapshot (settle park, continuation board read) and the clear is never erased — the settle logs nothing and leaves the task waiting; continuation skips that dependent entirely (no move, no dispatch). The health repair that strips `dependsOn` from done tasks passes the value it read. |
| D3 | **Persisted recovery counter (C2).** `recoveries: number` on `BakinTask` + `BakinTaskPatch` (store), AND on the internal `Task` view in `src/core/task-store.ts` (`taskToView`, where `readTaskboard()` — the watchdog's, restart recovery's and the `restart-recovery` health check's read path — projects it; absent ⇒ 0). NOT added to the SDK `Task` type (the architecture test already sanctions separate internal/SDK shapes). The watchdog and restart recovery both read it and compare against `settings.watchdog.maxAutoRecoveries`; `countAutoRecoveries()` (watchdog) and `countRecoveries()` + `WATCHDOG_RECOVERY_PREFIX`/`RESTART_RECOVERY_PREFIX` (restart recovery) are deleted. A new store verb `recoverTask(id, to: 'todo')` writes the increment and the column move in ONE `updateSync`. Log messages stay human-readable but carry no counting role. |
| D4 | **Operator moves reset the counter and leave a trace (C4).** Operator = a REST move arriving with `channel === 'human'` AND `agent === 'human'` (the board UI already sends both; the CLI sends them under `--as human`, D12). `moveTaskWithEffects` on that channel resets `recoveries` to 0 and appends ONE structured log line `Moved to <column> by operator` with `data: { operatorMove: { from, to } }`. System moves (watchdog, continuation, settle park, restart recovery) never reset. Human edits never reset. Moving to Blocked rides `blockTaskWithEffects` (a different route) and does NOT reset — blocking is not a retry. Because the line is a newer log entry, it also releases a restart-recovery manual hold naturally (existing rule). |
| D5 | **`updatedAt` is the activity clock.** The store bumps `updatedAt` on EVERY write (log appends included), so `lastActivity = task.updatedAt`; `getLastLogTimestamp` leaves the staleness path. A fresh dispatch or operator move always earns the full `stuckThresholdMs`. This is a watchdog guarantee only: restart recovery deliberately recovers stranded tasks at boot regardless of recency (pinned today). The manual-recovery-hold check (latest log entry's structured marker) is unchanged. |
| D6 | **Agent wording.** The exec tool's `description` and success message say the dependency must be a task that is NOT yet complete and that the tool refuses finished ones; the `## Bakin Dependency Pattern` block in `SUBAGENT_DEFAULT_RULES` (`src/core/team-context-defaults.ts`) gains "If their task is already done, do not register a dependency — do the work now." Dispatch prompt builders (`dispatch-prompts.ts`) and their byte fixtures are NOT touched. The role-layer change shows as managed-block drift on installed boxes until `bakin agents sync` runs (doctor `team.agent-sync` offers it). |
| D7 | **No compatibility shims.** Existing on-disk tasks start at `recoveries = 0`; legacy `Auto-recovered:` / `Restart recovery:` lines are inert history. No migration. |
| D8 | **Rollout: merge only.** No release is cut as part of this work. Margo picks it up with the next planned `v*` release; the task there is recreated by Mark without the "FIRST register dependency" sentence (nothing is changed on margo by Claude — read-only access). |
| D9 | **Fresh-state check at the recovery boundary (C3).** The watchdog iterates a board snapshot taken once per tick and awaits between tasks, so an operator can move a card mid-scan. Before anything is superseded, aborted or moved, the watchdog re-reads the task (`getTaskWithColumn`) and requires it still `inProgress` with the SAME `version` as the snapshot (every store write bumps `version`, so any operator move/reset, engine step advance or agent log during the scan parks the task for the next tick); from that read to the store write everything is synchronous. Restart recovery re-reads after its async re-assessment with the same rule. Combined with D3's single-write `recoverTask`, there is no window where a reset is overwritten by a stale increment. (Code review: the first cut validated after the supersede and before the await-free block; both engines now validate on `version`.) **Round 3:** `version` cannot see a workflow STEP claim — the card is already in progress, so the claim writes only the ledger — and HTTP is live during startup recovery (`runStartupRecovery` runs inside the `listen` callback). Restart recovery therefore re-checks the ledger synchronously over the scope its assessment read (`assessWorkflowRuns` on the same active steps + descendants; `isStrandedInProgress` for plain tasks) immediately before a recover/block write; a manual hold is a log line and still records. **Known residual, both engines:** a nested/map child spawned AND claimed between the descendant walk and the synchronous check is outside that scope (the parent row is untouched by a child spawn). Closing it needs the workflow engine to take the dispatch state lock around advance+claim — a separate change, not shimmed here. |
| D10 | **Agent-progress heuristic ignores non-agent authors (C5).** `shouldBlockAfterDispatchFailure` (`dispatch-board.ts`) currently treats ANY growth of the task log since dispatch as "the agent made progress, block for review". It now counts only entries whose `author` is the turn's target agent, so an operator line (D4), a watchdog line, or a system line can never turn a transport failure into a blocked card. |
| D11 | **Bypass scan skips by author (C7).** `checkBypassPatterns` skips the watchdog's own lines by `entry.author === 'watchdog'` instead of the `ALERT:` / `Auto-recovered:` / `⚠️` message prefixes. With D3 this removes the last message-prefix read in the watchdog's stuck-task scan. (The workflow step-timeout sweep's `BUDGET HOLD:` / `TIMEOUT:` marker reads are a separate mechanism and out of scope here.) |
| D12 | **CLI actor identity.** `getCliAgent()` in `src/cli/http.ts` becomes `resolveCliActor(args)` — the ONE resolver for every command that attributes an action (`tasks create/move/log/block/depend/complete`, `workflows submit`). Order: `--as <agent\|human>` flag → `.bakin-run.json` sidecar found by walking up from `cwd` (an agent's dispatch shell runs inside `~/.bakin/run-workspaces/<agent>/<run>/`, bound-repo worktrees one level below it; the sidecar is read through the zod schema exported from `src/core/run-workspace.ts`) → roster main (today's default, so existing scripts keep their behavior). `--as human` sends `agent: 'human', channel: 'human'`, which is exactly what the board UI sends, so `bakin tasks move <id> todo --as human` is an operator move under D4. The flag is stripped before positional parsing. **Identity reaches the server (plan review P1):** `tasks create` sends `createdBy`; `move/log/block/complete` send `agent`/`author` (+ `channel` when human); `tasks depend` sends `agent` through a new optional `dependencyBody.agent`, which the route logs as the activity author and passes to `setDependencyWithEffects(taskId, dependsOn, channel, actor)` so the `task.dependency_set` audit names the actor instead of the fixed `api`. Registry `usage` strings gain `[--as <agent\|human>]`; `bun run docs:generate` refreshes the CLI command blocks in `using/tasks.md`, `using/workflows.md`, `reference/generated/cli.mdx` and the LLM bundles, committed in the same slice (CI gate: `docs:check`). The Pi SDK has no per-session env, which is why identity rides the sidecar rather than an env var. |

Out of scope, stated so nobody looks for it: the session-death ladder (`failedDispatches`) keeps its own retry policy; "fresh attempts" means the shared watchdog/restart budget only.

## Tech Stack
Bun 1.3.13 (pinned), TypeScript strict, Zod at boundaries, `bun:sqlite` ledger via `packages/core/src/storage/db.ts` (untouched). No new dependencies.

## Commands
```
Typecheck:   bun run typecheck
Lint:        bun run lint                      (part of the gate — CI blocks on unused imports)
One file:    bun test tests/core/watchdog.test.ts --isolate
Full suite:  bun run test                      (never concurrently with ui:conformance)
Cycles:      bun run check:cycles
CLI docs:    bun run docs:generate             (after registry usage strings change)
Dev server:  bun run dev                       (server code not watched — restart manually)
Live test:   branch in the MAIN checkout so 3737 serves it; Mark tests before merge
```

## Project Structure (files touched)
```
packages/core/src/tasks/store.ts            recoveries field + patch key + recoverTask verb
src/core/task-store.ts                      Task view gains recoveries; recoverTask/operator-move helpers
src/core/task-service.ts                    DependencyRejectedError + validator; operator reset + log line
src/core/dispatch-board.ts                  isCompleteColumn(); shouldBlockAfterDispatchFailure by author
src/core/dispatch-cycle.ts, dispatch-single.ts   completedTaskIds via isCompleteColumn
src/core/dispatch-turns.ts                  settle park: dependsOn OR decomposition; open/complete messages
src/core/continuation.ts                    live-run dependents keep dependsOn
src/core/watchdog.ts                        updatedAt clock; recoveries; fresh re-read; author-based bypass skip
src/core/restart-recovery.ts                recoveries; fresh re-read; prefix counters deleted
src/core/run-workspace.ts                   export RunSidecarSchema (read-only use by the CLI)
src/core/team-context-defaults.ts           Dependency Pattern wording
src/core/cli/registry.ts                    usage strings: [--as <agent|human>]
src/cli/http.ts                             resolveCliActor (flag → sidecar → roster main)
src/cli/commands/tasks.ts, workflows.ts     use the resolver; strip --as
plugins/tasks/lib/exec-tools.ts             tool description/messages; refusal → ok:false
plugins/tasks/lib/routes.ts                 409 on DependencyRejectedError
docs/src/content/docs/reference/generated/cli.mdx   regenerated
tests/core/{task-service,dispatch-handoff,continuation,watchdog,restart-recovery,dispatch-board,tasks-store}.test.ts
tests/plugins/tasks/exec-tools.test.ts, tests/plugins/tasks/routes*.test.ts
tests/cli/tasks-actor.test.ts (new), tests/core/run-workspace.test.ts (sidecar read)
.claude/knowledge/dispatch.md               hand-off section (two triggers, one action), continuation, watchdog clock + counter + fresh re-read, restart recovery
.claude/knowledge/tasks-plugin.md           recoveries field, dependency validator, operator log line
.claude/knowledge/repo-architecture.md      only if the CLI resolver gets its own file
docs/src/content/docs/using/tasks.md        operator moves appear in the activity log; `--as human`
```
`README.md` and `CLAUDE.md` describe neither the counter nor the hand-off cases; the CLAUDE.md CLI bullet is re-checked at docs time (it names `src/cli/{http,output,help}.ts` as shared plumbing, which stays true).

## Code Style
```typescript
// One typed refusal, classified by kind — never by message text.
export class DependencyRejectedError extends Error {
  constructor(readonly reason: 'missing' | 'self' | 'complete', readonly dependsOn: string) {
    super(dependencyRejectionMessage(reason, dependsOn))
    this.name = 'DependencyRejectedError'
  }
}

export async function setDependencyWithEffects(taskId: string, dependsOn: string, channel?: Channel): Promise<void> {
  if (taskId === dependsOn) throw new DependencyRejectedError('self', dependsOn)
  const target = getTaskWithColumn(dependsOn)
  if (!target) throw new DependencyRejectedError('missing', dependsOn)
  if (isCompleteColumn(target.column)) throw new DependencyRejectedError('complete', dependsOn)
  await setStoredDependency(taskId, dependsOn)
  appendAudit(getContentDir(), 'task.dependency_set', 'api', { id: taskId, dependsOn }, channel)
}
```
Conventions: `const` over `let`, kebab-case files, `createLogger('module')`, no empty catches, structured `data` on log entries instead of message prefixes, typed errors classified by field, one store write per state transition.

## Testing Strategy
bun test, `--isolate` per file, temp-dir content-dir mocks on both resolver paths, in-memory ledger fake where only liveness is needed (`tests/core/task-service.test.ts` pattern), `waitUntil`/`settleFor` from `tests/helpers/wait.ts` — never sleeps. **Negative settle tests must claim a ledger run (C6)** — today's hand-off tests fire turns without claims, so `ownedRun` is false and the exclusions pass vacuously.

| Behaviour | Level | File |
|-----------|-------|------|
| Validator refuses missing/self/complete (done AND archived) targets, writes nothing, audits nothing; accepts open targets (todo/inProgress/blocked/review) | unit | `tests/core/task-service.test.ts` |
| Exec tool returns `ok:false` + agent-facing message per reason; REST returns 409 | unit | `tests/plugins/tasks/exec-tools.test.ts`, routes test |
| Settle park (claimed runs): open dependsOn → todo + waiting line; complete dependsOn → todo + cleared + re-queued line; missing dependsOn → treated complete; decomposition record without dependsOn → todo; same-owner no-dependsOn → untouched; superseded/lost attempt, live replacement, workflow step → never park (existing P2/R3 pins, now with claims) | unit (settle-shape matrix) | `tests/core/dispatch-handoff.test.ts` |
| Three orderings of "dependency completes" vs "turn settles": before registration (D1 refuses, decomposition still parks), between registration and settle (continuation keeps dependsOn, settle parks + clears), after settle (continuation re-dispatches from todo) | unit, continuation + settle together | `tests/core/continuation.test.ts`, `dispatch-handoff.test.ts` |
| Watchdog: fresh `updatedAt` with ancient log lines ⇒ not stuck; recovery writes `recoveries+1` and the move in one write; escalates at `maxAutoRecoveries`; `recoveries = 3` + fresh `updatedAt` ⇒ untouched; **mid-scan operator move** (snapshot stale, fresh row moved/reset) ⇒ skipped this tick | unit | `tests/core/watchdog.test.ts` |
| Operator move (channel human + agent human) resets `recoveries` to 0 and appends the structured line; `rest`-channel move with agent `main` does not; edit does not; block route does not; the new line releases a manual hold | unit | `tests/core/task-service.test.ts`, routes test |
| Real-store round trip: watchdog recover → file → reload → restart recovery and the `restart-recovery` health check read the same count → operator reset → 0 (C2) | unit with the real store in a temp dir | `tests/core/tasks-store.test.ts` or `restart-recovery.test.ts` |
| Restart recovery reads/increments the field; legacy prefix lines ignored; fresh re-read before mutation | unit | `tests/core/restart-recovery.test.ts` |
| `shouldBlockAfterDispatchFailure` counts agent-authored entries only (operator/system/watchdog lines never block) | unit | `tests/core/dispatch-board.test.ts`, `dispatch-session-death.test.ts` |
| `isCompleteColumn` is the single predicate behind `completedTaskIds` and the validator | unit | `tests/core/dispatch-board.test.ts` |
| Bypass scan skips watchdog lines by author | unit | `tests/core/watchdog.test.ts` |
| CLI actor: `--as patch` → agent patch; `--as human` → agent human + channel human; sidecar in cwd/parent → its agentId; none → roster main; flag stripped before positionals; applies to every tasks mutation and workflows submit | unit (HTTP client mocked, temp cwd with a sidecar) | `tests/cli/tasks-actor.test.ts` |
| Team-context wording | unit | `tests/core/team-context.test.ts` (if it pins the block) |
| Reproduction of the margo loop end to end on the mock runtime: task depends on a done task → tool refuses → agent continues → task completes | integration | existing dispatch integration suite or a new file under `tests/integration/` |

Gates before each commit: `bun run typecheck`, `bun run lint`, the touched test files. Before the PR is marked ready: full `bun run test`, `bun run check:cycles`, `bun run docs:generate` (committed output). No browser UI changes, so `ui:conformance` is not required.

## Boundaries
- **Always:** mock both content-dir resolvers in every new test; typed error kinds, never message-text classification; keep the dispatch-prompt byte fixtures untouched; claim ledger runs in settle tests; run lint + typecheck before every commit; commit in the checkpoint order the plan defines; update `.claude/knowledge` and regenerate CLI docs in the same PR.
- **Ask first:** touching the SDK `Task` type or any `@makinbakin/sdk` public surface; changing `settings.watchdog` keys; regenerating prompt fixtures; any change on margo; changing what a bare `bakin` command (no `--as`, no sidecar) attributes to.
- **Never:** hot-patch or restart anything on margo; merge before Mark's live test on 3737; add a migration or compatibility shim for old log lines; reintroduce heartbeat-file liveness; put identity in an env var the Pi SDK cannot set.

## Success Criteria
1. `bakin_exec_tasks_set_dependency` on a done or archived task returns `ok:false`, writes no `dependsOn`, emits no `task.dependency_set` audit, and its message tells the agent to continue. REST returns 409 for the same input.
2. A regular turn that registers an open dependency and ends leaves the task in `todo` with the waiting log line before the next watchdog tick; when the dependency completes DURING the turn, the settle still parks it (cleared, re-queued line) and the next dispatch cycle picks it up.
3. The decomposition flow still parks the parent in todo and still re-dispatches for final assembly, including when the last child finished before the parent registered its dependency.
4. A task dispatched or operator-moved within the last `stuckThresholdMs` is never recovered or escalated, regardless of how old its newest log line is — including a move that lands while a watchdog scan is in progress.
5. An operator move sets `recoveries = 0` and appends `Moved to <column> by operator` with `operatorMove` data; the watchdog then grants a full `maxAutoRecoveries` budget. Watchdog, continuation, settle and restart-recovery moves leave the counter alone; the block route does not reset.
6. No recovery-counting or watchdog-skip logic reads message text: `grep -rn "startsWith('Auto-recovered\|startsWith('ALERT\|RESTART_RECOVERY_PREFIX\|WATCHDOG_RECOVERY_PREFIX" src` is empty.
7. `isCompleteColumn` in `dispatch-board.ts` is the only definition of "complete" for dependencies; `completedTaskIds` and the validator both call it.
8. A transport failure after an operator line, with no agent-authored log growth, re-queues instead of blocking.
9. `bakin tasks move <id> todo --as human` resets the counter; the same command run from inside a run directory with no flag attributes to that run's agent; with neither it attributes to the roster main agent exactly as today.
10. The `## Bakin Dependency Pattern` block tells agents not to register a dependency on a finished task.
11. `.claude/knowledge/dispatch.md` and `tasks-plugin.md` describe the two-trigger hand-off, the counter, the clock, the fresh re-read, and the operator log line; `docs/using/tasks.md` mentions operator moves in the activity log and `--as human`; `reference/generated/cli.mdx` shows the flag.
12. typecheck, lint, `check:cycles`, and the full suite pass on the PR tip; Mark's live test on 3737 reproduces the margo shape (task depending on a done task) and sees the agent proceed.

## Open Questions
None blocking. The plan decides whether the end-to-end reproduction (criterion 12's test twin) rides the existing mock-runtime dispatch suite or a new integration file.
