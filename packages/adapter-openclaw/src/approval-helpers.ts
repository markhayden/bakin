/**
 * OpenClaw approval converters — pure mapping between Bakin approval events and
 * OpenClaw plugin-approval payloads/decisions/refs. No adapter state, no
 * channel/config reads (the channel-capability-dependent notice text stays in
 * the adapter). The class's approval methods own the gateway calls and import
 * these.
 */
import type { ApprovalResolveEvent, RuntimeMetadata } from '@bakin/core/adapters/runtime'
import type { OpenClawPluginApprovalDecision, OpenClawPluginApprovalResolvedPayload } from './approval-gateway'
import { truncate } from './runtime-utils'

/** Footer appended to native channel approval prompts (render-only path). */
const NATIVE_APPROVAL_NOTICE = [
  'Channel buttons are a convenience path and may expire before the Bakin gate does.',
  'The durable Bakin approval record remains canonical.',
].join(' ')

export const OPENCLAW_PLUGIN_APPROVAL_REF_PREFIX = 'openclaw-plugin-approval:'
export const OPENCLAW_PLUGIN_ID = 'bakin'
export const OPENCLAW_WORKFLOW_GATE_TOOL = 'workflow.gate'



export function renderNativeApprovalDescription(body: string, approvalUrl: string | undefined): string {
  const compactBody = body.replace(/\s+/g, ' ').trim()
  const footer = [
    approvalUrl ? `Bakin fallback: ${approvalUrl}` : undefined,
    NATIVE_APPROVAL_NOTICE,
  ].filter(Boolean).join('\n\n')
  if (!footer) return truncate(compactBody, 256)
  const bodyLimit = 256 - footer.length - 2
  const bodyPart = bodyLimit > 20 ? truncate(compactBody, bodyLimit) : undefined
  return [bodyPart, footer].filter(Boolean).join('\n\n').slice(0, 256)
}

export function supportsNativeApprovalOptions(options: Array<{ id: string }>): boolean {
  const ids = new Set(options.map(option => option.id))
  return ids.size === 2 && ids.has('approve') && ids.has('reject')
}

export function requiresRejectReason(context: RuntimeMetadata | undefined): boolean {
  return context?.requireRejectReason === true
}

export function approvalEventFromOpenClawPayload(payload: OpenClawPluginApprovalResolvedPayload): ApprovalResolveEvent | null {
  const request = payload.request
  if (!request) return null
  if (request.pluginId !== OPENCLAW_PLUGIN_ID) return null
  if (request.toolName !== OPENCLAW_WORKFLOW_GATE_TOOL) return null
  const approvalId = typeof request.toolCallId === 'string' ? request.toolCallId : ''
  if (!approvalId) return null

  const selectedOption = bakinOptionFromOpenClawDecision(payload.decision)
  if (!selectedOption) return null

  const actorId = payload.resolvedBy?.trim() || 'openclaw-channel'
  return {
    approvalId,
    channelId: channelIdFromOpenClawRequest(request),
    response: {
      selectedOption,
      respondedAt: typeof payload.ts === 'number' ? new Date(payload.ts).toISOString() : new Date().toISOString(),
      actor: {
        type: 'human',
        id: actorId,
        displayName: actorId,
      },
    },
  }
}

export function channelIdFromOpenClawRequest(request: Record<string, unknown>): string {
  const channel = typeof request.turnSourceChannel === 'string' && request.turnSourceChannel.length > 0
    ? request.turnSourceChannel
    : 'runtime-channel'
  const target = typeof request.turnSourceTo === 'string' && request.turnSourceTo.length > 0
    ? request.turnSourceTo
    : undefined
  return target ? `${channel}:${target}` : channel
}

export function openClawDecisionFromBakinOption(option: string): OpenClawPluginApprovalDecision | null {
  if (option === 'approve') return 'allow-once'
  if (option === 'reject') return 'deny'
  return null
}

export function bakinOptionFromOpenClawDecision(decision: string | undefined): 'approve' | 'reject' | null {
  if (decision === 'allow-once' || decision === 'allow-always') return 'approve'
  if (decision === 'deny') return 'reject'
  return null
}

export function parseNativeApprovalRef(ref: string): string | null {
  return ref.startsWith(OPENCLAW_PLUGIN_APPROVAL_REF_PREFIX)
    ? ref.slice(OPENCLAW_PLUGIN_APPROVAL_REF_PREFIX.length)
    : null
}

export function isExpectedNativeApprovalResolveMiss(message: string): boolean {
  return /expired|not found|unknown/i.test(message)
}
