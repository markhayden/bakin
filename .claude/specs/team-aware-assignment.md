# Spec: Team-Aware Task Assignment & Dispatch Routing

**Issue:** #189 — Track team-aware task assignment and dispatch routing
**Status:** Approved (interview 2026-07-05)
**Companion plan:** `team-aware-assignment-plan.md` (written after spec approval)

## Objective

Allow a task to be assigned to a **single agent OR a team**. When a team is
assigned, Bakin resolves the best-suited member at dispatch time via a cheap
LLM classification call, writes the choice back to the task, and dispatches to
that concrete agent. The record permanently explains *requested team* vs
*resolved agent* and *why*.

**User story:** "Assign this to the development team" — Bakin routes the task
to the reviewer/dev/architect member whose profile best matches the work,
without the user (or orchestrating agent) knowing the roster.

**Success looks like:** a team-assigned task created from any surface (UI,
CLI, REST, MCP, schedule fire) dispatches to a sensible member with an
auditable reason; failures are honest (visible skip/block states), never
silent misroutes.

## Decisions (from interview)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Selection mechanism | **LLM resolver** — new direct text-LLM transport; prompt = task + compact member profiles; zod-validated `{agentId, reason}` |
| 2 | Failure behavior | **Honest-state, no silent picks.** Transient (provider error, bad JSON, out-of-pool id after one retry): skip this cycle + retry next tick, visible reason + audit. Structural (no LLM key, zero eligible members, team plugin hook absent): task **blocked** with `blockedReason` |
| 3 | Data model | `team?: string` added to `BakinTask` alongside `agent?: string`; mutually exclusive at write; resolver fills `agent`, `team` retained for audit. Sticky: once `agent` set, no re-resolution; re-assign to team clears `agent` |
| 4 | Ownership | **Team plugin owns resolution** via typed hook `team.resolveAssignment`; dispatch (core) invokes through HookRegistry; generic text transport lives in `packages/core/src/llm/` |
| 5 | LLM config | Team plugin `settingsSchema` gains "Task routing" section: `provider` (`anthropic`\|`openai`\|`google`), `model` (default `anthropic` / `claude-haiku-4-5-20251001`). Keys resolve env-var → secret store (same as vision enrichment) |
| 6 | Eligibility | Pool = team members present in runtime roster (existence only). Status / in-flight workload are **prompt signals**, not filters. Zero pool = structural failure |
| 7 | Scope | **Tasks (UI + CLI + REST + MCP) + schedule templates.** Workflow steps deferred to a follow-up issue |

## Confirmed assumptions

1. **Write-time validation:** task create/update and schedule job save reject
   unknown team ids (zod at boundary + team lookup). No lazy discovery of bad
   ids at dispatch.
2. **Mutual exclusion enforced in the store update path** (not just API):
   setting `team` clears `agent`, setting `agent` clears `team`.
3. **UI:** `AgentSelect` grows a "Teams" group (color dot + label) — one
   dropdown. Board cards show a team chip until resolved, then agent avatar +
   small team chip. Task detail shows the resolution reason.
4. **Resolution before claim:** LLM call happens at dispatch prep, before the
   ledger run claim; resolved agent written to `task.agent` immediately →
   retries/re-dispatches never re-bill. Audit events `task.team_resolved`
   `{team, agent, reason, model}` and `task.team_resolution_failed`.
5. **Transport:** `packages/core/src/llm/direct-text-provider.ts`, sibling of
   `packages/core/src/media/direct-vision-provider.ts`, sharing generalized
   key resolution. Zod-validated JSON out; out-of-pool `agentId` → one retry →
   transient failure.
6. **Prompt inputs:** task title/description/tags + per member: id, name,
   role, model, status, in-flight turn count, byte-budgeted (~2 KB)
   SOUL/identity excerpt. Privacy note: SOUL prose is sent to the configured
   provider — same trust level as asset enrichment.
7. **Schedule:** `teamId` on job meta, mutually exclusive with `agentId`;
   passthrough at `fire-engine.ts` task creation; `requireTriage` still wins
   (creates unassigned). Fresh task per occurrence → fresh resolution.
8. **Doctor:** warn-only team-plugin health check — team routing in use
   (any team-assigned open task or any `teamId` schedule job) but no LLM key.
9. **Docs:** update `.claude/knowledge/dispatch.md`, team/tasks knowledge
   coverage, Astro docs; README only if it mentions assignment. Bump touched
   core plugin manifest versions (team, tasks, schedule — patch/minor per
   convention).

## Tech Stack

Bun ≥1.2, TypeScript strict, Zod at boundaries, HookRegistry for core↔plugin
calls, SQLite ledger untouched (resolution is task-store state, not a
coordination fact). No new dependencies.

## Commands

