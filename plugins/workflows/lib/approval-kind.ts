/**
 * The `workflow-gate` approval kind (spec D6/D7).
 *
 * Core owns the record, the resolve orchestration, rehydration and the ONE
 * channel subscription; this module owns what a gate decision MEANS:
 *   ownerState — is the instance still waiting at this gate (for rehydration)
 *   onResolve  — approve/reject the gate, audit, re-index, kick dispatch,
 *                post the decision receipt
 *   render     — the gate's channel card: context message (+ thread) first,
 *                then the native button card routed into the thread
 * plus the two entry points the plugin itself needs: `decideGate` for its
 * routes and hooks, `ensurePendingGateApprovals` for boot (plan review R5a).
 */
import type { ApprovalDelivery } from '@bakin/core/adapters/runtime'
import type { RuntimeChannelSurface } from '@bakin/core/adapters/runtime/channels'
import type { ApprovalActor } from '@bakin/core/plugin-types'
import { findPendingApproval, updateApprovalDeliveries, type ApprovalRecord } from '@bakin/core/approvals'
import { createLogger } from '@bakin/core/logger'
import {
  ApprovalResolveError,
  registerApprovalKind,
  resolveApproval,
  type ApprovalDecision,
  type ApprovalKindHandler,
  type ApprovalOwnerState,
  type RecordOf,
} from '../../../src/core/approvals'
import { getSettings } from '../../../src/core/settings'
import type { WorkflowInstance } from '../types'
import { approveGate, rejectGate } from './gates'
import { buildGateAuditPayload } from './gate-audit'
import { listInstances, loadInstance } from './instance-store'
import { requestGateApproval, sendGateContextMessage, sendGateDecisionSummary } from './notifications'
import { loadDefinition } from './parser'
import { getWorkflowPluginContext } from './plugin-context'
import { indexInstance } from './search-sync'
import { triggerDispatch } from './trigger-dispatch'

const log = createLogger('workflow-approvals')

export const CHANNEL_REJECT_DEFAULT_REASON = 'Rejected via runtime channel (no reason provided)'
const WEB_REJECT_DEFAULT_REASON = 'Rejected (no reason provided)'

type GateRecord = RecordOf<'workflow-gate'>

/** Label + reviewer context for a gate, read from the definition the engine used. */
function gateContext(instance: WorkflowInstance, stepId: string): { label: string; priorOutput: Record<string, unknown> | undefined } {
  const def = loadDefinition(instance.workflowId)
  const idx = def?.steps.findIndex((s) => s.id === stepId) ?? -1
  const step = idx >= 0 ? def!.steps[idx] : undefined
  const prior = idx > 0 ? def!.steps[idx - 1] : undefined
  return {
    label: step?.label || stepId,
    priorOutput: prior ? instance.stepStates[prior.id]?.output : undefined,
  }
}

export function pendingGateApproval(taskId: string, stepId: string): ApprovalRecord | null {
  return findPendingApproval((r) => r.owner.kind === 'workflow-gate' && r.owner.taskId === taskId && r.owner.stepId === stepId)
}

function rejectReason(decision: ApprovalDecision): string {
  const typed = decision.comment?.trim()
  if (typed) return typed
  if (decision.actor.source === 'channel') return CHANNEL_REJECT_DEFAULT_REASON
  if (getSettings().approvals.requireRejectReason) throw new ApprovalResolveError('A reject reason is required', 400)
  return WEB_REJECT_DEFAULT_REASON
}

async function ownerState(record: GateRecord): Promise<ApprovalOwnerState> {
  const { taskId, stepId, runId } = record.owner
  const instance = loadInstance(taskId)
  // Missing is ambiguous (deleted task vs. transiently unreadable file at
  // boot) — unknown, never orphaned: a false-positive cancel permanently kills
  // the gate's buttons. Genuinely deleted tasks leave a cancelled instance
  // file behind, which IS orphaned.
  if (!instance) return 'unknown'
  const stepState = instance.stepStates[stepId]
  if (
    instance.instanceId !== runId
    || instance.currentStepId !== stepId
    || instance.status !== 'pending_approval'
    || stepState?.status !== 'pending_approval'
  ) return 'orphaned'
  return 'live'
}

