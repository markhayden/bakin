# Adapter Architecture

## Contract

Bakin talks to external systems through adapters. Runtime concerns go through
`AgentRuntimeAdapter`; search concerns go through `SearchAdapter`; task metadata
goes through `BakinTaskStore`. The shared runtime object is `AppServices`:

```ts
interface AppServices {
  runtime: AgentRuntimeAdapter
  search: SearchAdapter
  tasks: BakinTaskStore
  health: HealthService
}
```

Core code creates the object once in `src/core/app-services.ts`. Plugins and
exec tools receive the same services through `PluginContext` / tool context.

The current implementations are:

| Contract | Factory | Implementation |
|---|---|---|
| Runtime | `src/core/runtime-adapter-factory.ts` | `packages/adapter-openclaw/` |
| Search | `src/core/search-adapter-factory.ts` | `packages/adapter-antfly/` |
| Tasks | `src/core/app-services.ts` | `createFileBakinTaskStore(getBakinPaths().tasks)` |

No plugin, route, CLI command, script, or `src/core/*` feature module should
import provider packages directly. Factories are the only production modules
that import `@bakin/adapter-openclaw` or `@bakin/adapter-antfly`.

## Ownership

Bakin owns:

- `~/.bakin/settings.json`
- task metadata under `~/.bakin/tasks/`
- audit, activity, assets, projects, workflows, plugin settings, package locks
- UI-only agent data such as avatars and Bakin heartbeats

The runtime adapter owns runtime provider state:

- agent identity, rules, tools, models, image generation routes, channels, cron
  jobs, workspaces, memory
- provider paths such as `~/.openclaw/`
- provider-specific transport, retry, and config parsing

The search adapter owns search-provider details:

- table/index creation
- query translation, score breakdowns, facets, rerank mapping
- transient provider retries and search health checks

## Boot Order

1. `getSettings()` resolves the configured adapter names and settings.
2. `createRuntimeAdapter(settings.runtime.adapter)` constructs the runtime
   implementation.
3. `createSearchAdapter(settings.search.adapter)` constructs the search
   implementation.
4. `createFileBakinTaskStore(getBakinPaths().tasks)` creates the Bakin task
   store.
5. Runtime and search adapters initialize with shared adapter init context:
   content dir, logger, audit callback, and adapter-specific settings.
6. `setAppServices()` stores the object for server modules and plugin
   activation.

Code that runs before boot may call `createAppServices()`; code that runs after
boot should use `getAppServices()` or the injected plugin/tool context.

## Plugin Surface

Plugins use:

- `ctx.runtime` for agent rosters, messaging, channels, cron, workspace files,
  skills, sessions, memory, models, image generation, and runtime task
  execution status.
- `ctx.search` for content type registration, indexing, transforms, removal,
  and queries.
- `ctx.tasks` for Bakin-owned task metadata.

Plugins must not import:

- `@bakin/adapter-openclaw`
- `@bakin/adapter-antfly`
- OpenClaw home/config/client helpers
- `@antfly/sdk`
- provider database paths or provider-owned SQLite files

## Raw Runtime Config

`runtime.config.raw()` is intentionally exposed on the adapter contract because
some provider data is not worth turning into a stable cross-runtime interface
yet. Direct calls are forbidden outside `src/core/runtime-config-raw.ts`.

Every raw read must be:

- allowlisted by reason and key
- audited as `runtime.config.raw`
- value-redacted in telemetry
- tied to a tracking id in `RAW_RUNTIME_CONFIG_ALLOWLIST`

Current allowlisted reads are onboarding-only:

| Reason | Key |
|---|---|
| `onboarding.runtime.integrity` | `*` |
| `onboarding.llm.check` | `agents.<id>.authProfiles` |
| `onboarding.channels.check` | `channels` |

If a new raw read is needed, either promote it to a typed adapter method or add
an explicit allowlist entry with owner/reason/tracking. Do not call
`runtime.config.raw()` from feature code.

## Task Metadata

`~/.bakin/tasks/` is the source of truth for task metadata. Runtime execution
ids are delivery/execution references only. Do not dual-write Bakin task fields
into runtime provider metadata. The runtime may expose execution status through
`runtime.tasks.*`, but task title, column, priority, blockers, workflow state,
and logs belong to the Bakin task store.

## Permission Layers

Bakin has several permission and capability layers. Do not treat a failure in
one layer as evidence that the others should be loosened:

