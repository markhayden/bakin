# Implementation Plan: Team-Aware Task Assignment (issue #189)

**Spec:** `team-aware-assignment.md` (approved 2026-07-05)
**Branch:** `feat/189-team-assignment`

## Overview

Add `team` assignment to tasks; the team plugin resolves team → best-suited
member via a cheap LLM call at dispatch time, behind a typed
`team.resolveAssignment` hook. Nine tasks in five phases, bottom-up along the
dependency graph; each task is one commit, each commit leaves the suite green
— every commit is a rollback checkpoint.

## Dependency Graph

```
T1 core task model (team field + exclusion)
T2 core text-LLM transport (+ shared key helper)
        │
T3 team plugin resolver hook + routing settings   (needs T2; T1 for types)
        │
T4 dispatch integration (resolve → write → claim) (needs T1 + T3 contract)
        │
T5 tasks surfaces: REST + MCP + CLI               (needs T1; T3 for validation)
T6 tasks UI: picker + board/detail                (needs T5 route shape)
T7 schedule passthrough                           (needs T5 semantics)
        │
T8 doctor check                                    (needs T3 settings)
T9 docs + manifest bumps                           (last)
```

## Architecture Decisions (carried from spec)

- Resolution is team-plugin-owned (`team.resolveAssignment` via HookRegistry
  `invoke<R>()`; `has()` gates structural absence). Dispatch classifies
  results by typed `kind`, never message text.
- Resolution runs in dispatch BEFORE the concurrency gate and ledger claim;
  the resolved agent is persisted to the store first, so every retry path
  (cycle re-scan, single, recovery) sees a plain agent task afterward —
  exactly-once LLM spend without touching the ledger.
- New transport `packages/core/src/llm/direct-text-provider.ts`; the
  env→secret-store key resolution generalizes out of
  `direct-vision-provider.ts` into a shared module both import.

---

## Task List

### Phase 1 — Foundation (core)

#### T1: `team` field + mutual exclusion in the task model
**Description:** Add `team?: string` to `BakinTask`, `BakinTaskCreate`,
`BakinTaskPatch`, and the board `Task` view. Enforce mutual exclusion in the
store write paths: a patch/create setting `agent` clears `team` and vice
versa. Extend `createTask(...)`/`updateTask`/`assignTask` in
`src/core/task-store.ts` (assignTask clears `team`).
**Acceptance:**
- [ ] `createSync({team})` persists team; setting both throws
- [ ] `updateSync(id, {agent})` on a team task clears `team`; `{team}` clears `agent`
- [ ] Board view (`taskToView`) exposes `team`
**Verify:** new `tests/core/task-store-team.test.ts` + existing task-store tests green; `bun run test`
**Files:** `packages/core/src/tasks/store.ts`, `src/core/task-store.ts`, `src/core/task-types.ts` (view type), test file
**Scope:** M
**Commit:** `feat(core): add team assignment field to task model with agent/team mutual exclusion`

#### T2: Direct text-LLM transport + shared key resolution
**Description:** Extract `resolveVisionProviderKeySource` +
`VISION_PROVIDER_ENV_VARS` into `packages/core/src/llm/provider-keys.ts`
(generic names: `DirectProviderId`, `resolveProviderKeySource`); vision
provider imports from there (clean rename, no re-export shim — single-user
repo). Add `packages/core/src/llm/direct-text-provider.ts`:
`callDirectTextProvider({provider, model, apiKey, system, prompt, schema})`
→ zod-parsed JSON, one malformed-output retry, typed errors
(`{kind: 'transient'|'structural'}`).
**Acceptance:**
- [ ] Anthropic/OpenAI/Google request shapes correct (mocked fetch asserts URL/headers/body)
- [ ] Malformed JSON → one retry → transient error; HTTP 401 → structural; 5xx/timeout → transient
- [ ] Vision provider still green after key-helper extraction
**Verify:** new `tests/core/direct-text-provider.test.ts`; existing vision/enrichment tests; `bun run test`
**Files:** `packages/core/src/llm/provider-keys.ts` (new), `packages/core/src/llm/direct-text-provider.ts` (new), `packages/core/src/media/direct-vision-provider.ts`, test file
**Scope:** M
**Commit:** `feat(core): direct text-LLM transport with shared provider key resolution`

### ✅ Checkpoint A (after T1–T2)
Suite green; no behavior change anywhere user-visible. Rollback = revert 2 commits.

### Phase 2 — Resolver (team plugin)

