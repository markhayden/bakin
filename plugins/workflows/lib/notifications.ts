/**
 * Workflow notification dispatcher.
 * Emits SSE events for UI updates and optionally sends chat notifications
 * (Discord first) when gates are reached or workflows complete.
 */
import type { ApprovalActor, EventBus } from '../../../src/lib/plugin-types'
import type { WorkflowInstance } from '../types'
import { loadDiscordConfig, resolveChannelId } from '../../../scripts/lib/post-discord'
import { createLogger } from '../../../src/core/logger'

const log = createLogger('workflow-notifications')

let eventBus: EventBus | null = null
let discordSettings: DiscordGateSettings | null = null

export function setEventBus(bus: EventBus): void {
  eventBus = bus
}

export function setDiscordGateSettings(settings: DiscordGateSettings): void {
  discordSettings = settings
}

export function getDiscordGateSettings(): DiscordGateSettings | null {
  return discordSettings
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

// ---------------------------------------------------------------------------
// Discord Gate Alerts
// ---------------------------------------------------------------------------

export interface DiscordGateSettings {
  discordGateAlerts: boolean
  discordGateChannel: string
  requireRejectReason: boolean
}

/**
 * Send a Discord message with approve/reject buttons for a gate step.
 * Returns the Discord message ID for later editing, or null on failure.
 */
export async function sendDiscordGateAlert(
  instance: WorkflowInstance,
  stepId: string,
  label: string,
  priorOutput: Record<string, unknown> | undefined,
  settings: DiscordGateSettings,
): Promise<string | null> {
  if (!settings.discordGateAlerts) return null

  const config = loadDiscordConfig()
  if (!config) {
    log.warn('Discord not configured — skipping gate alert')
    return null
  }

  const channelName = settings.discordGateChannel || 'general'
  const { id: channelId } = await resolveChannelId(channelName)
  if (!channelId) {
    log.warn(`Discord channel "${channelName}" not found — skipping gate alert`)
    return null
  }

  // Build prior output summary (truncated for embed)
  let outputSummary = ''
  if (priorOutput) {
    const entries = Object.entries(priorOutput)
    for (const [key, value] of entries) {
      const preview = typeof value === 'string' ? value : JSON.stringify(value)
      outputSummary += `**${key}:** ${preview.slice(0, 200)}${preview.length > 200 ? '...' : ''}\n`
    }
  }

  const embed = {
    title: `Gate: ${label}`,
    description: `Workflow **${instance.workflowId}** has reached a gate and needs your approval.`,
    color: 16776960, // Yellow
    fields: [
      { name: 'Task', value: instance.taskId, inline: true },
      { name: 'Step', value: stepId, inline: true },
      ...(outputSummary ? [{ name: 'Prior Output', value: outputSummary.slice(0, 1024) }] : []),
    ],
    timestamp: new Date().toISOString(),
  }

  const components = [{
    type: 1, // Action Row
    components: [
      {
        type: 2, // Button
        style: 3, // Success (green)
        label: 'Approve',
        custom_id: `gate:approve:${instance.taskId}:${stepId}`,
      },
      {
        type: 2, // Button
        style: 4, // Danger (red)
        label: 'Reject',
        custom_id: `gate:reject:${instance.taskId}:${stepId}`,
      },
    ],
  }]

  try {
    const payload = { embeds: [embed], components }
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${config.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const text = await res.text()
      log.error(`Discord gate alert failed (${res.status}): ${text}`)
      return null
    }

    const msg = await res.json() as { id: string }
    log.info(`Discord gate alert sent for ${instance.taskId}:${stepId}`, { messageId: msg.id })
    return msg.id
  } catch (err) {
    log.error('Discord gate alert error', err)
    return null
  }
}

/**
 * Edit a Discord gate alert message to reflect the outcome (approved/rejected).
 * Preserves the original embed's title and fields, appends a Decision and
 * Decided-by field (plus Reason on reject), updates the color, and removes
 * the buttons. Falls back to a stripped embed if the GET fails so the edit
 * still happens with at least minimal context.
 */
export async function editDiscordGateMessage(
  channelName: string,
  messageId: string,
  decision: 'approved' | 'rejected',
  approver: ApprovalActor,
  decidedAt: string,
  reason?: string,
): Promise<void> {
  const config = loadDiscordConfig()
  if (!config) return

  const { id: channelId } = await resolveChannelId(channelName)
  if (!channelId) return

  const color = decision === 'approved' ? 5763719 : 15548997 // Green : Red
  const decisionLabel = decision === 'approved' ? 'Approved' : 'Rejected'
  const approverLabel = `${approver.displayName ?? approver.id} (${approver.source})`
  const messageUrl = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`
  const authHeaders = { Authorization: `Bot ${config.botToken}` }

  // GET the existing message to preserve its embed context. If this fails
  // (missing READ_MESSAGE_HISTORY permission, message deleted, etc.), fall
  // back to a stripped embed — the audit log is the canonical record either
  // way, and the second summary message in C5 carries the full context.
  let preservedEmbed: Record<string, unknown> | null = null
  try {
    const getRes = await fetch(messageUrl, { headers: authHeaders })
    if (getRes.ok) {
      const msg = await getRes.json() as { embeds?: Array<Record<string, unknown>> }
      preservedEmbed = msg.embeds?.[0] ?? null
    } else {
      const text = await getRes.text()
      log.warn(`Discord message GET failed (${getRes.status}): ${text} — falling back to stripped embed`)
    }
  } catch (err) {
    log.warn('Discord message GET error — falling back to stripped embed', err as Error)
  }

  const decisionFields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: 'Decision', value: decisionLabel, inline: true },
    { name: 'Decided by', value: approverLabel, inline: true },
  ]
  if (decision === 'rejected' && reason) {
    decisionFields.push({ name: 'Reason', value: reason })
  }

  const newEmbed: Record<string, unknown> = preservedEmbed
    ? {
        ...preservedEmbed,
        color,
        fields: [
          ...((preservedEmbed.fields as Array<unknown> | undefined) ?? []),
          ...decisionFields,
        ],
        timestamp: decidedAt,
      }
    : {
        title: `Gate ${decisionLabel}`,
        description: decision === 'approved' ? 'Approved' : `Rejected${reason ? `: ${reason}` : ''}`,
        color,
        fields: decisionFields,
        timestamp: decidedAt,
      }

  try {
    const res = await fetch(messageUrl, {
      method: 'PATCH',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [newEmbed],
        components: [],
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      log.warn(`Discord message edit failed (${res.status}): ${text}`)
    }
  } catch (err) {
    log.error('Discord message edit error', err)
  }
}
