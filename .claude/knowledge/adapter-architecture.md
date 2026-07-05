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

### SearchAdapter contract

`packages/core/src/adapters/search/index.ts`. Beyond the shared lifecycle
(`initialize`/`shutdown`/`available`/`getHealthChecks`), every search adapter
MUST implement:

- `capabilities()` — what the adapter can build/serve, in capability terms:
  `{ legs: SearchLegCapability[], rerank, facets, transform }` where legs are
  `'full-text' | 'text-embedding' | 'media-embedding'`.
- `mappingFingerprint()` — a stable hash over the adapter settings that
  change the PHYSICAL index layout (embedder models, dimensions). Core folds
  it into each table's blue/green config fingerprint, so an adapter-side
  model swap migrates tables without any plugin edit.
- `tables.health(name)` — per-leg `TableLegHealth`
  (`ready | building | error`, indexed count, error). Drives the blue/green
  convergence check, `getSearchHealth()`, and the doctor. `tables.list()` is
  doctor/introspection only — never called on the boot path.
- `documents.{index,batchIndex,remove,batchRemove,transform}`,
  `query`/`multiQuery`/`scan` — generic primitives the outbox and registry
  are built on. Query hits carry a neutral
  `scoreBreakdown: Record<legName, number>` — leg names the table declared,
  no engine-specific keys.

Search setup (binary + models) flows through `SearchAdapterSetup`
components returned by `getSearchAdapterSetup()` — the onboarding
`check()`/`install()` contract.

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

- engine lifecycle: OS-service provisioning (launchd/systemd unit files),
  strict-child fallback, binary install/pin/upgrade, inference-model
  management (`bakin install search` / `search-models` flow through
  `getSearchAdapterSetup`)
- physical table/index creation and the wire-shape translation for queries,
  writes, facets, and rerank mapping
- mapping capability legs (full-text / text-embedding / media-embedding) to
  concrete embedder models — model names and dimensions are adapter
  settings, never content-type or core concerns
- normalizing per-leg scores into the neutral `scoreBreakdown` and per-leg
  index health into `TableLegHealth`
- classifying every failure into the typed search-error taxonomy before it
  crosses the boundary (see below)

Core owns the machinery built ON the contract: the durable search outbox,
the blue/green table registry/migrator, the content-type registry, and the
doctor's consistency sweeps (`packages/core/src/search/`,
`src/core/search-*`). Those layers call only generic contract primitives —
a second search adapter must require zero changes upstream of the adapter
layer (D17).

## Boot Order

1. `getSettings()` resolves the configured adapter names and settings.
2. `createRuntimeAdapter(settings.runtime.adapter)` constructs the runtime
   implementation.
3. `createSearchAdapter(settings.search.adapter)` constructs the search
   implementation.
4. `createFileBakinTaskStore(getBakinPaths().tasks)` creates the Bakin task
   store.
5. Runtime and search adapters initialize with shared adapter init context:
   content dir, logger, audit callback, and adapter-specific settings. The
   search adapter's `initialize()` ensures its OS-supervised engine service
   is provisioned (idempotent unit-file byte-compare); provisioning failures
   degrade search honestly instead of blocking boot.
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
  and queries. Writes journal through the durable search outbox before the
  adapter ever sees them — plugins never talk to the engine directly and
  never observe engine downtime on the write path.
- `ctx.tasks` for Bakin-owned task metadata.

Plugins must not import:

- `@bakin/adapter-openclaw`
- `@bakin/adapter-antfly`
- OpenClaw home/config/client helpers
- `@antfly/sdk`
- provider database paths or provider-owned SQLite files

## Runtime Config Access (governed)

Two gates, both audited, both architecture-test enforced:

- **Whole-config access** — `runtime.config.get()`/`.replace()` are called
  ONLY from `src/core/runtime-config.ts` (`readRuntimeConfig`/
  `replaceRuntimeConfig`). Every caller passes a typed scope; mutations
  append an audit row (reads deliberately don't — the models plugin reads
  config per `/config` request and auditing reads would spam the feed).
- **Key-level raw reads** — `runtime.config.raw()` for provider data not
  worth a stable cross-runtime interface yet. Direct calls are forbidden
  outside `src/core/runtime-config-raw.ts`.

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
into runtime provider metadata. Task title, column, priority, blockers,
workflow state, and logs belong to the Bakin task store. The store keeps an
in-memory id→path + column-bucket index (no content cached; self-healing on
miss) — `tasks/` is ignored by the content watcher and the store's own emit is
the single broadcast source, so the store is the **single writer** for task
JSON; external hand-edits need a restart to broadcast.

Cross-boundary asset lookup from core goes through the `assets.listByTask`
hook (assets plugin owns the index) — core must not walk `assets/store/`
directly. (The old
`runtime.tasks.*` adapter surface was deleted — it returned fabricated
`flowId`s and always-`'unknown'` status with zero real consumers; dispatch
execution tracking lives in the in-flight turn registry in
`src/core/dispatch-turns.ts`. Likewise deleted as dead/lying surface:
`agents.heartbeat()` — the real liveness system is `~/.bakin/heartbeats/` —
`channels.onMessage`/`onInteraction`, and `tools.list()`.)

