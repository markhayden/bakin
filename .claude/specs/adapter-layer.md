# Adapter Layer Architecture

**Status:** Draft 1 — for review
**Supersedes:** `.claude/specs/sdk-expansion-for-extraction.md` (the original SDK expansion approach is replaced by this; that earlier spec stays as historical context for the design conversation)
**Companion:** `.claude/specs/adapter-layer-plan.md` (per-PR migration plan)
**Author:** Claude (drafted 2026-04-27)

## 1. Objective

Introduce an adapter layer between bakin core and the external runtimes
it integrates with. Two adapter types ship in v1:

- **AgentRuntimeAdapter** — bakin's interface to the agent runtime.
  OpenClaw is the day-1 implementation; Hermes (and others) follow.
- **SearchAdapter** — bakin's interface to the search/vector backend.
  Antfly is the day-1 implementation.

After this work, **no bakin core or plugin code reaches OpenClaw or
Antfly directly.** Every interaction goes through the adapter
interface, with the implementation living in its own workspace
package.

## 2. Why this work

### The audit revealed deep coupling

A grep across `src/`, `cli/`, `plugins/`, `packages/`, `scripts/`,
`server.ts` shows:

| Surface | Files touched | Notes |
|---|---:|---|
| OpenClaw imports / paths | **58** | spread across core + 9 plugins + scripts |
| Discord-specific code | **1226 lines** | a 473-line WebSocket gateway in core, plus posting + approval rendering in plugins/scripts |
| Antfly imports | **13** | core + 4 plugins + scripts |
| Direct `flow_runs` SQL | **multiple** | bakin's tasks plugin reads OpenClaw's SQLite directly; even bakin-only fields (kanban column, ordering, comments) are stuffed into `state_json` inside that DB |

### Why this matters

Today bakin claims to be "an adapter over OpenClaw" but the abstraction
is structural, not enforced. A new plugin author has no way to know
where the boundary is. Switching from OpenClaw to a hypothetical
Hermes today would require touching ~58 files. Worse, bakin's task
metadata (kanban state, sort order, comments, tags, project linkage)
lives entirely inside OpenClaw's database — uninstall OpenClaw and
that data evaporates.

The adapter layer is the architecturally correct fix: a stable contract
bakin commits to, with implementations that translate.

## 3. Design principles

These were locked through a 7-question grill. They shape every
specific decision below.

1. **Two adapter types, separate workspace packages.** Runtime and
   search evolve independently. Future Hermes adapter is its own
   package; users who don't switch backends never see the cost.
2. **Interfaces in `packages/core`, implementations in their own
   packages.** Bakin owns the contract; adapter packages prove they
   satisfy it.
3. **Static dispatch from settings.** `bakin.settings.json` declares
   `runtime.adapter: "openclaw"`; a switch statement in core resolves
   to the static import. Future dynamic resolution layers on without
   changing the settings shape.
4. **Adapters initialize before plugins activate.** Boot order:
   settings → adapter init → plugin registry → HTTP server.