- Build: `bun run build`
- Test (full suite): `bun run test`
- Single file: `bun test tests/path/to/foo.test.ts --isolate`
- Dev loop: `bun run dev` (server code not watched — manual restart)
- Mock runtime: `bun run dev:mock`

## Project Structure (touch points)

```
packages/core/src/tasks/store.ts            → BakinTask.team field
packages/core/src/llm/direct-text-provider.ts  → NEW text transport
packages/core/src/media/direct-vision-provider.ts → extract shared key resolution
src/core/task-store.ts                      → createTask/updateTask/assign semantics, mutual exclusion
src/core/dispatch-board.ts                  → eligibility for team tasks (skip reasons)
src/core/dispatch-cycle.ts, dispatch-single.ts, dispatch-prepare.ts
                                            → resolve-before-claim via hook invoke
plugins/team/index.ts                       → register team.resolveAssignment hook + settingsSchema routing section
plugins/team/lib/assignment-resolver.ts     → NEW pool assembly, prompt build, LLM call, validation
plugins/team/lib/health-checks.ts           → routing-key warn check
plugins/tasks/lib/task-schemas.ts, routes.ts, exec-tools.ts → team param on create/update surfaces
plugins/tasks/components/*                  → picker + board/detail display
plugins/schedule/types.ts, lib/fire-engine.ts, job UI/schema → teamId passthrough
src/components/agent-select.tsx             → Teams group
src/cli/commands/tasks.ts                   → --team flag
tests/…                                     → per testing strategy below
```

## Code Style

Repo conventions apply (CLAUDE.md): strict TS, kebab-case files, zod at
boundaries, `createLogger('module')`, no empty catches, hook naming
`{pluginId}.{operation}`. Example of the hook contract shape:

```ts
// plugins/team/types.ts
export interface ResolveAssignmentRequest {
  teamId: string
  task: { id: string; title: string; description?: string; tags: string[] }
}
export type ResolveAssignmentResult =
  | { ok: true; agentId: string; reason: string; model: string }
  | { ok: false; kind: 'transient' | 'structural'; message: string }
```

Dispatch classifies by `kind`, never by message text (house rule).

## Testing Strategy

Bun test, `--isolate`, content-dir + OpenClaw-home mocks per CLAUDE.md
(mandatory — both resolver paths). Levels:

- **Unit:** mutual-exclusion semantics in task-store; prompt/pool assembly
  (empty team, missing roster members, byte budget); text-provider JSON
  parse/retry/out-of-pool handling (mock fetch); schedule meta validation.
- **Integration (plugin harness, `tests/plugins/test-helpers.ts`):** hook
  registration + resolution round trip with mocked transport; task routes /
  exec tools accept `team` and reject unknown/both-set; fire-engine team
  passthrough + requireTriage precedence.
- **Dispatch:** team task resolves → agent written → dispatched; transient
  failure → skipped with reason + retried next cycle; structural failure →
  blocked; resolved task never re-calls the LLM (call-count assertion).
- **No live LLM calls in tests** — transport always mocked.

## Boundaries

- **Always:** run `bun run test` before each commit; keep resolution results
  in task-store + audit (never in the ledger); route all core↔team-plugin
  interaction through HookRegistry; keep antfly/search untouched; honest
  skip/block states with reasons.
- **Ask first:** any change to the ledger schema; adding dependencies;
  touching workflow-step assignment (deferred scope); changing the vision
  provider's public API beyond extracting the shared key helper.
- **Never:** silent fallback routing to an arbitrary member; classify errors
  by message text; fabricate model metadata; write to `~/.bakin` or
  `~/.openclaw` from tests; backwards-compat shims (single-user machine —
  clean model only).

## Success Criteria

1. A task created with `team: development` from **each** surface (UI, REST,
   `bakin tasks --team`, `bakin_exec_tasks_create`, schedule fire) dispatches
   to a team member with `task.team` retained, `task.agent` resolved, a task
   log entry, and a `task.team_resolved` audit event carrying the reason.
2. Unknown team id is rejected at write time on every surface (400 / tool
   error), never stored.
3. Setting `team` clears `agent` and vice versa on every write path.
4. With no LLM key configured: team task becomes **blocked** with a clear
   `blockedReason`; doctor shows the warn check; nothing dispatches.
5. Transient provider failure: task skipped that cycle with visible reason +
   `task.team_resolution_failed` audit; next cycle retries; after success the
   LLM is never called again for that task.
6. Zero eligible members (empty team / members missing from roster): blocked,
   not spinning.
7. Direct agent assignment behavior is byte-for-byte unchanged (existing
   dispatch tests stay green).
8. `bun run test` passes; knowledge docs updated (`dispatch.md` + team/tasks
   coverage); plugin manifests bumped.

## Open Questions

None — all forks resolved in the 2026-07-05 interview. Workflow-step team
assignment is explicitly deferred (file follow-up issue at ship time,
consuming the same `team.resolveAssignment` hook).
