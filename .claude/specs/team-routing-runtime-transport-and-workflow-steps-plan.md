# Plan: Team Routing Runtime Transport + Workflow-Step Teams (#611)

Spec: `.claude/specs/team-routing-runtime-transport-and-workflow-steps.md` (approved 2026-07-17)
Branch: `feat/team-routing-runtime-transport` (in the MAIN checkout — 3737 serves it; Mark live-tests before merge)

## Dependency graph

```
P1 resolver transport ──► P2 delete transport + doctor ──► P5 docs
        │
        └──► P3 workflow-step token (needs working resolver) ──► P4 editor UI ──► P5 docs
```

P1 alone fixes the live bug. P2 depends on P1 (last consumer gone). P3 reuses
the P1 resolver via the same hook. P4 is presentation over P3. P5 sweeps docs
for everything.

## Grounding facts (verified in code, 2026-07-17)

- `resolveTeamAssignment` (`plugins/team/lib/assignment-resolver.ts:151`) is
  the only `callDirectTextProvider` consumer; `provider-keys.ts` is ALSO used
  by vision enrichment (`direct-vision-provider.ts`, `vision-models.ts`,
  `enrichment/providers.ts`) and by `checkTeamRouting` — it stays.
- Runtime send pattern to copy: `plugins/chat/lib/auto-title.ts:39-108`
  (gates → `messaging.send({ephemeral, threadId, ...routeSendArgs})` →
  `meterAgentTurn`); corrective re-ask pattern:
  `plugins/assets/lib/enrichment/runtime.ts:131-199` (stripFences + one
  re-ask on the same thread).
- `RuntimeErrorKind` (`packages/core/src/adapters/runtime/errors.ts:11-33`):
  `transport | timeout | session_death | provider_cooldown | runtime_failed |
  aborted | not_found`. Mock runtime for tests:
  `packages/core/src/adapters/runtime/testing.ts`.
- Main-agent helper: `getRuntimeMainAgentId` from
  `@bakin/core/adapters/runtime` (used at `dispatch-cycle.ts:70`).
- Dispatch integration (`src/core/dispatch-team.ts`) is transport-agnostic —
  pre-pass, ladder, sentinels, stale-guard all UNCHANGED by P1.
- Step agent DSL: `resolveAgent` (`plugins/workflows/lib/step-context.ts:26`),
  owner scoping (`engine.ts:363-365`), instance type
  (`plugins/workflows/types.ts:158-177` — gains `teamResolutions`).
