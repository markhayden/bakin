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
}

export interface MessageArgs {
  agentId: string
  content: string
  threadId?: string
  metadata?: RuntimeMetadata
}

export interface MessageResult {
  id: string
  content?: string
  metadata?: RuntimeMetadata
}

export interface ChatChunk {
  type: 'text' | 'tool' | 'status' | 'done' | 'error'
  content?: string
  data?: unknown
}

export interface ToolDefinition {
  name: string
  description?: string
  inputSchema?: unknown
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
    files?: Array<{ name: string; path: string; contentType?: string }>
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

export interface ChannelMessageEvent {
  channelId: string
  messageId: string
  actor: { type: 'agent' | 'human'; id: string; displayName?: string }
  body: string
  threadId?: string
  receivedAt: string
  metadata?: RuntimeMetadata
}

export interface ChannelInteractionEvent {
  channelId: string
  interactionId: string
  actor: { type: 'agent' | 'human'; id: string; displayName?: string }
  kind: string
  payload: RuntimeMetadata
  receivedAt: string
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

export interface TaskDispatchArgs {
  bakinTaskId: string
  agentId?: string
  title: string
  description?: string
  metadata?: RuntimeMetadata
}

export interface TaskDispatchResult {
  flowId: string
}

export interface TaskExecutionStatus {
  flowId: string
  bakinTaskId?: string
  state: 'queued' | 'running' | 'blocked' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'
  currentStep?: string | null
  blockingReason?: string | null
  retryCount?: number
  startedAt?: string | null
  endedAt?: string | null
  updatedAt?: string | null
  metadata?: RuntimeMetadata
}

export interface ListExecutionsOpts {
  bakinTaskId?: string
  agentId?: string
  state?: TaskExecutionStatus['state']
  limit?: number
}

export interface TaskExecutionEvent {
  flowId: string
  bakinTaskId?: string
  status: TaskExecutionStatus
}

export interface CronJob {
  id: string
  name: string
  schedule: string
  command: string
  enabled: boolean
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
  metadata?: RuntimeMetadata
}

export type UpdateCronJobInput = Partial<Omit<CreateCronJobInput, 'id'>>

export interface RuntimeConfigAccess {
  get<T = Record<string, unknown>>(): Promise<T>
  update(patch: Record<string, unknown>): Promise<void>
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
    updatePermissions(agentId: string, patch: RuntimePermissionPatch): Promise<void>
    updateAllowlist(agentId: string, patch: RuntimeAllowlistPatch): Promise<void>
    heartbeat(agentId: string): Promise<boolean>
  }

  messaging: {
    send(args: MessageArgs): Promise<MessageResult>
    stream(args: MessageArgs): AsyncIterable<ChatChunk>
  }

  tools: {
    invoke(agentId: string, name: string, args: unknown): Promise<ToolResult>
    list(agentId: string): Promise<ToolDefinition[]>
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
    onMessage(handler: (event: ChannelMessageEvent) => void): Unsubscribe
    onInteraction(handler: (event: ChannelInteractionEvent) => void): Unsubscribe
  }

  skills: {
    list(agentId?: string): Promise<RuntimeSkill[]>
    get(name: string, agentId?: string): Promise<RuntimeSkill | null>
    write(skill: RuntimeSkill): Promise<void>
    remove(name: string): Promise<void>
  }

  sessions: {
    list(agentId?: string): Promise<RuntimeSession[]>
    get(sessionId: string): Promise<RuntimeSession | null>
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

  tasks: {
    dispatch(args: TaskDispatchArgs): Promise<TaskDispatchResult>
    getExecutionStatus(flowId: string): Promise<TaskExecutionStatus>
    listExecutions(opts?: ListExecutionsOpts): Promise<TaskExecutionStatus[]>
    cancelExecution(flowId: string): Promise<void>
    subscribeExecutionUpdates(handler: (event: TaskExecutionEvent) => void): Unsubscribe
  }

  cron: {
    list(): Promise<CronJob[]>
    get(id: string): Promise<CronJob | null>
    create(input: CreateCronJobInput): Promise<CronJob>
    update(id: string, patch: UpdateCronJobInput): Promise<CronJob>
    remove(id: string): Promise<void>
    runNow(id: string): Promise<CronRun>
    listRuns(jobId: string): Promise<CronRun[]>
  }

  config: RuntimeConfigAccess
}
