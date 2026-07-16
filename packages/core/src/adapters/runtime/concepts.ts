import type { AdapterInitOpts, MessageUsage, RuntimeExecToolProvider, Unsubscribe } from '../shared'
import type { ActivityClass } from '@makinbakin/sdk/types'
import type { ChannelCapability } from './capabilities'

export type { MessageUsage } from '../shared'

export type RuntimeMetadata = Record<string, unknown>

export interface RuntimeAgent {
  id: string
  name: string
  role?: string
  model?: string
  /** Model this agent's spawned subagents use (runtimes with a subagent concept). */
  subagentModel?: string
  status?: 'active' | 'inactive' | 'unknown'
  metadata?: RuntimeMetadata
}

export interface CreateRuntimeAgentInput {
  id?: string
  name: string
  role?: string
  model?: string
  metadata?: RuntimeMetadata
}

export interface UpdateRuntimeAgentInput {
  name?: string
  role?: string
  /** `null` clears the assignment (agent falls back to the routing default). */
  model?: string | null
  /** `null` clears. Reject via routingSupport().perAgentSubagentModel=false runtimes. */
  subagentModel?: string | null
  metadata?: RuntimeMetadata
}

export interface RuntimeAllowlistPatch {
  add?: string[]
  remove?: string[]
  replace?: string[]
}

export interface WorkspaceFile {
  path: string
  content: string
  updatedAt?: string
  metadata?: RuntimeMetadata
}

/**
 * Size stats for one file the runtime loads at session start. Names + sizes
 * only — content never crosses the adapter boundary (#357). `kind` is
 * classified by the adapter so callers never re-derive runtime-private
 * file conventions.
 */
export interface WorkspaceFileStat {
  /** Path relative to the agent's workspace root (e.g. 'AGENTS.md', 'skills/foo/SKILL.md'). */
  name: string
  bytes: number
  mtimeMs: number
  kind: 'canonical' | 'skill' | 'memory'
}

export type RuntimeMessageToolsMode = 'auto' | 'none'

export interface RuntimeMessageToolPolicy {
  /**
   * Controls whether runtime-native tools are available for this agent turn.
   * `none` disables tools. Omit or use `auto` for runtime/provider defaults.
   * Native tool policy beyond on/off is ADAPTER-PRIVATE — callers never name
   * native tools.
   */
  toolsMode?: RuntimeMessageToolsMode
  /**
   * Per-turn allowlist of BAKIN EXEC TOOLS by exact name (e.g.
   * `bakin_exec_tasks_get`). Scope is the exec-tool set ONLY — never
   * runtime-native tools (audit M3: OpenClaw once forwarded these as native
   * policy while Pi filtered exec tools, so `toolsAllow: ['read']` meant two
   * different things). Enforcement is mechanism-dependent: in-process
   * runtimes filter the tool bridge per turn; runtimes whose exec tools ride
   * session-static transports (OpenClaw's per-agent MCP servers) cannot
   * filter per-turn and must IGNORE the fields with a loud warning — never
   * misapply them to native tools.
   */
  toolsAllow?: string[]
  /** Per-turn denylist of Bakin exec tools by exact name (same scope/enforcement as `toolsAllow`). */
  toolsDeny?: string[]
}

/** Local file offered to the runtime as model input for one turn. */
export interface MessageAttachment {
  path: string
  mimeType: string
}

