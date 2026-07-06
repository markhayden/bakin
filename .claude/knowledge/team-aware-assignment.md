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

Config: team plugin settings `routingProvider` (anthropic|openai|google) +
`routingModel` (default `claude-haiku-4-5-20251001`). Keys resolve env →
secret store via `resolveProviderKeySource`.

## LLM transport

`packages/core/src/llm/direct-text-provider.ts` — text sibling of the
vision transport: structured JSON out, one malformed-output retry, errors
typed `DirectTextError{kind}` (401/4xx structural; 408/429/5xx/network
transient). Shared key resolution in `packages/core/src/llm/provider-keys.ts`
(extracted from the vision provider; assets enrichment imports it too).
Fetch-injectable; NO live calls in tests.

## Dispatch integration

`src/core/dispatch-team.ts` (`resolveTeamAssignmentForDispatch`), invoked
by BOTH `dispatch-cycle.ts` and `dispatch-single.ts` when
`task.team && !task.agent`, BEFORE the workflow branch and the
concurrency/budget/claim sequence (so workflow tasks with a team also
resolve first, and no ledger run is claimed for an unresolvable task).

- ok → `recordTeamResolution` persists the pick **immediately** → the LLM
  bills at most once per task lifetime (retries/re-dispatches see a plain
  agent task); task log line + `task.team_resolved` audit
  `{team, agent, reason, model}`.
- transient → skip this cycle, retried next tick; the failure reason is
  task-logged ONCE (dedupe against the last log entry) + audited.
- structural (no key / unknown team / empty pool / hook missing) → task
  **blocked** with `Team routing failed: <reason>` + audit — never a
  silent fallback pick (matches the ledger/search fail-closed style).

Un-resolving: clearing the agent (`assignTask(id, '')`) returns a resolved
task to unresolved — the next dispatch re-resolves (one new LLM call).

## Surfaces (identical semantics everywhere)

- **REST** `POST/PUT /api/plugins/tasks/` — `team` field; 400 on both-set
  or unknown team (validated via `validateTeamRef` in
  `src/core/task-service.ts`, which fails CLOSED when the team plugin/hook
  is unavailable).
- **MCP** `bakin_exec_tasks_create` / `_update` — `team` param.
- **CLI** `bakin tasks create <title> [agent] [--team=<id>]`.
- **UI** — `AgentSelect includeTeams` renders a Teams group; `team:<id>`
  is a UI-only value encoding (helpers `isTeamValue`/`teamIdFromValue`
  exported from `@makinbakin/sdk/components`); board cards show a team
  chip (violet, Users icon) until resolved, then avatar + chip; the detail
  form notes "Routed from team X".
- **Schedule** — `teamId` on job meta (mutex with `agentId`, validated at
  save); `fire-engine.ts` passes `team` into `createTaskWithEffects`, so
  each occurrence re-resolves; `requireTriage` still wins (task created
  unassigned).

Workflow steps are explicitly deferred — the follow-up issue consumes the
same `team.resolveAssignment` hook.

## Doctor

`team.routing` (warn-only, local-only): active team-assigned tasks exist
but no key resolves for the configured routing provider — they will all
block at dispatch. `plugins/team/lib/health-checks.ts::checkTeamRouting`.

## Testing map

- `tests/core/task-store.test.ts` — exclusion semantics (team describe)
- `tests/core/direct-text-provider.test.ts` — transport shapes/retry/kinds
- `tests/plugins/team/assignment-resolver.test.ts` — pool/prompt/failures (DI, mocked transport)
- `tests/core/dispatch-team-resolution.test.ts` — helper + cycle wiring, sticky-resolution call-count
- `tests/core/task-service.test.ts` — validateTeamRef fail-closed
- `tests/plugins/tasks/routes-rest.test.ts` / `exec-tools.test.ts` — surface validation
- `tests/plugins/schedule/routes-jobs.test.ts` / `blocked-fire-routing.test.ts` — schedule passthrough
- `tests/plugins/team/health-checks.test.ts` — routing readiness check

Gotcha for new tests: any module mock of `src/core/task-store` must export
`assignTaskToTeam` + `recordTeamResolution`, and team-plugin test files
that import the plugin graph need `purgeTaskRows` in execution-ledger
mocks (health-checks → task-store → ledger chain).
