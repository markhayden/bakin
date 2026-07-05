/**
 * Workflow notification dispatcher.
 *
 * Workflow code emits local UI events directly. External delivery is routed
 * through the active runtime adapter's channel surface so provider-specific
 * API details stay behind the adapter boundary.
 */
import type { AgentRuntimeAdapter, ApprovalRenderRef, CreateApprovalArgs } from '@bakin/core/adapters/runtime'
import type { ApprovalActor, EventBus } from '@bakin/core/plugin-types'
import type { WorkflowInstance } from '../types'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'
import { createLogger } from '../../../src/core/logger'
import { resolveRuntimeChannelRef } from '../../../src/core/channel-aliases'
import { createApprovalRecord, resolveApprovalRecord, updateApprovalDeliveries } from './approval-store'
import { getGateDescription } from './gate-audit'

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

export function buildGateApprovalId(taskId: string, stepId: string, runId?: string, requestKey?: string): string {
  const parts = ['workflow-gate', encodeURIComponent(taskId), encodeURIComponent(stepId)]
  if (runId) parts.push(encodeURIComponent(runId))
  if (requestKey) parts.push(encodeURIComponent(requestKey))
  return parts.join(':')
}

export function parseGateApprovalId(approvalId: string): { taskId: string; stepId: string } | null {
  const parts = approvalId.split(':')
  if ((parts.length !== 3 && parts.length !== 4 && parts.length !== 5) || parts[0] !== 'workflow-gate') return null
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

export function notifyWorkflowReopened(
  instance: WorkflowInstance,
  reopenedStepId: string,
  reason: string,
  actor?: ApprovalActor,
): void {
  if (!eventBus) return

  eventBus.emit('workflow.reopened', {
    instanceId: instance.instanceId,
    taskId: instance.taskId,
    workflowId: instance.workflowId,
    stepId: reopenedStepId,
    reason,
    actor,
  })
}

/**
 * Notify that a gate step has been approved.
 */
export function notifyGateApproved(
  instance: WorkflowInstance,
  stepId: string,
  label: string,
  approver?: ApprovalActor,
): void {
  if (!eventBus) return

  eventBus.emit('workflow.gate_approved', {
    instanceId: instance.instanceId,
    taskId: instance.taskId,
    workflowId: instance.workflowId,
    stepId,
    label,
    approver,
  })
}

/**
 * Notify that a gate step has been rejected.
 */
export function notifyGateRejected(
  instance: WorkflowInstance,
  stepId: string,
  label: string,
  reason: string,
  approver?: ApprovalActor,
): void {
  if (!eventBus) return

  eventBus.emit('workflow.gate_rejected', {
    instanceId: instance.instanceId,
    taskId: instance.taskId,
    workflowId: instance.workflowId,
    stepId,
    label,
    reason,
    approver,
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

  const requestedAt = instance.stepStates[stepId]?.requestedAt ?? instance.updatedAt ?? instance.createdAt
  const approvalId = buildGateApprovalId(instance.taskId, stepId, instance.instanceId, requestedAt)
  const channel = settings.approvalChannel || 'general'
  const body = [
    `Workflow ${instance.workflowId} has reached a gate and needs approval.`,
    `Task: ${instance.taskId}`,
    `Step: ${stepId}`,
    renderPriorOutput(priorOutput),
  ].filter(Boolean).join('\n\n')

  const request: CreateApprovalArgs['request'] = {
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
      approvalUrl: buildGateApprovalUrl(instance.taskId, stepId),
    },
  }

  createApprovalRecord({
    approvalId,
    owner: {
      workflowId: instance.workflowId,
      runId: instance.instanceId,
      stepId,
      taskId: instance.taskId,
    },
    request,
    createdAt: requestedAt,
  })

  let resolvedChannel: string
  try {
    resolvedChannel = (await resolveRuntimeChannelRef(runtime, channel)).resolved
  } catch (err) {
    log.error('Gate approval channel resolution failed', err, { approvalId, channel })
    return null
  }

  // Context first, buttons second: the native approval card is capped at 256
  // chars upstream, so the reviewable substance (gate description, prior
  // output, generated media) rides a normal rich message posted just before
  // the card. Best-effort — a context failure never blocks the approval.
  await sendGateContextMessage(instance, stepId, label, priorOutput, resolvedChannel, request.context)

  try {
    const result = await runtime.channels.createApproval({
      approvalId,
      channels: [resolvedChannel],
      request,
    })
    updateApprovalDeliveries(approvalId, result.deliveries)
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

/** Recursively collect assetId-ish string values from a step output object. */
export function extractAssetIds(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) extractAssetIds(entry, found)
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/^asset_?ids?$/i.test(key)) {
        for (const id of Array.isArray(entry) ? entry : [entry]) {
          if (typeof id === 'string' && id && !found.includes(id)) found.push(id)
        }
      } else {
        extractAssetIds(entry, found)
      }
    }
  }
  return found
}

interface ResolvedAssetFile {
  match?: boolean
  found?: boolean
  absPath?: string
  mimeType?: string
}

/**
 * Post the human-readable gate context (description, prior output, generated
 * media, links) to the approvals channel as a normal rich message. The native
 * approval card that follows carries only the decision buttons.
 */
