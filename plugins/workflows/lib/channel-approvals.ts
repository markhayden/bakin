/**
 * Workflow channel approvals
 *
 * wireChannelApprovals(ctx) rehydrates any pending approval renders and
 * subscribes to runtime-channel approval responses, driving approveGate /
 * rejectGate for gates decided from a channel. Returns the unsubscribe handle
 * (owned by the caller's lifecycle). Extracted from the activate() body.
 */
import type { PluginContext, ApprovalActor } from '@bakin/core/plugin-types'
import { createLogger } from '@bakin/core/logger'
import { rehydratePendingApprovals } from './approval-rehydration'
import { activeGateSettings } from './gate-settings'
import { getApprovalRecord, approvalRefFromRecord } from './approval-store'
import { approveGate, rejectGate, loadInstance } from './runtime'
import { buildGateAuditPayload, getGateDescription } from './gate-audit'
import { indexInstance } from './search-sync'
import { triggerDispatch } from './trigger-dispatch'
import { resolveGateApproval, sendGateDecisionSummary } from './notifications'

const log = createLogger('workflows')

export async function wireChannelApprovals(ctx: PluginContext): Promise<() => void> {
  const approvalRehydration = await rehydratePendingApprovals({
    runtime: ctx.runtime,
    channel: activeGateSettings().approvalChannel || 'general',
    renderMissingDeliveries: activeGateSettings().approvalChannelAlerts,
    log,
  })
  if (approvalRehydration.pending > 0 || approvalRehydration.pruned > 0 || approvalRehydration.cancelled > 0) {
    log.info('Rehydrated pending workflow approvals', { ...approvalRehydration })
  }

  return ctx.runtime.channels.subscribeApprovalResponses(async (event) => {
    const approvalRecord = getApprovalRecord(event.approvalId)
    if (!approvalRecord) {
      log.warn('Channel approval response ignored: no durable approval record', { approvalId: event.approvalId })
      return
    }

    const taskId = approvalRecord.owner.taskId
    const stepId = approvalRecord.owner.stepId
    if (!taskId || !stepId) return
    const approver: ApprovalActor = {
      source: 'channel',
      id: event.response.actor.id,
      displayName: event.response.actor.displayName,
    }
    const selected = event.response.selectedOption

    if (selected === 'approve') {
      const approvalRef = approvalRefFromRecord(approvalRecord)
      const result = approveGate(taskId, stepId, { approver })
      if (!result.success) {
        log.warn(`Channel approve failed: ${result.errors?.[0] || 'unknown error'}`, { taskId, stepId })
        return
      }

      const auditPayload = buildGateAuditPayload(taskId, stepId, result.decision)
      ctx.activity.audit('gate.approved', 'channel', auditPayload)
      ctx.activity.log('channel', `Gate "${stepId}" approved via runtime channel`, { taskId })
      indexInstance(taskId).catch(() => {})
      triggerDispatch()

      const instance = loadInstance(taskId)
      if (instance && result.decision) {
        resolveGateApproval(
          approvalRef,
          'approved',
          approver,
          result.decision.decidedAt,
        ).catch(() => {})
        sendGateDecisionSummary(
          instance,
          stepId,
          result.decision.gateLabel,
          getGateDescription(instance.workflowId, stepId),
          'approved',
          approver,
          result.decision.requestedAt,
          result.decision.decidedAt,
          undefined,
          activeGateSettings(),
        ).catch(() => {})
      }
    } else if (selected === 'reject') {
      const channelComment = event.response.comment?.trim()
      const rejectReason = channelComment || 'Rejected via runtime channel (no reason provided)'
      const approvalRef = approvalRefFromRecord(approvalRecord)
      const result = rejectGate(taskId, stepId, rejectReason, { approver })
      if (!result.success) {
        log.warn(`Channel reject failed: ${result.errors?.[0] || 'unknown error'}`, { taskId, stepId })
        return
      }

      const auditPayload = buildGateAuditPayload(taskId, stepId, result.decision, rejectReason)
      ctx.activity.audit('gate.rejected', 'channel', auditPayload)
      ctx.activity.log('channel', `Gate "${stepId}" rejected via runtime channel: ${rejectReason}`, { taskId })
      indexInstance(taskId).catch(() => {})

      const instance = loadInstance(taskId)
      if (instance && result.decision) {
        resolveGateApproval(
          approvalRef,
          'rejected',
          approver,
          result.decision.decidedAt,
          rejectReason,
        ).catch(() => {})
        sendGateDecisionSummary(
          instance,
          stepId,
          result.decision.gateLabel,
          getGateDescription(instance.workflowId, stepId),
          'rejected',
          approver,
          result.decision.requestedAt,
          result.decision.decidedAt,
          rejectReason,
          activeGateSettings(),
        ).catch(() => {})
      }
    }
  })
}
