# Team-Aware Task Assignment — Deep Reference

Assign a task to a **team** instead of a concrete agent; dispatch resolves
the best-suited member via a cheap LLM classification call at fire time
(#189). Spec: `.claude/specs/team-aware-assignment.md`; plan:
`team-aware-assignment-plan.md`.

## Data model

`BakinTask.team?: string` sits alongside `agent?: string`
(`packages/core/src/tasks/store.ts`). Four states:

| team | agent | Meaning |
|---|---|---|
| – | – | unassigned (dispatch falls back to the main agent) |
| – | ✓ | direct assignment (unchanged behavior) |
| ✓ | – | **unresolved** team task — the resolver picks a member at dispatch |
| ✓ | ✓ | **resolved** — agent is the pick; team is RETAINED so the record explains requested vs resolved |

Exclusion semantics live in the app facade (`src/core/task-store.ts`), NOT
the raw store, because dispatch legitimately re-writes `{agent}` on
resolved tasks (`moveTaskToInProgress`):

- create: both assignee + team → reject
- `updateTask`/`assignTask`: agent set to a **different** value → clears team
  (re-assignment intent); same-value re-write or unassign → team retained
- team set → clears agent (back to unresolved); explicit Unassigned in the
  UI clears both
- `recordTeamResolution(id, agent)` — dispatch-only write that fills agent
  and retains team

## Resolution (team plugin owns it)

`plugins/team/lib/assignment-resolver.ts`, exposed as the RPC hook
`team.resolveAssignment` (registered in `plugins/team/index.ts`). Also
`team.exists` for write-time validation.

- **Pool** = team members (`displaySettings[agentId].teamId`) ∩ runtime
  roster. Existence is the ONLY hard filter — status/workload are prompt
  signals, so "best suited" beats "available right now".
- **Prompt** = task title/description/tags + per member: id, name, role,
  model, live status, and a byte-budgeted (`MEMBER_PROFILE_BYTE_BUDGET`,
  2 KB) SOUL/IDENTITY excerpt. Privacy: that prose goes to the configured
  provider — same trust level as asset enrichment.
- **Output** = zod-validated `{agentId, reason}`; an out-of-pool pick gets
  one fresh retry, then counts as transient.
- **Result contract** (`ResolveAssignmentResult`): `{ok:true, agentId,
  reason, model}` | `{ok:false, kind: 'transient'|'structural', message}`.
  Consumers classify by `kind`, never message text (house rule).

Config: the router model comes from the models routing matrix's
`'team-routing'` work-class row — the hook registration in
`plugins/team/index.ts` resolves it via `resolveSystemRoute('team-routing')`
and passes `{model, thinking, source}` into the resolver's deps. The full
`provider/model` id passes through to the runtime as a per-turn override —
ANY runtime-servable model routes; no route = **inherit** (the main agent's
default), exactly like every other system class. There is no provider
allowlist, no API-key lookup, and no default-model constant anymore.

## LLM transport — the runtime (no keys)

The routing call is an **ephemeral runtime turn** (the auto-title/enrichment
pattern), NOT a direct provider call: `runtime.messaging.send({ agentId:
mainAgentId, activityClass: 'system', ephemeral: true, threadId:
'task:<id>:route', ...route })`. The runtime's own credentials serve every
box — subscription-authenticated runtimes (Pi) need zero API keys. Every
send is metered via `meterAgentTurn` under `workClass: 'team-routing'`
(route receipts + `byWorkClass` spend intact). Reply handling: strip fences,
zod-parse; ONE corrective re-ask on the same thread covers malformed JSON
AND out-of-pool picks, then honest transient failure. Runtime failures map
by `RuntimeError.kind`: `not_found` → structural; every other kind →
transient (the dispatch ladder bounds retries). The old
`direct-text-provider.ts` is DELETED; `provider-keys.ts` survives only for
vision enrichment.

Gating: the pause/budget gates for the ROUTING CALL live at the
dispatch-team callers (`routingCallGated` — kill switch + `deferForBudget`
against the main agent with the route's model), OUTSIDE the failure ladder:
a paused system or budget freeze defers quietly and can never escalate a
team task to blocked.

## Dispatch integration

`src/core/dispatch-team.ts`. Resolution runs as a **pre-lock pre-pass**
(post-review R3): `resolveTeamAssignmentsPrePass` (cycle) /
`resolveTeamAssignmentForSingle` (kick) execute BEFORE `withStateLock`.
Round-3 concurrency shape: the pre-pass is **re-entrant-guarded** (a
force-released dispatch mutex cannot start a second billing pass), tasks
resolve **concurrently** (N slow routing calls cost one ~60s timeout, not
N), a **per-task in-flight set** keeps kicks and cycles off each other's
tasks, and a **stale-write guard** re-reads the task (id + COLUMN — must
still be in todo) before persisting so a slow result never overwrites a
re-assigned/dispatched/blocked task (returns `'stale'`, records nothing).
Round-4: the in-flight registry is a Map of promises — a racing kick JOINS
the in-flight resolution and proceeds when it lands, never silently
swallowed; the kick path applies the same eligibility gate (kicks bypass
availableAt like dispatch does; nothing bypasses an unmet EXISTING
dependency, and a dangling dependency target counts as satisfied,
mirroring isTaskDispatchEligible). Resolution is also **eligibility-gated**: a
task with a future `availableAt` or unmet `dependsOn` never bills the
router (the pick could go stale before the task fires). The locked loop
then only skips still-unresolved team tasks.

- ok → `recordTeamResolution` persists the pick **immediately** → the LLM
  bills at most once per successful task lifetime; task log line +
  `task.team_resolved` audit `{team, agent, reason, model}`.
- transient (provider hiccup, out-of-pool pick, throwing hook) → recorded
  in the SAME `failedDispatches` ladder as every other dispatch failure
  (post-review R2): transient cooldown between retries; at
  `dispatch.maxRetries` the PRE-PASS itself escalates to blocked
  (round-3: sessionDeath records are NOT exempt from pacing/escalation
  here — recording a resolution failure drops the stale sessionDeath
  context). Reason is task-logged ONCE (dedupe against the last log
  entry) + audited, including the throwing-hook path (post-review R8).
- structural (unknown team / empty pool / hook missing / runtime
  `not_found`) → task **blocked** with `Team routing failed: <reason>` +
  audit — never a silent fallback pick (matches the ledger/search
  fail-closed style).

Un-resolving: clearing the agent (`assignTask(id, '')`) returns a resolved
task to unresolved — the next dispatch re-resolves (one new LLM call).

## Surfaces (identical semantics everywhere)

Validation is ONE shared guard (post-review R10):
`validateTeamAssignment({assignee, team})` in `src/core/task-service.ts`
throws the typed `TaskValidationError` carrying a `code`
(`both_set` | `unknown_team` | `validation_unavailable`) — consumers
branch on instanceof + code, never message text. Mutual exclusion +
`team.exists` lookup, failing CLOSED when the team plugin/hook is
unavailable; routes map to 400 **by instanceof**.
`createTaskWithEffects` calls it internally — the tasks create route has
no duplicate pre-check (one `team.exists` round-trip per create). Round-4:
schedule validation lives in the job-service verbs (`createScheduleJob`,
now-async `updateScheduleJob`, `ensureBakinJob`, adopt handler) — surfaces
carry no guard copies; adopt treats `''` and `null` both as explicit
clears (only ABSENT preserves the existing value).

- **REST** `POST/PUT /api/plugins/tasks/` — `team` field. The PUT is a
  true PARTIAL update (post-review R1): only keys present in the body are
  forwarded, because `updateTask` clears on key presence — an omitted
  field never wipes stored team/agent. Clients clear explicitly with `''`;
  the task dialog sends assignment keys only when the picker changed.
- **MCP** `bakin_exec_tasks_create` / `_update` — `team` param.
- **CLI** `bakin tasks create <title> [agent] [--team=<id>]`.
- **UI** — `AgentSelect includeTeams` renders a Teams group; `team:<id>`
  is a UI-only value encoding via `TEAM_VALUE_PREFIX` /
  `isTeamValue` / `teamIdFromValue` from `@makinbakin/sdk/components`
  (the ONLY parsing — no hand-rolled prefix slicing; post-review R9);
  board cards show a team chip (violet, Users icon) until resolved, then
  avatar + chip; the detail form notes "Routed from team X".
- **Schedule** — `teamId` on job meta (mutex with `agentId`, validated at
  save AND in `ensureBakinJob` for the hook path — an input-provided side
  clears the other; post-review R5); `fire-engine.ts` passes `team` into
  `createTaskWithEffects`, so each occurrence re-resolves; `requireTriage`
  still wins. **Dangling team** (deleted after job creation): the fire
  creates the occurrence as a BLOCKED task with the
  `TEAM_ROUTING_BLOCK_REASON` sentinel (single-sourced in
  `src/core/dispatch-types.ts`; detail in the task log). Round-4: EVERY
  team-routing block uses this sentinel — dispatch-side resolver blocks and
  exhaustion included — so the outcome check excludes routing problems
  from auto-pause no matter where they were detected. A
  `validation_unavailable` error (team plugin momentarily down) defers:
  the occurrence keeps its team via createTaskWithEffects'
  INTERNAL `skipAssignmentValidation` flag (fire path only — API surfaces
  never set it) and dispatch re-checks honestly.
  Adopt (route + UI) and `bakin_exec_schedule_create`/`_update` carry
  `teamId` with the same exclusion + validation; `jobs-reader` merges
  `teamId` into the UI projection so edits round-trip it (round-3).
- **Team deletion** — `DELETE /teams/:teamId` refuses with 409 while
  ACTIVE tasks still reference the team (post-review R6).

- **Workflow steps (#611)** — a step's agent value may be `team:<teamId>`
  (same string as the AgentSelect UI encoding; steps store it verbatim).
  Token DSL: `@bakin/core/workflows/team-token`. Resolution is per-step at
  dispatch (`resolveTeamAssignmentForStep` in `src/core/dispatch-team.ts`)
  through the SAME hook: sticky pick persisted on the instance
  (`teamResolutions[stepId]`, first-write-wins via the
  `workflows.recordStepTeamResolution` hook — retries/revisions reuse it,
  the router bills at most once per step), structural failures block the
  PARENT task with the same sentinels, transient failures ride the
  failedDispatches ladder keyed `<contextTaskId>:<stepId>`.
  `resolveAgent(value, instance, stepId)` returns the sticky pick or passes
  the token through; `getCurrentStep` treats the token as the step identity
  pre-resolution (dispatch fetches step context with it), the member
  post-resolution — lane scoping stays honest on both sides. Validation:
  `validateDefinition` checks team existence via `knownTeamIds` (definition
  save + workflow start ask `team.exists`; unreachable team plugin = tiered
  pass, dispatch fails honestly) and bans hardcoded teams in plugin-shipped
  workflows. Editor: node-config drawer + parallel-children editor pass
  `includeTeams`; `AgentAssignmentLabel` renders `Team · <id>` chips.

## Doctor

`team.routing` (warn-only, local-only): active **unresolved** team tasks
(`team && !agent` — resolved tasks never re-invoke the router; post-review
R7) exist but the RUNTIME has no usable LLM credentials
(`credentialStatus().llmProviders` empty) — they will all fail resolution
at dispatch. Unreadable credential status reports Unknown, never healthy;
the healthy summary names the effective route model (or inherit).
`plugins/team/lib/health-checks.ts::checkTeamRouting`.

## Testing map

- `tests/core/task-store.test.ts` — exclusion semantics (team describe)
- `tests/plugins/team/assignment-resolver.test.ts` — pool/prompt/failures + runtime-transport shape (scripted mock runtime, injected meter — NO live calls)
- `tests/core/dispatch-team-resolution.test.ts` — helper + cycle wiring, sticky-resolution call-count
- `tests/core/dispatch-team-step.test.ts` — step resolution (#611): sticky record, block/ladder/exhaustion, pause gate, in-flight join
- `tests/plugins/workflows/team-step-token.test.ts` — token resolve/passthrough, instance lifecycle, validateDefinition team branch
- `tests/plugins/workflows/agent-assignment-label.test.tsx` — team chip rendering
- `tests/core/task-service.test.ts` — validateTeamRef fail-closed
- `tests/plugins/tasks/routes-rest.test.ts` / `exec-tools.test.ts` — surface validation
- `tests/plugins/schedule/routes-jobs.test.ts` / `blocked-fire-routing.test.ts` — schedule passthrough
- `tests/plugins/team/health-checks.test.ts` — routing readiness check (runtime credentials)

Gotcha for new tests: any module mock of `src/core/task-store` must export
`assignTaskToTeam` + `recordTeamResolution`, and team-plugin test files
that import the plugin graph need `purgeTaskRows` in execution-ledger
mocks (health-checks → task-store → ledger chain).