## Typed Runtime Errors

Adapters map every failure to a typed `RuntimeError` from
`@bakin/core/adapters/runtime` (`kind: transport | timeout | session_death |
provider_cooldown | runtime_failed`, original error preserved on `cause`,
optional structured `providerInfo`) BEFORE it crosses the boundary.
`RuntimeTurnError` (kind `session_death`) carries a `RuntimeTurnDiagnosis`
assembled from provider session forensics inside the adapter. Core classifies
on `kind` exclusively — provider error strings are interpreted in exactly one
adapter module (`packages/adapter-openclaw/src/errors.ts`). Deep reference:
`.claude/knowledge/session-forensics.md`.

## Typed Search Errors

The same rule applies to search. Adapters map every write/query failure to a
typed error from `@bakin/core/adapters/search/errors` before it crosses the
boundary:

- `SearchEngineUnavailableError` — engine unreachable or transiently failing
  (connect refused, timeout, 5xx, shard settling). Retry-forever safe: the
  search outbox backs off without advancing rows toward quarantine.
- `SearchRequestRejectedError` — the engine rejected the request itself
  (4xx: schema/validation/shape). Retrying the identical payload cannot
  succeed; the outbox counts these toward quarantine (5 attempts).

The outbox classifies by **type, never message text**
(`isEngineUnavailable()`). Provider status codes are interpreted in exactly
one place — the adapter's HTTP request path
(`packages/adapter-antfly/src/client.ts`).

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

## Runtime Messaging Streams & Sessions

Messaging callers pass stable Bakin `threadId` values through
`runtime.messaging.send()/stream()`. Two caller classes:

- **Task work** (dispatch, continuation, recovery): per-attempt threadIds
  (`task:<taskId>:d<seq>`, workflow steps `task:<id>:step:<stepId>:d<seq>`)
  so each attempt runs in a fresh, deterministic provider session. Threaded
  sends return the provider `sessionId` in `MessageResult.metadata` and use
  the stable gateway idempotency key `bakin:<threadId>`.
- **Notifications/conversation** (orchestrator complete-ping, watchdog,
  doctor, agents API, UI chat `messaging:<sessionId>:<agentId>`): default or
  durable conversational sessions — never per-attempt.

**Turn cancellation (#604):** `MessageArgs.signal?: AbortSignal` is the
adapter-neutral best-effort cancel. Contract: on abort the adapter MUST
reject the local awaiter promptly with `RuntimeError` kind `'aborted'`
(terminal — dispatch never retries or diagnoses it) and SHOULD cancel the
provider-side run where the runtime supports it. Fail-open: the OpenClaw
gateway's `chat.abort` registry only tracks channel auto-reply runs (probed
live on 2026.6.11 — backend `agent` RPC runs are NOT stopped server-side),
so the adapter fires the canonical-key `chat.abort` frame as forward-compat
and relies on the local rejection; the residual ghost run is bounded by the
runtime's own turn timeout with every Bakin tool failing closed.

The OpenClaw adapter maps threadIds to provider session ids and tails the
provider transcript while the Gateway request is pending so tool
calls/results become `ChatChunk { type: 'tool' }` events before final
assistant text; it also watches the session **trajectory** file to fail fast
on session deaths and run post-mortems (read-only — see
`.claude/knowledge/session-forensics.md`). OpenClaw may store the live
transcript entry under `agent:<agentId>:explicit:<uuid>` in `sessions.json`;
the adapter owns that provider-specific lookup (mtime-cached). Plugins and UI
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
can display that policy on the native crons it surfaces read-only. **Bakin-owned
schedules no longer use runtime cron at all** — Bakin runs its own tick
scheduler and fires tasks directly (see `.claude/knowledge/bakin-owned-scheduler.md`).
The boundary is now: the runtime owns the cron jobs it/agents create for
themselves; Bakin owns the scheduling of Bakin tasks. Hard scoping of
`bakin_exec_*` MCP tools is a separate MCP routing-layer concern, not a runtime
cron concern.

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
gate, raw SQLite access outside `packages/core/src/storage/db.ts`, and
hard-coded local runtime agent ids in plugin-shipped workflow defaults.

**Antfly identifier ban (D17):** the test additionally forbids
antfly-specific identifiers — engine/model names (`antflydb/*`, the CLIP and
rerank model names, the release-host URL, the swarm argv) — anywhere upstream
of the adapter, **comments included** (they rot into load-bearing
assumptions). Allowed exceptions: `src/core/search-adapter-factory.ts` and
the settings surfaces that carry the adapter's own defaults for
`~/.bakin/settings.json` (`src/core/settings.ts`,
`packages/core/src/settings.ts`, `src/core/onboarding/`). Everything else
must speak capabilities only — a second search adapter requires zero
upstream changes.

ESLint duplicates the import-level restriction so provider package imports fail
before the architecture test runs. `.claude/hooks/check-adapter-boundary.mjs`
also runs after Claude Code edits and blocks the common provider-bypass and
shipped-workflow-agent mistakes at edit time.

Use `.claude/skills/check-adapter-boundary.md` for the full repeatable audit.
