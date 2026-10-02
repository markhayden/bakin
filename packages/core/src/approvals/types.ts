/**
 * Approvals — ONE durable primitive for every "a human must decide" moment
 * (spec D6/D7). Workflow gates and Health repairs share the record shape;
 * the owner is a tagged union so each kind carries exactly what its handler
 * needs to act on a decision, and nothing else.
 */
import type { ApprovalDelivery, ApprovalOption, ApprovalResponse, RuntimeMetadata } from '../adapters/runtime/channels'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired'

export type RepairSafety = 'safe' | 'manual' | 'destructive'

/** One deterministic change a repair item proposes — frozen at approval time (plan review R1). */
export interface ProposedChange {
  kind: string
  target: string
  action: string
  description: string
}

export interface ProposedRepairItem {
  actionId: string
  itemId: string
  safety: RepairSafety
  changes: ProposedChange[]
}

/**
 * The frozen proposal a health-repair approval was granted for. At apply time
 * the doctor re-plans against fresh evidence and applies only when the new
 * change set matches this one (plan review R1); `reportId` is provenance.
 */
export interface RepairProposal {
  reportId: string
  observationIds: string[]
  items: ProposedRepairItem[]
}

export type ApprovalOwner =
  | { kind: 'workflow-gate'; taskId: string; workflowId: string; runId: string; stepId: string }
  | { kind: 'health-repair'; taskId: string; requestId: string; incidentIds: string[]; proposal: RepairProposal }
  | { kind: 'health-navigate'; taskId: string; requestId: string; incidentIds: string[]; href: string }

export type ApprovalKind = ApprovalOwner['kind']

export interface ApprovalRequest {
  title: string
  body: string
  options: ApprovalOption[]
  expiresAt?: string
  context?: RuntimeMetadata
}

export interface ApprovalRecord {
  approvalId: string
  owner: ApprovalOwner
  status: ApprovalStatus
  request: ApprovalRequest
  deliveries: ApprovalDelivery[]
  response?: ApprovalResponse
  createdAt: string
  updatedAt: string
  resolvedAt?: string
}

export interface ApprovalListFilter {
  status?: ApprovalStatus
  /** Only records whose owner.taskId is in this set. */
  taskIds?: readonly string[]
  kind?: ApprovalKind
}
