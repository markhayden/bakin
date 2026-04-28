# Adapter Layer - Single PR Hard Cutover Plan

**Companion to:** `.claude/specs/adapter-layer.md`
**Author:** Claude (revised 2026-04-27)

## Plan Summary

One implementation PR. Internal commits are review checkpoints, not deployable
release points.

This plan is optimized for the actual constraint set:

- Single user.
- Single local machine.
- Existing local task/runtime data may be wiped.
- Intermediate commits do not need to run.
- Clean final architecture is more important than compatibility shims,
  rollback layers, or deployable migration checkpoints.

The final PR must compile, pass tests, and pass manual smokes. Intermediate
commits should be coherent enough to review, but they do not need to preserve a
working application.

Principle: pretend this is the first implementation. Remove legacy paths with
no mercy. If code exists only to help the refactor transition, it must not
survive the PR. After public release, compatibility and import flows are product
features with tests, not leftover scaffolding.

## Non-Goals

- No staged production migration.
- No dual-write task metadata period.
- No old import re-export shims as final artifacts.
- No compatibility allowlists that survive the PR.
- No local data migration required for this machine.
- No v1 adoption API for old OpenClaw `flow_runs`. Post-release import is a
  separate product feature, not a leftover refactor path.

## Branch

`refactor/adapter-hard-cutover`

## Implementation Checkpoints

| Checkpoint | Purpose | Final-state requirement |
|---:|---|---|
| 1 | Adapter contracts and package skeletons | Interfaces live in `packages/core`; adapter packages export factories only |
| 2 | AppServices boot and injection spine | One bootstrapped service object reaches plugins, routes, MCP tools, CLI/scripts, lifecycle, health, and tests |
| 3 | Tasks hard cutover | Bakin task JSON store is the only task metadata authority before broad plugin rewrites |
| 4 | Search adapter cutover | Antfly-specific code lives under `packages/adapter-antfly/`; `search-registry` delegates through `SearchAdapter` |
| 5 | OpenClaw runtime adapter extraction | OpenClaw-specific code lives under `packages/adapter-openclaw/` |
| 6 | Durable approvals and channels | Approval state is Bakin-owned; channel messages are delivery refs only |
| 7 | Plugin hard cutover | Plugins use `ctx.runtime.*`, `ctx.search.*`, and the Bakin task store only |
| 8 | CLI/scripts/host/core hard cutover | Non-plugin callers use `AppServices` or server APIs only |
| 9 | Boundary enforcement and tests | Forbidden imports, provider strings, and raw storage access fail lint/test |
| 10 | Docs and Claude knowledge | Architecture is documented for future sessions |
| 11 | Final deletion sweep | Old direct-client files, shims, and plugin-side adapters are gone |

These are commit groups inside one PR, not separate mergeable PRs.

## Checkpoint 1 - Adapter Contracts And Packages

Add the adapter interfaces and package shells.

### Add

```text
packages/core/src/app-services.ts
packages/core/src/adapters/runtime/
  index.ts
  capabilities.ts
  concepts.ts
  testing.ts

packages/core/src/adapters/search/
  index.ts
  concepts.ts
  testing.ts

packages/core/src/tasks/
  store.ts
  testing.ts

packages/adapter-openclaw/
  package.json
  tsconfig.json
  src/index.ts

packages/adapter-antfly/
  package.json
  tsconfig.json
  src/index.ts
```

### Rules

- `packages/adapter-openclaw/src/index.ts` exports factory functions such as
  `createOpenClawRuntimeAdapter(...)`.
- `packages/adapter-antfly/src/index.ts` exports factory functions such as
  `createAntflySearchAdapter(...)`.
- `packages/core` exports interfaces, concepts, and test mocks only. It does
  not import concrete adapter packages.
- App boot/server code owns the static switch from settings to concrete
  adapter factories.
- Do not export provider classes as public API.
- Do not create delegating stubs that survive the final PR.
- Add settings shape for `runtime.adapter` and `search.adapter`.
- Add `getBakinPaths().tasks` so the task store has a Bakin-owned home before
  any task caller is rewritten.

## Checkpoint 2 - AppServices Boot And Injection Spine

Create the single application service object and thread it through every
runtime-dependent entrypoint before moving large provider implementations.

### Required Order

1. Load Bakin settings and paths.
2. Select runtime adapter factory from `runtime.adapter`.
3. Select search adapter factory from `search.adapter`.
4. Create the Bakin task store.
5. Run adapter compatibility checks.
6. Initialize runtime adapter.
7. Initialize search adapter.
8. Build `AppServices`.
9. Pass `AppServices` to plugin registry, route handlers, MCP tools, CLI/script
   helpers, lifecycle/health/doctor code, and tests.