#### T3: `team.resolveAssignment` hook + routing settings
**Description:** New `plugins/team/lib/assignment-resolver.ts`: pool assembly
(members via `displaySettings[].teamId` ∩ runtime roster), per-member profile
(id, name, role, model, status, in-flight count, ~2KB SOUL/identity excerpt
via existing profile reader), prompt build, `callDirectTextProvider` call,
out-of-pool retry, typed `ResolveAssignmentResult`. Register hook in
`activate()`; add "Task routing" `settingsSchema` section (provider/model,
defaults anthropic + `claude-haiku-4-5-20251001`). Also register a tiny
`team.exists` hook (teamId → boolean) for write-time validation consumers.
Result contract in `plugins/team/types.ts` (spec §Code Style).
**Acceptance:**
- [ ] Happy path returns `{ok:true, agentId, reason, model}` with in-pool agent (mocked transport)
- [ ] No key → `{ok:false, kind:'structural'}`; empty pool → structural; transport transient → transient; out-of-pool id twice → transient
- [ ] Prompt byte budget enforced (oversized SOUL truncated, marker visible)
**Verify:** `tests/plugins/team/assignment-resolver.test.ts` via `tests/plugins/test-helpers.ts`, transport mocked; `bun run test`
**Files:** `plugins/team/lib/assignment-resolver.ts` (new), `plugins/team/index.ts`, `plugins/team/types.ts`, test file
**Scope:** M
**Commit:** `feat(team): LLM assignment resolver behind team.resolveAssignment hook`

### Phase 3 — Dispatch integration

#### T4: Resolve team tasks in dispatch, before claim
**Description:** Extend `DispatchTask` with `team?`. In `dispatch-cycle.ts`
and `dispatch-single.ts`, when `task.team && !task.agent`: invoke
`team.resolveAssignment` (via `getHookRegistry()`); on `ok` → persist
`updateStoredTask(id, {agent})` + task log + `task.team_resolved` audit, then
continue into the existing `targetAgent` flow; transient failure → task log
reason + `task.team_resolution_failed` audit + skip this cycle; structural
failure (incl. hook absent) → `blockStoredTask` with clear reason + audit.
`isTaskDispatchEligible` gains no new gate (resolution is inline); the
`task.agent && !roster.has()` gate stays as-is for the resolved id.
**Acceptance:**
- [ ] Team task dispatches to resolver's pick; `team` retained, `agent` persisted; audit + log entries present
- [ ] Transient → skipped with reason, retried next cycle; resolver invoked exactly once after success (call-count assert)
- [ ] Structural / hook-missing → blocked with `blockedReason`
- [ ] Direct-agent tasks: zero behavior change (existing dispatch tests untouched and green)
**Verify:** `tests/core/dispatch-team-resolution.test.ts` (mocked hook registry + runtime); full `bun run test`
**Files:** `src/core/dispatch-types.ts`, `src/core/dispatch-cycle.ts`, `src/core/dispatch-single.ts`, shared helper (new small `src/core/dispatch-team.ts`), test file
**Scope:** M
**Commit:** `feat(dispatch): resolve team-assigned tasks to a concrete agent before claim`

### ✅ Checkpoint B (after T3–T4)
End-to-end core flow proven by tests (create team task programmatically →
dispatch resolves → dispatched). Direct-assignment regression suite green.
Rollback = revert T4 (dispatch untouched by T1–T3).

### Phase 4 — Surfaces

#### T5: REST + MCP + CLI team assignment
**Description:** `createTaskBody`/`updateTaskBody` gain `team` (reject both
`assignee`/`agent` + `team` set; validate existence via `team.exists` hook →
400 / tool error). `bakin_exec_tasks_create` gains `team` param; routes map
through to store. CLI `bakin tasks add --team <id>` (+ list/show render team).
**Acceptance:**
- [ ] Each surface creates a team task; unknown team rejected on each; both-set rejected
- [ ] Update to `team` clears agent (round-trip through route)
**Verify:** `tests/plugins/tasks/` route + exec-tool tests via `callRoute`/`callTool`; CLI unit test; `bun run test`
**Files:** `plugins/tasks/lib/task-schemas.ts`, `plugins/tasks/lib/routes.ts`, `plugins/tasks/lib/exec-tools.ts`, `src/cli/commands/tasks.ts`, tests
**Scope:** M
**Commit:** `feat(tasks): team assignment across REST, MCP exec tools, and CLI`

#### T6: UI — picker, board, detail
**Description:** `AgentSelect` gains optional `includeTeams` prop rendering a
"Teams" `SelectGroup` (team entries `team:<id>` internally, color dot +
label; component maps selection to `{agent}` or `{team}` via a new
`onAssignChange` or caller-side split — keep the component's `value` a plain
string union). Task dialog wires team selection; board card shows team chip
(unresolved) or avatar + small team chip (resolved); detail view surfaces the
resolution reason from the task log.
**Acceptance:**
- [ ] Selecting a team on create/edit persists `team` (and clears agent)
- [ ] Board/detail render both states; resolution reason visible
**Verify:** component test if practical; manual `bun run dev:mock` pass; `bun run test`
**Files:** `src/components/agent-select.tsx`, `plugins/tasks/components/task-detail-modes.tsx`, `plugins/tasks/components/use-task-detail.ts`, board card component
**Scope:** M
**Commit:** `feat(tasks): team assignment UI — picker group, board chips, resolution reason`

