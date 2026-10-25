/**
 * Approvals — ONE durable primitive for every "a human must decide" moment
 * (spec D6/D7). Workflow gates and Health repairs share the record shape;
 * the owner is a tagged union so each kind carries exactly what its handler
 * needs to act on a decision, and nothing else.
 */
import type { HealthRepairEffects, HealthRepairMode } from '@makinbakin/sdk/types'
import type { ApprovalDelivery, ApprovalOption, ApprovalResponse, RuntimeMetadata } from '../adapters/runtime/channels'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'expired'

/** Records the adapted engine writes carry this; legacy records lack it and are retired raw at boot (self-healing 1.6/1.7). */
export const APPROVAL_SCHEMA_VERSION = 2

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
  effects: HealthRepairEffects
  mode: HealthRepairMode
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
  /** Why the operator is being asked: the safe auto-repair that already failed (#896 D3.4). */
  failure?: RepairFailure
}

/** The receipt of a repair attempt that failed before this proposal was raised. */
export interface RepairFailure {
  operationId: string
  stage: string
  error: string
  at: string
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

/** A recorded decision; `provenance` is absent only on records from before #898 (legacy). */
export type StoredApprovalResponse = Omit<ApprovalResponse, 'provenance'> & { provenance?: ApprovalResponse['provenance'] }

export interface ApprovalRecord {
  approvalId: string
  /** `APPROVAL_SCHEMA_VERSION` on every record the current engine writes; absent on legacy records. */
  schemaVersion?: number
  owner: ApprovalOwner
  status: ApprovalStatus
  request: ApprovalRequest
  deliveries: ApprovalDelivery[]
  response?: StoredApprovalResponse
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
