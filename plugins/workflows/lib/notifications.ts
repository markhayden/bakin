/**
 * Workflow notification dispatcher.
 *
 * Workflow code emits local UI events directly. External delivery is routed
 * through the active runtime adapter's channel surface so provider-specific
 * API details stay behind the adapter boundary.
 */
import type { AgentRuntimeAdapter, ApprovalRenderRef } from '@bakin/core/adapters/runtime'
import type { ApprovalActor, EventBus } from '../../../src/lib/plugin-types'
import type { WorkflowInstance } from '../types'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('workflow-notifications')

let eventBus: EventBus | null = null
let runtime: AgentRuntimeAdapter | null = null
let gateSettings: GateNotificationSettings | null = null

export interface GateNotificationSettings {
  approvalChannelAlerts: boolean
  approvalChannel: string
  requireRejectReason: boolean
}

export function setEventBus(bus: EventBus): void {
  eventBus = bus
}

export function setNotificationRuntime(adapter: AgentRuntimeAdapter): void {
  runtime = adapter
}

export function setGateNotificationSettings(settings: GateNotificationSettings): void {
  gateSettings = settings
}

export function getGateNotificationSettings(): GateNotificationSettings | null {
  return gateSettings
}

export function buildGateApprovalId(taskId: string, stepId: string): string {
  return `workflow-gate:${encodeURIComponent(taskId)}:${encodeURIComponent(stepId)}`
}

export function parseGateApprovalId(approvalId: string): { taskId: string; stepId: string } | null {
  const parts = approvalId.split(':')
  if (parts.length !== 3 || parts[0] !== 'workflow-gate') return null
  try {
    return {
      taskId: decodeURIComponent(parts[1]),
      stepId: decodeURIComponent(parts[2]),
    }
  } catch {
    return null
  }
}

/**
 * Notify that a gate step has been reached and awaits approval.
 */
export function notifyGateReached(
  instance: WorkflowInstance,
  stepId: string,
  label: string,
  priorOutput?: Record<string, unknown>
): void {
  if (!eventBus) return

  eventBus.emit('workflow.gate_reached', {
    instanceId: instance.instanceId,
    taskId: instance.taskId,
    workflowId: instance.workflowId,
    stepId,
    label,
    priorOutput,
  })
}

/**
 * Notify that a workflow step has been completed.
 */
export function notifyStepComplete(
  instance: WorkflowInstance,
  stepId: string,
  label: string
): void {
  if (!eventBus) return

  eventBus.emit('workflow.step_complete', {
    instanceId: instance.instanceId,
    taskId: instance.taskId,
    workflowId: instance.workflowId,
    stepId,
    label,
  })
}

/**
 * Notify that a workflow has been completed.
 */
export function notifyWorkflowComplete(instance: WorkflowInstance): void {
  if (!eventBus) return

  eventBus.emit('workflow.complete', {
    instanceId: instance.instanceId,
    taskId: instance.taskId,
    workflowId: instance.workflowId,
  })
}

/**
 * Notify that a gate step has been approved.
 */
export function notifyGateApproved(
  instance: WorkflowInstance,
  stepId: string,
  label: string
): void {
  if (!eventBus) return

  eventBus.emit('workflow.gate_approved', {
    instanceId: instance.instanceId,
    taskId: instance.taskId,
    workflowId: instance.workflowId,
    stepId,
    label,
  })
}

/**
 * Notify that a gate step has been rejected.
 */
export function notifyGateRejected(
  instance: WorkflowInstance,
  stepId: string,
  label: string,
  reason: string
): void {
  if (!eventBus) return

  eventBus.emit('workflow.gate_rejected', {
    instanceId: instance.instanceId,
    taskId: instance.taskId,
    workflowId: instance.workflowId,
    stepId,
    label,
    reason,
  })
}

/**
 * Notify that a workflow step has been dispatched to an agent.
 */
export function notifyStepDispatched(
  instance: WorkflowInstance,
  stepId: string,
  agent: string,
  label?: string
): void {
  if (!eventBus) return

  eventBus.emit('workflow.step_dispatched', {
    instanceId: instance.instanceId,
    taskId: instance.taskId,
    workflowId: instance.workflowId,
    stepId,
    agent,
    label: label || stepId,
  })
}