export interface MessageArgs extends RuntimeMessageToolPolicy {
  agentId: string
  content: string
  /** Producer-assigned usage class; omitted interactive turns default to user. */
  activityClass?: ActivityClass
  /**
   * Image attachments for the turn (runtime support is declared by
   * `capabilities().imageInput`; adapters reject unsupported media loudly
   * rather than silently dropping pixels).
   */
  attachments?: MessageAttachment[]
  /**
   * Utility turn: ask the runtime to suppress visible session side effects
   * (control-UI visibility, prompt persistence) where it supports them.
   * The thread still exists for idempotency; it just stays out of the way.
   */
  ephemeral?: boolean
  /**
   * Adapter-neutral durable conversation key. Runtime adapters should map the
   * same agentId + threadId pair to the same provider/runtime session.
   */
  threadId?: string
  /**
   * Per-turn model override (`provider/model` id). Omit to use the agent's
   * configured model. The caller (Bakin's routing policy) resolves it.
   */
  model?: string
  /**
   * Per-turn thinking level. Omit to use the runtime/agent default.
   */
  thinking?: string
  /**
   * Best-effort turn cancellation. On abort, adapters MUST reject the send
   * promptly with RuntimeError kind 'aborted' and SHOULD cancel the
   * provider-side run where the runtime supports it (fail-open: a provider
   * that can't cancel still gets the local rejection).
   */
  signal?: AbortSignal
  /**
   * Best-effort live-activity tap for a `send()` turn (prelaunch-hardening
   * R7/D-plan-1): invoked with `tool` and `status` chunks as the runtime
   * surfaces them — text deltas do NOT flow here (use `messaging.stream`
   * to render prose live). No delivery guarantee, no chunk is required to
   * appear, and no ordering guarantee relative to the send() settle (a
   * late-arriving frame may tap after the promise resolves). Adapters
   * contain callback exceptions — a throwing tap never fails the turn.
   * Ignored by `messaging.stream`, whose iterator already carries chunks.
   */
  onActivity?: (chunk: ChatChunk) => void
  /**
   * Byte threshold above which a died turn's completion counts as
   * "oversized output" in its RuntimeTurnDiagnosis (the recovery ladder
   * treats runaway-output deaths differently from ordinary interrupts).
   * Dispatch passes `settings.dispatch.oversizedOutputBytes`; adapters fall
   * back to their own default (128 KiB) when omitted. Typed here — NOT a
   * metadata-bag key (audit M4: core policy must never ride the opaque bag).
   */
  oversizedOutputBytes?: number
  metadata?: RuntimeMetadata
}

/**
 * Fallback for `MessageArgs.oversizedOutputBytes` when the caller omits it —
 * THE single source both adapters and `settings.dispatch.oversizedOutputBytes`
 * default from (previously duplicated per adapter; parity by reference, not
 * by copy). Both adapters measure the same thing: UTF-8 bytes of the turn's
 * assistant output text, strict `>`.
 */
export const DEFAULT_OVERSIZED_OUTPUT_BYTES = 128 * 1024

export interface MessageResult {
  id: string
  content?: string
  /** Per-turn token usage, omitted when the runtime reported none. */
  usage?: MessageUsage
  metadata?: RuntimeMetadata
}

export interface RuntimeToolActivity {
  phase: 'call' | 'result'
  callId?: string
  toolName: string
  status?: 'running' | 'completed' | 'failed' | string
  summary?: string
  inputPreview?: string
  outputPreview?: string
  durationMs?: number
  exitCode?: number
  metadata?: RuntimeMetadata
}

/** Render format for a text chunk's content. Absent means 'markdown'. */
export type ChatTextFormat = 'markdown' | 'plain' | 'code'

/**
 * One chunk of a streaming agent turn — the turn-output normalization
 * contract every adapter emits and every consumer renders against.
 *
 * Behavioral contract (pinned today by the per-adapter suites —
 * tests/adapter-openclaw/stream-events.test.ts and
 * tests/integration/pi/turn.test.ts; the cross-adapter conformance suite
 * lands with prelaunch-hardening PR 3):
 * - Chunk GRANULARITY may vary by adapter: per-token deltas, coalesced
 *   spans, or one chunk per turn are all legal. Consumers accumulate
 *   `text` content in arrival order and must not assume a cadence.
 * - `done` is yielded EXACTLY ONCE, always last; no chunk of any kind
 *   follows it.
 * - A DELIBERATE abort (the turn's `kind:'aborted'` settle) ends the
 *   stream with a clean `done` — never an `error` chunk. Abort is a
 *   clean end, not a failure.
 * - `tool` and `status` chunks are BEST-EFFORT liveness: adapters emit
 *   what their runtime exposes, and none is guaranteed to appear.
 * - Terminal failure ends the stream with an `error` chunk (its `data`
 *   carries `{ kind }` — the RuntimeError kind — when known) and NO
 *   `done`; the iterator itself never throws.
 * - Adapters emit CLASSIFIED, STRUCTURED chunks only — never
 *   pre-rendered HTML/ANSI or raw JSON/shell dumps in `content`.
 *   Stripping runtime-specific noise is the adapter's job.
 */
export type ChatChunk =
  /** Assistant text. `format` hints rendering; absent = markdown. */
  | { type: 'text'; content: string; format?: ChatTextFormat; data?: RuntimeMetadata }
  /** Tool activity; `data` is always the structured RuntimeToolActivity. */
  | { type: 'tool'; content?: string; data: RuntimeToolActivity }
  /** Turn lifecycle hint (e.g. 'thinking'). */
  | { type: 'status'; content?: string; data?: RuntimeMetadata }
  /** Clean turn end (success or deliberate abort) — exactly once, always last. */
  | { type: 'done'; content?: string; data?: RuntimeMetadata }
  /** Terminal failure — `data.kind` carries the RuntimeError kind when known. */
  | { type: 'error'; content?: string; data?: RuntimeMetadata }