async function sendGateContextMessage(
  instance: WorkflowInstance,
  stepId: string,
  label: string,
  priorOutput: Record<string, unknown> | undefined,
  resolvedChannel: string,
  context: CreateApprovalArgs['request']['context'],
): Promise<void> {
  if (!runtime) return
  try {
    const files: Array<{ name: string; path: string; contentType?: string }> = []
    for (const assetId of extractAssetIds(priorOutput)) {
      try {
        const resolved = await getHookRegistry().invoke<ResolvedAssetFile>('assets.resolveServe', { segments: [assetId] })
        if (resolved?.found && resolved.absPath) {
          files.push({ name: assetId, path: resolved.absPath, ...(resolved.mimeType ? { contentType: resolved.mimeType } : {}) })
        }
      } catch {
        // Assets plugin unavailable or unknown id — context ships without media.
      }
    }

    const base = process.env.BAKIN_URL || 'http://localhost:3737'
    const approvalUrl = typeof context?.approvalUrl === 'string' ? context.approvalUrl : buildGateApprovalUrl(instance.taskId, stepId)
    const taskUrl = `${base}/?taskId=${encodeURIComponent(instance.taskId)}`
    const gateDescription = getGateDescription(instance.workflowId, stepId)

    // Tight header block (single newlines), then breathing room around the
    // reviewable content, then links and a divider separating this context
    // from the provider's button card that follows.
    const header = [
      `🚦 **${label}** — \`${instance.workflowId}\``,
      `Task \`${instance.taskId}\` · step \`${stepId}\``,
      // The workflow author's gate description, quoted as the workflow's words.
      ...(gateDescription ? [`> ${gateDescription}`] : []),
    ].join('\n')

    const body = [
      header,
      renderPriorOutput(priorOutput, { markdown: true }),
      `**[Review & Approve in Bakin](${approvalUrl})** · [View Task](${taskUrl})\n${'─'.repeat(30)}`,
    ].filter(Boolean).join('\n\n')

    await runtime.channels.deliverContent({
      channels: [resolvedChannel],
      content: {
        // Header lives in the body: a non-empty title forces a blank line
        // between it and the body in the provider message rendering.
        title: '',
        body,
        ...(files.length > 0 ? { files } : {}),
        metadata: {
          instanceId: instance.instanceId,
          workflowId: instance.workflowId,
          taskId: instance.taskId,
          stepId,
        },
      },
    })
  } catch (err) {
    log.warn('Gate context message failed', err, { taskId: instance.taskId, stepId })
  }
}

// Deliberately short: the native approval card caps descriptions at 256 chars
// (upstream), so every character spent on the URL is context lost. The page
// resolves the pending approval from task + step; no approvalId needed.
function buildGateApprovalUrl(taskId: string, stepId: string): string {
  const base = process.env.BAKIN_URL || 'http://localhost:3737'
  const url = new URL(`/api/plugins/workflows/gates/${encodeURIComponent(taskId)}/decision`, base)
  url.searchParams.set('stepId', stepId)
  return url.toString()
}

export async function resolveGateApproval(
  approvalRef: ApprovalRenderRef | undefined,
  decision: 'approved' | 'rejected',
  approver: ApprovalActor,
  decidedAt: string,
  reason?: string,
): Promise<void> {
  if (!runtime || !approvalRef) return

  const response = {
    selectedOption: decision === 'approved' ? 'approve' : 'reject',
    respondedAt: decidedAt,
    actor: {
      type: 'human' as const,
      id: approver.id,
      displayName: approver.displayName ?? approver.id,
    },
    ...(reason ? { comment: reason } : {}),
  }
  resolveApprovalRecord(approvalRef.approvalId, response)

  try {
    await runtime.channels.resolveApproval({
      ...approvalRef,
      response,
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

  const channel = settings.approvalChannel || 'general'
  let resolvedChannel: string
  try {
    resolvedChannel = (await resolveRuntimeChannelRef(runtime, channel)).resolved
  } catch (err) {
    log.error('Gate decision summary channel resolution failed', err, { channel })
    return
  }

  try {
    await runtime.channels.sendNotification({
      channels: [resolvedChannel],
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

function humanizeKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

interface RenderOutputOptions {
  /** Bold labels/headings for markdown surfaces (channel messages). */
  markdown?: boolean
}

/** Render one output entry as `Label: value` prose; nested objects indent. */
function renderOutputEntry(key: string, value: unknown, indent: string, opts: RenderOutputOptions): string[] {
  const name = humanizeKey(key)
  const label = `${indent}${opts.markdown ? `**${name}:**` : `${name}:`}`
  if (value === null || value === undefined || value === '') return []
  if (isScalar(value)) {
    const text = String(value)
    return text.length > 80 ? [label, `${indent}${text}`] : [`${label} ${text}`]
  }
  if (Array.isArray(value)) {
    if (value.every(isScalar)) return [`${label} ${value.map(String).join(', ')}`]
    return [label, ...value.flatMap((entry, i) => renderOutputEntry(String(i + 1), entry, `${indent}  `, opts))]
  }
  if (typeof value === 'object') {
    const children = Object.entries(value as Record<string, unknown>)
      .flatMap(([childKey, child]) => renderOutputEntry(childKey, child, `${indent}  `, opts))
    return children.length > 0 ? [label, ...children] : []
  }
  return []
}

/**
 * Render the step output under review as labeled prose (humans read this in
 * channels and on the decision page — never show them a JSON blob).
 */
function renderPriorOutput(priorOutput: Record<string, unknown> | undefined, opts: RenderOutputOptions = {}): string {
  if (!priorOutput) return ''
  const lines = Object.entries(priorOutput)
    .flatMap(([key, value]) => renderOutputEntry(key, value, '', opts))
  const rendered = lines.length > 0 ? lines.join('\n') : JSON.stringify(priorOutput, null, 2)
  if (!rendered) return ''
  const cap = 4000
  const heading = opts.markdown ? '**For review:**' : 'For review:'
  return `${heading}\n${rendered.length > cap ? `${rendered.slice(0, cap)}\n...[truncated]` : rendered}`
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
