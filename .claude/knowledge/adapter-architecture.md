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

- agent identity, rules, tools, models, channels, cron jobs, workspaces, memory
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
  skills, sessions, memory, models, and runtime task execution status.
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