export interface ChannelInfo {
  id: string
  platform: string
  label: string
  capabilities: ChannelCapability[]
  metadata?: RuntimeMetadata
}

export interface DeliveryResult {
  deliveries: ApprovalDelivery[]
}

export interface NotificationArgs {
  channels: string[]
  notification: {
    severity: 'info' | 'warn' | 'error' | 'success'
    title: string
    body: string
    fields?: { label: string; value: string }[]
    metadata?: RuntimeMetadata
  }
}

export interface ChannelMessageArgs {
  channels: string[]
  message: {
    body: string
    title?: string
    threadId?: string
    metadata?: RuntimeMetadata
  }
}

export interface ContentDeliveryArgs {
  channels: string[]
  content: {
    title: string
    body?: string
    url?: string
    files?: Array<{ name: string; path: string; contentType?: string } | { kind: 'asset'; filename: string; mimeType?: string }>
    metadata?: RuntimeMetadata
  }
}

export interface CreateThreadArgs {
  /** Channel ref the anchor message lives in (provider or provider:target). */
  channel: string
  /** Delivery ref of the message to anchor the thread to (e.g. "message:<id>"). */
  messageRef?: string
  name: string
}

export interface CreatedThread {
  threadId: string
  /**
   * Provider-addressable channel ref for posting INTO the thread (opaque to
   * callers — provider target syntax stays inside the adapter).
   */
  channelRef: string
}

export interface EditChannelMessageArgs {
  /** Channel ref the message lives in (provider or provider:target). */
  channel: string
  /** Delivery ref of the message to edit (e.g. "message:<id>"). */
  messageRef: string
  body: string
}

export interface ApprovalOption {
  id: string
  label: string
  variant?: 'primary' | 'destructive' | 'neutral'
}

export interface ApprovalDelivery {
  channelId: string
  ref: string
  renderedAt: string
}

export interface ApprovalPatch {
  body?: string
  options?: ApprovalOption[]
  expiresAt?: string
  context?: RuntimeMetadata
}

export interface ApprovalResponse {
  selectedOption: string
  respondedAt: string
  actor: { type: 'agent' | 'human'; id: string; displayName?: string }
  comment?: string
}

export interface ApprovalRenderResult {
  deliveries: ApprovalDelivery[]
}

export interface ApprovalRenderRef {
  approvalId: string
  deliveries: ApprovalDelivery[]
}

export interface CreateApprovalArgs {
  approvalId: string
  channels: string[]
  request: {
    title: string
    body: string
    options: ApprovalOption[]
    expiresAt?: string
    context?: RuntimeMetadata
  }
}

export interface EditApprovalArgs extends ApprovalRenderRef {
  patch: ApprovalPatch
}

export interface CancelApprovalArgs extends ApprovalRenderRef {
  reason?: string
}

export interface ResolveApprovalArgs extends ApprovalRenderRef {
  response: ApprovalResponse
}

export interface ApprovalResolveEvent {
  approvalId: string
  response: ApprovalResponse
  channelId: string
}

export interface DurableApprovalRecord {
  approvalId: string
  owner: {
    workflowId: string
    runId: string
    stepId: string
    taskId?: string
  }
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired'
  request: CreateApprovalArgs['request']
  deliveries: ApprovalDelivery[]
  response?: ApprovalResponse
  createdAt: string
  updatedAt: string
  resolvedAt?: string
}

export interface RuntimeSkill {
  name: string
  path?: string
  instructions?: string
  files?: Record<string, string>
  metadata?: RuntimeMetadata
}

export interface RuntimeSession {
  id: string
  agentId: string
  title?: string
  startedAt?: string
  updatedAt?: string
  metadata?: RuntimeMetadata
}

export interface RuntimeSessionStoreStats {
  agentId: string
  /** Live entries in the runtime's session store for this agent. */
  storeEntries: number
  /**
   * Top-level files in the agent's sessions directory (session artifacts,
   * including the store itself) — cache subtrees are excluded so the
   * orphaned-artifact ratio stays meaningful.
   */
  fileCount: number
  /** Total bytes of the agent's sessions directory, subtrees included. */
  diskBytes: number
  /**
   * Adapter-owned operator guidance for shrinking this agent's store (CLI
   * commands, config knobs). Health surfaces render it verbatim — provider
   * specifics belong HERE, never hardcoded upstream of the adapter.
   */
  remediation?: string
}

export interface RuntimeMemoryTier {
  id: string
  label: string
  description?: string
  metadata?: RuntimeMetadata
}