10. Activate plugins and collect search schemas.
11. Provision/reconcile search tables after schemas are known.
12. Start HTTP/SSE/runtime-facing services.

### Required Coverage

- `PluginContext` exposes `ctx.runtime` and `ctx.search`.
- Plugin route handlers in `packages/host/` receive the same services object.
- MCP tool registration receives the same services object.
- CLI/scripts either call `loadAppServicesForCli()` or use server HTTP APIs.
- Server lifecycle, onboarding, doctor, watchdog, and health checks use
  `AppServices`; they do not import provider clients directly.
- Test helpers build mock `AppServices` once and reuse it.

No plugin, route handler, MCP tool, CLI command, script, or health check may
construct OpenClaw/Antfly/Discord clients directly after this checkpoint.

## Checkpoint 3 - Tasks Hard Cutover

Move task metadata authority once, before broad plugin rewrites.

### Final Ownership

- Bakin JSON task store owns task metadata.
- Runtime adapter owns execution dispatch/status/cancel.
- `flow_runs` stores execution-side fields only.
- `execution.flowId` links a Bakin task to a runtime execution.

### Required Store Surface

Implement one shared Bakin task-store module used by all task readers/writers.
It must cover creation, reads, list/filter, update, move/reorder, delete,
comments, audit/log entries, dependencies/blocking, pending-delete tombstones,
execution linking, and execution-status cache updates.

No task caller may keep using plugin hooks as the authoritative persistence
boundary. Hooks can be deleted or become thin event notifications after the
store write, but they cannot own task state.

### Required Behavior

Task creation writes Bakin metadata first, then dispatches execution:

1. Generate `bakinTaskId`.
2. Write `<getBakinPaths().tasks>/YYYY-MM/task-<id>.json` with
   `execution.flowId: null`.
3. Call `runtime.tasks.dispatch({ bakinTaskId, ... })`.
4. Receive `{ flowId }`.
5. Update the task JSON with `execution.flowId: flowId`.

There is no temporary mode where the old tasks plugin metadata path and the new
JSON task store both create authoritative task metadata.

### Delete Or Replace

- Replace old tasks plugin metadata reads/writes with the Bakin task store.
- Replace task-service's `tasks.createTask` hook dependency with the shared
  task-store module.
- Update kanban UI, task CLI, workflow integration, schedule integration, and
  any task-service callers to use the same task-store source of truth.
- Replace `src/core/dispatch.ts`, `src/core/agents.ts`, and
  `src/core/continuation.ts` imports from `@bakin/tasks/lib/flow-store`.
- Delete or rewrite task health checks so they inspect the Bakin task store and
  runtime adapter status, not raw `flow_runs` metadata.

### Wipe Policy

For this PR, local task/runtime data may be wiped before validation. Do not
write legacy adoption code to preserve this machine's existing data.

If import of existing OpenClaw executions is needed after release, build it as
a deliberate user-facing import flow with tests. Do not keep hard-cutover shims
or unused adapter methods for that future requirement.

## Checkpoint 4 - Search Adapter Cutover

Move Antfly-specific implementation into `packages/adapter-antfly/`.

### Move Or Re-home

- `src/core/antfly.ts`
- `src/core/antfly-server.ts`
- Antfly daemon health/startup helpers
- Table provisioning and reconciliation helpers

### Search Requirements

- Search table creation happens after plugins register schemas.
- `search-registry.ts` stores plugin schema declarations and delegates
  provisioning/index/query work to `AppServices.search`.
- Plugins keep using the plugin-facing `SearchAPI`; they do not see
  Antfly-native strategy names, table DDL, or aggregation shapes.
- `scan()` must expose stable document keys as well as documents.
- Existing search features survive the abstraction: filters, facets,
  aggregations, offset/limit, strategy selection, rerank data, and score
  breakdown diagnostics.

## Checkpoint 5 - Move OpenClaw Behind Runtime Adapter

Move OpenClaw-specific implementation into `packages/adapter-openclaw/`.

### Move Or Re-home

- `src/core/openclaw-client.ts`
- `packages/adapter-openclaw/src/home.ts`
- `packages/adapter-openclaw/src/config.ts`
- `src/core/discord-gateway.ts`
- `scripts/lib/post-channel.ts`
- Plugin-side OpenClaw adapter helpers from `plugins/team/` and
  `plugins/memory/`
- OpenClaw cron shell helpers
- OpenClaw health/startup helpers

### Runtime Surfaces To Implement

