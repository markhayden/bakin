import type { AdapterHealthCheckDefinition, AdapterInitOpts, Unsubscribe } from '../shared'
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

export interface MessageArgs extends RuntimeMessageToolPolicy {
  agentId: string
  content: string
  /**
   * Adapter-neutral durable conversation key. Runtime adapters should map the
   * same agentId + threadId pair to the same provider/runtime session.
   */
  threadId?: string
  metadata?: RuntimeMetadata
}

export interface MessageResult {
  id: string
  content?: string
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
  /** Files in the agent's sessions directory, including the store itself. */
  fileCount: number
  /** Total bytes of the agent's sessions directory. */
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

export interface RuntimeConfigAccess {
  get<T = Record<string, unknown>>(): Promise<T>
  update(patch: Record<string, unknown>): Promise<void>
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

  channels: {
    list(): Promise<ChannelInfo[]>
    sendNotification(args: NotificationArgs): Promise<DeliveryResult>
    sendMessage(args: ChannelMessageArgs): Promise<DeliveryResult>
    deliverContent(args: ContentDeliveryArgs): Promise<DeliveryResult>
    createApproval(args: CreateApprovalArgs): Promise<ApprovalRenderResult>
    editApproval(args: EditApprovalArgs): Promise<ApprovalRenderResult>
    cancelApproval(args: CancelApprovalArgs): Promise<void>
    resolveApproval(args: ResolveApprovalArgs): Promise<void>
    subscribeApprovalResponses(handler: (event: ApprovalResolveEvent) => void): Unsubscribe
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

  cron: {
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
