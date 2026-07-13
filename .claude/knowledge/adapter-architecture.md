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

**Behavioral guarantees are executable, not prose:** the runtime conformance
suite (`tests/integration/runtime-conformance/` — shared checks, one runner
per target: dev mock, Pi/fake-provider, OpenClaw/Imitation Crab, plus a
teeth file proving the checks reject violators) is the acceptance gate for
any adapter. It pins messaging (sessionId, clean abort, typed kinds), the
stream chunk contract, the `onActivity` tap, capability honesty in both
directions (declared mode ⇔ working surface — the SDK's reduced runtime
type now declares `channels`/`cron` optional to match), provisioning
idempotency, and `not_found`-typed CRUD mutations. Specified semantics
(T29/T30): `ping` = cheap can-serve-a-turn probe; `restart` = re-read all
durable config; `toolsAllow`/`toolsDeny` scope Bakin exec tools only;
`oversizedOutputBytes` is a typed `MessageArgs` field; `updatePermissions`
and `tools.invoke` are deleted; `updateAllowlist` patches agent ids
(subagent-dispatch allowlist). Session-store remediation text and the
session-file naming convention are adapter-provided data
(`RuntimeSessionStoreStats.remediation`, memory-surface paths); the
`media://` scheme is the contract's `RUNTIME_MEDIA_URI_SCHEME` constant.

The current implementations are:

| Contract | Factory | Implementation |
|---|---|---|
| Runtime | `src/core/runtime-adapter-factory.ts` | `packages/adapter-openclaw/` (default) or `packages/adapter-pi/` (`settings.runtime.adapter: 'pi'`) |
| Search | `src/core/search-adapter-factory.ts` | `packages/adapter-antfly/` |
| Tasks | `src/core/app-services.ts` | `createFileBakinTaskStore(getBakinPaths().tasks)` |

No plugin, route, CLI command, script, or `src/core/*` feature module should
import provider packages directly. Factories are the only production modules
that import `@bakin/adapter-openclaw`, `@bakin/adapter-pi`, or
`@bakin/adapter-antfly`.

Two adapter-neutral seams exist so in-process runtimes (Pi) get what OpenClaw
reaches out-of-band:

- `AdapterInitOpts.execTools: RuntimeExecToolProvider` — core offers the live
  exec-tool registry (JSON-Schema descriptors + invoke with usage/audit
  bookkeeping, `src/core/exec-tools/provider.ts`). Pi registers the tools as
  native session tools; OpenClaw reaches the same registry over its native
  MCP client (per-agent `bakin-<agent>` servers, adapter-provisioned).
- `describeToolAccess(): RuntimeToolAccess` — how agents call Bakin tools
  (`in-process` / `mcp` / `cli-shim`); every prompt + AGENTS.md surface
  renders through the ONE renderer in `src/core/tool-access.ts`
  (`resolveToolAccess()` in `src/core/dispatch-prompts.ts`).
- `provisionToolAccess()` / `deprovisionToolAccess()` / `verifyToolAccess()` —
  adapter-owned tool-access wiring lifecycle (OpenClaw writes/prunes its own
  MCP config entries; Pi is a no-op). Runs at server boot, onboarding
  install, and roster changes — never from read-only paths.

Deep reference for the Pi implementation: `.claude/knowledge/pi-adapter.md`.

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

## Runtime Config Is Adapter-Private

The contract's `config` surface is DELETED (runtime-capabilities P2.5): no
whole-config access, no raw key reads, no governed wrappers. An architecture
rule bans `runtime.config.` / `readRuntimeConfig` / `replaceRuntimeConfig` /
`readAllowedRuntimeConfigRaw` anywhere upstream of the adapter packages.

Every former consumer crosses a neutral contract method instead:

| Former raw read | Neutral surface |
|---|---|
| onboarding runtime integrity (`*`) | `agents.list()` roster + adapter-resolved `metadata.workspacePath` |
| onboarding llm/channels checks | `credentialStatus()` — presence-only names, never secrets |
| models plugin routing (defaults/fallbacks/aliases) | `models.routingPolicy()` / `setRoutingPolicy()` / `routingSupport()` |
| per-agent model assignment | `agents.update({ model, subagentModel })` (null clears) |
| OpenClaw MCP provisioning | `provisionToolAccess()` family (adapter-internal writes) |