async function onResolve(record: GateRecord, decision: ApprovalDecision): Promise<void> {
  const { taskId, stepId } = record.owner
  const approver: ApprovalActor = decision.actor
  const source = decision.actor.source
  const ctx = getWorkflowPluginContext()

  if (decision.option === 'approve') {
    const result = approveGate(taskId, stepId, { approver })
    if (!result.success || !result.decision) throw new ApprovalResolveError(result.errors?.[0] ?? 'Gate could not be approved', 400)
    ctx?.activity.audit('gate.approved', source, buildGateAuditPayload(taskId, stepId, result.decision))
    ctx?.activity.log(source, `Gate "${stepId}" approved`, { taskId })
    indexInstance(taskId).catch(() => {})
    // Kick dispatch so the next step's agent starts immediately.
    triggerDispatch()
    const instance = loadInstance(taskId)
    if (instance) {
      sendGateDecisionSummary(instance, stepId, result.decision.gateLabel, 'approved', approver, result.decision.requestedAt, result.decision.decidedAt, undefined, record.deliveries)
        .catch((err) => log.warn('Gate decision summary failed', err, { taskId, stepId }))
    }
    return
  }

  if (decision.option === 'reject') {
    const reason = rejectReason(decision)
    const result = rejectGate(taskId, stepId, reason, { approver })
    if (!result.success || !result.decision) throw new ApprovalResolveError(result.errors?.[0] ?? 'Gate could not be rejected', 400)
    ctx?.activity.audit('gate.rejected', source, buildGateAuditPayload(taskId, stepId, result.decision, reason))
    ctx?.activity.log(source, `Gate "${stepId}" rejected: ${reason}`, { taskId })
    indexInstance(taskId).catch(() => {})
    const instance = loadInstance(taskId)
    if (instance) {
      sendGateDecisionSummary(instance, stepId, result.decision.gateLabel, 'rejected', approver, result.decision.requestedAt, result.decision.decidedAt, reason, record.deliveries)
        .catch((err) => log.warn('Gate decision summary failed', err, { taskId, stepId }))
    }
    return
  }

  throw new ApprovalResolveError(`Unknown gate decision "${decision.option}"`, 400)
}

/**
 * Context first, buttons second: the native approval card is capped at 256
 * chars upstream, so the reviewable substance (prior output, generated media)
 * rides rich messages — ONE compact card plus a thread when the adapter
 * supports threads, one flat message otherwise. Context deliveries are
 * persisted BEFORE the button card is attempted: if createApproval throws,
 * the already-posted card must be on the record or the next rehydration
 * re-renders a duplicate.
 */
async function render(record: GateRecord, channels: RuntimeChannelSurface, resolvedChannel: string): Promise<ApprovalDelivery[]> {
  const { taskId, stepId } = record.owner
  const instance = loadInstance(taskId)
  if (!instance) throw new Error(`Workflow instance ${taskId} not found`)
  const { label, priorOutput } = gateContext(instance, stepId)

  const thread = await sendGateContextMessage(channels, instance, stepId, label, priorOutput, resolvedChannel, record.request.context)
  const contextDeliveries = thread?.deliveries ?? []
  if (contextDeliveries.length > 0) updateApprovalDeliveries(record.approvalId, contextDeliveries)

  const request = thread?.threadId
    ? { ...record.request, context: { ...(record.request.context ?? {}), threadId: thread.threadId } }
    : record.request
  const result = await channels.createApproval({ approvalId: record.approvalId, channels: [resolvedChannel], request })
  const deliveries = [...contextDeliveries, ...result.deliveries]
  log.info(`Gate approval card sent for ${taskId}:${stepId}`, { approvalId: record.approvalId, deliveryCount: deliveries.length, threaded: Boolean(thread?.threadId) })
  return deliveries
}

export const workflowGateApprovalKind: ApprovalKindHandler<'workflow-gate'> = { kind: 'workflow-gate', ownerState, onResolve, render }

export function registerWorkflowGateApprovalKind(): void {
  registerApprovalKind(workflowGateApprovalKind)
}

/**
 * Decide the pending gate at (task, step) through core. The ONE entry for the
 * plugin's own surfaces — REST routes, the decision page, the gate hooks.
 * Throws the typed approval errors (no pending record ⇒ ApprovalResolveError 404-ish 400).
 */
export async function decideGate(
  taskId: string,
  stepId: string,
  option: 'approve' | 'reject',
  actor: ApprovalActor,
  comment?: string,
): Promise<ApprovalRecord> {
  const record = pendingGateApproval(taskId, stepId)
  if (!record) throw new ApprovalResolveError(`No pending approval for gate "${stepId}" on task ${taskId}`, 400)
  return resolveApproval(record.approvalId, { option, actor, ...(comment ? { comment } : {}) })
}

/**
 * Boot reconcile (plan review R5a): every instance waiting at a gate gets a
 * pending record — gates reached before approvals lived in core, or while a
 * record write failed, become decidable on the board. Idempotent.
 */
export function ensurePendingGateApprovals(): { checked: number; created: number } {
  let created = 0
  const pending = listInstances('pending_approval')
  for (const instance of pending) {
    const stepId = instance.currentStepId
    if (instance.stepStates[stepId]?.status !== 'pending_approval') continue
    const existing = findPendingApproval((r) =>
      r.owner.kind === 'workflow-gate' && r.owner.taskId === instance.taskId && r.owner.stepId === stepId && r.owner.runId === instance.instanceId)
    if (existing) continue
    const { label, priorOutput } = gateContext(instance, stepId)
    requestGateApproval(instance, stepId, label, priorOutput)
    created += 1
  }
  return { checked: pending.length, created }
}