export interface RuntimeMemoryEntry {
  id: string
  tierId: string
  agentId?: string
  path?: string
  content: string
  updatedAt?: string
  metadata?: RuntimeMetadata
}

export interface RuntimeMemoryEntryStat {
  size: number
  mtimeMs: number
  updatedAt?: string
  metadata?: RuntimeMetadata
}

export interface RuntimeMemoryReadRange {
  content: string
  size: number
  mtimeMs?: number
  updatedAt?: string
  metadata?: RuntimeMetadata
}

export interface RuntimeMemoryPathMatch {
  tierId: string
  id: string
  agentId?: string
  path: string
  metadata?: RuntimeMetadata
}

export interface RuntimeMemorySearchResult {
  results: unknown[]
  metadata?: RuntimeMetadata
}

/**
 * What the runtime's ACTIVE configuration can accept as model input
 * (spec: enrichment-runtime-fallback §3). Adapter-declared from the
 * runtime's own model catalog for the SELECTED agent's effective model
 * (default: the main agent) — conservative false on any ambiguity, never
 * model-name heuristics.
 */
export interface RuntimeCapabilities {
  imageInput: boolean
  audioInput: boolean
}

/**
 * One capability's provisioning state on a runtime:
 * - 'native'      — the runtime provides it directly.
 * - 'shimmed'     — the runtime doesn't, but a Bakin-owned shim fills it.
 * - 'unavailable' — neither; degrade honestly + surface in the UI.
 */
export type CapabilityMode = 'native' | 'shimmed' | 'unavailable'

/**
 * How agents on this runtime invoke Bakin exec tools:
 * - 'in-process' — exec tools are first-class session tools; the agent calls
 *                  `bakin_exec_*` directly (Pi's in-process bridge).
 * - 'mcp'        — the runtime's native MCP client reaches Bakin's MCP server;
 *                  tools appear namespaced as `<mcpServerTemplate>.<tool>`.
 * - 'cli-shim'   — the agent shells `<shimCommand>` (inert extension point for
 *                  a future runtime that can neither embed nor speak MCP).
 */
export type ToolAccessStyle = 'in-process' | 'mcp' | 'cli-shim'

export interface RuntimeToolAccess {
  style: ToolAccessStyle
  /** 'mcp': per-agent server-name template, e.g. `bakin-<agent>`. */
  mcpServerTemplate?: string
  /** 'cli-shim': shell command template. */
  shimCommand?: string
  /** One canonical, style-appropriate example call. */
  example?: string
  /**
   * Whether this runtime can ENFORCE `MessageArgs.toolsAllow`/`toolsDeny`
   * per turn. In-process runtimes filter their tool bridge per call (true);
   * runtimes whose exec tools ride session-static transports (OpenClaw's
   * per-agent MCP servers) cannot (false) — they ignore the fields with a
   * loud warning. Callers needing a RESTRICTED turn must feature-detect
   * this and refuse rather than degrade fail-open.
   */
  perTurnExecToolFiltering?: boolean
}

/**
 * Result of `verifyToolAccess()` — a runtime-neutral report on whether this
 * runtime's tool-access wiring is currently in place, so core (onboarding,
 * doctor) can surface drift WITHOUT knowing any provider's config shape.
 * `in-process` runtimes report `ok: true` with no issues (nothing to
 * provision); `mcp` runtimes report missing/stale server entries.
 */
export interface ToolAccessProvisioningStatus {
  style: ToolAccessStyle
  ok: boolean
  /** Human-readable drift descriptions when `ok` is false. */
  issues: string[]
  details?: Record<string, unknown>
}

/**
 * The unified capability declaration — every runtime-provided capability that
 * has a native/shim/gap choice. Bakin renders agent instructions from it,
 * routes to shims when `shimmed`, degrades honestly when `unavailable`, and
 * plugins query it instead of assuming. Always-Bakin-owned capabilities
 * (scheduling, heartbeats, tasks, assets, audit) are NOT here — they have no
 * native/shim choice. `input` folds in the former modality-only capabilities.
 */
export interface CapabilitySet {
  toolCalling: { mode: 'native'; access: RuntimeToolAccess }
  delivery: { mode: CapabilityMode }
  imageGen: { mode: CapabilityMode }
  memory: { mode: 'native' | 'unavailable' }
  sessions: { mode: 'native' | 'unavailable' }
  workspaceFiles: { mode: 'native' | 'unavailable' }
  input: RuntimeCapabilities
}

/**
 * Presence-only credential report (P2.2): WHICH LLM providers and channels
 * have usable credentials configured in the runtime — names only, NEVER
 * secret material. Drives the onboarding llm/channels checks; each adapter
 * reads its own config internally so credential shapes never leak upstream.
 */
