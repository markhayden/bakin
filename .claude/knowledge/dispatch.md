# Dispatch — Deep Reference

Concurrent, session-scoped task dispatch with typed failure classification
and a session-death recovery ladder. Companion deep dives:
`.claude/knowledge/session-forensics.md` and
`.claude/knowledge/execution-ledger.md` (the claims/seq/completion layer).

## Execution claims (the correctness mechanism)

Every dispatch path — the cycle, `dispatchSingleTask`, and workflow steps —
**claims its run in the execution ledger before any side effect** via
`claimDispatchRun()` → `claimNextRun()` (atomic mint+claim; the runs
table's partial unique index "one running row per exec_key" IS the lock). A
duplicate dispatch (overlapping cycle, kick racing the cycle, second server
process) fails the INSERT, audits `task.dispatch_suppressed`, and skips.
Workflow steps claim exec_key `taskId:stepId` so parallel step agents stay
legitimate. Settle handlers free the claim FIRST (success → `settleRun`,
session death → `loseRun`) so the recovery ladder can claim anew; a
dispatch-prep failure releases its claim (`dispatch-prep-failed`). The
`dispatched[]` markers + in-flight registry remain advisory bookkeeping —
the ledger is the source of truth. A startup sweep (`server.ts`) marks
prior-boot running rows lost (keyed on `src/core/boot-id.ts`) before
restart recovery, or stale claims would suppress legitimate re-dispatch.

## Concurrent dispatch model

The dispatch cycle **fires sends and returns** — it never awaits an agent
turn (turns legally run up to 10 minutes; the old serial-await loop stalled
the whole board behind one slow agent). Mechanics in `src/core/dispatch.ts`:

- `fireDispatchTurn()` registers each send in an in-flight turn registry
  (`marker → { agentId, threadId, startedAt, settled }`) and attaches settle
  handlers that re-load state under the lock and reconcile (success cleanup,
  session-death ladder, or generic cooldown). The registry is advisory —
  caps + bookkeeping, never task state; restart recovery is unchanged.
- **Caps:** `settings.dispatch.maxConcurrentTurns` (global, default 3) and
  `maxTurnsPerAgent` (default 1 pending rig validation of gateway per-agent
  concurrency). A capped task is deferred with no failure recorded.
- The state lock spans only the scan/fire phase, so manual kicks
  (`dispatchSingleTask`) interleave with in-flight cycles.
- **Two-phase cycle (#434):** the regular loop *collects* dispatch intents
  (claim + move + build message), then ONE `saveDispatchState` persists the
  advisory bookkeeping, then all turns fire — 1 state write per cycle.
  Persist-before-send is now a ledger property: a run row is durable in
  SQLite before its turn is sent. Collected-but-unfired turns reserve their
  concurrency slots explicitly (`pendingByAgent` passed into
  `concurrencyGate`) since the in-flight registry only sees them at fire
  time.
- `awaitDispatchIdle()` — deterministic "all turns + bookkeeping settled"
  synchronization for tests and shutdown.

## Per-dispatch sessions

Every task send carries a fresh provider session via
`threadId = task:<taskId>:d<seq>` (workflow steps:
`task:<taskId>:step:<stepId>:d<seq>`) — the threadId IS the ledger
`run_id`. `seq` is a **monotonic per-task counter owned by the execution
ledger** (`MAX(seq)` over runs + seeded watermarks, minted atomically with
the claim), durable **before the turn fires** — never the failure count,
which resets on success and would resume a stale session. The legacy
`.dispatch-state.json#dispatchSeq` was read exactly once by the ledger's v1
migration to seed seq watermarks (no threadId reuse across the upgrade) and
is never written again.
Consequences:

- No cross-task context accumulation (a major contributor to oversized
  completions), deterministic forensics per attempt, corrective re-dispatches
  never replay a dead session's context.
- The adapter uses the stable idempotency key `bakin:<threadId>` for threaded
  turns and returns the provider `sessionId` in `MessageResult.metadata`.
- Notification sends (orchestrator complete-ping, watchdog, doctor, agents
  API) deliberately stay in the agent's default session — only task work is
  session-scoped.

## Failure classification (typed, no string matching)

Adapters throw typed `RuntimeError`s (`@bakin/core/adapters/runtime`) with a
structural `kind`; `classifyDispatchError()` maps kinds to cooldown classes.
**No error-message text is ever inspected in dispatch.ts** — an architecture
test pins this.

| RuntimeError kind | Cooldown class | reasonCode |
|---|---|---|
| `transport` | transient (60 s) | `transport_failure` |
| `timeout` | structural (30 min) | `dispatch_timeout` |
| `provider_cooldown` | structural | `provider_cooldown` / `auth_profile_unavailable` (via `providerInfo`) |
| `runtime_failed` | structural | `runtime_adapter_failure` |
| `session_death` | **recovery ladder** (below) | `runtime_turn_died` |

Non-RuntimeError fallback (mocks/unexpected): `TypeError`, `AbortError`, and
`err.cause.code` socket codes are transient; everything else structural.
`settings.dispatch.maxRetries` (default 5) escalates generic failures to
**blocked**.

## Session-death recovery ladder

A `RuntimeTurnError` (the adapter diagnosed the provider session dying
mid-turn) is deterministic — retrying reproduces it. The ladder changes the
approach instead of waiting (`handleSessionDeath()`):

1. **Death 1** — salvage the truncated completion to
   `~/.bakin/tasks/salvage/<taskId>-d<seq>.md` + persist as a task-linked
   asset (`assets.saveFromSource` hook, tag `salvaged-output`), then an
   IMMEDIATE corrective re-dispatch whose prompt opens with
   `PREVIOUS ATTEMPT FAILED` (why it died, size, salvaged-asset pointer,
   artifact-first instructions).
2. **Death 2** — decomposition dispatch: the agent must NOT do the work,
   only split it into single-deliverable subtasks chained via `dependsOn`
   (deliverable assets saved against the PARENT taskId); the parent waits on
   the last link and re-dispatches for final assembly.
3. **Death 3** — block with an actionable reason: diagnosis detail, last
   tool call, salvaged asset ids, explicit next steps.

Workflow steps get corrective → block (no decomposition — the engine owns
step structure) and stay `inProgress` throughout. Ladder state lives on
`FailureRecord.sessionDeath` and is exempt from generic cooldowns/maxRetries;
a successful rung clears it. Audit kinds: `task.runtime_session_died`,
`task.corrective_redispatch`, `task.decomposition_dispatched`,
`task.runtime_failed_blocked` (with the structured diagnosis). The tasks
plugin surfaces incidents via the `session-death-incidents` doctor check.

### Provider availability detail

`task.dispatch_failed` audit entries and the matching system task log now carry
structured dispatch failure detail in addition to the retry/cooldown class:

- `category` — `model_provider_unavailable` or `runtime_unavailable`
- `reasonCode` — currently `provider_cooldown`,
  `auth_profile_unavailable`, `dispatch_timeout`, `transport_failure`,
  `runtime_adapter_failure`, or `runtime_dispatch_failed`
- `summary` — compact UI text such as
  `Dispatch failed: model provider unavailable`
- `specificReason` — drawer/debug detail such as
  `Provider in cooldown after timeout` or `Auth profile unavailable`
- `provider`, `model`, `cooldownReason` — optional extracted runtime context
- `retryable` — whether normal dispatch retry/cooldown can reasonably recover
- `rawError` — bounded raw runtime error text for technical details

Task logs store this detail under `entry.data.dispatchFailure`. Audit entries
store the same fields top-level for the activity feed. Compact surfaces should
show the generic provider-unavailable label; task detail drawers and debug
activity views may show the specific cause and raw bounded error. Do not make
raw provider text the primary UI message.

## Settle-time reconciliation

Dispatch moves a task to `inProgress` before firing the send so a fast agent
cannot complete before Bakin records active work. When a turn's send later
rejects, the settle handler re-reads current task state under the lock:

- Task already left active work (`done`, `blocked`, `review`, `archived`) →
  leave it alone, remove stale dispatch markers (late gateway errors after
  the agent already called `bakin_exec_tasks_complete`/`_block`).
- `RuntimeTurnError` → the session-death recovery ladder (above).
- Still `inProgress` with work evidence (task log grew) → block with a
  sanitized reason.
- Otherwise → back to `todo`, record `failedDispatches`, cooldown/retry.

Task logs and audit entries use short sanitized summaries derived from
RuntimeError kinds; do not write raw prompts, local paths, tokens, or full
runtime trajectories to task logs.

## Continuation

When a dependency completes, `src/core/continuation.ts` routes dependents
through a FULL re-dispatch (`dispatchSingleTask(source: 'continuation')`):
fresh `d<seq>` session and a self-contained prompt carrying a
`## Completed Dependency` block. (The old bare "resume your task" nudge only
worked because it landed in the shared session that still held the original
context.) Blocked dependents are moved to `todo` first; in-progress
dependents are skipped.

## Task Eligibility

Dispatch only considers `todo` tasks that are actually eligible to run.

Eligibility checks are centralized in `isTaskDispatchEligible(task, ctx)`:

- `availableAt` is absent or at/before the current time
- `dependsOn` is absent or already completed
- assigned agent exists in the runtime roster
- concurrency caps have a free slot (checked separately in the loop)

**Stranding guard:** a `dependsOn` pointing at a task id that exists in NO
column (hard-deleted by `archiveOldTasks`) is treated as satisfied, with a
warning + task-log note — load-bearing for decomposition chains.

Invalid `availableAt` values are treated as unscheduled so malformed metadata
does not permanently strand a task. Explicit user kick dispatches can bypass the
schedule gate, but automatic dispatch and automatic subtasks cannot.

## Prompt construction

`buildDispatchMessage()` / `buildWorkflowDispatchMessage()` share
`outputDisciplineSection()` (a SHORT artifact-first reminder in EVERY
dispatch carrying the taskId-templated `assets_save` command) and
`sharedExecutionToolDocs()` (taskId-templated invocations — intentional
differences are parameters, so the builders can't drift). The static half of
the old ~4KB catalog (logging rules, discipline rationale, dependency
pattern, tool reference) lives in the `execution-tools` **managed block**
projected into subagent AGENTS.md (`src/core/agent-rules/managed-blocks.ts`;
run `bakin agent-rules --apply-all` after deploy — plain `--apply` writes the
main-agent context only and will NOT project this subagent-target block). The
triage roster is derived
from `runtime.agents.list()`; core contains no hardcoded agent names.
Recovery variants: corrective prompts open with `PREVIOUS ATTEMPT FAILED`;
decomposition replaces the work prompt entirely.

Per-prompt context blocks are computed async at the call sites and passed
into the synchronous builders:

- **Assets:** `buildDispatchAssetBlock(taskId)` invokes the assets plugin's
  `assets.listByTask` hook (in-memory taskId→assetIds index; no search
  dependency) and renders assetIds — agents open them by assetId via
  `bakin_exec_assets_open`. Core never walks `assets/store/` directly.
- **Lessons:** `buildDispatchLessonBlock()` caches the formatted block per
  `(agentId, query)` (TTL 5 min, cap 200; empty blocks cached too) — a
  workflow step change alters the query and naturally misses; same-step
  re-dispatches hit without a `crossTableSearch`. Lessons that can't keep
  ≥400 chars of body are omitted with a visible `(N lessons omitted)`
  marker, never silently dropped.

One audit row per dispatch: the internal todo→inProgress move is folded into
`task.dispatched` (payload carries `from`/`to`); `task.moved` is reserved for
human/system/workflow moves. Task writes broadcast exactly once — the content
watcher ignores `tasks/` and the store's own emit is authoritative.

Plugins that need future work should create a real task with `availableAt`
rather than registering a private heartbeat, health check, cron, or sweep.
The dispatcher heartbeat is the wakeup surface for task-backed work.

## Persistence

Correctness state (run claims, seqs, completions) lives in the execution
ledger (`~/.bakin/bakin.db` — see `.claude/knowledge/execution-ledger.md`).
`~/.bakin/.dispatch-state.json` holds the remaining advisory bookkeeping:

- `failedDispatches`: `{ lastAttempt, count, kind, sessionDeath? }` —
  `sessionDeath` is `{ stage, deaths, lastDiagnosis, salvagedAssetIds }`
  (ladder state; diagnosis stored without salvage text).
- `dispatched`: in-flight/active markers, trimmed to
  `settings.dispatch.maxDispatched`. Advisory only — the ledger claim is
  what actually prevents a double dispatch.
- `dispatchSeq` (legacy, read-once): seeded into the ledger's seq
  watermarks by its v1 migration; never written again.

Legacy plain-number `failedDispatches` entries are migrated to
`{ kind: 'structural' }` by `getFailureRecord()` on read.

## Restart recovery

Startup orphan repair lives in `src/core/restart-recovery.ts`, not in the
dispatch loop. After plugins are active and the HTTP server is listening,
`server.ts` runs one recovery pass over Bakin's task store before starting the
normal dispatch/watchdog loops:

- Plain `inProgress` tasks recover when their assigned agent heartbeat is
  missing or stale.
- Workflow-backed tasks ask the workflow plugin for `workflows.loadInstance`
  and `workflows.getActiveAgents`; recovery uses active workflow agents, not
  the card assignee.
- `pending_approval`, `complete`, and `cancelled` workflow instances are left
  alone.
- Partial parallel staleness and workflow states with no active agents are
  reported for manual attention instead of redispatching live work. The
  manual path writes a structured hold marker
  (`addTaskLog(..., { restartRecovery: 'manual' })`, message prefixed
  `Manual recovery hold:` — deliberately NOT `Restart recovery:`, which
  `countRecoveries()` would count as an attempt). The watchdog skips a task
  while that marker is its LATEST log entry; any newer activity clears the
  hold naturally.
- Recovery loops share `settings.watchdog.maxAutoRecoveries`; exhausted tasks
  move to `blocked`.

When recovery returns tasks to `todo`, `server.ts` starts the loops and then
immediately triggers one dispatch cycle so recovered work does not wait for the
next interval.

## Scheduled tasks

Scheduled tasks are fired by the schedule plugin's own tick scheduler — Bakin no
longer delegates to OpenClaw cron, and the old cron→task bridge webhook (and its
`bakin:<pluginId>:<action>` command routing) has been removed. The scheduler
claims each occurrence in the execution ledger and creates a board task through
the normal dispatch path. Deep reference:
`.claude/knowledge/bakin-owned-scheduler.md`. Prefer `availableAt` tasks for
one-time scheduled work.

## Where to look

- `src/core/app-services.ts` — boot-created runtime/search/task service object
- `packages/adapter-openclaw/src/runtime.ts` — OpenClaw adapter transport, fail-fast watcher, post-mortem
- `packages/adapter-openclaw/src/trajectory-forensics.ts` — trajectory parsing + diagnosis
- `packages/adapter-openclaw/src/errors.ts` — the ONE place provider error strings are interpreted
- `src/core/dispatch.ts` — classification, recovery ladder, concurrency registry, prompt builders
- `src/core/continuation.ts` — dependency continuation as full re-dispatch
- `src/core/restart-recovery.ts` — post-boot recovery of orphaned `inProgress` tasks
- `plugins/schedule/index.ts` — Bakin-owned scheduler wiring (see `.claude/knowledge/bakin-owned-scheduler.md`)
- `.claude/knowledge/session-forensics.md` — trajectory schema, diagnosis flow, ladder walkthroughs
- `.claude/knowledge/adapter-architecture.md` — adapter boundaries and task/runtime ownership
