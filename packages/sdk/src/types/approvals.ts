/**
 * `ctx.approvals` — a plugin's own "a human must sign off" gates (spec D26).
 *
 * Gates ride Bakin's ONE approval primitive: every request shows on the
 * board (anchored on `taskId`), on configured channels, and in attention;
 * the operator decides through the one decision path — agents never can.
 * Bakin hands the decision to the gate handler the plugin registered for
 * that `gateKind`.
 */

export type PluginApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired'

export interface PluginApprovalOption {
  id: string
  label: string
  variant?: 'primary' | 'destructive' | 'neutral'
}

/** One of this plugin's approvals, as the plugin sees it. */
export interface PluginApproval {
  approvalId: string
  gateKind: string
  /** The plugin's subject (e.g. a project id). */
  entityId: string
  /** The board task the approval is anchored on. */
  taskId: string
  status: PluginApprovalStatus
  title: string
  summary: string
  options: PluginApprovalOption[]
  createdAt: string
  resolvedAt?: string
  /** Present once decided. */
  response?: { option: string; comment?: string; respondedAt: string; decidedBy?: string }
}

/** The operator's decision, as handed to the gate. */
export interface PluginApprovalDecision {
  option: string
  comment?: string
  respondedAt: string
  /** Human-readable "who decided, and how we know" (e.g. "Declared in UI"). */
  decidedBy: string
}

/**
 * Is the plugin still waiting on this approval? Asked at boot:
 *   live     — keep it
 *   orphaned — the subject moved on (deleted, completed, superseded); Bakin cancels it
 *   unknown  — cannot tell right now; Bakin leaves it alone
 */
export type PluginGateOwnerState = 'live' | 'orphaned' | 'unknown'

export interface PluginGateHandler {
  ownerState(approval: PluginApproval): PluginGateOwnerState | Promise<PluginGateOwnerState>
  /**
   * Apply the decision. Throw `ctx.approvals.refusal(message, status)` to
   * refuse it — the approval stays pending and the caller sees that status.
   */
  onResolve(approval: PluginApproval, decision: PluginApprovalDecision): unknown | Promise<unknown>
}

export interface PluginApprovalRequestInput {
  /**
   * Caller-chosen, deterministic id — re-requesting an existing id (pending or
   * decided) returns it untouched; a changed request needs a new id (bump a
   * generation). Must start with `<pluginId>:` (e.g.
   * `projects:<projectId>:complete:project:1`).
   */
  approvalId: string
  gateKind: string
  entityId: string
  taskId: string
  title: string
  summary: string
  /** Default: Approve / Reject. */
  options?: PluginApprovalOption[]
}

export interface PluginApprovalsAPI {
  /** Register the handler for one gate kind (in `activate()`); removed automatically on deactivate/hot reload. */
  registerGate(gateKind: string, handler: PluginGateHandler): () => void
  request(input: PluginApprovalRequestInput): PluginApproval
  /** Withdraw one of this plugin's pending approvals; null when it is not this plugin's. */
  cancel(approvalId: string, reason: string): Promise<PluginApproval | null>
  /** One of this plugin's approvals by id, or null. */
  get(approvalId: string): PluginApproval | null
  listPending(filter?: { entityId?: string; gateKind?: string }): PluginApproval[]
  /** The error to throw from `onResolve` to refuse a decision with a status. */
  refusal(message: string, status?: 400 | 409): Error
}