/**
 * Presence-only credential KIND: 'api-key' = metered pay-per-use billing;
 * 'oauth' = subscription login (plan quota). An entry carrying both reports
 * 'api-key' — the key is what the provider bills. Never carries values.
 */
export type RuntimeCredentialKind = 'api-key' | 'oauth'

export interface RuntimeCredentialStatus {
  /** Provider names with usable credentials (api key / token / OAuth). */
  llmProviders: string[]
  /**
   * Per-provider credential kind (billing-lane detection, cost-control v2).
   * Optional — consumers treat absence as unknown and stay conservative
   * (unknown bills as metered, never silently uncapped-as-free).
   */
  llmCredentials?: Array<{ provider: string; kind: RuntimeCredentialKind }>
  /** Channel names with usable credentials. Empty on channel-less runtimes. */
  channels: string[]
}

/**
 * Runtime-owned model routing policy (P2.3): the knobs the RUNTIME honors at
 * session time — default model for agents without an assignment, failover
 * order, subagent default, alias map. Bakin manages these through this
 * neutral surface; each adapter maps to its native store, so a runtime's
 * policy survives untouched while another runtime is active (round-trip by
 * construction).
 */
export interface RuntimeRoutingPolicy {
  /** Default model for agents without an explicit assignment. '' when unset. */
  defaultModel: string
  /** Failover models tried in order when the default fails. */
  fallbackModels: string[]
  /** Default model for spawned subagents. Null when unset/unsupported. */
  defaultSubagentModel: string | null
  /** Alias name → target model id. */
  aliases: Record<string, string>
}

/**
 * Which routing-policy fields this runtime actually HONORS. Static
 * declaration (like describeToolAccess): UIs hide unsupported controls and
 * `setRoutingPolicy` rejects patches carrying unsupported fields — a knob
 * the runtime ignores must never be silently stored.
 */
export interface RuntimeRoutingSupport {
  defaultModel: boolean
  fallbackModels: boolean
  defaultSubagentModel: boolean
  aliases: boolean
  /** Per-agent subagentModel via agents.update. */
  perAgentSubagentModel: boolean
}

export interface RuntimeAvailableModel {
  id: string
  name?: string
  input?: string
  contextWindow?: number
  local?: boolean
  available?: boolean
  tags?: string[]
  metadata?: RuntimeMetadata
}

export type RuntimeImageOutputFormat = 'png' | 'jpeg' | 'jpg' | 'webp'
export type RuntimeImageBackground = 'transparent' | 'opaque' | 'auto'

/**
 * Image capability is intentionally all-optional. A thin runtime that exposes a
 * single image tool maps on by filling minimal fields (e.g. one synthesized
 * provider with a defaultModel); a rich runtime fills more. Consumers MUST
 * treat a sparse capability as normal and never require a field a thin runtime
 * cannot provide — gaps are filled below, in the adapter/shim, not pushed up
 * into plugins. See .claude/knowledge/media-generation-adapter-architecture.md.
 */
export interface RuntimeImageProviderCapabilities {
  generate?: {
    maxCount?: number
    supportsSize?: boolean
    supportsAspectRatio?: boolean
    supportsResolution?: boolean
  }
  edit?: {
    enabled?: boolean
    maxCount?: number
    maxInputImages?: number
    supportsSize?: boolean
    supportsAspectRatio?: boolean
    supportsResolution?: boolean
  }
  geometry?: {
    sizes?: string[]
    aspectRatios?: string[]
    resolutions?: string[]
  }
  output?: {
    formats?: string[]
    qualities?: string[]
    backgrounds?: string[]
  }
  metadata?: RuntimeMetadata
}

export interface RuntimeImageProvider {
  id: string
  label?: string
  defaultModel?: string
  models?: string[]
  available?: boolean
  configured?: boolean
  selected?: boolean
  capabilities?: RuntimeImageProviderCapabilities
  metadata?: RuntimeMetadata
}

export interface RuntimeImageGenerateInput {
  prompt: string
  provider?: string
  model?: string
  count?: number
  width?: number
  height?: number
  size?: string
  aspectRatio?: string
  resolution?: string
  outputFormat?: RuntimeImageOutputFormat
  background?: RuntimeImageBackground
  /**
   * Reference/context image file paths conditioning the generation. The caller
   * (Bakin) resolves managed asset ids to concrete paths before the adapter
   * sees them. Native generation has no file input, so a generate carrying
   * references is routed through the edit-style invocation (#418).
   */
  referenceImages?: string[]
  timeoutMs?: number
  metadata?: RuntimeMetadata
}