- UI: `AgentSelect` (`src/components/agent-select.tsx`) ALREADY emits
  `team:<id>` via `includeTeams` (#189) — `TEAM_VALUE_PREFIX = 'team:'`.
  Workflow drawer instantiates it WITHOUT `includeTeams`
  (`node-config-drawer.tsx:512-527`); token rendering lives in
  `nodes/agent-assignment-label.tsx`.

---

## Phase 1 — resolver rides the runtime (commit 1)

> `refactor(team): route team-assignment resolution through the runtime`
> Fixes the live bug by itself. Rollback point: revert restores direct-call
> behavior (still broken on this box, but inert).

**T1.1 Rewrite `resolveTeamAssignment`** (`plugins/team/lib/assignment-resolver.ts`)
- Drop deps `transport`/`keySource`; add `mainAgentId: string` (or async
  getter) to `ResolverDeps`. Keep `runtime`, `route`, `readTeams`,
  `getTeamMembers`, `getStatus` injectables.
- Order: team-exists check → pool build (unchanged) → gates
  (`dispatchPaused` → transient skip; `budgetGate(mainAgentId)` defer →
  transient) → send.
- Send: `runtime.messaging.send({ agentId: mainAgentId, activityClass:
  'system', ephemeral: true, threadId: 'task:<taskId>:route',
  ...routeSendArgs(route), content: SYSTEM_PROMPT + buildPrompt(...) })`.
- Parse: stripFences + `PickSchema.safeParse`. Malformed → ONE corrective
  re-ask on the same thread. Out-of-pool pick → one fresh re-ask (preserve
  existing semantics), then transient failure.
- Meter EVERY send: `meterAgentTurn({ runId: threadId, agent: mainAgentId,
  activityClass: 'system', workClass: 'team-routing', routeSource:
  route.source, resolvedModel: route.model, result, name: 'team-routing' })`.
- Error mapping: `RuntimeError.kind === 'not_found'` → structural (main
  agent/entity missing); every other kind → transient (ladder bounds
  retries). Non-RuntimeError throw → transient (unchanged).
- DELETE: `parseRoutedModel`, `DIRECT_PROVIDERS`,
  `DEFAULT_ROUTING_PROVIDER/MODEL`, `Transport` type, provider-keys import.
  `ok.model` becomes `route.model ?? 'inherit'`.
- Result contract `{ok...}` shape UNCHANGED (dispatch + #611 both consume it).

**T1.2 Hook registration** (`plugins/team/index.ts:303-315`)
- Resolve `mainAgentId` via `getRuntimeMainAgentId(ctx.runtime)` inside the
  handler (per-invoke — roster can change); pass to deps.

**T1.3 Tests** (`tests/plugins/team/assignment-resolver*.test.ts` + any
dispatch-team tests asserting deleted messages)
- Rewrite against the mock runtime (`adapters/runtime/testing.ts`):
  ok pick / malformed-then-corrected / out-of-pool retry / out-of-pool twice
  → transient / RuntimeError not_found → structural / RuntimeError timeout →
  transient / paused → transient / budget defer → transient / unknown team →
  structural / empty pool → structural. Assert metering via injectable or
  module mock. Standard content-dir + openclaw-home mocks.

**Acceptance / verification**
- [ ] No `provider-keys` or `direct-text-provider` import in the resolver
- [ ] `bun test tests/plugins/team/ tests/core/dispatch-team* --isolate` green
- [ ] `bun run test` green; `bun run check:cycles` green (system-route import
      stays lazy — #696 lesson)
- [ ] CHECKPOINT: commit 1

## Phase 2 — delete the dead transport + doctor rework (commit 2)

> `refactor(core): delete the direct-text LLM transport`

**T2.1 Delete** `packages/core/src/llm/direct-text-provider.ts` (+ its test
file). Grep-verify zero references (`callDirectTextProvider`,
`DirectTextError`).

**T2.2 Rework `checkTeamRouting`** (`plugins/team/lib/health-checks.ts:41-97`)
- Drop `routingProvider`/`keySource` opts + provider-keys import.
- Demand-driven shape stays (unresolved team tasks count). When demand > 0:
  hook registered? route resolvable? runtime `credentialStatus()` ok? →
  healthy with evidence `{unresolvedTasks, model: route.model ?? 'inherit'}`;
  otherwise error incident pointing at the actual missing leg (runtime
  credentials / models routing), not a key.
- Update registration call site (`plugins/team/index.ts:752-763`) — drop the
  route-model probe it currently feeds as `routingProvider`.

**T2.3 Tests**: health-check tests for the new legs; delete key-based cases.

**Acceptance / verification**
- [ ] `grep -r "direct-text-provider\|DirectTextError\|callDirectTextProvider"` → only knowledge/spec docs (updated in P5)
- [ ] `provider-keys.ts` still compiles with vision consumers only
- [ ] `bun run test` green; typecheck green
- [ ] CHECKPOINT: commit 2 — live-bug fix COMPLETE; optional early `/verify` smoke: team task resolves end-to-end on a key-less isolated server

## Phase 3 — workflow-step team token (commit 3)

> `feat(workflows): team:<id> step token with sticky per-step resolution`

**T3.1 Types** (`plugins/workflows/types.ts`)
- `WorkflowInstance.teamResolutions?: Record<string, { agentId: string;
  team: string; reason: string; at: string }>` (keyed by stepId).
- Shared token helpers (mirror `TEAM_VALUE_PREFIX`): `isTeamToken`,
  `teamIdFromToken` in workflows lib (steps store the token; tasks don't —
  update the agent-select comment in P4).

**T3.2 Resolution read-path** (`plugins/workflows/lib/step-context.ts`)
- `resolveAgent`: `team:` token → `instance.teamResolutions?.[stepId]?.agentId
  ?? token`. NOTE: needs the stepId — extend signature (callers all pass the
  step or its id; `$assigned`/`$preferred` behavior untouched).
- `getActiveAgents`: token entries ARE returned (unresolved marker) so
  dispatch can resolve them; audit every consumer of the returned agent
  string (engine lane check, board bridge) for token safety.
- Engine lane check (`engine.ts:363-365`): resolved step compares the
  concrete agent; unresolved token never matches a caller → correct
  rejection.

**T3.3 Save-time validation**
- Definition save/validation path (parser / engine validate + the drawer's
  `workflow-dialog-validation.ts`): a `team:<id>` value is valid only if the
  team exists (`team.exists` hook server-side); nonexistent team = save
  error, mirroring task-side write validation.

**T3.4 Dispatch integration** (`src/core/dispatch-workflow.ts` +
`src/core/dispatch-team.ts`)
- In `dispatchWorkflowTask`, per active agent whose value is a team token:
  - Ladder gate first (reuse `ladderGate` semantics; failure key
    `${contextTaskId}:${stepId}` in `failedDispatches` — additive, no
    collision with task-level records).
  - Invoke `team.resolveAssignment` with `{ teamId, task: { id:
    contextTaskId, title: '<task.title> — step: <label>', description:
    step instructions } }` via a new exported
    `resolveTeamAssignmentForStep(...)` in dispatch-team (reuses
    resolveShared-style in-flight dedupe keyed by `taskId:stepId`).
  - ok → invoke new hook `workflows.recordStepTeamResolution` `{ taskId,
    stepId, agentId, team, reason }` (instance-store write, hook registered
    in `plugins/workflows/index.ts`), audit `task.team_resolved` `{ id,
    stepId, team, agent, reason, model }`, task-log
    `Routed step "<label>" to <agent> (team <team>): <reason>`, then dispatch
    this cycle with the resolved agent.
  - structural → `blockTask(task.id, TEAM_ROUTING_BLOCK_REASON)` + audit +
    task-log detail (issue acceptance: honest block).
  - transient → skip step this cycle, ladder count; exhausted →
    `TEAM_ROUTING_EXHAUSTED_REASON` block (same escalation copy).
- Owner-move (`dispatch-workflow.ts:65`): a still-unresolved token must
  never become `ownerAgent` — fall through to `mainAgentId`.

**T3.5 Tests**
- step-context: token unresolved passthrough / resolved map hit / $assigned
  + $preferred untouched / lane check with resolved token.
- dispatch-workflow (mock hook registry + mock runtime): resolve-then-
  dispatch, sticky reuse on re-dispatch (no second hook call), structural
  block, transient skip + ladder + exhaustion, stale/deleted instance safety.
- Save validation: unknown team rejected, known team accepted.
- Prompt fixtures: `tests/fixtures/dispatch-prompts/` byte-identical.

**Acceptance / verification**
- [ ] Direct/$assigned step behavior byte-identical (fixtures + existing tests untouched)
- [ ] `bun run test` green
- [ ] CHECKPOINT: commit 3

## Phase 4 — editor UI (commit 4)

> `feat(workflows): team targets in the canvas editor`

**T4.1** `node-config-drawer.tsx` agent field: add `includeTeams` (and keep
`includeAssigned`). Confirm the field's save path stores the raw select
value (it does — string field).
**T4.2** `nodes/agent-assignment-label.tsx`: render `team:<id>` → Users icon
+ team label ('Team · <id>', resolved agent shown when the instance has a
resolution — label component stays instance-agnostic; the step-detail
drawer, which has the instance, shows the resolved agent line).
**T4.3** `src/components/agent-select.tsx`: update the "never stored"
comment (workflow step definitions DO store the token).
**T4.4** Step detail drawer: when instance.teamResolutions has the step,
show resolved agent + reason (read-only line, no new panel — ConfirmDialog
rule untouched).
**T4.5** Component tests with rtl-settle (`import '<rel>/rtl-settle'`,
final `await settleReact()` where fetch-race applies).

**Acceptance / verification**
- [ ] Canvas: picking a team stores `team:<id>`; chip renders distinctly; no hard navigation introduced
- [ ] `bun run test` green
- [ ] CHECKPOINT: commit 4

## Phase 5 — docs sweep (commit 5)

> `docs(knowledge): team routing rides the runtime; workflow-step teams`

**T5.1** `.claude/knowledge/team-aware-assignment.md` — transport section
(runtime ephemeral send, gates, metering, kind-mapping; keys/providers gone;
defaults gone → inherit), workflow-step section: deferred → implemented.
**T5.2** `.claude/knowledge/workflows-plugin.md` — token, teamResolutions,
dispatch lifecycle, validation.
**T5.3** `.claude/knowledge/models-plugin.md` — team-routing note (any
runtime model routable; no direct-call exception).
**T5.4** `CLAUDE.md` — Dispatch bullet team sentence; nothing else expected.
**T5.5** README + `docs/src/content/docs/**` — verify/regenerate reference
docs if team/workflow pages exist (`docs(generated)` convention).
**T5.6** Bump workflows + team plugin manifest versions (bits-convention:
patch/minor per size — minor here).

**Acceptance / verification**
- [ ] `grep -ri 'direct.text\|routing provider.*key' .claude/knowledge CLAUDE.md` → no stale claims
- [ ] CHECKPOINT: commit 5

## Final verification (before handing to Mark)

1. `bun run test` (full, `--isolate`) green; `bun run check:cycles` green.
2. `/verify` isolated server, zero LLM keys in env:
   - Team task: create → pre-pass resolves → `task.team_resolved` audit →
     dispatched to member (mock/pi runtime).
   - Workflow with `agent: 'team:<id>'` step: resolves at step dispatch,
     sticky across a gate rejection, structural block on unknown-team.
   - `bakin spend` shows `team-routing` work-class rows.
   - Doctor `team.routing` healthy on the key-less box.
3. Branch served on 3737 (restart server — server-code changes need it),
   Mark live-tests, merge on approval. Then: re-assign the stranded blocked
   task `3567c99c`.

## Rollback map

| Symptom | Roll back to |
|---|---|
| Routing calls misbehave on runtime transport | revert commit 1 (+2) |
| Doctor false-positives | revert commit 2 |
| Workflow dispatch regression | revert commit 3 (+4) |
| Editor issues only | revert commit 4 |
