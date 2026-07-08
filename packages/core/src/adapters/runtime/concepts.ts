import type { AdapterHealthCheckDefinition, AdapterInitOpts, RuntimeExecToolProvider, Unsubscribe } from '../shared'
import type { ChannelCapability } from './capabilities'

export type RuntimeMetadata = Record<string, unknown>

export interface RuntimeAgent {
  id: string
  name: string
  role?: string
  model?: string
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
  model?: string
  metadata?: RuntimeMetadata
}

export interface RuntimePermissionPatch {
  allow?: string[]
  deny?: string[]
  replace?: boolean
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
   */
  toolsMode?: RuntimeMessageToolsMode
  /** Optional runtime-native tool allowlist for this turn. */
  toolsAllow?: string[]
  /** Optional runtime-native tool denylist for this turn. */
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
  metadata?: RuntimeMetadata
}

/** Token usage for one agent turn, when the runtime reports it. */
export interface MessageUsage {
  input?: number
  output?: number
  total?: number
  /** Cached-input tokens read (priced far below fresh input when known). */
  cacheRead?: number
  /** Cached-input tokens written (cache creation). */
  cacheWrite?: number
  /** Resolved model the runtime ran, when known. */
  model?: string
}

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

export interface ChatChunk {
  type: 'text' | 'tool' | 'status' | 'done' | 'error'
  content?: string
  data?: RuntimeMetadata | RuntimeToolActivity
}

export interface ToolResult {
  ok: boolean
  output?: unknown
  error?: { message: string; recoverable: boolean }
}

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
export interface RuntimeCredentialStatus {
  /** Provider names with usable credentials (api key / token / OAuth). */
  llmProviders: string[]
  /** Channel names with usable credentials. Empty on channel-less runtimes. */
  channels: string[]
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
 * Whole-config access to the runtime provider's own configuration.
 *
 * GOVERNED SURFACE: app and plugin code never calls these directly — reads
 * and replaces go through the scoped wrapper in `src/core/runtime-config.ts`
 * (typed scopes; mutations audited), and key-level reads through
 * `src/core/runtime-config-raw.ts` (allowlist + audit). Both are
 * architecture-test enforced. `update(patch)` was removed — it had zero
 * callers, and a reasonless deep-merge write was exactly the ungoverned
 * surface the audit flagged.
 */
export interface RuntimeConfigAccess {
  get<T = Record<string, unknown>>(): Promise<T>
  replace<T = Record<string, unknown>>(next: T, reason: string): Promise<void>
  raw<T = unknown>(key: string, reason: string): Promise<T>
}

export interface AgentRuntimeAdapter {
  readonly name: string
  readonly version: string
  readonly requiredCoreVersion: string

  initialize(opts: AdapterInitOpts): Promise<void>
  shutdown(): Promise<void>
  ping(): Promise<boolean>
  restart(): Promise<void>
  getHealthChecks(): AdapterHealthCheckDefinition[]

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
    updatePermissions(agentId: string, patch: RuntimePermissionPatch): Promise<void>
    updateAllowlist(agentId: string, patch: RuntimeAllowlistPatch): Promise<void>
  }

  messaging: {
    send(args: MessageArgs): Promise<MessageResult>
    stream(args: MessageArgs): AsyncIterable<ChatChunk>
  }

  tools: {
    invoke(agentId: string, name: string, args: unknown): Promise<ToolResult>
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
  }

  /**
   * The unified capability declaration for this runtime, evaluated for
   * `opts.agentId`'s effective model (default: the main agent) where
   * model-dependent (input modality). Async: the report surface for the
   * runtime-switch UI + plugin capability queries. `input` is conservative-
   * false on any ambiguity, never model-name heuristics.
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
   * mcp: remove Bakin-owned `bakin-*` server entries. NO CALLER YET — the
   * Phase-3 runtime-switch flow (P3.2) invokes it on switch-away; until then
   * a switched-from OpenClaw config keeps its (harmless, idle) entries.
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
   * `resolveUri` maps a runtime-private URI (OpenClaw's `media://…`) to an
   * absolute local file path; null for unknown schemes or missing files —
   * never throws for not-found. Optional: runtimes without a media store
   * omit it, and callers must treat absence as "cannot resolve".
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

  config: RuntimeConfigAccess
}