export interface RuntimeImageEditInput extends RuntimeImageGenerateInput {
  files: string[]
}

export interface RuntimeImageFile {
  filePath: string
  mimeType?: string
  width?: number
  height?: number
  provider?: string
  model?: string
  url?: string
  metadata?: RuntimeMetadata
}

export interface RuntimeImageGenerationResult {
  images: RuntimeImageFile[]
  provider?: string
  model?: string
  providerText?: string
  metadata?: RuntimeMetadata
}

export interface RuntimeImagesAccess {
  providers(): Promise<RuntimeImageProvider[]>
  generate(input: RuntimeImageGenerateInput): Promise<RuntimeImageGenerationResult>
  edit(input: RuntimeImageEditInput): Promise<RuntimeImageGenerationResult>
}

export interface CronJob {
  id: string
  name: string
  schedule: string
  command: string
  enabled: boolean
  toolsAllow?: string[]
  metadata?: RuntimeMetadata
}

export interface CronRun {
  id: string
  jobId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  startedAt?: string
  endedAt?: string
  output?: string
  error?: string
}

export interface CreateCronJobInput {
  id?: string
  name: string
  schedule: string
  command: string
  enabled?: boolean
  toolsAllow?: string[]
  metadata?: RuntimeMetadata
}

export type UpdateCronJobInput = Partial<Omit<CreateCronJobInput, 'id' | 'toolsAllow'>> & {
  toolsAllow?: string[] | null
}

export interface RawCronSnapshot {
  provider: string
  capturedAt: string
  snapshot: unknown
}

/**
 * URI scheme for runtime-private media references (`media://inbound/…`).
 * The ONE place upstream code may learn the scheme: callers detect
 * media references with this constant and hand them to `media.resolveUri`
 * (feature-detected) — the adapter owns what the URI means.
 */
export const RUNTIME_MEDIA_URI_SCHEME = 'media://'

export interface AgentRuntimeAdapter {
  readonly name: string
  readonly version: string
  readonly requiredCoreVersion: string

  initialize(opts: AdapterInitOpts): Promise<void>
  shutdown(): Promise<void>
  /**
   * "Can this runtime serve a turn?" — a CHEAP probe (an HTTP health hit, a
   * credential-presence read; never an LLM call). Resolves `false` rather
   * than throwing when the runtime cannot serve (unreachable process,
   * uninitialized adapter, no LLM credentials). Deeper diagnostics are
   * registered separately with the canonical Health registry.
   */
  ping(): Promise<boolean>
  /**
   * Re-read ALL durable config: credentials, model registry, settings,
   * provisioned tool access. External-process runtimes may bounce the
   * process; in-process runtimes must drop every cache so the next call
   * re-reads disk. Callers (team/models plugins) invoke this after config
   * writes and expect the next read to reflect them.
   */
  restart(): Promise<void>

  /**
   * CRUD error contract (R28): `get` returns `null` for a missing agent —
   * absence is a value, never a throw. Mutations addressing a MISSING agent
   * (`update`, `updateAllowlist`, `remove`) reject with a typed
   * `RuntimeError` kind `'not_found'`. Workspace-file writes are exempt BY
   * DESIGN: they provision the workspace directory on demand (creating an
   * agent's first file is a legitimate provisioning step, not an error).
   * Provider/runtime failures on these surfaces are typed `RuntimeError`s
   * (adapters map them in their own errors module — core never classifies
   * on message text); caller-INPUT validation (invalid names/paths,
   * unsupported options) may throw plain `Error`s — those signal programmer
   * error before any runtime interaction, not runtime state.
   */
  agents: {
    list(): Promise<RuntimeAgent[]>
    get(agentId: string): Promise<RuntimeAgent | null>
    create(input: CreateRuntimeAgentInput): Promise<RuntimeAgent>
    update(agentId: string, input: UpdateRuntimeAgentInput): Promise<RuntimeAgent>
    remove(agentId: string): Promise<void>
    listWorkspaceFiles(agentId: string): Promise<string[]>
    readWorkspaceFile(agentId: string, path: string): Promise<WorkspaceFile | null>
    writeWorkspaceFile(agentId: string, file: WorkspaceFile): Promise<void>
    removeWorkspaceFile(agentId: string, path: string): Promise<void>
    /**
     * Read-only size stats for the files the runtime loads at session start
     * (canonical bootstrap files, skills, memory notes). Null when the agent
     * has no workspace. Optional: runtimes without a file-backed workspace
     * omit it, and callers must treat absence as "stats unavailable" —
     * skip, never error.
     */
    workspaceFileStats?(agentId: string): Promise<WorkspaceFileStat[] | null>
    /**
     * The SUBAGENT-DISPATCH allowlist: the patch strings are AGENT IDS this
     * agent may dispatch subtasks to (P5.3 live incident: these were once fed
     * into an exec-tool name filter — they are never tool names). OpenClaw
     * writes `agents.list[].subagents.allowAgents` in its config; Pi stores
     * the registry record's `allowlist`, consumed by its tool bridge when
     * filtering subagent dispatch targets. Installer/team flows add every
     * newly installed agent to its dispatchers here.
     */
    updateAllowlist(agentId: string, patch: RuntimeAllowlistPatch): Promise<void>
  }