If a new provider-data need appears, add a typed adapter method — never a
config escape hatch. Deep reference:
`.claude/knowledge/runtime-capabilities.md`.

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
adapter module (`packages/adapter-openclaw/src/errors.ts`). The kind union
also carries `not_found` (nonexistent-id CRUD mutations) and `aborted`
(deliberate cancellation). An architecture test BANS error-message string
matching upstream of the adapters (`tests/architecture/adapter-boundary.test.ts`,
incl. `const msg = err.message` aliasing and `.toLowerCase()` chains) — the
fix is always `err instanceof RuntimeError && err.kind === '…'` or a typed
error class; for the rare genuinely-untyped source (raw `fetch` failures in
the CLI), annotate the line with `// arch:allow-error-message <reason>`.
Deep reference: `.claude/knowledge/session-forensics.md`.

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
  sends return the provider `sessionId` in `MessageResult.metadata`.
  **`messaging.send` is NOT idempotent at the contract level** — callers own
  dedupe (dispatch's ledger claims are that dedupe). The OpenClaw adapter
  happens to derive a stable gateway idempotency key `bakin:<threadId>`
  (which the gateway echoes back as the run's `runId`), but that is an
  OpenClaw implementation detail, not a contract guarantee; Pi has no send
  dedupe at all.
- **Notifications/conversation** (orchestrator complete-ping, watchdog,
  doctor, agents API, UI chat `messaging:<sessionId>:<agentId>`): default or
  durable conversational sessions — never per-attempt.

**Turn cancellation (#604, hardened in WS1a):** `MessageArgs.signal?:
AbortSignal` is the adapter-neutral best-effort cancel. Contract: on abort
the adapter MUST reject the local awaiter promptly with `RuntimeError` kind
`'aborted'` (terminal — dispatch never retries or diagnoses it) and SHOULD
cancel the provider-side run where the runtime supports it. On OpenClaw the
server-side cancel is REAL (live-verified on 2026.6.11, fixture
`tests/fixtures/openclaw-gateway-frames/abort-turn.jsonl`): the adapter
captures the `agent` RPC's accepted ack (`runId` + canonical `sessionKey`)
and sends `chat.abort { sessionKey, runId }` from the owning connection —
the gateway stops the run (`{aborted:true, runIds}` + terminal
`chat state:'aborted'` frame). The outcome is consumed and audited
(`agent-turn-abort`, honest `aborted:false` on refusal/send failure) —
never fire-and-forget. Pre-ack aborts fall back to the best-known explicit
session key (no guessed runId); the local rejection stays unconditional and
immediate either way. Post-abort RPC finals arrive as `status:'timeout'`
with `stopReason:'aborted'` — classification is by abort state/stopReason,
never RPC status.

**Stream contract (R5).** `ChatChunk` is a discriminated union (text with
`format?: 'markdown'|'plain'|'code'` — absent = markdown; tool with
structured `RuntimeToolActivity` data; status; done; error with
`data.kind`). Behavioral guarantees every adapter implements: chunk
granularity may vary by adapter; `done` is yielded exactly once and last;
no chunks after done; tool/status chunks are best-effort; a terminal
failure surfaces as an `error` chunk carrying the typed kind and then ends
the stream (the iterator never throws). Adapters emit classified,
structured chunks only — never pre-rendered HTML/ANSI/raw-JSON dumps;
stripping runtime noise is the adapter's job. The doc-comment source of
truth is `packages/core/src/adapters/runtime/concepts.ts`.

**Turn-activity tap (`MessageArgs.onActivity`).** `send()` accepts an
optional per-turn callback both adapters feed with **tool + status chunks
only** (text deltas never tap — they belong to `stream()`). Best-effort:
no delivery or ordering guarantee relative to the settle; adapters contain
callback exceptions (a throwing tap can never fail the turn); absent tap =
zero cost (OpenClaw doesn't even subscribe). This is dispatch's liveness
seam — see `dispatch.md` § Concurrent dispatch model for the `turn-activity`
SSE fan-out. Deliberately NOT mirrored into the SDK's reduced
`RuntimeMessageArgs` (plugins consume liveness via SSE, not the tap).

**Turn output formatting — the two-seam rule.** (1) Server seam: adapters
normalize runtime output into the chunk taxonomy above — per-runtime
formatting differences are absorbed here, invisibly to the UI. (2) Client
seam: ONE SDK component turns chunks into pixels — `TurnOutputView` from
`@makinbakin/sdk/components` (`src/components/turn-output-view.tsx`:
format-hinted text via MarkdownContent or a mono block, folded tool chips,
the live thinking status, typed error rows; `foldTurnChunks` is the
exported folding primitive). No third path: new turn-output surfaces
consume normalized chunks through the single renderer, never hand-rolled
dumps or per-surface format heuristics. Chat (live region + durable
assistant/tool/error rows) and the tasks step-output viewer render
through it.

The OpenClaw adapter streams turns from gateway push events
(`gateway-frames.ts` schemas → the `stream-events.ts` frame→chunk machine):
`chat` delta frames carry text (deltaText + full cumulative text — dropped
`dropIfSlow` deltas self-heal via cumulative reconciliation), `agent`
`tool`-stream frames become structured tool chunks (the `tool-events`
connect cap gates that stream; `item`/`command_output` mirrors are
deliberately ignored to avoid duplicate chips), and the accepted ack yields
an immediate `status:'thinking'` chunk. The gateway connect handshake
requires protocol ≥ 4 (actionable "upgrade OpenClaw" error below it). The
session **trajectory** file is still watched — read-only, forensics only
(fail-fast death detection + post-mortems, see
`.claude/knowledge/session-forensics.md`), not for streaming. OpenClaw may
store the live transcript entry under `agent:<agentId>:explicit:<uuid>` in
`sessions.json`; the adapter owns that provider-specific lookup
(mtime-cached). Plugins and UI code must continue to consume normalized
runtime chunks instead of reading OpenClaw session files directly.

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

## Ecosystem-first per-turn capabilities (pi-parity D3, 2026-07-13)

Per-turn agent capabilities (web search, browser, transcription) are
runtime-OWNED content, not Bakin exec tools — Bakin manages installs via
capability packs (`.claude/knowledge/capability-packs.md`) and never wraps
what both runtimes' ecosystems already ship. Daemons (channel bridges,
cron, inbox watchers) remain Bakin-side by structure: Pi extensions are
session-scoped and the adapter disposes sessions per turn.
