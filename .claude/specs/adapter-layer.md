# Adapter Layer Architecture

**Status:** Draft 2 — hardened review draft
**Supersedes:** `.claude/specs/sdk-expansion-for-extraction.md` (the original SDK expansion approach is replaced by this; that earlier spec stays as historical context for the design conversation)
**Companion:** `.claude/specs/adapter-layer-plan.md` (single-PR hard-cutover plan)
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

These are the constraints this design is optimizing for. They shape every
specific decision below.

1. **Two adapter types, separate workspace packages.** Runtime and
   search evolve independently. Future Hermes adapter is its own
   package; users who don't switch backends never see the cost.
2. **Interfaces in `packages/core`, implementations in their own
   packages.** Bakin owns the contract; adapter packages prove they
   satisfy it.
3. **Static dispatch from app boot settings.** `getContentDir()/settings.json`
   declares `runtime.adapter: "openclaw"` and `search.adapter: "antfly"`.
   App boot code resolves those names to static imports. `packages/core`
   owns interfaces only; it must not import concrete adapter packages.
4. **Adapters initialize before plugins activate; search tables after schemas.**
   Boot order: settings and paths -> adapter selection -> adapter init ->
   plugin activation/schema collection -> search provisioning -> HTTP server.
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
   tags, links) in `getBakinPaths().tasks/YYYY-MM/task-*.json` (with
   `~/.bakin/tasks/` being the default resolution); runtime stores
   execution (status, blocking, retries, current_step) via the adapter.
9. **Escape hatches are temporary and gated.** Plugin code must not depend on
   runtime-specific raw config in the final hard-cutover PR. Any temporary
   `raw()` access must be allowlisted, telemetry-logged, and attached to a
   tracked follow-up to promote it into the typed interface or delete it.
10. **Score breakdowns are first-class.** Search results carry per-
    signal scores (`fts`, `vector`, `hybrid`, `rerank`) so debug
    visibility survives the abstraction.
11. **One runtime injection spine.** The boot process creates one
    `AppServices` object and passes it everywhere that needs runtime,
    search, task, channel, or health behavior. Plugin contexts, plugin
    route handlers, MCP tools, CLI/script entrypoints, server lifecycle
    code, and tests all consume that same object shape.
12. **Non-plugin code is not exempt.** `src/`, `cli/`, `scripts/`,
    `packages/host/`, and core lifecycle/health/onboarding code follow
    the same adapter boundary as plugins. Provider-specific code belongs
    in adapter packages or a clearly documented boot-wiring file.

## 4. Package structure

```
packages/
├── core/
│   └── src/
│       ├── app-services.ts                         [NEW — AppServices shape]
│       ├── tasks/
│       │   └── store.ts                            [NEW — Bakin task store]
│       └── adapters/                              [NEW — interfaces only]
│           ├── runtime/
│           │   ├── index.ts                       AgentRuntimeAdapter
│           │   ├── concepts.ts                    Agent, Task, Skill, Channel...
│           │   ├── capabilities.ts                ChannelCapability + helpers
│           │   └── testing.ts                     createMockRuntimeAdapter
│           └── search/
│               ├── index.ts                       SearchAdapter
│               ├── concepts.ts                    Query, ScoreBreakdown...
│               └── testing.ts                     createMockSearchAdapter
├── adapter-openclaw/                              [NEW — workspace package]
│   ├── package.json                               private: true; @bakin/core peer
│   ├── tsconfig.json                              extends root
│   └── src/
│       ├── index.ts                               exports createOpenClawRuntimeAdapter (factory only)
│       ├── runtime.ts                             AgentRuntimeAdapter impl
│       ├── lifecycle.ts                           gateway start/stop/ping
│       ├── agents.ts                              list/get/identity from openclaw.json
│       ├── messaging.ts                           send/stream/chat (incl. AsyncIterable<ChatChunk>)
│       ├── tools.ts                               invokeTool wrapper
│       ├── skills.ts                              runtime skill store ops
│       ├── sessions.ts                            agents/{id}/sessions/ readers
│       ├── memory.ts                              workspace/memory/** + tier parsers
│       ├── tasks.ts                               flow_runs execution queries + dispatch + subscribe
│       ├── cron.ts                                cron/jobs.json + cron/runs/
│       ├── config.ts                              openclaw.json typed reader + gated raw()
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
        ├── index.ts                               exports createAntflySearchAdapter (factory only)
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
a specific interface major version. Concrete adapter selection lives in app
boot code outside `packages/core`; otherwise `@bakin/core` would import
packages that also peer-depend on it.

**Adapter packages export FACTORIES, not implementation classes.** Each
adapter package's `index.ts` exports only the appropriate factory
(`createOpenClawRuntimeAdapter`, `createAntflySearchAdapter`) returning
`AgentRuntimeAdapter` (or `SearchAdapter`). Implementation classes
(`OpenClawAdapter`, `AntflyAdapter`) are package-internal and never
appear in the public surface. The `package.json` `exports` map exposes
only the factory.

This pattern resolves the type-level enforcement requirement: app boot imports
`createOpenClawRuntimeAdapter` and treats the return value as `AgentRuntimeAdapter`
only. Plugin code that tries to
`import { OpenClawAdapter } from '@bakin/adapter-openclaw'` fails at
both lint (no-restricted-imports rule) AND module resolution (the
class isn't in the exports map). Defense in depth.

## 5. Boot + registration

```
1. Load Bakin paths and `getContentDir()/settings.json`
2. App boot selects concrete adapters from static imports:
   `runtime.adapter` -> `createOpenClawRuntimeAdapter`
   `search.adapter` -> `createAntflySearchAdapter`