  messaging: {
    send(args: MessageArgs): Promise<MessageResult>
    /**
     * Stream one agent turn as normalized ChatChunks. See the ChatChunk
     * doc for the behavioral contract: adapter-varying granularity,
     * `done` exactly once and last, best-effort tool/status liveness,
     * terminal failure = `error` chunk then end (never a throw from
     * iteration), classified/structured chunks only.
     */
    stream(args: MessageArgs): AsyncIterable<ChatChunk>
  }

  /**
   * OPTIONAL capability (P2.1): runtimes without a channel/delivery layer
   * (Pi) OMIT this member entirely — no throwing stubs. Callers MUST
   * feature-detect (`runtime.channels?.…` or a guarded local) and degrade
   * honestly: empty channel lists, log-only alerts, UI-only approval gates.
   * `capabilities().delivery.mode` reports the same fact declaratively.
   */
  channels?: {
    list(): Promise<ChannelInfo[]>
    sendNotification(args: NotificationArgs): Promise<DeliveryResult>
    sendMessage(args: ChannelMessageArgs): Promise<DeliveryResult>
    deliverContent(args: ContentDeliveryArgs): Promise<DeliveryResult>
    createApproval(args: CreateApprovalArgs): Promise<ApprovalRenderResult>
    editApproval(args: EditApprovalArgs): Promise<ApprovalRenderResult>
    cancelApproval(args: CancelApprovalArgs): Promise<void>
    resolveApproval(args: ResolveApprovalArgs): Promise<void>
    subscribeApprovalResponses(handler: (event: ApprovalResolveEvent) => void): Unsubscribe
    /**
     * Optional threading/editing capabilities. Adapters for providers without
     * threads or message editing omit them; callers MUST feature-detect and
     * fall back to flat channel messages — never error on absence.
     */
    createThread?(args: CreateThreadArgs): Promise<CreatedThread | null>
    editMessage?(args: EditChannelMessageArgs): Promise<void>
  }

  skills: {
    list(agentId?: string): Promise<RuntimeSkill[]>
    get(name: string, agentId?: string): Promise<RuntimeSkill | null>
    write(skill: RuntimeSkill, agentId?: string): Promise<void>
    remove(name: string, agentId?: string): Promise<void>
  }

  sessions: {
    list(agentId?: string): Promise<RuntimeSession[]>
    get(sessionId: string): Promise<RuntimeSession | null>
    /**
     * Per-agent session-store disk stats. Optional: runtimes without a
     * file-backed session store omit it, and callers must treat absence
     * as "stats unavailable" — skip, never error.
     */
    storeStats?(): Promise<RuntimeSessionStoreStats[]>
  }

  memory: {
    listTiers(): Promise<RuntimeMemoryTier[]>
    listEntries(tierId: string, opts?: { agentId?: string }): Promise<RuntimeMemoryEntry[]>
    getEntry(tierId: string, id: string, opts?: { agentId?: string }): Promise<RuntimeMemoryEntry | null>
    statEntry(tierId: string, id: string, opts?: { agentId?: string }): Promise<RuntimeMemoryEntryStat | null>
    readEntryRange(
      tierId: string,
      id: string,
      opts?: { agentId?: string; offset?: number; length?: number },
    ): Promise<RuntimeMemoryReadRange | null>
    resolvePath(path: string): Promise<RuntimeMemoryPathMatch | null>
    watchPaths(): Promise<string[]>
    search(query: string, opts?: { agentId?: string; limit?: number }): Promise<RuntimeMemorySearchResult>
  }

