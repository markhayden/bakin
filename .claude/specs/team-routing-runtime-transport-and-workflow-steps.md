# Team Routing: Runtime Transport + Workflow-Step Team Assignment (#611)

Status: APPROVED 2026-07-17 — implemented on feat/team-routing-runtime-transport
Date: 2026-07-17
Issues: fixes the live team-resolution failure; closes #611

## 1. Objective

Two workstreams, one branch:

**A — Fix team-assignment resolution.** Team-assigned tasks currently land in
the blocked column with `team routing failed — re-assign this task`. Root
cause (confirmed in audit trail + code): the resolver
(`plugins/team/lib/assignment-resolver.ts`) is the ONLY remaining call site
that makes a direct provider HTTP call requiring an API key from env/secret
store (`direct-text-provider.ts` + `provider-keys.ts`). This box (Pi runtime,
subscription auth) has no LLM API keys, and the configured `team-routing`
route (`openai-codex/gpt-5.4-mini`) isn't even a provider the direct
transport supports. Every other system class (auto-title, relay, enrichment,
send) rides the runtime adapter via `routeSendArgs`. Team routing adopts the
same pattern; the direct-text transport is deleted.

**B — Workflow-step team assignment (#611).** Let a workflow step declare a
team target via a `team:<id>` token in the existing agent-string DSL,
resolved per-step at dispatch through the same `team.resolveAssignment`
hook, sticky once resolved, honest structural blocks.

Single user, no backwards compatibility, priority = tech-debt reduction.

## 2. Decisions (interview, 2026-07-17)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Resolver transport | **Runtime ephemeral send** (auto-title/enrichment pattern); delete `direct-text-provider.ts`. `provider-keys.ts` STAYS — vision-enrichment consumers (`direct-vision-provider.ts`, `vision-models.ts`, `enrichment/providers.ts`). |
| 2 | Delivery | **One branch, phased commits** as rollback checkpoints; live-test on 3737, merge on approval. |
| 3 | Step schema | **`team:<id>` token** in the existing `agent` string DSL (alongside `$assigned`, `$preferred`). No new step field. |
| 4 | Stickiness | **Sticky once resolved**, persisted per-step on the workflow instance. Revisions/retries return to the same agent. Re-route only via human re-assign. |
| 5 | UI scope | **AgentSelect "Teams" group + honest chips** (unresolved `team · <id>` chip → resolved agent once routed). No `$preferred` interplay. |

### Standing assumptions (veto if wrong)

- The routing call uses the **main agent** identity (`getRuntimeMainAgentId`)
  with the route's model override — the established fallback for system
  calls with no natural agent (`dispatch-cycle.ts:206`).
- The call is **budget-gated like auto-title** (`dispatchPaused` +
  `budgetGate`); a gated call is a *transient* deferral, never a block.
- The call is **metered** via `meterAgentTurn` with `workClass:
  'team-routing'` — route receipts keep working; `byWorkClass` spend facet
  unchanged.
- Runtime send failures classify by `RuntimeError.kind` (never message
  text — architecture rule): auth/not-found ⇒ structural; timeout/network ⇒
  transient.
- "No route configured" ⇒ `inherit` (main-agent default model) — the
  hardcoded `DEFAULT_ROUTING_PROVIDER/MODEL` (anthropic/haiku) constants
  die with the transport. Matches every other system class.
- The `team.routing` doctor check drops key-presence probing; it now checks
  route validity + runtime readiness (`credentialStatus`).
- Existing blocked tasks (e.g. `3567c99c`) are re-assigned manually after
  the fix ships — no auto-unblock sweep.
- Spec lives in `.claude/specs/` (repo convention) rather than root
  `SPEC.md`.

## 3. Workstream A — runtime transport

### Current flow (what changes)

`plugins/team/index.ts:303-315` registers `team.resolveAssignment` →
`resolveTeamAssignment()` parses the route model (`parseRoutedModel`,
anthropic/openai/google only), resolves an API key (`provider-keys.ts`),
calls `callDirectTextProvider`, validates the pick (zod + in-pool, one
retry).

### New flow

1. Route via `resolveSystemRoute('team-routing')` (unchanged).
2. Gate: `dispatchPaused` → skip (transient); `budgetGate(mainAgentId)`
   defer → transient `{ok:false, kind:'transient', message:'budget gate deferred'}`.
3. Send: `runtime.messaging.send({ agentId: mainAgentId, activityClass:
   'system', ephemeral: true, threadId: 'task:<taskId>:route',
   ...routeSendArgs(route), content: <routing prompt> })`.
   Deterministic thread id per task ⇒ idempotent replays land on one thread.
4. Meter: `meterAgentTurn({ runId: 'task:<taskId>:route', agent:
   mainAgentId, activityClass: 'system', workClass: 'team-routing',
   routeSource, resolvedModel, result, name: 'team-routing' })`.
5. Parse reply (existing zod schema + fence-stripping), validate pick in
   pool, ONE corrective re-ask on the same thread (enrichment pattern),
   then honest failure.
6. Error mapping: `RuntimeError.kind` → structural/transient; unknown
   throws → transient (unchanged contract:
   `{ok:true, agentId, reason, model} | {ok:false, kind, message}`).

### Deletions / simplifications

- `packages/core/src/llm/direct-text-provider.ts` — DELETE (sole consumer).
- `parseRoutedModel` + provider allowlist + `DEFAULT_ROUTING_PROVIDER/MODEL`
  in `assignment-resolver.ts` — DELETE. The full `provider/model` id passes
  through to the runtime; any runtime-supported model works.
- `provider-keys` import in `plugins/team/lib/health-checks.ts` — replaced
  by the reworked check.
- Structural message `No API key configured for routing provider …` and
  `…supports anthropic/openai/google direct calls…` — GONE (the failure
  modes no longer exist).

### Unchanged

`src/core/dispatch-team.ts` semantics (pre-pass, ladder, sentinels,
stale-write guard, `recordTeamResolution`, audit events), the hook contract,
pool construction (members ∩ roster), the routing prompt, task-store
exclusion semantics.

## 4. Workstream B — workflow-step team assignment (#611)

### Token

`agent: 'team:<teamId>'` on any agent-bearing step. Validation at
definition-save time via the existing `team.exists` hook (same write-time
check tasks get).

### Resolution

- Instance gains `teamResolutions?: Record<stepId, { agentId, team, reason,
  at }>` (typed in `plugins/workflows/types.ts`).
- `resolveAgent` (`plugins/workflows/lib/step-context.ts`) recognizes the
  token: resolved entry in `instance.teamResolutions[stepId]` → that
  agentId; else the token passes through (step is "unresolved").
- `dispatchWorkflowTask` (`src/core/dispatch-workflow.ts`): before firing a
  step whose resolved agent is still a `team:` token, invoke
  `team.resolveAssignment` (shared resolver, per-step), persist the sticky
  resolution on the instance, audit `task.team_resolved` with `{ id, stepId,
  team, agent, reason }`, then dispatch to the resolved agent.
  - Structural failure ⇒ block the parent task with the existing
    `TEAM_ROUTING_BLOCK_REASON` sentinel + `Team routing failed: <msg>` log
    line (issue acceptance: honest block, no silent fallback).
  - Transient ⇒ skip this cycle; existing failedDispatches ladder counts;
    exhaustion ⇒ `TEAM_ROUTING_EXHAUSTED_REASON` (same as task-level).
- Engine "stay in your lane" validation (`engine.ts:363-365`) and
  step-scoped surfaces compare against the resolved agent.
- `$assigned` semantics untouched; `$preferred(...)` does NOT accept team
  tokens (out of scope by decision 5).
- Task-level team assignment on a workflow-backed task is already handled
  by the #189 pre-pass (owner resolution) — unchanged; `$assigned` steps
  follow the resolved owner as today.

### UI

- `plugins/workflows/components/AgentSelect.tsx` (+ canvas editor state):
  "Teams" option group emitting `team:<id>` values.
- Step/board rendering: unresolved team step shows a distinct `team ·
  <teamId>` chip; once resolved, the resolved agent (resolution map comes
  along wherever the instance is already fetched).
- `task-bridge.ts` unrenderable-agent handling extended to render the token
  honestly.

## 5. Commit strategy (rollback checkpoints — every commit green)

1. `refactor(team): route team-assignment resolution through the runtime`
   — resolver rewrite (ephemeral send + gates + metering + RuntimeError
   classification), hook registration passes mainAgentId dep, resolver unit
   tests rewritten against a mock runtime. Fixes the live bug by itself.
2. `refactor(core): delete the direct-text LLM transport`
   — delete `direct-text-provider.ts` + dead resolver helpers; rework the
   `team.routing` doctor check (route validity + runtime readiness);
   health-check tests updated.
3. `feat(workflows): team:<id> step token with sticky per-step resolution`
   — types, `resolveAgent` recognizer, instance persistence,
   `dispatch-workflow` resolution + block/ladder wiring, `team.exists`
   validation at definition save, backend tests.
4. `feat(workflows): team targets in the canvas editor`
   — AgentSelect Teams group, editor state, honest chips, component tests.
5. `docs(knowledge): team routing rides the runtime; workflow-step teams`
   — knowledge + CLAUDE.md + reference-doc sweep (§7).

## 6. Testing strategy

- **Unit:** resolver against a mock runtime (ok / structural / transient /
  malformed-reply + corrective re-ask / out-of-pool pick / budget-gate
  defer / paused); step-context token resolution (unresolved passthrough,
  resolved map hit, `$assigned` untouched); dispatch-workflow team-step
  resolution (sticky persistence, structural block, transient skip+ladder,
  audit payloads); doctor check states.
- **Standing rules honored:** content-dir + OpenClaw-home mocks, `--isolate`,
  no error-message-text classification (kinds only), prompt byte-fixtures
  must not drift (dispatch prompt untouched — assert fixture suite green).
- **Full suite:** `bun run test` green at every commit.
- **Live:** `/verify` isolated server — create a team task end-to-end
  (todo → resolved → dispatched) and a `team:` step workflow; then Mark
  tests on 3737 (branch served from main checkout) before merge.

## 7. Docs impact (sweep in commit 5)

- `.claude/knowledge/team-aware-assignment.md` — transport section rewritten
  (runtime send, no keys, provider-restriction gone, defaults gone);
  workflow-step section moves from "deferred" to implemented.
- `.claude/knowledge/workflows-plugin.md` — step token + resolution
  lifecycle.
- `.claude/knowledge/models-plugin.md` — team-routing no longer a
  direct-call exception; any runtime model routable.
- `CLAUDE.md` — Dispatch bullet's team-assignment sentence + testing note if
  needed (small).
- `docs/src/content/docs/**` reference docs — regenerate if team/workflow
  reference pages exist (`docs(generated)` convention).
- README — checked; no team-routing content expected (verify during sweep).
- Issue #611 closed by the PR; PR body notes the live-bug fix.

## 8. Acceptance criteria

1. On this box (zero LLM API keys, Pi runtime), a task assigned
   `team: builders` resolves to a member at dispatch, is audited
   (`task.team_resolved`), dispatches, and never enters blocked for
   key/provider reasons.
2. The `team-routing` route `openai-codex/gpt-5.4-mini` is honored as a
   per-turn model override on the routing call; no route ⇒ inherit.
3. Routing spend appears under `byWorkClass: team-routing` with a route
   receipt (`route_source` correct).
4. `direct-text-provider.ts` is gone; `provider-keys.ts` remains solely for
   vision enrichment; no source references to the deleted transport.
5. A workflow step `agent: 'team:builders'` resolves per-step at dispatch,
   audited with requested team + resolved agent + reason + stepId; the
   resolution is sticky across gate rejections/retries.
6. Structural step-resolution failures block the parent task with the
   existing sentinel + task-log detail; transient failures ride the ladder;
   exhaustion escalates exactly like task-level routing.
7. Direct-agent and `$assigned` step behavior byte-identical (prompt
   fixtures + existing tests untouched and green).
8. Canvas editor offers team targets; unresolved team steps render a
   distinct chip; resolved steps show the agent.
9. `bun run test` green; doctor `team.routing` reports honestly on a
   key-less box (no false warning).

## 9. Boundaries

- **Always:** classify by typed kinds, never message text; audit every
  resolution outcome; honest blocks over silent fallbacks; mock content-dir
  + OpenClaw home in every test.
- **Ask first:** any change to the hook contract shape consumed by other
  plugins; touching dispatch prompt bytes; anything that would alter task
  board semantics beyond the described block paths.
- **Never:** parallel routing config or spend math; fabricated model
  metadata; `$preferred` team interplay (explicitly out of scope); shims or
  compatibility layers for the deleted transport.