- `lifecycle`
- `messaging`
- `agents`
- `skills`
- `sessions`
- `memory`
- `tasks`
- `cron`
- `channels`
- `config`
- `tools`

Provider-specific details stay inside the OpenClaw adapter. Bakin core and
plugins consume only the runtime interface.

Do not implement v1 adoption/list-adoptable behavior for historical
`flow_runs`. The hard cutover assumes wipe.

## Checkpoint 6 - Durable Approvals And Channels

Implement channel operations so workflow approvals are durable Bakin state, not
provider message state.

Required behavior:

- Workflow gates persist a Bakin approval record before rendering channel
  messages.
- The record contains `approvalId`, workflow/run/step/task identity, status,
  request details, delivery refs, response data, and timestamps.
- Discord/Telegram/Slack message IDs are delivery refs only.
- Channel interaction payloads embed `approvalId`; the workflow handler looks
  up workflow/task/step identity from Bakin state after the event returns.
- `createApproval`, `editApproval`, `resolveApproval`, and `cancelApproval` are
  idempotent around duplicate renders, duplicate clicks, and restart retries.
- Restart with a pending approval can rehydrate delivery refs and continue,
  re-render, expire, or cancel the approval.

## Checkpoint 7 - Plugin Hard Cutover

Migrate every plugin to the final adapter surfaces in the same PR.

| Plugin | Final state |
|---|---|
| `messaging` | Uses `ctx.runtime.messaging` and `ctx.runtime.channels` |
| `team` | Uses `ctx.runtime.agents`; plugin-side OpenClaw adapter is deleted |
| `memory` | Uses `ctx.runtime.memory` and `ctx.runtime.sessions`; plugin-side OpenClaw helpers are deleted |
| `tasks` | Uses Bakin task store for metadata and `ctx.runtime.tasks` for execution |
| `workflows` | Uses `ctx.runtime.tools` and `ctx.runtime.channels` |
| `schedule` | Uses `ctx.runtime.cron` for list/create/update/delete/run-now behavior |
| `health` | Uses adapter health/lifecycle checks |
| `models` | Uses `ctx.runtime.config` |
| `projects` | Uses Bakin project files plus runtime config/agent APIs where needed |
| `assets` | Must not call OpenClaw/Antfly directly; verify no adapter boundary violation |

## Checkpoint 8 - CLI, Scripts, Host API, And Core Lifecycle

Migrate non-plugin callers in the same hard cut.

Required coverage:

- `src/`
- `cli/`
- `plugins/`
- `packages/host/`
- `packages/core/`
- `scripts/`

Required final shape:

- CLI commands either bootstrap `AppServices` through the shared loader or call
  server APIs.
- Scripts do not import OpenClaw/Antfly/Discord helpers directly.
- Host API routes receive services from server boot, not ad-hoc providers.
- Core lifecycle, onboarding, doctor, watchdog, and health checks use
  adapter health/services.
- Agent package installer/uninstaller code receives runtime services instead
  of importing the team/OpenClaw adapter directly.

Any direct OpenClaw/Antfly import outside `packages/adapter-*` is a bug unless
there is a documented final-state exception.

`raw()` config access is also treated as a boundary exception. Any surviving
use must be allowlisted, telemetry-logged, and tied to a tracked issue. The
preferred final state is zero plugin `raw()` use.

## Checkpoint 9 - Boundary Enforcement And Tests

Add strict checks in the same PR. Do not land lenient pre-migration rules.

### Required Checks

```bash
bunx tsc --noEmit -p tsconfig.app.json
bun run lint
bun test --isolate
bun run docs:check
bun run lint:home-bypasses
bun test tests/architecture/adapter-boundary.test.ts --isolate
```

The boundary test scans `src/`, `cli/`, `plugins/`, `packages/host/`,
`packages/core/`, and `scripts/`.

Forbidden outside `packages/adapter-*`:

- `openclaw-client`
- `openclaw-home`
- `openclaw-config`
- `discord-gateway`
- `src/core/antfly`
- `@antfly/sdk`
- `getOpenClawPath`
- `OPENCLAW_HOME`
- `~/.openclaw/`
- `flow_runs` SQL
- Discord REST/gateway URLs or interaction payload parsing
- shelling out to the OpenClaw binary
- direct `bun:sqlite` access to OpenClaw-owned DB files
- direct adapter package imports from plugin code
- non-allowlisted `runtime.config.raw()` usage

## Checkpoint 10 - Docs And Knowledge

Update docs in the same PR so future work sees the final architecture.

### Add

- `.claude/knowledge/adapter-architecture.md`
- `.claude/skills/check-adapter-boundary.md`