3. assertAdapterCompatibility - boot-time check that adapters target
   the interface version this build provides
4. await runtimeAdapter.initialize({ logger, contentDir, audit })
   await searchAdapter.initialize({ ... })
5. registerCorePlugins(...)
6. await pluginRegistry.initialize() - plugins activate; ctx.runtime
   and ctx.search are live and usable inside their activate(ctx)
7. collect plugin search schemas
8. provision/reconcile search tables
9. HTTP server starts accepting traffic
```

Mismatch at step 3 -> loud boot error: `"adapter @bakin/adapter-openclaw@2.0.0 requires @bakin/core ^2.0.0; this build provides @bakin/core@1.5.2. Upgrade bakin or downgrade the adapter."`

### 5.1 AppServices injection spine

The hard cutover introduces one application service object created by boot code
after adapter selection and compatibility checks. It is the only sanctioned way
for non-adapter code to access runtime/search/task/channel behavior.

```ts
interface AppServices {
  runtime: AgentRuntimeAdapter
  search: SearchAdapter
  tasks: BakinTaskStore
  health: HealthService
}

interface HealthService {
  listChecks(): HealthCheckDefinition[]
  runAll(): Promise<HealthCheckResult[]>
}
```

Required consumers:

- `PluginContext` exposes `ctx.runtime`, `ctx.search`, and task helpers backed
  by this object.
- Plugin route handlers created by `packages/host/` receive this object instead
  of rebuilding provider-specific context per request.
- MCP tool registration receives this object; MCP tools do not import OpenClaw,
  Antfly, Discord, or task-flow internals directly.
- CLI commands and scripts either bootstrap `AppServices` through a shared
  `loadAppServicesForCli()` helper or call server HTTP APIs. They do not create
  ad-hoc OpenClaw/Antfly clients.
- Server lifecycle, onboarding, doctor, watchdog, and health checks use
  `AppServices` or adapter health checks. They are not special cases.
- Test helpers create mock `AppServices` from `createMockRuntimeAdapter`,
  `createMockSearchAdapter`, and the in-memory task store.

Only app boot/server wiring may import concrete adapter factories. Every other
caller receives interfaces. A file that needs provider-specific behavior must
move into an adapter package or add a final-state boundary exception before the
PR is complete.

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

The team plugin's existing OpenClaw adapter does much more than
list/get — it creates and removes agents, manages auth allowlists,
edits permissions, and writes workspace files. The interface must
cover all of those or the hard cutover will fail the boundary checks.

```ts
agents: {
  // Discovery
  list(): Promise<Agent[]>
  get(id: string): Promise<Agent | null>
  getMainId(): Promise<string | null>

  // Lifecycle (create/update/remove)
  create(spec: AgentSpec): Promise<Agent>
  update(id: string, patch: AgentPatch): Promise<Agent>
  remove(id: string): Promise<void>

  // Identity files (SOUL/AGENTS/IDENTITY/TOOLS — covers workspace writes)
  readIdentity(id: string): Promise<AgentIdentity>
  writeIdentity(id: string, identity: Partial<AgentIdentity>): Promise<void>

  // Safe workspace files (non-recursive v1; path traversal rejected)
  listWorkspaceFiles(id: string): Promise<WorkspaceFile[]>
  readWorkspaceFile(id: string, filename: string): Promise<string | null>
  writeWorkspaceFile(id: string, filename: string, content: string): Promise<void>
  readHeartbeat(id: string): Promise<{ content: string; lastUpdated: string | null } | null>

  // Permissions / auth profiles (varies by runtime; abstract shape)
  readPermissions(id: string): Promise<AgentPermissions>
  writePermissions(id: string, perms: Partial<AgentPermissions>): Promise<void>

  // Status / state (push-based)
  getLastReply(id: string): Promise<number | null>
  subscribeStatus(handler: (event: AgentStatusEvent) => void): Unsubscribe
}

interface Agent {
  id: string
  name: string
  workspacePath?: string                                    // INFORMATIONAL ONLY
  metadata?: Record<string, unknown>
}

interface AgentSpec {
  id?: string                                               // adapter generates if omitted
  name: string
  identity?: Partial<AgentIdentity>                         // optional initial files
  permissions?: Partial<AgentPermissions>
  metadata?: Record<string, unknown>
}

interface AgentPatch {
  name?: string
  metadata?: Record<string, unknown>
}

interface AgentIdentity {
  soul?: string
  agents?: string
  identity?: string
  tools?: string
}

interface WorkspaceFile {
  filename: string
  size?: number
  updatedAt?: string
}

