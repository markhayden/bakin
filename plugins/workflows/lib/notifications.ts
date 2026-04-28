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

/** Discord embed field value cap — fields rendering longer values are truncated by Discord. */
const DISCORD_FIELD_CAP = 1024
/** Discord message content cap — longer messages must be split across multiple posts. */
const DISCORD_MESSAGE_CAP = 2000
/** Discord thread name cap — anything longer is truncated by the API. */
const DISCORD_THREAD_NAME_CAP = 100

/**
 * Start a thread on an existing channel message and post the given content
 * inside it. Splits content longer than DISCORD_MESSAGE_CAP into sequential
 * posts so the full text always lands. Fire-and-forget — failures log but
 * do not throw, so a missing CREATE_PUBLIC_THREADS permission won't break
 * the gate alert flow.
 */
export async function postThreadReply(
  channelId: string,
  messageId: string,
  threadName: string,
  content: string,
): Promise<void> {
  const config = await loadDiscordConfig()
  if (!config) return

  const truncatedName = threadName.slice(0, DISCORD_THREAD_NAME_CAP)
  const authHeaders = {
    Authorization: `Bot ${config.botToken}`,
    'Content-Type': 'application/json',
  }

  let threadId: string
  try {
    const startRes = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/threads`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ name: truncatedName, auto_archive_duration: 60 }),
      },
    )

    if (!startRes.ok) {
      const text = await startRes.text()
      log.warn(`Discord thread create failed (${startRes.status}): ${text}`)
      return
    }
    const thread = await startRes.json() as { id: string }
    threadId = thread.id
  } catch (err) {
    log.error('Discord thread create error', err)
    return
  }

  // Split content into Discord-message-sized chunks and post sequentially.
  const chunks: string[] = []
  let remaining = content
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, DISCORD_MESSAGE_CAP))
    remaining = remaining.slice(DISCORD_MESSAGE_CAP)
  }

  for (const chunk of chunks) {
    try {
      const postRes = await fetch(
        `https://discord.com/api/v10/channels/${threadId}/messages`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ content: chunk }),
        },
      )
      if (!postRes.ok) {
        const text = await postRes.text()
        log.warn(`Discord thread message failed (${postRes.status}): ${text}`)
      }
    } catch (err) {
      log.error('Discord thread message error', err)
    }
  }
}

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

  const config = await loadDiscordConfig()
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

  // Build prior output summary (truncated for embed). The full text is
  // posted as a thread reply below if it overflows the embed field cap.
  let outputSummary = ''
  let outputFull = ''
  if (priorOutput) {
    const entries = Object.entries(priorOutput)
    for (const [key, value] of entries) {
      const fullValue = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      outputFull += `**${key}:**\n${fullValue}\n\n`
      const preview = typeof value === 'string' ? value : JSON.stringify(value)
      outputSummary += `**${key}:** ${preview.slice(0, 200)}${preview.length > 200 ? '...' : ''}\n`
    }
  }

  // The summary is pre-truncated per-value to 200 chars, so it's always
  // small; the meaningful overflow signal is the full content size.
  const overflowsEmbedField = outputFull.length > DISCORD_FIELD_CAP
  const truncationNotice = overflowsEmbedField ? '\n\n_Full output posted in thread below._' : ''

  const embed = {
    title: `Gate: ${label}`,
    description: `Workflow **${instance.workflowId}** has reached a gate and needs your approval.`,
    color: 16776960, // Yellow
    fields: [
      { name: 'Task', value: instance.taskId, inline: true },
      { name: 'Step', value: stepId, inline: true },
      ...(outputSummary ? [{
        name: 'Prior Output',
        value: outputSummary.slice(0, DISCORD_FIELD_CAP - truncationNotice.length) + truncationNotice,
      }] : []),
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

    // Overflow: if the summary was too long for the embed field, post the
    // full prior output as a thread reply on the gate message. Fire-and-
    // forget — a thread permission failure does not invalidate the alert.
    if (overflowsEmbedField && outputFull) {
      const threadName = `${instance.workflowId} — ${label}`
      postThreadReply(channelId, msg.id, threadName, outputFull).catch(() => {})
    }

    return msg.id
  } catch (err) {
    log.error('Discord gate alert error', err)
    return null
  }
}

/**
 * Post a standalone summary message after a gate decision. This is the
 * durable "what happened" trace — the awaiting card edit (above) preserves
 * the original ask, but this message is what someone scrolling the
 * approvals channel reads to understand who decided what, when, and why.
 *
 * Fire-and-forget — failures log but do not throw, so a Discord outage
 * never blocks workflow progression.
 */
export async function sendDiscordGateSummary(
  instance: WorkflowInstance,
  stepId: string,
  gateLabel: string,
  gateDescription: string | undefined,
  decision: 'approved' | 'rejected',
  approver: ApprovalActor,
  requestedAt: string | undefined,
  decidedAt: string,
  reason: string | undefined,
  settings: DiscordGateSettings,
): Promise<void> {
  if (!settings.discordGateAlerts) return

  const config = await loadDiscordConfig()
  if (!config) return

  const channelName = settings.discordGateChannel || 'general'
  const { id: channelId } = await resolveChannelId(channelName)
  if (!channelId) return

  const decisionLabel = decision === 'approved' ? 'Approved' : 'Rejected'
  const color = decision === 'approved' ? 5763719 : 15548997
  const approverLabel = `${approver.displayName ?? approver.id} (${approver.source})`

  // Discord's relative timestamp marker — clients render "5 minutes ago"
  const tsRel = (iso: string): string => `<t:${Math.floor(Date.parse(iso) / 1000)}:R>`

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: 'Decision', value: decisionLabel, inline: true },
    { name: 'Decided by', value: approverLabel, inline: true },
    { name: 'Workflow', value: instance.workflowId, inline: true },
    { name: 'Task', value: instance.taskId, inline: true },
    { name: 'Step', value: stepId, inline: true },
  ]

  if (requestedAt) {
    fields.push({ name: 'Requested', value: tsRel(requestedAt), inline: true })
    const durationMs = Date.parse(decidedAt) - Date.parse(requestedAt)
    fields.push({ name: 'Duration', value: humanizeDuration(durationMs), inline: true })
  }
  fields.push({ name: 'Decided', value: tsRel(decidedAt), inline: true })

  if (reason) {
    fields.push({ name: 'Reason', value: reason })
  }

  const embed: Record<string, unknown> = {
    title: `Gate ${decisionLabel}: ${gateLabel}`,
    description: gateDescription ?? '',
    color,
    fields,
    footer: { text: `instance ${instance.instanceId}` },
    timestamp: decidedAt,
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${config.botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ embeds: [embed] }),
    })

    if (!res.ok) {
      const text = await res.text()
      log.warn(`Discord gate summary failed (${res.status}): ${text}`)
    }
  } catch (err) {
    log.error('Discord gate summary error', err)
  }
}

function humanizeDuration(ms: number): string {
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
  const config = await loadDiscordConfig()
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