### Update

- `CLAUDE.md`
- `.claude/knowledge/plugin-system.md`
- `.claude/knowledge/repo-architecture.md`
- `.claude/knowledge/search-system.md`
- `.claude/knowledge/dispatch.md`
- `.claude/knowledge/doctor-and-health-checks.md`
- `docs-old/plugin-authoring.md`

## Checkpoint 11 - Final Deletion Sweep

Delete old paths instead of leaving shims.

Expected deletes include:

- `src/core/openclaw-client.ts`
- `src/core/discord-gateway.ts`
- `src/core/antfly.ts`
- `src/core/antfly-server.ts`
- old OpenClaw home/config modules after relocation
- plugin-side OpenClaw adapter files
- obsolete task metadata/flow-store paths after the tasks hard cutover
- obsolete test mocks that patched old direct-client modules
- unused adoption/import scaffolding for historical `flow_runs`
- non-allowlisted `raw()` call sites

If a file cannot be deleted, the PR must document why it is still part of the
final architecture. "Kept for migration" is not an acceptable final reason.

## Manual Final Smoke

Run after the full hard-cut PR is implementation-complete.

1. Optionally wipe local Bakin/OpenClaw task/runtime data before testing.
2. `bun install`
3. `bunx tsc --noEmit -p tsconfig.app.json`
4. `bun run lint`
5. `bun test --isolate`
6. `bun run docs:check`
7. `bun run lint:home-bypasses`
8. `bakin start`
9. Send a chat message and verify streaming response.
10. Trigger a Discord notification.
11. Trigger a workflow approval, approve it, and verify the workflow advances.
12. Restart Bakin with a pending approval, then approve after restart; verify the
    interaction routes and the message updates. Do not test clicks while Bakin
    is down as guaranteed delivery.
13. Create, edit, move, complete, and delete a task from the UI; verify the JSON
    task store is the metadata source of truth.
14. Dispatch a task; verify `flow_runs.owner_key` links to
    `bakin:task:<id>` and runtime status flows back to Bakin.
15. Create, edit, run-now, and delete a scheduled cron job through schedule UI.
16. Edit a project file; verify SSE updates and search indexing.
17. Open team UI; create/edit/remove an agent and edit permissions through
    runtime adapter APIs.
18. Open memory UI; verify tiers and sessions load.
19. `bakin doctor` passes.
20. Run the adapter boundary audit and confirm zero forbidden imports.

## Definition Of Done

- One PR contains the hard cutover.
- No compatibility shims remain.
- No dual-write task metadata remains.
- `AppServices` is the only runtime/search/task/channel injection path for
  plugins, routes, MCP tools, CLI/scripts, lifecycle, health, and tests.
- Bakin task JSON store is the only task metadata authority.
- Runtime adapter is the only execution/channel/agent/cron/tool boundary.
- Search adapter is the only Antfly/search boundary.
- Workflow approvals persist Bakin-owned approval records; channel messages are
  delivery refs only.
- Plugins consume `ctx.runtime.*` and `ctx.search.*` exclusively.
- CLI, scripts, host API, and core code respect the same boundaries.
- Boundary tests scan imports, provider strings, OpenClaw paths, direct
  `flow_runs` SQL, Discord URLs, OpenClaw binary calls, and raw DB access.
- Tests, lint, docs, and manual smokes pass.
- Architecture docs describe the final state, not a temporary migration state.

## Risks

| Risk | Mitigation |
|---|---|
| The PR is large | Keep commit groups aligned to the checkpoints above; review by checkpoint, not by trying to reason about the whole diff at once |
| Intermediate commits do not run | Accept this explicitly; only the final PR state must be runnable |
| Interface gap appears mid-refactor | Change the interface immediately and update both adapters/callers in the same PR |
| Task data loss | Accepted for this local machine; wipe before final smoke if needed |
| Hidden direct imports remain | Strict boundary test and lint run before merge |
| Old code survives as accidental shim | Final deletion sweep requires every leftover direct-client path to justify itself as final architecture |

## Sequencing Into Plugin Architecture V2

The adapter hard cutover should land before extracting messaging/projects into
external plugin packages. After this PR, extracted plugins consume stable
`ctx.runtime.*` and `ctx.search.*` surfaces instead of repo-local OpenClaw or
Antfly modules.

```text
NOW
`- Adapter layer hard cutover (this one PR)

THEN
|- Extract messaging
|- Extract projects
`- Populate RECOMMENDED_PLUGINS

LATER
|- Hermes adapter implementation
|- Other channel adapters
`- Third-party adapter authoring docs
```