export async function sendGateApprovalRequest(
  instance: WorkflowInstance,
  stepId: string,
  label: string,
  priorOutput: Record<string, unknown> | undefined,
  settings: GateNotificationSettings,
): Promise<ApprovalRenderRef | null> {
  if (!settings.approvalChannelAlerts) return null
  if (!runtime) {
    log.warn('Runtime channel adapter unavailable; skipping gate approval alert')
    return null
  }

  const approvalId = buildGateApprovalId(instance.taskId, stepId)
  const channel = settings.approvalChannel || 'general'
  const body = [
    `Workflow ${instance.workflowId} has reached a gate and needs approval.`,
    `Task: ${instance.taskId}`,
    `Step: ${stepId}`,
    renderPriorOutput(priorOutput),
  ].filter(Boolean).join('\n\n')

  try {
    const result = await runtime.channels.createApproval({
      approvalId,
      channels: [channel],
      request: {
        title: `Gate: ${label}`,
        body,
        options: [
          { id: 'approve', label: 'Approve', variant: 'primary' },
          { id: 'reject', label: 'Reject', variant: 'destructive' },
        ],
        context: {
          instanceId: instance.instanceId,
          workflowId: instance.workflowId,
          taskId: instance.taskId,
          stepId,
          requireRejectReason: settings.requireRejectReason,
        },
      },
    })
    log.info(`Gate approval alert sent for ${instance.taskId}:${stepId}`, {
      approvalId,
      deliveryCount: result.deliveries.length,
    })
    return { approvalId, deliveries: result.deliveries }
  } catch (err) {
    log.warn('Gate approval alert failed', err)
    return null
  }
}

export async function resolveGateApproval(
  approvalRef: ApprovalRenderRef | undefined,
  decision: 'approved' | 'rejected',
  approver: ApprovalActor,
  decidedAt: string,
  reason?: string,
): Promise<void> {
  if (!runtime || !approvalRef) return

  try {
    await runtime.channels.resolveApproval({
      ...approvalRef,
      response: {
        selectedOption: decision === 'approved' ? 'approve' : 'reject',
        respondedAt: decidedAt,
        actor: {
          type: 'human',
          id: approver.id,
          displayName: approver.displayName ?? approver.id,
        },
        ...(reason ? { comment: reason } : {}),
      },
    })
  } catch (err) {
    log.warn('Gate approval resolve notification failed', err)
  }
}

/**
 * Post a standalone summary after a gate decision. Failures are logged but do
 * not block workflow progression.
 */
export async function sendGateDecisionSummary(
  instance: WorkflowInstance,
  stepId: string,
  gateLabel: string,
  gateDescription: string | undefined,
  decision: 'approved' | 'rejected',
  approver: ApprovalActor,
  requestedAt: string | undefined,
  decidedAt: string,
  reason: string | undefined,
  settings: GateNotificationSettings,
): Promise<void> {
  if (!settings.approvalChannelAlerts) return
  if (!runtime) return

  const decisionLabel = decision === 'approved' ? 'Approved' : 'Rejected'
  const approverLabel = `${approver.displayName ?? approver.id} (${approver.source})`
  const fields = [
    { label: 'Decision', value: decisionLabel },
    { label: 'Decided by', value: approverLabel },
    { label: 'Workflow', value: instance.workflowId },
    { label: 'Task', value: instance.taskId },
    { label: 'Step', value: stepId },
    ...(requestedAt ? [
      { label: 'Requested', value: requestedAt },
      { label: 'Duration', value: humanizeDuration(Date.parse(decidedAt) - Date.parse(requestedAt)) },
    ] : []),
    { label: 'Decided', value: decidedAt },
    ...(reason ? [{ label: 'Reason', value: reason }] : []),
  ]

  try {
    await runtime.channels.sendNotification({
      channels: [settings.approvalChannel || 'general'],
      notification: {
        severity: decision === 'approved' ? 'success' : 'warn',
        title: `Gate ${decisionLabel}: ${gateLabel}`,
        body: gateDescription ?? '',
        fields,
        metadata: {
          instanceId: instance.instanceId,
          workflowId: instance.workflowId,
          taskId: instance.taskId,
          stepId,
          decision,
        },
      },
    })
  } catch (err) {
    log.warn('Gate decision summary failed', err)
  }
}

function renderPriorOutput(priorOutput: Record<string, unknown> | undefined): string {
  if (!priorOutput) return ''
  const rendered = JSON.stringify(priorOutput, null, 2)
  if (!rendered) return ''
  const cap = 4000
  return `Prior output:\n${rendered.length > cap ? `${rendered.slice(0, cap)}\n...[truncated]` : rendered}`
}

function humanizeDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown'
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}