  models: {
    listAvailable(opts?: { includeUnavailable?: boolean }): Promise<RuntimeAvailableModel[]>
    /** Static declaration of which routing-policy fields this runtime honors. */
    routingSupport(): RuntimeRoutingSupport
    /** The runtime's current routing policy (unsupported fields empty). */
    routingPolicy(): Promise<RuntimeRoutingPolicy>
    /**
     * Merge a partial policy into the runtime's native store. MUST throw on
     * a patch carrying a field `routingSupport()` declares unsupported.
     * `reason` feeds the adapter's audit trail.
     */
    setRoutingPolicy(patch: Partial<RuntimeRoutingPolicy>, reason: string): Promise<void>
  }

  /**
   * The unified capability declaration for this runtime, evaluated for
   * `opts.agentId`'s effective model (default: the main agent) where
   * model-dependent (input modality). Async: the report surface for the
   * runtime-switch UI + plugin capability queries. `input` is conservative-
   * false on any ambiguity, never model-name heuristics.
   *
   * Modes are HONEST: a static `'native'` declaration is acceptable only
   * when the surface is unconditionally implemented (the standard the T28
   * sessions fix restored — a declared-native stub is a contract violation,
   * pinned by the runtime conformance suite's capability-honesty check).
   */
  capabilities(opts?: { agentId?: string }): Promise<CapabilitySet>

  /**
   * How agents on this runtime invoke Bakin exec tools — drives the
   * tool-usage wording of dispatch prompts + projected AGENTS.md. SYNC +
   * static (declared wiring, not probed state) so it's callable from the
   * synchronous prompt-assembly path; `capabilities().toolCalling.access`
   * returns the same facts for the async report surface.
   */
  describeToolAccess(): RuntimeToolAccess

  /**
   * Presence-only credential report for the runtime's LLM providers and
   * channels (P2.2). `opts.agentId` scopes provider credentials to one
   * agent's profile where the runtime keys them per-agent (default: the
   * main agent). Never returns secret material.
   */
  credentialStatus(opts?: { agentId?: string }): Promise<RuntimeCredentialStatus>

  /**
   * Wire up this runtime so its agents can reach Bakin's exec tools.
   * Idempotent + re-invokable: run at init AND whenever the agent roster or
   * exec-tool set changes (agent-create, plugin (un)load).
   *   - in-process (Pi): no-op — tools are injected per session via the
   *     `execTools` provider passed to `initialize`.
   *   - mcp (OpenClaw): write `config.mcp.servers[bakin-<agent>]` for every
   *     agent, pruning stale Bakin entries; needs `bakinMcpBaseUrl` (init opt).
   *   - cli-shim: no-op stub.
   * The `execTools` provider reads the LIVE registry; runtimes that inject
   * tools by value re-read it here so late registrations become visible.
   */
  provisionToolAccess(execTools?: RuntimeExecToolProvider): Promise<void>

  /**
   * Tear down what `provisionToolAccess` wrote. in-process/cli-shim: no-op.
   * mcp: remove Bakin-owned `bakin-*` server entries. Called by the
   * runtime-switch flow (P3.2) on switch-away.
   */
  deprovisionToolAccess(): Promise<void>

  /**
   * Report whether tool-access provisioning is currently in place, WITHOUT
   * writing. Drives the onboarding/doctor drift surfaces through a
   * runtime-neutral status so core never inspects a provider's config shape.
   */
  verifyToolAccess(): Promise<ToolAccessProvisioningStatus>

  images?: RuntimeImagesAccess

  /**
   * Access to the runtime's private media store (e.g. channel attachments).
   * `resolveUri` maps a runtime-private URI (`RUNTIME_MEDIA_URI_SCHEME`-
   * prefixed) to an absolute local file path; null for unknown schemes or
   * missing files — never throws for not-found. Optional: runtimes without a
   * media store omit it, and callers must treat absence as "cannot resolve".
   */
  media?: {
    resolveUri(uri: string): Promise<string | null>
  }

  /**
   * OPTIONAL capability (P2.1): the RUNTIME's native cron surface (jobs the
   * runtime/agents create for themselves — Bakin surfaces them read-only and
   * can adopt them). Runtimes without one (Pi) OMIT the member; Bakin-owned
   * task scheduling (the schedule plugin's own tick scheduler) is unaffected.
   * Callers MUST feature-detect and treat absence as "no native jobs".
   */
  cron?: {
    list(): Promise<CronJob[]>
    get(id: string): Promise<CronJob | null>
    create(input: CreateCronJobInput): Promise<CronJob>
    update(id: string, patch: UpdateCronJobInput): Promise<CronJob>
    remove(id: string): Promise<void>
    runNow(id: string): Promise<CronRun>
    listRuns(jobId: string): Promise<CronRun[]>
    getRaw(id: string, reason: string): Promise<unknown | null>
    restoreRaw(id: string, snapshot: unknown, reason: string): Promise<CronJob>
  }
}