- Filesystem/process sandbox policy controls what a local command may read,
  write, or reach over the network.
- Plugin manifest permissions control which `ctx.runtime.*` surfaces an
  installed plugin can call through `src/lib/plugin-permissions.ts`.
- Workflow step ownership controls `bakin_exec_*` tools with
  `assertWorkflowToolAllowed`; the current step owner may log progress, submit
  work, block work, or post an output according to the active step type.
- Runtime messaging tool policy controls the tools available to one live
  runtime agent turn. `RuntimeMessageArgs` supports `toolsMode`, `toolsAllow`,
  and `toolsDeny`; the OpenClaw adapter forwards these to Gateway agent
  requests. Use `toolsMode: 'none'` when a delegated turn must produce text
  only.
- Runtime cron `toolsAllow` is native isolated cron agent policy. It is exposed
  as `CronJob.toolsAllow` for scheduling visibility and is separate from live
  messaging policy and MCP routing.

## Runtime Messaging Streams

Messaging callers pass stable Bakin `threadId` values such as
`messaging:<sessionId>:<agentId>` through `runtime.messaging.stream()`. The
OpenClaw adapter maps those to provider session ids and tails the provider
transcript while the Gateway request is pending so tool calls/results become
`ChatChunk { type: 'tool' }` events before final assistant text. OpenClaw may
store the live transcript entry under `agent:<agentId>:explicit:<uuid>` in
`sessions.json`; the adapter owns that provider-specific lookup. Plugins and UI
code must continue to consume normalized runtime chunks instead of reading
OpenClaw session files directly.

## Approvals And Channels

Workflow approvals persist as Bakin-owned durable records. Runtime channel
message ids are delivery refs. A lost provider message must not destroy the
approval decision history.

Adapters may expose `interactive-approval` only when the provider/runtime can
return structured approval decisions. Provider decisions are normalized into
`runtime.channels.subscribeApprovalResponses()` events; provider TTLs and
message ids never become the source of truth. Durable Bakin approval links stay
available as the provider-agnostic fallback.

Channel operations go through `runtime.channels.*`. Cron operations go through
`runtime.cron.*`. Plugin notification channel definitions still belong to the
Bakin workflow/channel registry; provider delivery is adapter-backed.

Logical channel labels such as `general` or `#general` are not assumed to be
runtime delivery targets. Exec tools that deliver content resolve labels through
`settings.notifications.channelAliases` before calling the runtime adapter. A
fully-qualified target such as `discord:<target>` passes through unchanged; a
bare id is allowed only when it matches `runtime.channels.list()`. The
`health.channel-aliases` check validates alias targets without sending a
message. For backwards compatibility, a legacy
`notifications.channel` + `notifications.target` pair supplies the default
`general` alias only when `channelAliases.general` is not set.

Cron adapter policy fields should be normalized at the runtime boundary. For
OpenClaw, native isolated agent-turn cron tool allowlists live on
`payload.toolsAllow`; the adapter exposes that as `CronJob.toolsAllow`. Schedule
can display or audit that policy, but Bakin-owned schedules still use runtime
cron as a timer and create Bakin tasks through the schedule reconciler. Hard
scoping of `bakin_exec_*` MCP tools is a separate MCP routing-layer concern, not
a runtime cron concern.

## Boundary Enforcement

Run:

```sh
bun test tests/architecture/adapter-boundary.test.ts --isolate
bun run lint
bun run lint:home-bypasses
rg -n "runtime\\.config\\.raw|config\\.raw|\\.raw<|openclaw\\.ai" src cli plugins packages/core/src packages/host/src scripts server.ts --glob '!packages/host/public/vendor/**'
```

The architecture test scans `src/`, `plugins/`, `packages/core/src/`,
`packages/host/src/`, `cli/`, `scripts/`, and `server.ts`, including JSON and
YAML files in those roots. It fails on direct provider imports, raw provider
paths, legacy OpenClaw client modules, legacy `flow_runs` metadata, provider
setup URLs outside adapter factories, raw runtime config access outside the
gate, and hard-coded local runtime agent ids in plugin-shipped workflow
defaults.

ESLint duplicates the import-level restriction so provider package imports fail
before the architecture test runs. `.claude/hooks/check-adapter-boundary.mjs`
also runs after Claude Code edits and blocks the common provider-bypass and
shipped-workflow-agent mistakes at edit time.

Use `.claude/skills/check-adapter-boundary.md` for the full repeatable audit.