5. **Restart-required when adapter settings change.** No hot-swapping.
6. **Channels are part of the runtime adapter.** Channel config lives
   in the runtime (e.g., OpenClaw's `openclaw.json`). Bakin code is
   channel-agnostic; switching from Discord to Telegram is a runtime
   config change with zero bakin code change.
7. **Rigid mandatory implementation.** Every interface method is
   required. Adapters provide fallback implementations for runtime
   primitives the underlying system lacks. Plugins NEVER call
   `has(capability)` — they call the API and get a (possibly degraded)
   result. Per-channel capabilities (`buttons`, `modals`, etc.) are
   the one exception, declared on `ChannelInfo`.
8. **Bakin owns concepts, runtime owns execution.** Tasks split: bakin
   stores metadata (title, agent, kanban column, ordering, comments,
   tags, links) in `~/.bakin/tasks/YYYY-MM/task-*.json`; runtime stores
   execution (status, blocking, retries, current_step) via the adapter.
9. **Escape hatches are Proxy-tracked.** When the typed interface is
   incomplete (a runtime exposes a config field bakin's `RuntimeConfig`
   doesn't have), a `raw()` accessor returns a Proxy that logs every
   key access. Bakin's doctor surfaces gaps so the typed interface
   evolves toward what plugins actually need.
10. **Score breakdowns are first-class.** Search results carry per-
    signal scores (`fts`, `vector`, `hybrid`, `rerank`) so debug
    visibility survives the abstraction.

## 4. Package structure

```
packages/
├── core/
│   └── src/
│       └── adapters/                              [NEW — interfaces only]
│           ├── runtime/
│           │   ├── index.ts                       AgentRuntimeAdapter
│           │   ├── concepts.ts                    Agent, Task, Skill, Channel...
│           │   ├── capabilities.ts                ChannelCapability + helpers
│           │   ├── select.ts                      selectRuntimeAdapter(name)
│           │   └── testing.ts                     createMockRuntimeAdapter
│           └── search/
│               ├── index.ts                       SearchAdapter
│               ├── concepts.ts                    Query, ScoreBreakdown...
│               ├── select.ts                      selectSearchAdapter(name)
│               └── testing.ts                     createMockSearchAdapter
├── adapter-openclaw/                              [NEW — workspace package]
│   ├── package.json                               private: true; @bakin/core peer
│   ├── tsconfig.json                              extends root
│   └── src/
│       ├── index.ts                               exports OpenClawAdapter
│       ├── runtime.ts                             AgentRuntimeAdapter impl
│       ├── lifecycle.ts                           gateway start/stop/ping
│       ├── agents.ts                              list/get/identity from openclaw.json
│       ├── messaging.ts                           send/stream/chat (incl. AsyncIterable<ChatChunk>)
│       ├── tools.ts                               invokeTool wrapper
│       ├── skills.ts                              ~/.openclaw/skills/ ops
│       ├── sessions.ts                            agents/{id}/sessions/ readers
│       ├── memory.ts                              workspace/memory/** + tier parsers
│       ├── tasks.ts                               flow_runs queries + dispatch + subscribe
│       ├── cron.ts                                cron/jobs.json + cron/runs/
│       ├── config.ts                              openclaw.json reader + Proxy-tracked raw()
│       ├── client.ts                              [moved] gateway HTTP client
│       ├── home.ts                                [moved] path resolution
│       ├── channels/
│       │   ├── index.ts                           channel router
│       │   ├── discord/
│       │   │   ├── gateway.ts                     [moved from src/core/]
│       │   │   ├── post.ts                        [moved from scripts/lib/]
│       │   │   ├── approval.ts                    abstract → buttons render
│       │   │   └── interactions.ts                INTERACTION_CREATE handler
│       │   ├── slack/                             (future)
│       │   └── telegram/                          (future)
│       ├── health-checks.ts                       [absorbed from plugins/health/system-checks]
│       └── tests/
└── adapter-antfly/                                [NEW — workspace package]
    ├── package.json
    └── src/
        ├── index.ts                               exports AntflyAdapter
        ├── search.ts                              SearchAdapter impl
        ├── server.ts                              [moved] daemon mgmt
        ├── tables.ts                              create/drop/list/stats/health
        ├── documents.ts                           index/remove/batch/transform
        ├── queries.ts                             query/multi/scan + ScoreBreakdown
        ├── embedder.ts                            hasChanged + rebuildAll
        ├── health-checks.ts                       [moved from plugins/health]
        └── tests/
```

Interfaces live in `packages/core/src/adapters/`. Adapter implementations
declare `peerDependencies: { '@bakin/core': '^1.0.0' }` so they target
a specific interface major version.

## 5. Boot + registration

```
1. Load ~/.bakin/settings.json
2. selectRuntimeAdapter(settings.runtime.adapter) → instance
   selectSearchAdapter(settings.search.adapter) → instance
3. assertAdapterCompatibility — boot-time check that adapters target
   the interface version this build provides
4. await runtimeAdapter.initialize({ logger, contentDir, audit })
   await searchAdapter.initialize({ ... })
5. registerCorePlugins(...)
6. await pluginRegistry.initialize() — plugins activate; ctx.runtime
   and ctx.search are live and usable inside their activate(ctx)
7. HTTP server starts accepting traffic
```

Mismatch at step 3 → loud boot error: `"adapter @bakin/adapter-openclaw@2.0.0 requires @bakin/core ^2.0.0; this build provides @bakin/core@1.5.2. Upgrade bakin or downgrade the adapter."`

## 6. AgentRuntimeAdapter — full interface

12 concepts. Each concept's methods are listed in TypeScript-ish
shorthand below; complete TS lives in
`packages/core/src/adapters/runtime/index.ts` once implemented.

### 6.1 Lifecycle

```ts
interface AgentRuntimeAdapter {
  readonly name: string                                // 'openclaw'
  readonly version: string                             // adapter package semver
  readonly requiredCoreVersion: string                 // e.g., '^1.0.0'

  initialize(opts: AdapterInitOpts): Promise<void>
  shutdown(): Promise<void>
  ping(): Promise<boolean>
  restart(): Promise<void>
  getHealthChecks(): HealthCheckDefinition[]

  // Plus all 11 concept namespaces below: agents, messaging, tools,
  // channels, skills, sessions, memory, tasks, cron, config
}
```

`AdapterInitOpts` carries the bakin-side context the adapter needs:
logger factory, content-dir resolver, audit emitter, settings-section
slice the adapter owns.

### 6.2 Agents (workspace folds in here)

```ts
agents: {
  list(): Promise<Agent[]>
  get(id: string): Promise<Agent | null>
  getMainId(): Promise<string | null>
  readIdentity(id: string): Promise<AgentIdentity>          // SOUL/AGENTS/IDENTITY/TOOLS
  writeIdentity(id: string, identity: Partial<AgentIdentity>): Promise<void>
  getLastReply(id: string): Promise<number | null>          // ms timestamp
  subscribeStatus(handler: (event: AgentStatusEvent) => void): Unsubscribe
}

interface Agent {
  id: string
  name: string
  workspacePath?: string                                    // INFORMATIONAL ONLY
  metadata?: Record<string, unknown>
}

interface AgentIdentity {
  soul?: string
  agents?: string
  identity?: string
  tools?: string
}
```

`workspacePath` is documented as informational-only. The lint rule
flags `existsSync(agent.workspacePath)` and similar fs ops.

### 6.3 Messaging

```ts
messaging: {
  send(agentId: string, message: string, opts?: SendOpts): Promise<string>
  stream(opts: ChatOpts): Promise<AsyncIterable<ChatChunk>>
  complete(opts: ChatOpts): Promise<string>
}

interface ChatChunk {
  type: 'token' | 'tool_call' | 'done' | 'error'
  content?: string
  toolCall?: { name: string; args: unknown }
  error?: { message: string }
}
```

`stream` returns `AsyncIterable<ChatChunk>` not raw `Response` — typed
contract; plugins iterate chunks; adapter parses runtime's native
stream format.

### 6.4 Tools

```ts
tools: {
  invoke(agentId: string, name: string, args: unknown): Promise<ToolResult>
  list(agentId: string): Promise<ToolDefinition[]>
}

interface ToolResult {
  ok: boolean
  output?: unknown
  error?: { message: string; recoverable: boolean }
}
```

### 6.5 Channels (load-bearing — handles the abstraction work)

```ts
channels: {
  list(): Promise<ChannelInfo[]>

  // Four abstract operations — adapter renders per-platform
  requestApproval(args: ApprovalArgs): Promise<ApprovalResponse>
  sendNotification(args: NotificationArgs): Promise<DeliveryResult>
  sendMessage(args: MessageArgs): Promise<DeliveryResult>
  deliverContent(args: ContentDeliveryArgs): Promise<DeliveryResult>

  onMessage(handler: (event: ChannelMessageEvent) => void): Unsubscribe
  onInteraction(handler: (event: ChannelInteractionEvent) => void): Unsubscribe
}

interface ChannelInfo {
  id: string                                                // 'discord:main', opaque
  platform: string                                          // 'discord' | 'slack' | ...
  label: string
  capabilities: ChannelCapability[]
}

type ChannelCapability =
  | 'message'
  | 'rich-content'
  | 'interactive-approval'
  | 'modal-input'
  | 'threaded-replies'

// Approval — interactive, awaits response
interface ApprovalArgs {
  channels: string[]
  request: {
    title: string
    body: string
    options: ApprovalOption[]
    expiresAt?: string
    context?: Record<string, unknown>
  }
}

interface ApprovalOption {
  id: string                                                // 'approve' | 'reject' | etc
  label: string
  variant?: 'primary' | 'destructive' | 'neutral'
}

interface ApprovalResponse {
  selectedOption: string
  respondedAt: string
  actor: { type: 'agent' | 'human'; id: string }
  comment?: string
}

// Notification — fire-and-forget operational alerts
interface NotificationArgs {
  channels: string[]
  notification: {
    severity: 'info' | 'warn' | 'error' | 'success'
    title: string
    body: string
    fields?: { label: string; value: string }[]
    cta?: { label: string; href: string }
    assets?: Asset[]
  }
}

// Message — fire-and-forget plain communication
interface MessageArgs {
  channels: string[]
  text: string
  threadId?: string
  mentionAgentId?: string
  assets?: Asset[]
}

// Content delivery — publishing user-authored content
interface ContentDeliveryArgs {
  channels: string[]
  content: {
    title?: string
    body?: string
    assets?: Asset[]
    metadata?: Record<string, unknown>
  }
}

interface Asset {
  source: string                                            // 'asset:...' | URL | path | data:
  kind: 'image' | 'video' | 'document' | 'audio' | 'archive' | 'data'
  filename?: string
  mimeType?: string
  hints?: {
    alt?: string
    caption?: string
    poster?: string
    durationMs?: number
    width?: number
    height?: number
    pageCount?: number
  }
}
```

The four ops carry semantic weight adapters render differently.
Discord's approval becomes interactive buttons. Telegram's becomes
inline keyboard. Plain-text fallback is numbered options.

### 6.6 Skills

```ts
skills: {
  list(scope?: SkillScope): Promise<Skill[]>
  get(name: string, scope?: SkillScope): Promise<Skill | null>
  install(name: string, content: SkillContent, scope?: SkillScope): Promise<void>
  uninstall(name: string, scope?: SkillScope): Promise<void>
  isUserEdited(name: string, scope?: SkillScope): Promise<boolean>
}

type SkillScope =
  | { kind: 'global' }
  | { kind: 'agent'; agentId: string }
  | { kind: 'workspace'; agentId: string }

interface Skill {
  name: string
  scope: SkillScope
  installedBy?: string
  contentSha: string
}

interface SkillContent {
  manifest: string
  files?: Record<string, Buffer | string>
}
```

### 6.7 Sessions

```ts
sessions: {
  list(agentId: string, opts?: SessionListOpts): Promise<SessionSummary[]>
  get(agentId: string, sessionId: string): Promise<Session | null>
  read(agentId: string, sessionId: string): AsyncIterable<SessionEvent>
}
```

Read-only in v1.

### 6.8 Memory (raw tier reads only)

```ts
memory: {
  tiers(agentId: string): Promise<MemoryTier[]>
  read(agentId: string, tierId: string, opts?: ReadOpts): AsyncIterable<MemoryEntry>
}

interface MemoryTier {
  id: string                                                // 'durable', 'unified', etc
  label: string
  description?: string
  capabilities: ('readable' | 'writable')[]
  estimatedSize?: { entries?: number; bytes?: number }
}

interface MemoryEntry {
  id: string
  tierId: string
  agentId: string
  ts: string
  content: string
  metadata?: Record<string, unknown>
}
```

Tier IDs are runtime-specific. Bakin's memory plugin iterates whatever
the adapter declares; doesn't hardcode tier names. Indexing + cross-
cutting search lives in the memory plugin itself, using SearchAdapter
to populate `bakin_memory`.

### 6.9 Tasks (split-layer — bakin metadata + runtime execution)

Bakin owns task metadata in `~/.bakin/tasks/`. Adapter is the executor.

```ts
tasks: {
  dispatch(args: TaskDispatch): Promise<{ flowId: string }>
  getExecutionStatus(flowId: string): Promise<TaskExecutionStatus>
  listExecutions(opts?: ListExecutionsOpts): Promise<TaskExecutionStatus[]>
  cancelExecution(flowId: string): Promise<void>
  subscribeExecutionUpdates(handler: (event: TaskExecutionEvent) => void): Unsubscribe
  listAdoptableExecutions(opts?: { since?: string; limit?: number }): Promise<AdoptableExecution[]>
}

interface TaskDispatch {
  bakinTaskId: string
  agentId: string
  goal: string
  workflowDefinition?: unknown
}

interface TaskExecutionStatus {
  flowId: string
  bakinTaskId?: string
  state: 'queued' | 'running' | 'blocked' | 'succeeded' | 'failed' | 'cancelled'
  startedAt?: string
  endedAt?: string
  currentStep?: string
  blockingReason?: string
  retryCount?: number
  output?: unknown
  error?: { message: string; recoverable: boolean }
}

interface AdoptableExecution {
  flowId: string
  goal: string
  agentId: string
  startedAt: string
  state: TaskExecutionStatus['state']
}
```

The "adopt existing" workflow exists for the "already using OpenClaw,
install bakin" case: bakin reads runtime executions that have no bakin
metadata yet, offers to create bakin-side records. Runtime continues
executing; bakin gains ownership of metadata.

### 6.10 Cron

```ts
cron: {
  listJobs(): Promise<CronJob[]>
  listRuns(opts?: { jobId?: string; since?: string; limit?: number }): Promise<CronRun[]>
  getJob(id: string): Promise<CronJob | null>
}
```

Read-only in v1.

### 6.11 Config

```ts
config: {
  read(): Promise<RuntimeConfig>                            // typed; preferred path
  raw(): Promise<RawConfigProxy>                            // Proxy-tracked fallback
}

interface RuntimeConfig {
  agentIds: string[]
  defaultModel?: string
  workspaceRoot: string
  channels?: { configured: string[] }
}
```

`raw()` returns a Proxy. Every property access logs `{ pluginId,
keyPath, runtimeAdapter, timestamp }` to a ring buffer. Bakin's doctor
surfaces gaps:

```
Adapter abstraction gaps detected:
  pluginId    keyPath                    accessCount
  ──────────  ─────────────────────────  ───────────
  messaging   gateway.port               147
  workflows   channels.discord.guildId   89
```

The lint rule warns on `raw()` usage (soft). Telemetry data drives
typed-promotion priorities.

## 7. SearchAdapter — full interface

15-ish methods. Smaller surface; sits BELOW bakin's `search-registry.ts`
which is unchanged from a plugin perspective.

```ts
interface SearchAdapter {
  readonly name: string
  readonly version: string

  initialize(): Promise<void>
  shutdown(): Promise<void>
  available(): Promise<boolean>
  getHealthChecks(): HealthCheckDefinition[]

  tables: {
    list(): Promise<TableInfo[]>
    create(name: string, config: TableConfig): Promise<void>
    drop(name: string): Promise<void>
    stats(name: string): Promise<TableStats | null>
    getHealth(name: string): Promise<TableHealth | null>
    rebuildIndexes(name: string): Promise<void>
  }

  documents: {
    index(table: string, key: string, doc: Document, opts?: IndexOpts): Promise<void>
    batchIndex(table: string, items: IndexItem[], opts?: IndexOpts): Promise<BatchResult>
    remove(table: string, key: string): Promise<void>
    batchRemove(table: string, keys: string[]): Promise<number>
    transform(table: string, key: string, fn: TransformFn): Promise<void>
  }

  query(table: string, q: Query): Promise<QueryResult>
  multiQuery(queries: Array<{ table: string; query: Query }>): Promise<QueryResult[]>
  scan(table: string, opts?: ScanOpts): AsyncIterable<Document>

  embedder: {
    hasChanged(): Promise<boolean>
    rebuildAll(): Promise<RebuildReport>
  }
}

interface Query {
  text?: string
  vector?: number[]
  filters?: Filter[]
  sort?: SortSpec
  limit?: number
}

interface QueryResult {
  hits: SearchHit[]
  total?: number
  diagnostics?: QueryDiagnostics
}

interface SearchHit {
  key: string
  document: Document
  score: number                                             // canonical [0,1]
  scoreBreakdown?: ScoreBreakdown
  matchedFields?: string[]
  highlights?: Record<string, string>
  explanation?: unknown                                     // adapter raw explain
}

interface ScoreBreakdown {
  fts?: number
  vector?: number
  hybrid?: number
  rerank?: number
  raw?: Record<string, number>
}

interface QueryDiagnostics {
  timingMs: number
  strategy?: 'fts' | 'vector' | 'hybrid' | 'rerank'
  candidatesScanned?: number
  cached?: boolean
  raw?: unknown
}

interface TableConfig {
  schema: FieldDefinition[]
  primaryKey: string
  facets?: string[]
  searchable?: string[]
  embedded?: { fields: string[] }
  ttl?: { field: string; days: number }
  raw?: Record<string, unknown>                             // Proxy-tracked
}
```

### Query strategy is adapter's call

Adapter picks FTS / vector / hybrid based on what's available. Plugin
specifies `text` or `vector` (or both); adapter chooses how. FTS-only
adapters fall back to text-only; vector-only adapters embed text
internally.

### Score breakdown survives the abstraction

Adapter populates `scoreBreakdown.{fts,vector,hybrid,rerank}` for
whichever signals contributed. Bakin's debug-mode UI renders the
breakdown. Switching backends preserves debug visibility as long as
the new adapter populates the same shape.

## 8. Bakin task store

New storage layer at `~/.bakin/tasks/YYYY-MM/task-<id>.json`.

```json
{
  "id": "task-abc123",
  "title": "Write blog post about plugin architecture",
  "description": "...",
  "agent": "pixel",
  "column": "in-progress",
  "order": 2,
  "tags": ["blog", "engineering"],
  "workflowId": "content-pipeline",
  "projectId": "blog-q2",
  "executionFlowId": "fr_xyz789",
  "log": [...],
  "createdAt": "2026-04-27T...",
  "updatedAt": "2026-04-27T..."
}
```

Atomic writes via tmp+rename (consistent with `lockfile.ts` pattern).
Chokidar watches `~/.bakin/tasks/` for SSE broadcasts. Antfly-indexed
for cross-cutting search via the existing `bakin_memory` table or a
new `bakin_tasks` content type.

## 9. Versioning

Three semver layers:

| Layer | What | Major bump means |
|---|---|---|
| `@bakin/sdk` | Plugin author surface (`ctx.runtime.*`, `ctx.search.*`) | breaking ctx.* change |
| `@bakin/core/adapters` | Adapter interface contract | breaking interface change |
| `@bakin/adapter-{openclaw,antfly}` | Adapter behavior | breaking behavior change |

Boot-time check (server.ts): adapter declares `requiredCoreVersion`;
if it doesn't satisfy this build's `ADAPTER_INTERFACE_VERSION`, fail
loud with version + remediation.

Deprecation cycle: `@deprecated('use X — removed in Y.0')` JSDoc +
runtime warning + at least one minor version of overlap.

Day-1 ship: all packages at 1.0.0 from the same monorepo. Discipline
matters when third-party adapters land (~6+ months out).

## 10. Boundary enforcement

Three layers of guard:

### ESLint (compile-time gate)

`eslint.config.mjs` adds `no-restricted-imports` patterns:

- `**/openclaw-client`, `**/openclaw-home`, `**/openclaw-config`,
  `@bakin/core/openclaw-*` — banned everywhere except
  `packages/adapter-openclaw/**`
- `**/src/core/antfly`, `**/src/core/antfly-server` — banned everywhere
  except `packages/adapter-antfly/**`
- `@bakin/adapter-openclaw`, `@bakin/adapter-antfly` (and sub-paths)
  — banned in plugin code; restricted to bakin core boot wiring

### Architecture fitness test

`tests/architecture/adapter-boundary.test.ts` walks `src/`, `cli/`,
`plugins/`, `packages/host/`, `packages/core/` (excluding adapter
packages and select boot-wiring files). Asserts:

- No imports of openclaw-client / openclaw-home / openclaw-config
- No imports of src/core/antfly / antfly-server
- No literal `getOpenClawPath(...)` outside adapter
- No `flow_runs` SQL outside adapter
- No `~/.openclaw/` path strings outside adapter
- No `vault.get('gateway-token')` outside adapter

Fails CI loud with file:line citations. Belt + suspenders against
ESLint config drift.

### Type-level

`PluginContext.runtime: AgentRuntimeAdapter` and
`PluginContext.search: SearchAPI` are the only adapter touchpoints
plugin code can see. Adapter packages' `exports` map doesn't expose
implementation classes (`OpenClawAdapter`, etc.) — accidental import
attempts are dead-end at the type layer.

## 11. Documentation that ships with the work

| File | Status | Purpose |
|---|---|---|
| `.claude/knowledge/adapter-architecture.md` | NEW | canonical deep reference |
| `.claude/skills/check-adapter-boundary.md` | NEW | invocable audit skill |
| `CLAUDE.md` | UPDATE | adapter section + storage map updates |
| `.claude/knowledge/plugin-system.md` | UPDATE | "Plugins and adapters" subsection |
| `.claude/knowledge/repo-architecture.md` | UPDATE | new packages in map |
| `.claude/knowledge/search-system.md` | UPDATE | SearchAdapter + score breakdown contract |
| `.claude/knowledge/dispatch.md` | UPDATE | uses ctx.runtime.messaging |
| `.claude/knowledge/doctor-and-health-checks.md` | UPDATE | adapter exposes health checks |
| `docs-old/plugin-authoring.md` | UPDATE | ctx.runtime / ctx.search sections |

## 12. Test mock harness

`@bakin/sdk/testing` exports:

- `createMockRuntimeAdapter(overrides?)` — in-memory implementation of
  every method. Sensible defaults; per-test overrides.
- `createMockSearchAdapter(overrides?)` — same shape.

Plugin tests build a context with mocks as `ctx.runtime` / `ctx.search`.
The 30+ `mock.module('@/core/openclaw-client', ...)` patterns scattered
across today's tests consolidate to one canonical mock surface.

`tests/plugins/test-helpers.ts` consumes these from `@bakin/sdk/testing`
instead of carrying ad-hoc mocks.

## 13. Migration strategy

See `.claude/specs/adapter-layer-plan.md` for the staged-PR plan.
Six PRs (PR 0 prep + PRs 1-5 implementation). Each PR ships
self-contained; system stays functional between PRs. Each PR's
description includes manual confirmation steps.

## 14. Definition of done

The full series is complete when:

- [ ] `packages/adapter-openclaw/` and `packages/adapter-antfly/` exist
      and pass `bun typecheck` + `bun test`.
- [ ] `packages/core/src/adapters/` defines both interfaces.
- [ ] No file under `src/`, `cli/`, `plugins/`, or `packages/host/`
      imports `openclaw-client`, `openclaw-home`, `openclaw-config`,
      or `src/core/antfly*`.
- [ ] No plugin file imports from `@bakin/adapter-{openclaw,antfly}`.
- [ ] `tests/architecture/adapter-boundary.test.ts` passes against
      a fully-migrated codebase.
- [ ] `~/.bakin/tasks/` is the live task metadata store; flow_runs
      contains only execution-side fields.
- [ ] Every plugin's primary feature works against a freshly-cloned
      bakin instance (manual smoke per the plan doc).
- [ ] `bun run lint`, `bun run typecheck`, `bun test --isolate`,
      `bun run docs:check`, `bun run lint:home-bypasses` all pass
      across every PR in the chain.
- [ ] `.claude/knowledge/adapter-architecture.md` exists and is
      cross-referenced from CLAUDE.md.
- [ ] `.claude/skills/check-adapter-boundary.md` is invocable.

## 15. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Adapter abstraction is too leaky (specifics of OpenClaw bleed into the interface) | Telemetry-tracked `raw()` accessors surface gaps; adapter authoring docs (Tier 4) prescribe how to handle runtime-specific concerns; the rigid-mandatory model forces fallback-in-adapter rather than capability-flag-in-plugin |
| Adapter abstraction is too rigid (Hermes can't fit) | Per-channel capabilities, AsyncIterable streams, and `metadata` fields on most types provide adapter-specific wiggle room without breaking the contract |
| Big-bang refactor introduces regressions | Staged PRs (PR 0–5); each is self-contained and tested before the next opens; manual confirmation steps in each PR |
| Plugin tests break across all plugins simultaneously | The mock harness ships in PR 1; tests migrate to it as plugins migrate; existing ad-hoc mocks coexist during transition |
| Tasks data loss during migration | User confirmed wipe is acceptable; one-shot adoption flow handles "OpenClaw users installing bakin" case |
| flow_runs contention between bakin and OpenClaw | Bakin's adapter respects OpenClaw's `revision` column for optimistic concurrency; multiple writers don't clobber |
| Hot reload breaks adapter init | Restart-required for adapter changes (locked at Q2.3); adapter init lives outside the hot-reload pipeline |
| Discord migration leaves orphan auth flows | `discord-gateway.ts` moves entirely into `adapter-openclaw/channels/discord/`; init order ensures the gateway WS connects on adapter init |
| Versioning drift between SDK + core + adapter | Boot-time compatibility check at step 3 of boot sequence; loud failure mode |

## 16. Open questions (to settle during implementation)

- **Tasks adoption flow UX.** When existing flow_runs have no bakin
  metadata, do we auto-adopt silently or prompt the user? Lean toward
  prompt for the first install; auto for subsequent.
- **Per-channel capability list specifics.** Current draft has 5
  values (`message`, `rich-content`, `interactive-approval`,
  `modal-input`, `threaded-replies`). May surface a 6th as adapter
  implementations land.
- **Antfly adapter's stance on a non-running daemon.** Bakin currently
  tolerates `antfly.enabled: false`. The adapter should preserve that
  — `available()` returns false; bakin's search-registry no-ops; doctor
  surfaces "search disabled."
- **Hermes adapter target.** Spec'd alongside but not implemented.
  When work begins, the AgentRuntimeAdapter interface will be tested
  against Hermes' actual capabilities; some fields may need
  adjustment.

## 17. Out of scope

- Third-party adapter authoring docs (Tier 4 — when external authors
  become real).
- Telemetry dashboard for `raw()` usage (Tier 4 — built later when
  data accumulates).
- Per-adapter README capability matrices (Tier 4).
- Rate limiting of `ctx.runtime.*` invocations (separate spec).
- Channel capabilities beyond the 5-value list above (extended as
  adapter implementations surface real needs).