interface AgentPermissions {
  /** Generic ACL — list of principal IDs allowed to interact. */
  allowlist?: string[]
  /** Tool names this agent may invoke (or `'*'` for unrestricted). */
  tools?: string[] | '*'
  /** Adapter-extensible field for runtime-specific permission shape
   *  (e.g., OpenClaw's auth-profiles.json structure). Must be documented
   *  if final plugin behavior depends on fields outside the typed shape. */
  metadata?: Record<string, unknown>
}
```

`workspacePath` is documented as informational-only. The lint rule
flags `existsSync(agent.workspacePath)` and similar fs ops.

Identity-oriented workspace writes (SOUL.md, IDENTITY.md, etc) go through
`writeIdentity`. General root-level workspace file reads/writes go through the
safe workspace file methods above. V1 is intentionally non-recursive; filenames
containing `/`, `\`, or `..` are rejected by the adapter. Per-agent skill
installation goes through `skills.install({ kind: 'agent', agentId })` (see
§6.6). `permissions.metadata` is the escape hatch for runtime-specific auth
fields the typed shape doesn't capture; usage is telemetry-tracked and must not
be required by final plugin code without a tracked promotion issue.

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

V1 topology: runtime adapters are initialized in-process with Bakin. They are
not independent daemons and do not provide a durable inbound event queue. If the
Bakin process is down, channel interactions may fail at the provider layer.
Durability means Bakin can recover unresolved approval records after restart and
re-render, expire, cancel, or continue them where the channel supports it.

Approvals are **durable workflow primitives**, not synchronous
function calls. Workflow gates can wait minutes, hours, or days. Bakin
can restart, the runtime can reconnect to its messaging platforms,
and the rendered messages may need editing after resolution. A single
blocking `Promise<ApprovalResponse>` would die on any of those events.

The split: **bakin owns the durable approval record**, including logical
approval state and latest known per-channel delivery refs. **Adapter owns
platform-specific rendering and inbound interaction wiring** (Discord button
IDs, Telegram callback payloads, etc). Adapter caches are allowed for speed, but
are not authoritative. After restart, Bakin rehydrates pending approval records
and passes their delivery refs back to the adapter when editing, resolving,
cancelling, or re-rendering. The approval ID is Bakin-generated and embedded in
rendered messages (Discord button `custom_id`, etc) so interactions echo back
the right ID.

```ts
channels: {
  list(): Promise<ChannelInfo[]>

  // Fire-and-forget operations
  sendNotification(args: NotificationArgs): Promise<DeliveryResult>
  sendMessage(args: MessageArgs): Promise<DeliveryResult>
  deliverContent(args: ContentDeliveryArgs): Promise<DeliveryResult>

  // Durable approval primitives — Bakin persists approval state and delivery
  // refs; adapters render/update provider-specific messages.
  createApproval(args: CreateApprovalArgs): Promise<ApprovalRenderResult>
  editApproval(args: EditApprovalArgs): Promise<ApprovalRenderResult>
  cancelApproval(args: CancelApprovalArgs): Promise<void>
  /** Bakin marks approval resolved; adapter updates rendered messages
   *  (e.g., edit Discord embed to show "approved by X"). Idempotent
   *  on duplicate calls — silent no-op when already resolved. */
  resolveApproval(args: ResolveApprovalArgs): Promise<void>
  subscribeApprovalResponses(handler: (event: ApprovalResolveEvent) => void): Unsubscribe

  // Generic inbound (chat replies, interactions not bound to approvals)
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
  | 'edit-after-send'                                       // can edit a sent message
  | 'cancel-rendered'                                       // can mark a sent message cancelled visually

interface CreateApprovalArgs {
  /** Bakin-generated. Must be stable across the approval's lifetime;
   *  embedded in rendered messages so interactions route back to the
   *  right state even across restarts. */
  approvalId: string
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

interface ApprovalDelivery {
  channelId: string
  ref: string                                               // adapter-internal ID (e.g., Discord message ID)
  renderedAt: string
}

interface ApprovalPatch {
  body?: string
  options?: ApprovalOption[]
  expiresAt?: string
  context?: Record<string, unknown>
}

interface ApprovalResponse {
  selectedOption: string
  respondedAt: string
  actor: { type: 'agent' | 'human'; id: string }
  comment?: string
}

interface ApprovalRenderResult {
  deliveries: ApprovalDelivery[]
}

interface ApprovalRenderRef {
  approvalId: string
  deliveries: ApprovalDelivery[]
}

interface EditApprovalArgs extends ApprovalRenderRef {
  patch: ApprovalPatch
}

interface CancelApprovalArgs extends ApprovalRenderRef {
  reason?: string
}

interface ResolveApprovalArgs extends ApprovalRenderRef {
  response: ApprovalResponse
}

interface ApprovalResolveEvent {
  approvalId: string
  response: ApprovalResponse
  channelId: string                                         // which channel the response came from
}
```

#### Persistence + restart semantics

| What | Lives | Restart-safe |
|---|---|---|
| Approval ID | bakin's workflow state on disk | yes — recreated from saved state |
| Pending approval logical state (gate is waiting on approval X) | bakin's workflow state on disk | yes |
| Per-channel delivery refs (Discord message IDs) | bakin's workflow state on disk; adapter may cache | yes — Bakin re-passes refs to adapter on edit/resolve/cancel/re-render |
| Inbound interaction routing (Discord button click → bakin handler) | adapter's gateway connection | no durable queue in v1 — gateway reconnects on adapter restart, but clicks while the process is down may fail at the provider layer |

#### Durable approval record shape

Bakin persists one approval record for every unresolved workflow gate before it
asks the adapter to render channel messages. The concrete storage can live in
workflow instance state, but the semantic shape is mandatory:

```ts
interface DurableApprovalRecord {
  approvalId: string
  owner: {
    workflowId: string
    runId: string
    stepId: string
    taskId?: string
  }
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired'
  request: {
    title: string
    body: string
    options: ApprovalOption[]
    expiresAt?: string
    context?: Record<string, unknown>
  }
  deliveries: ApprovalDelivery[]
  response?: ApprovalResponse
  createdAt: string
  updatedAt: string
  resolvedAt?: string
}
```

The adapter never owns this record. Discord/Telegram/Slack message IDs are
delivery refs inside the record, not the source of truth. Button payloads and
callback IDs embed `approvalId`; workflow/task/step IDs are looked up from
Bakin state after the event returns. Approval resolution is therefore one
workflow-state transition plus one best-effort rendered-message update.

#### Idempotency

- `createApproval` with a duplicate `approvalId` → adapter returns
  the existing render result without re-rendering where the provider
  supports lookup/update by embedded approval ID. Bakin can safely retry
  after a crash mid-creation, but the system must tolerate duplicate rendered
  messages in provider crash windows that cannot be deduplicated.
- `resolveApproval` on an already-resolved approval → silent no-op.
  Duplicate Discord button clicks (rare but possible) don't double-fire.
- `cancelApproval` on an already-resolved approval → marks the
  rendered message as superseded but doesn't override the response.

#### Interaction → approval wiring

When a user clicks a button in Discord:

1. Discord sends `INTERACTION_CREATE` to the adapter's gateway.
2. Adapter parses the embedded `approvalId` from the button's `custom_id`.
3. Adapter ACKs the interaction (Discord requires response within 3s).
4. Adapter fires `subscribeApprovalResponses` event with `{ approvalId, response, channelId }`.
5. Bakin's workflows plugin handler looks up its pending approval by ID.
6. Workflow handler persists the response and calls `resolveApproval({ approvalId, deliveries, response })`.
7. Adapter edits the Discord message to show resolved state (e.g., "approved by @markhayden, 12:34pm").

If the process crashes after Bakin persists the approval record but before
rendering succeeds, Bakin retries `createApproval` on restart using the same
approval ID. If the process crashes after rendering succeeds but before Bakin
persists delivery refs, Bakin may re-render on restart. If the process is down
when a user clicks a channel interaction, that click is not guaranteed to be
captured; the user may need to retry, or Bakin may re-render/expire the approval
after restart.

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
  source: AssetSource
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

type AssetSource =
  | { kind: 'asset'; id: string }                           // managed Bakin asset
  | { kind: 'url'; url: string }                             // adapter downloads/embeds if allowed
  | { kind: 'data'; data: ArrayBuffer | string; encoding?: 'base64' | 'utf8' }
```

The four ops carry semantic weight adapters render differently.
Discord's approval becomes interactive buttons. Telegram's becomes
inline keyboard. Plain-text fallback is numbered options.
Arbitrary filesystem paths are intentionally excluded from `AssetSource`.
Plugins hand adapters managed Bakin assets, URLs, or inline data only. If a
local file must be sent, Bakin first imports it into the asset store and passes
an `asset` source.

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

Bakin owns task metadata in `getBakinPaths().tasks` (default
`~/.bakin/tasks/`; honors `BAKIN_HOME` resolution per
`packages/core/src/content-dir.ts`). Adapter is the executor.

```ts
tasks: {
  dispatch(args: TaskDispatch): Promise<{ flowId: string }>
  getExecutionStatus(flowId: string): Promise<TaskExecutionStatus>
  listExecutions(opts?: ListExecutionsOpts): Promise<TaskExecutionStatus[]>
  cancelExecution(flowId: string): Promise<void>
  subscribeExecutionUpdates(handler: (event: TaskExecutionEvent) => void): Unsubscribe
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

```

Existing OpenClaw execution import is not part of the v1 hard cutover
interface. If released Bakin later needs it, add a separate import adapter API
and product flow with tests.

### 6.10 Cron

The schedule plugin actively creates/edits/deletes/runs cron jobs, so
the adapter must expose full CRUD plus on-demand triggering. Read-only
would be a boundary violation.

```ts
cron: {
  // Reads
  listJobs(): Promise<CronJob[]>
  getJob(id: string): Promise<CronJob | null>
  listRuns(opts?: ListRunsOpts): Promise<CronRun[]>

  // Lifecycle
  createJob(spec: CronJobSpec): Promise<CronJob>
  updateJob(id: string, patch: CronJobPatch): Promise<CronJob>
  deleteJob(id: string): Promise<void>

  // On-demand execution
  runJob(id: string): Promise<{ runId: string }>
}

interface CronJob {
  id: string
  name: string
  schedule: CronSchedule
  session: 'main' | 'isolated'
  callback?: CronCallback
  payload: CronPayload
  enabled: boolean
  timezone?: string
  metadata?: Record<string, unknown>
}

interface CronJobSpec {
  id?: string                                               // adapter generates if omitted
  name: string
  schedule: CronSchedule
  session?: 'main' | 'isolated'                             // default isolated for Bakin jobs
  callback?: CronCallback
  payload: CronPayload
  enabled?: boolean                                         // default true
  timezone?: string
  metadata?: Record<string, unknown>
}

interface CronJobPatch {
  name?: string
  schedule?: CronSchedule
  session?: 'main' | 'isolated'
  callback?: CronCallback
  payload?: Partial<CronPayload>
  enabled?: boolean
  timezone?: string
  metadata?: Record<string, unknown>
}

type CronSchedule =
  | { kind: 'cron'; expression: string }
  | { kind: 'every'; expression: string }
  | { kind: 'at'; isoTime: string }

type CronCallback =
  | { kind: 'webhook'; url: string }
  | { kind: 'none' }

interface CronPayload {
  message: string
  agentId?: string
  workflowId?: string
  taskPrompt?: string
  taskTitle?: string
  owner?: string
  requireTriage?: boolean
  allowOverlap?: boolean
  maxFailures?: number
}

interface CronRun {
  jobId: string
  runId: string
  startedAt: string
  endedAt?: string
  exitCode?: number
  output?: string
}

interface ListRunsOpts {
  jobId?: string
  since?: string
  limit?: number
}
```

### 6.11 Config

```ts
config: {
  read(): Promise<RuntimeConfig>                            // typed; preferred path
  raw?(reason: RawAccessReason): Promise<RawConfigProxy>     // gated diagnostic fallback
}

interface RuntimeConfig {
  agentIds: string[]
  defaultModel?: string
  workspaceRoot: string
  channels?: { configured: string[] }
}

interface RawAccessReason {
  pluginId: string
  issue: string                                             // ticket/spec link
  justification: string
}
```

`raw()` is optional and gated. It is not a normal plugin development surface.
Any use must pass a reason that includes `pluginId`, `issue`, and a short
justification. Every property access logs `{ pluginId, issue, keyPath,
runtimeAdapter, timestamp }` to a ring buffer. Bakin's doctor surfaces gaps:

```
Adapter abstraction gaps detected:
  pluginId    keyPath                    accessCount
  ──────────  ─────────────────────────  ───────────
  messaging   runtime.endpoint.port      147
  workflows   channels.discord.guildId   89
```

The lint rule fails on `raw()` usage unless the call site is explicitly
allowlisted. Allowlisted uses are reviewed before release; the preferred
outcome is promoting the field into `RuntimeConfig` or deleting the use.

## 7. SearchAdapter — full interface

15-ish methods. Smaller surface; sits BELOW bakin's `search-registry.ts`,
which remains the plugin-facing abstraction. The hard cutover may update
`SearchAPI` so plugin-facing query types map cleanly to this adapter contract,
but plugins must not see Antfly-native strategy names or raw Antfly aggregation
shapes after the PR.

`search-registry.ts` becomes a coordinator, not a provider. It stores plugin
schema declarations, normalizes plugin-facing query input, and delegates table
provisioning/index/query work to `AppServices.search`. Antfly embedder
selection, table DDL, hybrid/RRF/rerank implementation, daemon lifecycle, and
provider-specific aggregation translation live in `packages/adapter-antfly/`.
If a plugin-facing option cannot be expressed without leaking Antfly-native
types, the option is either promoted into the generic `SearchAdapter` contract
or removed during the hard cutover.

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
  scan(table: string, opts?: ScanOpts): AsyncIterable<ScannedDocument>

  embedder: {
    hasChanged(): Promise<boolean>
    rebuildAll(): Promise<RebuildReport>
  }
}

interface Query {
  text?: string
  vector?: number[]
  filters?: Filter[]
  /** Field names to compute facet counts on (e.g., 'agent', 'kind').
   *  Adapter returns counts in QueryResult.facets. */
  facets?: string[]
  /** Aggregations to compute over the result set (count, avg, sum,
   *  histogram). Adapter returns values in QueryResult.aggregations. */
  aggregations?: AggregationRequest[]
  sort?: SortSpec
  limit?: number
  offset?: number
  /** Explicit strategy override. Default 'auto' lets the adapter pick.
   *  Plugins generally don't specify this; reserved for the rare case
   *  a plugin needs lexical-only or vector-only ranking. */
  strategy?: 'auto' | 'fts' | 'vector' | 'hybrid'
  /** Toggle adapter's reranker on/off. Default true when the adapter
   *  has one; false skips the rerank stage even when available. Used
   *  for cost/latency-sensitive paths and for debug comparison. */
  rerank?: boolean
}

interface AggregationRequest {
  name: string                                              // result key
  type: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'histogram'
  field: string
  /** For histogram only — bucket interval. */
  interval?: string | number
}

interface FacetCount {
  value: string | number | boolean
  count: number
}

interface QueryResult {
  hits: SearchHit[]
  total?: number
  /** Facet counts per requested field. Adapter omits unrequested fields. */
  facets?: Record<string, FacetCount[]>
  /** Aggregation results keyed by AggregationRequest.name. */
  aggregations?: Record<string, unknown>
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

interface ScannedDocument {
  key: string
  document: Document
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
  adapterOptions?: Record<string, unknown>                  // allowlisted only
}

type Document = Record<string, unknown>

interface FieldDefinition {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'vector' | 'json'
  required?: boolean
  indexed?: boolean
}

interface Filter {
  field: string
  op: 'eq' | 'neq' | 'in' | 'not-in' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'
  value: string | number | boolean | Array<string | number | boolean>
}

interface SortSpec {
  field: string
  direction: 'asc' | 'desc'
  mode?: 'text' | 'number' | 'date'
}

interface ScanOpts {
  prefix?: string
  limit?: number
  cursor?: string
}

interface IndexItem {
  key: string
  document: Document
}

interface IndexOpts {
  refresh?: boolean
}

interface BatchResult {
  indexed: number
  failed: Array<{ key: string; error: string }>
}

type TransformFn = (doc: Document) => Document | null

interface TableInfo {
  name: string
  documentCount?: number
}

interface TableStats {
  documents: number
  bytes?: number
}

interface TableHealth {
  ok: boolean
  message?: string
}

interface RebuildReport {
  rebuilt: number
  failed: number
}
```

`adapterOptions` is not a general plugin escape hatch. Any use must be
documented in the boundary exception ledger with an owner and removal condition,
or promoted into the typed `TableConfig` shape before release.

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

New storage layer rooted at `getBakinPaths().tasks` (default
`~/.bakin/tasks/`); files at `<root>/YYYY-MM/task-<id>.json`. Tasks
storage path is added to `BakinPaths` in
`packages/core/src/content-dir.ts` so it resolves consistently with every
other Bakin storage path: `BAKIN_HOME` when set, otherwise `~/.bakin`.

The task store is a core Bakin module, not a plugin hook facade. Every task
reader/writer uses this module after the hard cutover: kanban UI, task CLI,
workflows, schedule, dispatch, continuation, agent assignment, and health
checks. The old `plugins/tasks/lib/flow-store.ts` metadata path is deleted;
no compatibility shim remains, and no direct `flow_runs` task metadata reads
remain outside the runtime adapter.

Implementation sequencing is part of the contract: the Bakin task store is cut
over before broad plugin rewrites. Once task metadata has one owner, plugins and
core services can be migrated safely around that stable store. There is no
temporary authoritative split between `flow_runs.state_json` and task JSON
files, even inside the single hard-cutover PR.

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
  "parentId": null,
  "blockedBy": [],
  "blocking": [],
  "comments": [],
  "pendingDelete": false,
  "execution": {
    "flowId": "fr_xyz789",
    "state": "running",
    "currentStep": "draft",
    "blockingReason": null,
    "retryCount": 0,
    "startedAt": "2026-04-27T...",
    "endedAt": null,
    "lastSyncedAt": "2026-04-27T..."
  },
  "log": [],
  "createdAt": "2026-04-27T...",
  "updatedAt": "2026-04-27T..."
}
```

Atomic writes via tmp+rename (consistent with `lockfile.ts` pattern).
Chokidar watches the resolved tasks path for SSE broadcasts. Antfly-indexed
for cross-cutting search via the existing `bakin_memory` table or a
new `bakin_tasks` content type.

### 8.1 Task store API

The concrete names may differ, but the hard cutover must expose one shared
module with this semantic coverage:

```ts
interface BakinTask {
  id: string
  title: string
  description?: string
  agent?: string
  column: string
  order: number
  tags: string[]
  workflowId?: string
  projectId?: string
  parentId?: string | null
  blockedBy: string[]
  blocking: string[]
  comments: TaskComment[]
  pendingDelete: boolean
  execution: {
    flowId: string | null
    state?: TaskExecutionStatus['state'] | 'execution-orphaned' | 'not-dispatched'
    currentStep?: string | null
    blockingReason?: string | null
    retryCount?: number
    startedAt?: string | null
    endedAt?: string | null
    lastSyncedAt?: string | null
  }
  log: TaskLogEntry[]
  createdAt: string
  updatedAt: string
}

interface BakinTaskStore {
  create(input: CreateBakinTaskInput): Promise<BakinTask>
  get(id: string): Promise<BakinTask | null>
  list(opts?: TaskListOpts): Promise<BakinTask[]>
  update(id: string, patch: BakinTaskPatch): Promise<BakinTask>
  move(id: string, column: string, order?: number): Promise<BakinTask>
  remove(id: string): Promise<void>

  appendLog(id: string, entry: TaskLogEntry): Promise<void>
  addComment(id: string, comment: TaskComment): Promise<void>
  setDependencies(id: string, deps: TaskDependencyPatch): Promise<BakinTask>
  markPendingDelete(id: string, pending: boolean): Promise<BakinTask>
  linkExecution(id: string, flowId: string): Promise<BakinTask>
  updateExecutionCache(id: string, status: TaskExecutionStatus): Promise<BakinTask>

  subscribe(handler: (event: BakinTaskStoreEvent) => void): Unsubscribe
}

interface CreateBakinTaskInput {
  id?: string
  title: string
  description?: string
  agent?: string
  column?: string
  order?: number
  tags?: string[]
  workflowId?: string
  projectId?: string
  parentId?: string | null
}

type BakinTaskPatch = Partial<Pick<
  BakinTask,
  | 'title'
  | 'description'
  | 'agent'
  | 'column'
  | 'order'
  | 'tags'
  | 'workflowId'
  | 'projectId'
  | 'parentId'
  | 'blockedBy'
  | 'blocking'
  | 'pendingDelete'
>>

interface TaskListOpts {
  column?: string
  agent?: string
  projectId?: string
  includePendingDelete?: boolean
}

interface TaskLogEntry {
  at: string
  actor: string
  event: string
  data?: Record<string, unknown>
}

interface TaskComment {
  id: string
  author: string
  body: string
  createdAt: string
}

interface TaskDependencyPatch {
  blockedBy?: string[]
  blocking?: string[]
}

interface BakinTaskStoreEvent {
  type: 'created' | 'updated' | 'deleted'
  taskId: string
  task?: BakinTask
}
```

Required invariants:

- `id` is stable and never reused.
- All writes are atomic tmp+rename writes.
- List ordering is deterministic: column order, then numeric `order`, then
  `updatedAt` as a tie-breaker.
- Metadata fields are only written by Bakin.
- Execution cache fields are derived from runtime adapter status and may be
  rebuilt.
- Deletion uses tombstones when an execution must be cancelled first.
- The store emits one SSE-invalidating event per logical write.

### 8.2 Reconciliation + transactional consistency

Two stores held by different processes will diverge on crash, partial
failure, retry, or external mutation. The rules below are the contract
the tasks plugin and adapter must satisfy.

#### Idempotency keys

- **`bakinTaskId`** is the canonical identifier across both stores.
  Bakin generates it; bakin's task JSON file is named after it; the
  adapter records it in the `flow_run`'s `owner_key` (current pattern:
  `bakin:task:<bakinTaskId>`).
- `tasks.dispatch({ bakinTaskId, ... })` is **idempotent on
  `bakinTaskId`**. If a `flow_run` with that owner_key already exists,
  the adapter returns its existing `flowId` instead of creating a
  duplicate. Bakin can safely retry after a crash mid-dispatch.
- `tasks.cancelExecution(flowId)` is idempotent. Already-cancelled →
  silent no-op.

#### Write order — bakin first, adapter second

Bakin writes its JSON file BEFORE calling the adapter to dispatch.
The order matters:

1. Generate `bakinTaskId`.
2. Write `<tasks>/YYYY-MM/task-<id>.json` with `execution.flowId: null`.
   (Atomic tmp+rename.)
3. Call `tasks.dispatch({ bakinTaskId, ... })`.
4. Receive `{ flowId }` from the adapter.
5. Update the bakin file with `execution.flowId: <flowId>`.

If the process crashes between 2 and 5, the bakin file exists with
null `execution.flowId`. Boot-time reconciliation handles this case
(see below).

#### Boot-time reconciliation

On every bakin boot, the tasks plugin reconciles its store against
the adapter. Required cases:

| Bakin file says | Adapter says | Action |
|---|---|---|
| `execution.flowId: 'fr_X'` | `'fr_X'` exists, status `running` | normal - UI shows running |
| `execution.flowId: 'fr_X'` | `'fr_X'` not found (deleted in runtime) | mark bakin task `execution-orphaned`; UI offers re-dispatch |
| `execution.flowId: null` | adapter has a flow with `owner_key bakin:task:<id>` | repair: write the found `flowId` into the bakin file |
| `execution.flowId: null` | no matching flow in adapter | bakin task is in pre-dispatch limbo; UI shows "not yet dispatched"; user can dispatch or delete |

The reconciler runs once on boot and exits. It does NOT continuously
sync; runtime changes are pushed to bakin via
`subscribeExecutionUpdates`.

#### Conflict policy

- **Execution state conflicts:** runtime wins. If bakin's last-known
  status was `running` but the runtime now reports `succeeded`,
  bakin updates its UI cache from the runtime. Bakin never overrides
  runtime execution status.
- **Metadata conflicts:** bakin wins. The runtime never edits bakin's
  metadata fields (title, column, ordering, tags). The adapter's
  `flow_run.state_json` does not carry those fields after the hard
  cutover; historical state_json fields are ignored.
- **`agent` field:** lives in BOTH stores intentionally. Bakin's is
  the user-mutable assignment; the runtime's is who actually runs the
  current execution. They DIVERGE if the user reassigns the agent in
  bakin without re-dispatching. UI shows "assigned to A; currently
  executing under B" when they differ — explicit state, not bug.

#### Tombstones

Deleting a bakin task is a two-phase operation:

1. Set `pendingDelete: true` in the bakin file. UI hides the task.
2. Call `adapter.cancelExecution(flowId)` (if `execution.flowId` exists).
3. On confirmed cancel: delete the bakin file.

If step 2 fails (adapter unavailable), the file stays as a tombstone
and a background retry picks it up next time the adapter responds.
Boot-time reconciliation also retries pending deletes.

#### Explicitly excluded from hard cutover

Do not implement hidden adoption, dual-read, or compatibility behavior for
existing OpenClaw `flow_runs` in this PR. This pre-release cutover may wipe
local data. After public release, importing existing runtime executions must be
a separate user-facing feature with its own adapter API, UI, tests, and failure
semantics.

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

Post-release deprecation cycle: `@deprecated('use X - removed in Y.0')` JSDoc +
runtime warning + at least one minor version of overlap. This does not apply to
the pre-release hard cutover; no compatibility overlap is required inside this
PR.

Day-1 ship: all packages at 1.0.0 from the same monorepo. Discipline
matters when third-party adapters land (~6+ months out).

## 10. Boundary enforcement

Three layers of guard:

### ESLint (compile-time gate)

`eslint.config.mjs` adds `no-restricted-imports` patterns. The
`files:` glob covers `src/`, `cli/`, `plugins/`, `packages/host/`,
`packages/core/`, **and `scripts/`** (matching the fitness test
scope). Banned patterns:

- `**/openclaw-client`, `**/openclaw-home`, `**/openclaw-config`,
  `@bakin/core/openclaw-*` — banned everywhere except
  `packages/adapter-openclaw/**`
- `**/src/core/antfly`, `**/src/core/antfly-server` — banned everywhere
  except `packages/adapter-antfly/**`
- `@bakin/adapter-openclaw`, `@bakin/adapter-antfly` (and sub-paths)
  — banned in plugin code; restricted to app boot/server wiring

### Architecture fitness test

`tests/architecture/adapter-boundary.test.ts` walks `src/`, `cli/`,
`plugins/`, `packages/host/`, `packages/core/`, **and `scripts/`**
(excluding adapter packages and select boot-wiring files). Asserts:

- No imports of openclaw-client / openclaw-home / openclaw-config
- No imports of src/core/antfly / antfly-server
- No imports of `@antfly/sdk` outside `packages/adapter-antfly/**`
- No literal `getOpenClawPath(...)` outside adapter
- No `flow_runs` SQL outside adapter
- No `~/.openclaw/` path strings outside adapter
- No `OPENCLAW_HOME` environment access outside adapter or boot settings code
- No `vault.get('gateway-token')` outside adapter
- No Discord REST/gateway URLs or interaction payload handling outside the
  runtime adapter's channel implementation
- No shelling out to the OpenClaw binary outside `packages/adapter-openclaw/**`
- No direct `bun:sqlite` access to OpenClaw-owned database files outside the
  runtime adapter

`scripts/` is included because the audit found direct OpenClaw
client usage there (`scripts/lib/post-channel.ts`,
`scripts/lib/generate-image.ts`, `scripts/migration/snapshot-agent.ts`,
`scripts/migration/wipe-and-install-all.ts`). After the hard cutover, those
imports route through the adapter package or are deleted.

ESLint's `files:` glob covers the same scope so the lint and
fitness test stay in sync. Fails CI loud with file:line citations.

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
Provider-client mocks such as `mock.module('@/core/openclaw-client', ...)`
are refactor blockers and must not be reintroduced.

`tests/plugins/test-helpers.ts` consumes these from `@bakin/sdk/testing`
instead of carrying ad-hoc mocks.

## 13. Cutover strategy

See `.claude/specs/adapter-layer-plan.md` for the single-PR hard-cutover
plan. This is a pre-release refactor for a single-user local install; local
data can be wiped and intermediate commits do not need to run. The goal is the
clean final architecture, not deployable migration checkpoints.

Rules:

- Delete old direct-client paths instead of preserving re-export shims.
- Move each source of truth once; do not introduce dual-write metadata paths.
- Treat compatibility/adoption as explicit future product work, not hidden
  refactor scaffolding.
- Final PR state must pass tests, lint, docs, boundary checks, and manual
  smokes.

## 14. Definition of done

The hard-cutover PR is complete when:

- [ ] `packages/adapter-openclaw/` and `packages/adapter-antfly/` exist
      and pass `bun typecheck` + `bun test`.
- [ ] `packages/core/src/adapters/` defines both interfaces.
- [ ] `AppServices` is the shared runtime/search/task/channel injection path
      for plugins, plugin routes, MCP tools, CLI/scripts, lifecycle, health,
      and tests.
- [ ] No file under `src/`, `cli/`, `plugins/`, `packages/host/`,
      `packages/core/`, or `scripts/` imports `openclaw-client`,
      `openclaw-home`, `openclaw-config`, `@antfly/sdk`, or
      `src/core/antfly*`.
- [ ] No plugin file imports from `@bakin/adapter-{openclaw,antfly}`.
- [ ] `tests/architecture/adapter-boundary.test.ts` passes against
      a fully-migrated codebase.
- [ ] Any remaining boundary exception is documented in an exception ledger
      with owner, reason, linked issue, and removal condition. Empty ledger is
      preferred.
- [ ] `getBakinPaths().tasks` is the live task metadata store; flow_runs
      contains only execution-side fields.
- [ ] Workflow approvals persist Bakin-owned durable approval records;
      channel/provider message IDs are delivery refs only.
- [ ] Every plugin's primary feature works against a freshly-cloned
      bakin instance (manual smoke per the plan doc).
- [ ] `bun run lint`, `bun run typecheck`, `bun test --isolate`,
      `bun run docs:check`, and `bun run lint:home-bypasses` all pass
      in the final PR state.
- [ ] `.claude/knowledge/adapter-architecture.md` exists and is
      cross-referenced from CLAUDE.md.
- [ ] `.claude/skills/check-adapter-boundary.md` is invocable.

## 15. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Adapter abstraction is too leaky (specifics of OpenClaw bleed into the interface) | Boundary exception ledger plus gated `raw()`/`adapterOptions` usage exposes gaps; final plugin behavior must use typed surfaces or documented exceptions |
| Adapter abstraction is too rigid (Hermes can't fit) | Per-channel capabilities, AsyncIterable streams, and `metadata` fields on most types provide adapter-specific wiggle room without breaking the contract |
| Hard cutover introduces regressions | Use checkpointed commits for review, but require only the final PR state to run; final manual smokes cover every plugin and boundary |
| Plugin tests break across all plugins simultaneously | Replace ad-hoc direct-client mocks with the canonical mock adapter harness in the same PR |
| Local task/runtime data loss | Accepted pre-release for this single machine; wipe before final validation if needed |
| flow_runs contention between bakin and OpenClaw | Bakin's adapter respects OpenClaw's `revision` column for optimistic concurrency; multiple writers don't clobber |
| Hot reload breaks adapter init | Restart-required for adapter changes (locked at Q2.3); adapter init lives outside the hot-reload pipeline |
| Discord migration leaves orphan auth flows | `discord-gateway.ts` moves entirely into `adapter-openclaw/channels/discord/`; init order ensures the gateway WS connects on adapter init |
| Versioning drift between SDK + core + adapter | Boot-time compatibility check at step 3 of boot sequence; loud failure mode |

## 16. Open questions (to settle during implementation)

- **Post-release task import UX.** If released Bakin needs to import existing
  OpenClaw `flow_runs`, design it as an explicit import flow with tests. Do
  not preserve hidden hard-cutover shims for this.
- **Per-channel capability list specifics.** Current draft has 7
  values (`message`, `rich-content`, `interactive-approval`,
  `modal-input`, `threaded-replies`, `edit-after-send`,
  `cancel-rendered`). More may surface as adapter implementations land.
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
- Channel capabilities beyond the 7-value list above (extended as
  adapter implementations surface real needs).
