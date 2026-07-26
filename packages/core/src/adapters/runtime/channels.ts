/**
 * Channel/delivery contract types — a LEAF module (imports only
 * ./capabilities) so both the runtime contract (concepts.ts) and the
 * delivery-bridge seam (packages/core/src/delivery/bridge.ts, threaded
 * through AdapterInitOpts in ../shared.ts) can share the surface without an
 * import cycle: shared -> bridge -> channels and concepts -> channels.
 */
import type { ChannelCapability } from './capabilities'

export type RuntimeMetadata = Record<string, unknown>

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
    /**
     * Path files are read from disk (trusted plugin/core callers only). For
     * `{ kind: 'asset' }` refs, `filename` is the ASSET ID — providers
     * resolve it through the `assets.resolveServe` hook; an unresolvable id
     * degrades to a visible omission, never a failed delivery.
     */
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

/** An inbound attachment already materialized to a LOCAL file by the provider. */
export interface InboundChannelAttachment {
  name: string
  path: string
  contentType?: string
  size?: number
}

/**
 * A human message arriving FROM a channel (#669 Phase B). The provider has
 * already applied its gating (allowlists, mention requirements) — a handler
 * receiving this may treat the sender as authorized. `channelRef` is
 * provider-qualified and directly usable as a send target for the reply.
 */
export interface InboundChannelMessage {
  platform: string
  channelRef: string
  authorId: string
  authorName?: string
  text: string
  attachments?: InboundChannelAttachment[]
  /** Provider message ref (e.g. "message:<id>"). */
  messageRef: string
}

/**
 * The full channel surface a delivering runtime exposes (see
 * `AgentRuntimeAdapter.channels` for the capability semantics — the member
 * is OPTIONAL there; this type is the shape when present).
 */
export interface RuntimeChannelSurface {
  list(): Promise<ChannelInfo[]>
  sendNotification(args: NotificationArgs): Promise<DeliveryResult>
  sendMessage(args: ChannelMessageArgs): Promise<DeliveryResult>
  deliverContent(args: ContentDeliveryArgs): Promise<DeliveryResult>
  createApproval(args: CreateApprovalArgs): Promise<ApprovalRenderResult>
  editApproval(args: EditApprovalArgs): Promise<ApprovalRenderResult>
  cancelApproval(args: CancelApprovalArgs): Promise<void>
  resolveApproval(args: ResolveApprovalArgs): Promise<void>
  subscribeApprovalResponses(handler: (event: ApprovalResolveEvent) => void): () => void
  /**
   * Optional threading/editing capabilities. Adapters for providers without
   * threads or message editing omit them; callers MUST feature-detect and
   * fall back to flat channel messages — never error on absence.
   */
  createThread?(args: CreateThreadArgs): Promise<CreatedThread | null>
  editMessage?(args: EditChannelMessageArgs): Promise<void>
  /**
   * OPTIONAL inbound stream (#669 Phase B): human messages from the channel
   * platform, pre-gated by the provider (allowlists fail closed; guild
   * messages mention-gated). Runtimes that handle inbound themselves
   * (OpenClaw) OMIT this member — consumers feature-detect.
   */
  subscribeInboundMessages?(handler: (message: InboundChannelMessage) => void): () => void
}