#### T7: Schedule template passthrough
**Description:** `teamId?` on schedule job meta (types, `job-service.ts`
create/update mapping, `routes/jobs.ts` zod — mutually exclusive with
`agentId`, validated via `team.exists`), `fire-engine.ts` passes `team`
into `createTaskWithEffects` (`requireTriage` still forces unassigned);
job editor UI reuses the T6 picker.
**Acceptance:**
- [ ] Fired occurrence creates a team-assigned task; requireTriage wins; unknown team rejected at job save
**Verify:** schedule plugin tests (fire-engine + routes); `bun run test`
**Files:** `plugins/schedule/types.ts`, `plugins/schedule/lib/job-service.ts`, `plugins/schedule/lib/routes/jobs.ts`, `plugins/schedule/lib/fire-engine.ts`, job editor component, tests
**Scope:** M (6 files — accepted, all thin touches on one seam)
**Commit:** `feat(schedule): team-assigned schedule jobs with fire-time passthrough`

### ✅ Checkpoint C (after T5–T7)
All five creation surfaces produce identical semantics. Manual smoke on
`dev:mock`: create team task in UI → watch it resolve + dispatch.
Rollback = revert any of T5/T6/T7 independently (no cross-deps).

### Phase 5 — Polish

#### T8: Doctor warn check
**Description:** Team plugin health check `team.routing`: warn when any open
team-assigned task or `teamId` schedule job exists but no routing key
resolves. Registered via `ctx.registerHealthCheck` in
`plugins/team/lib/health-checks.ts`.
**Acceptance:**
- [ ] Warn fires exactly in the key-missing+in-use case; pass otherwise
**Verify:** health-check unit test; `bun run test`
**Files:** `plugins/team/lib/health-checks.ts`, test
**Scope:** S
**Commit:** `feat(team): routing-readiness doctor check`

#### T9: Docs + manifest bumps
**Description:** Update `.claude/knowledge/dispatch.md` (resolution step) and
team/tasks/schedule knowledge coverage (new section or file
`.claude/knowledge/team-aware-assignment.md` if none fits); CLAUDE.md Key
Patterns bullet (Dispatch) one-line addition; Astro docs
(`docs/src/content/docs/`) task-assignment page; README only if it mentions
assignment. Bump `bakin-plugin.json` versions: team (minor), tasks (minor),
schedule (patch). Close-out comment drafted for #189 + follow-up issue for
workflow-step team assignment.
**Acceptance:**
- [ ] Docs reflect shipped behavior (spot-check against tests); manifests bumped
**Verify:** `bun run test`; docs build if applicable
**Files:** knowledge docs, CLAUDE.md, docs site page, 3 manifests
**Scope:** S
**Commit:** `docs(knowledge): team-aware assignment coverage + plugin manifest bumps`

### ✅ Checkpoint D — Complete
All spec Success Criteria 1–8 checked off individually. PR to `main`.

---

## Commit Strategy (rollback checkpoints)

- **Branch:** `feat/189-team-assignment` off `main`.
- **One commit per task (9 commits), conventional format as listed.** No
  fixup/amend after a checkpoint is announced — later corrections are new
  commits, so checkpoints stay stable rollback anchors.
- **Green gate:** full `bun run test` must pass before every commit (repo
  Always-rule). A commit is never pushed red.
- **Rollback semantics:** the graph is strictly additive downward —
  `git revert` of any surface commit (T5–T8) is safe standalone; reverting
  T4 restores pre-feature dispatch while leaving the inert model/resolver;
  reverting the whole branch = revert T9→T1 in order (no migrations, no data
  format changes — `team` is an optional field new tasks simply stop writing).
- **Never committed:** `packages/host/src/generated-version.ts` mutations
  from `bun run build` (repo memory), `~/.bakin` artifacts.
- **PR:** single PR referencing #189, spec + plan linked, checkpoint
  structure called out for reviewable revert points.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM output quality (bad routing picks) | Med | Reason string audited + shown in UI; pool-constrained zod output; model configurable; misroute = re-assign manually, sticky thereafter |
| SOUL prose bloats prompt / cost | Low | Hard byte budget per member (~2KB) with visible truncation markers; haiku-class default |
| Dispatch regression on the hot path | High | Resolution branch only when `task.team && !task.agent`; T4 keeps existing tests untouched; call-count + no-change assertions |
| Key-helper extraction breaks vision enrichment | Med | T2 runs vision/enrichment suite; pure rename, no logic change |
| Hook waterfall semantics misuse | Low | Use `invoke<R>()` (first-handler RPC) + `has()` guard, not `call()` |
| Schedule UI divergence | Low | Reuse the same picker component; passthrough only |

## Open Questions

None. Workflow-step team assignment deferred (follow-up issue filed at T9).
