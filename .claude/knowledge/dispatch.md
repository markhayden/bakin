# Dispatch — Deep Reference

Concurrent, session-scoped task dispatch with typed failure classification
and a session-death recovery ladder. Companion deep dives:
`.claude/knowledge/session-forensics.md` and
`.claude/knowledge/execution-ledger.md` (the claims/seq/completion layer).

## Module map

`src/core/dispatch.ts` is a **29-line public barrel** — consumers keep the
`@/core/dispatch` import path, but the implementation lives in sibling
modules that import each other directly (never through the barrel):

| Module | Responsibility |
|---|---|
| `dispatch-types.ts` | Shared type/interface declarations (no runtime code) |
| `dispatch-state.ts` | `.dispatch-state.json` load/save + the single state mutex + marker/failure-record accessors |
| `dispatch-board.ts` | Taskboard reads, `isTaskDispatchEligible` policy, thin task-store wrappers |
| `dispatch-failures.ts` | Pure RuntimeError→cooldown-class classification (kind-only, never message text) |
| `dispatch-prompts.ts` | Synchronous prompt assembly (labeled sections; pure string builders) |
| `dispatch-context-blocks.ts` | Async prompt-context builders (lessons via retrieval, assets via hook, brand card via `brands.getContext` #419) + lessonBlockCache + brand resolution/defer |
| `dispatch-registry.ts` | The in-flight turn registry (LEAF — types+logger only): counts, abort/snapshot/force-release surface for task-store + watchdog |
| `dispatch-turns.ts` | The concurrent fire engine: budget gate, run claiming, turn registration + caps, `fireDispatchTurn` settle handlers |
| `dispatch-prepare.ts` | Shared per-task fire prep (claim → lesson → assets → message → move → audit) for cycle + single |
| `dispatch-team.ts` | Team → agent resolution via the `team.resolveAssignment` hook (#189) — see `.claude/knowledge/team-aware-assignment.md` |
| `dispatch-cycle.ts` | The periodic two-phase collect-then-fire cycle, start/stop, `getDispatchInfo` |
| `dispatch-single.ts` | Immediate single-task dispatch (kick / subtask / continuation / recovery) |
| `dispatch-workflow.ts` | Workflow-step dispatch + workflow prompt builder |
| `dispatch-session-death.ts` | Session-death recovery ladder + dispatch-rejection reconciliation |

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
the whole board behind one slow agent). Mechanics in
`src/core/dispatch-turns.ts` (fire engine) + `dispatch-cycle.ts` (the scan):

- `fireDispatchTurn()` registers each send in an in-flight turn registry
  (`marker → { agentId, threadId, startedAt, settled, abort, abortedAt? }`)
  and attaches settle handlers that re-load state under the lock and
  reconcile (success cleanup, session-death ladder, or generic cooldown).
  The registry is advisory — caps + bookkeeping, never task state; restart
  recovery is unchanged.
- **Turn abort (#604):** every entry carries an `AbortController` whose
  signal is threaded to the runtime as `MessageArgs.signal`.
  `abortTurnsForTask(taskId, reason)` cancels every turn for a task
  (regular AND `taskId:stepId` workflow-step markers); `deleteTask`'s first
  effect calls it with `'task-deleted'`. An aborted turn settles on a
  dedicated branch: best-effort `settleRun` (a no-op after the delete's
  ledger purge, by design), a `task.turn_aborted` audit carrying the
  signal's reason, clean exit — **no recovery ladder, no reconcile
  fail-noise** (a corrective re-dispatch would resurrect work for a deleted
  task). The watchdog sweeps the registry each cycle for turns whose task no
  longer exists in the store (board presence is NOT the test — done tasks
  exist off-board): first sighting aborts (`'orphan-sweep'`); a turn still
  registered `ORPHAN_TURN_FORCE_RELEASE_GRACE_MS` (60 s) after its abort is
  dropped via `forceReleaseTurn` + `task.turn_force_released` audit so a
  hung provider turn can never hold the agent's slot until restart.
- **Caps:** `settings.dispatch.maxConcurrentTurns` (global, default 3) and
  `maxTurnsPerAgent` (default 2 — honored only on runtimes declaring
  `concurrency.sameAgentTurns: 'isolated'`; serialized runtimes clamp to 1
  with a once-per-boot `dispatch.concurrency_clamped` audit). Workflow-step
  gates fold in the cycle's reserved (collected-but-unfired) counts. A capped
  task is deferred with no failure recorded. Isolated turns run in per-run
  dirs; repo-bound tasks add a worktree — deep reference:
  `.claude/knowledge/same-agent-concurrency.md`.
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
- **Live turn activity (WS1b):** every fired turn passes
  `MessageArgs.onActivity` — the adapter-side tap that forwards **tool +
  status chunks only** (text deltas stay on `messaging.stream`; best-effort,
  no ordering guarantee vs the settle; the adapter contains callback
  exceptions). Dispatch broadcasts each chunk as a `turn-activity` SSE event
  (`TurnActivityEvent`: `{taskId, childTaskId?, agentId, runId, chunk, ts}`,
  exported from `dispatch-turns.ts`) over the `globalThis.__bakinBroadcastEphemeral`
  seam — a live-sockets-only broadcast that never enters the SSE replay
  buffer and carries no event id, so a long turn can't evict durable events
  from the reconnect window or advance a client's Last-Event-ID.
  **Ephemeral by design** — never persisted: no task
  log, no audit row, no heartbeat bump; `done`/`error` chunk types are
  filtered defensively. Late chunks after settle are dropped by gating on the
  EXACT in-flight registry entry (`getInFlightTurn` + threadId match). No
  extra throttling — tool chunks are naturally sparse and `thinking` status
  is once-gated per turn in both adapters (OpenClaw's tap gate mirrors Pi's
  `announcedThinking`); previews are redacted by both adapters
  (`@bakin/core/redact`).
  Client side: the shell fans `turn-activity` onto the plugin-event emitter
  (`use-sse.ts`); the board renders a per-task latest chip
  (`plugins/tasks/hooks/use-live-activity.ts`, 45 s TTL, in-progress column
  only, workflow steps chip parent + child) and the Team Diagnostics timeline
  shows a live row for in-flight turns — UI layer only, the durable
  ledger+audit timeline spine is untouched. Heartbeats never chip:
  OpenClaw's chunk machine filters `isHeartbeat` frames and Pi heartbeats
  don't go through `messaging.send`.

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
structural `kind`; `classifyDispatchError()` (in `dispatch-failures.ts`) maps
kinds to cooldown classes. **No error-message text is ever inspected in the
dispatch modules** — an architecture test pins this.

| RuntimeError kind | Cooldown class | reasonCode |
|---|---|---|
| `transport` | transient (60 s) | `transport_failure` |
| `timeout` | structural (30 min) | `dispatch_timeout` |
| `provider_cooldown` | structural | `provider_cooldown` / `auth_profile_unavailable` (via `providerInfo`) |
| `runtime_failed` | structural | `runtime_adapter_failure` |
| `session_death` | **recovery ladder** (below) | `runtime_turn_died` |
| `aborted` | **none — terminal** (intentional cancel; audited `task.turn_aborted`, never retried, never diagnosed) | — |

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

## Model routing + budget gating (cost, #464 / cost-control v2)

Bakin-owned policy checks wrap every turn fire. All read policy from the models plugin via hooks (absent plugin → no-op) and degrade gracefully. Deep reference: `.claude/knowledge/models-plugin.md`.

**Gate order per turn: routing → kill switch → budget → claim.** Routing resolves FIRST (all three paths — cycle/single/workflow) because provider-scoped budget rules need to know which model the turn would spend on; the resolved routing is threaded into `fireDispatchTurn` so the gated model IS the fired model (one resolution per dispatch).

- **Kill switch** (`dispatchPaused`, checked inside `deferForBudget` and by the billed-media gate): `settings.dispatch.paused` pauses ALL Bakin-initiated task dispatch + billed media, independent of budget policy. Audited once per activation (`dispatch.paused`); watchdog/doctor health probes stay allowed. Surfaces: host header banner, budget health check row, `bakin budget pause|resume`.
- **Budget gate** (`deferForBudget`/`budgetGate`, before each `claimDispatchRun`): reads the rule-list policy (`models.getBudgetPolicy` — `BudgetRule` = scope global|agent|provider (`model` evaluator-ready) × lane metered|subscription; unit-per-lane: metered caps are estimated USD, subscription caps are tokens) and the turn's billing context (`models.resolveBilling` — provider + lane from the routed/effective model). Spend comes from the ONE engine `assembleBudgetSpend` (`src/core/budget-spend.ts`): attributed `run_costs` PLUS the unattributed usage.db delta per (agent, local day, lane) — total-observed basis, so agent activity outside Bakin-managed tasks still moves the caps. **defer** → don't claim, task stays in todo (Tasks UI badges it via `/budget/status`); resumes at window rollover or a raised cap. **`atCap: 'pause'`** rules hold past rollover until a human resolves the incident. **Fail-closed**: an unreadable spend ledger defers. Breaches open durable `budget_incidents` rows — the table's UNIQUE is the restart-safe once-per-(rule, window, kind) debounce; a fresh open audits (`budget.warn`/`budget.deferred` with `incidentId`) and fans out via `budget-notify` (SSE → browser notification + one metered main-agent relay message). The cycle passes a per-cycle facets memo (`BudgetSpendMemo`, keyed on the local day-start — a cycle straddling midnight recomputes instead of gating on stale windows). Incident reopen fires only for `raised`/`window_rollover` resolutions — a human's 'resume as-is' (acknowledged) stays suppressed for the window. Warn incidents always carry `atCap: 'defer'` (sweepable) even on pause rules; the rollover sweep runs before the empty-policy early-return AND on `/budget/incidents` reads. `requestImmediateDispatch` (dispatch-cycle) runs a cycle now — the incident raise/resume routes call it. Spend counts ALL agent sends (dispatch + watchdog/doctor/orchestrator) plus billed images, metered via `src/core/agent-cost.ts`; billed media additionally gates PER CALL (`gateBilledMediaCall` — typed `budget_exceeded`/`dispatch_paused` refusal before any provider call or idempotency row).
- **Model routing** (`resolveDispatchRouting`, hoisted above the gate): reads `models.getRoutingConfig` and resolves `{model?, thinking?, source}` from the turn's **work class** + tag overrides (`resolveTurnModel` in `src/core/model-routing.ts`), then clamps the thinking level to the runtime's declared `supportedThinkingLevels` via `applyThinkingCapability` (clamp-and-warn down the ordinal ladder; `'adaptive'` clamps to inherit — never silent, never a failed turn). Never throws into the dispatch path — no plugin/config/match or a failed read = `{ source: 'inherit' }` (agent's configured model). Passed onto the runtime via `MessageArgs.model/thinking`; the resolved model + work class + `route_source` (`'tag:<name>'|'class'|'inherit'`) are recorded on the `run_costs` row (with provider + billing lane) and audited (`task.routed` carries `source`, plus `requestedThinking`/`clamped` when a clamp fired) — Team Diagnostics run rows render the receipt as `· via class route`/`tag:<x>`.

The dispatch work class is classified deterministically from task shape + dispatch context (`classifyDispatchWorkClass`): recovery-ladder re-dispatch→recovery, `workflowId`→workflow, `scheduleJobId`→scheduled, `parentId`→decomposition, else adhoc. System sends (auto-titles, enrichment, relays, team-routing, direct sends) resolve the same matrix via `resolveSystemRoute` (`src/core/system-route.ts`); interactive `chat` is metered-only, never routed. Deep reference: `.claude/knowledge/models-plugin.md` § Routing.

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

## Team assignment resolution (#189)

A task carrying `team` but no `agent` resolves to a concrete member via a
PRE-LOCK pre-pass (`resolveTeamAssignmentsPrePass` for the cycle,
`resolveTeamAssignmentForSingle` for kicks — `dispatch-team.ts` → the team
plugin's `team.resolveAssignment` RPC hook): the routing LLM call (up to
~60s per attempt) runs before `withStateLock`, re-entrant-guarded,
CONCURRENT across tasks, deduped by a per-task in-flight set, gated on
dispatch eligibility (future availableAt / unmet dependsOn never bill),
and stale-write-guarded before persisting (round-3 review). The pick is persisted immediately
(`recordTeamResolution` — retains `team` for audit) so the routing LLM
bills at most once per successful task lifetime. The routing call itself is
an EPHEMERAL RUNTIME TURN as the main agent (no API keys — the runtime's
credentials serve it; metered under `workClass: 'team-routing'`), and its
pause/budget gate (`routingCallGated`) sits at the callers OUTSIDE the
ladder. Transient failures
(including a throwing hook) are recorded in the SAME `failedDispatches`
ladder as every other dispatch failure — transient cooldown between
retries, escalation to blocked at `maxRetries` — with the reason
task-logged once; structural failures (unknown team, empty pool, hook
missing, runtime not_found)
BLOCK the task with an honest reason — never a silent fallback pick.
Workflow STEPS route the same way (#611): a `team:<id>` step agent resolves
per-step at dispatch (`resolveTeamAssignmentForStep`, sticky on the
instance via `workflows.recordStepTeamResolution`, ladder key
`<contextTaskId>:<stepId>`, structural blocks hit the parent task).
Audit: `task.team_resolved` / `task.team_resolution_failed` (with `stepId`
for step resolutions). Deep
reference: `.claude/knowledge/team-aware-assignment.md`.

## Prompt construction

Both builders assemble LABELED SECTIONS (`Array<{source, text}>`; the message
is the joined sections) so the context-report diagnostics measure exactly
what production sends — see `.claude/knowledge/startup-context.md` (#357).
`buildDispatchSections()` / `buildWorkflowDispatchSections()` share
`outputDisciplineSection()` (a SHORT artifact-first reminder in EVERY
dispatch carrying the taskId-templated `assets_save` command) and
`sharedExecutionToolDocs()` (taskId-templated invocations — intentional
differences are parameters, so the builders can't drift). Every tool-call
line renders through `renderToolCall` (`src/core/tool-access.ts`) per the
ACTIVE runtime's `describeToolAccess()` — bare calls on Pi (in-process),
`bakin-<agent>.`-prefixed native MCP calls on OpenClaw — the same primitive
the AGENTS.md tool-access section uses, so prompt and projection bytes can
never drift (runtime-capabilities P1.4). The static half of
the old ~4KB catalog (logging rules, discipline rationale, dependency
pattern, tool reference) lives in the SUBAGENT ROLE CONTEXT layer
(`~/.bakin/team/context/roles/subagent.md`, defaults in
`src/core/team-context-defaults.ts`) composed into each subagent's AGENTS.md
managed block — `bakin agents sync` (or the doctor's agent-sync repair)
refreshes it after deploy. Static sections are pinned by byte fixtures
(`tests/fixtures/dispatch-prompts/`, regenerated deliberately) and a
boilerplate budget test; the workflow WORKFLOW CONTEXT block is byte-budgeted
by `settings.dispatch.maxWorkflowContextBytes` (newest step outputs kept
whole, visible omission markers). The
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
- `src/core/dispatch.ts` — the public barrel; implementation in the `dispatch-*` modules (see the module map above)
- `src/core/continuation.ts` — dependency continuation as full re-dispatch
- `src/core/restart-recovery.ts` — post-boot recovery of orphaned `inProgress` tasks
- `plugins/schedule/index.ts` — Bakin-owned scheduler wiring (see `.claude/knowledge/bakin-owned-scheduler.md`)
- `.claude/knowledge/session-forensics.md` — trajectory schema, diagnosis flow, ladder walkthroughs
- `.claude/knowledge/adapter-architecture.md` — adapter boundaries and task/runtime ownership

## Brand context (#419)

Effective brand resolves LAZILY per dispatch in `dispatch-context-blocks.ts`:
`task.brandId` → cycle-safe parent ancestry → `projects.getBrand` hook.
`buildDispatchBrandBlock` invokes `brands.getContext` (structural-mirror types,
graceful when absent for unbranded tasks) and returns none/ready/missing.
Ready → a conditional `brand` section between `project` and `lessons` in BOTH
builders (full card subagent/main; one-liner in triage), budgeted by
`dispatch.maxBrandContextBytes`, plus a `brand.injected` audit post-claim.
Missing → the PRE-CLAIM brand gate (`deferForMissingBrand`, mirror of
`deferForBudget` in dispatch-cycle + dispatch-single) leaves the task in todo
with notify-once (`brand.dispatch_blocked` audit + plugin-event → browser
notification + derived board badge); the post-gate race backstop is a typed
`BrandUnavailableError` in prepare (claim released). A brand-linked task is
NEVER dispatched brandless. Deep reference: `.claude/knowledge/brands-plugin.md`.
