/**
 * OpenClaw channels + messaging — channel ref/arg building, delivery-output
 * parsing, the channel registry read (capabilities + interactive-approval
 * detection), and the approval-notice text. The class's channels methods own
 * the exec; this is config-read + pure parsing. gatewayWebSocketUrl stays on
 * the adapter (it is coupled to OpenClawSettings).
 */
import type { ChannelInfo, RuntimeMetadata } from '@bakin/core/adapters/runtime'
import { firstStringAtPaths, isRecord, metadataValue, parseJsonObject } from './runtime-utils'
import { readOpenClawConfig } from './config'
import { requiresRejectReason } from './approval-helpers'

/** Timeout (ms) surfaced per channel for an interactive plugin approval. */
export const OPENCLAW_PLUGIN_APPROVAL_TIMEOUT_MS = 600000

const RENDER_ONLY_APPROVAL_NOTICE = [
  'This channel cannot return approval decisions to Bakin.',
  'Use the Bakin approval link or approve/reject this gate in the Bakin UI.',
].join(' ')
const REJECT_REASON_APPROVAL_NOTICE = [
  'Button rejects record a default reason.',
  'Use the Bakin approval link to reject with a typed reason.',
].join(' ')
const NATIVE_APPROVAL_PROVIDERS = new Set(['discord', 'telegram', 'slack', 'matrix', 'qqbot'])

export function splitChannelRef(channelId: string, metadata: RuntimeMetadata | undefined): { channel: string; target?: string } {
  const explicitTarget = metadataValue(metadata, 'target') ?? metadataValue(metadata, 'channelTarget')
  if (explicitTarget) return { channel: channelId, target: explicitTarget }
  const [channel, ...targetParts] = channelId.split(':')
  if (channel && targetParts.length > 0) return { channel, target: targetParts.join(':') }
  return { channel: channelId }
}

export function openClawMessageSendArgs(
  ref: { channel: string; target?: string },
  message: { body: string; title?: string; threadId?: string; metadata?: RuntimeMetadata },
  files: Array<{ name: string; path: string; contentType?: string }>,
): string[] {
  const args = ['message', 'send', '--channel', ref.channel]
  if (ref.target) args.push('--target', ref.target)
  const body = [message.title, message.body].filter(Boolean).join('\n\n')
  if (body) args.push('--message', body)
  if (message.threadId) args.push('--thread-id', message.threadId)
  for (const file of files) args.push('--media', file.path)
  args.push('--json')
  return args
}

/** Strip the "message:" delivery-ref prefix down to the provider message id. */
export function messageIdFromDeliveryRef(ref: string | undefined): string | null {
  if (!ref?.startsWith('message:')) return null
  const id = ref.slice('message:'.length)
  return id || null
}

export function openClawThreadCreateArgs(
  ref: { channel: string; target?: string },
  opts: { messageId?: string; name: string },
): string[] {
  const args = ['message', 'thread', 'create', '--channel', ref.channel]
  if (ref.target) args.push('--target', ref.target)
  if (opts.messageId) args.push('--message-id', opts.messageId)
  args.push('--thread-name', opts.name)
  args.push('--json')
  return args
}

export function openClawMessageEditArgs(
  ref: { channel: string; target?: string },
  opts: { messageId: string; body: string },
): string[] {
  const args = ['message', 'edit', '--channel', ref.channel]
  if (ref.target) args.push('--target', ref.target)
  args.push('--message-id', opts.messageId, '--message', opts.body, '--json')
  return args
}

export function threadIdFromOpenClawOutput(stdout: string): string | null {
  const value = parseOpenClawDeliveryOutput(stdout)
  // The CLI wraps action results in an envelope: { action, channel,
  // handledBy, payload: { ok, thread: {...} } } — check payload paths first.
  return firstStringAtPaths(value, [
    ['payload', 'thread', 'id'],
    ['payload', 'threadId'],
    ['payload', 'thread_id'],
    ['payload', 'id'],
    ['thread', 'id'],
    ['threadId'],
    ['thread_id'],
    ['result', 'thread', 'id'],
    ['result', 'threadId'],
    ['result', 'thread_id'],
    ['result', 'id'],
    ['id'],
  ])
}

export function deliveryRefFromOpenClawOutput(stdout: string): string | null {
  const value = parseOpenClawDeliveryOutput(stdout)
  const id = firstStringAtPaths(value, [
    ['messageId'],
    ['message_id'],
    ['id'],
    ['message', 'id'],
    ['result', 'messageId'],
    ['result', 'message_id'],
    ['result', 'id'],
    ['result', 'message', 'id'],
    ['delivery', 'messageId'],
    ['delivery', 'message_id'],
    ['delivery', 'id'],
    ['delivery', 'message', 'id'],
  ])
  return id ? `message:${id}` : null
}

export function parseOpenClawDeliveryOutput(stdout: string): Record<string, unknown> | null {
  const text = stdout.trim()
  if (!text) return null
  return parseJsonObject(text)
    ?? parseJsonObject(text.split('\n').reverse().find(part => part.trim().startsWith('{') && part.trim().endsWith('}')) ?? '')
    // Pretty-printed JSON preceded by log noise: slice the outermost braces.
    ?? (text.includes('{') ? parseJsonObject(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) : null)
}

export function readChannelInfos(): ChannelInfo[] {
  const config = readOpenClawConfig() as { channels?: unknown } | null
  const channels = config?.channels
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) return []

  return Object.entries(channels as Record<string, unknown>).map(([id, raw]): ChannelInfo => {
    const entry = isRecord(raw) ? raw : {}
    const interactive = channelEntrySupportsInteractiveApproval(id, entry)
    const capabilities: ChannelInfo['capabilities'] = ['message', 'rich-content']
    if (interactive) capabilities.push('interactive-approval')
    return {
      id,
      platform: typeof entry.platform === 'string' ? entry.platform : id,
      label: typeof entry.label === 'string' ? entry.label : humanizeChannelId(id),
      capabilities,
      metadata: {
        approvalResponses: interactive ? 'interactive' : 'render-only',
        approvalMode: interactive ? 'openclaw-plugin-approval' : 'render-only',
        ...(interactive
          ? {
              approvalTimeoutMs: OPENCLAW_PLUGIN_APPROVAL_TIMEOUT_MS,
              rejectReason: 'native-default-reason',
            }
          : {}),
      },
    }
  })
}

export function hasAnyInteractiveApprovalChannel(): boolean {
  return readChannelInfos().some(channel => channel.capabilities.includes('interactive-approval'))
}

export function channelHasInteractiveApproval(channelId: string): boolean {
  const ref = splitChannelRef(channelId, undefined)
  return readChannelInfos().some(channel => (
    channel.id === ref.channel && channel.capabilities.includes('interactive-approval')
  ))
}

export function channelEntrySupportsInteractiveApproval(id: string, entry: Record<string, unknown>): boolean {
  if (entry.enabled === false) return false
  const provider = typeof entry.platform === 'string' ? entry.platform : id
  if (!NATIVE_APPROVAL_PROVIDERS.has(provider)) return false

  const approvalConfig = isRecord(entry.execApprovals)
    ? entry.execApprovals
    : isRecord(entry.approvals)
      ? entry.approvals
      : null
  if (!approvalConfig) return false
  const enabled = approvalConfig.enabled
  if (!(enabled === true || enabled === 'auto')) return false

  const eventKinds = approvalConfig.eventKinds
  if (Array.isArray(eventKinds) && !eventKinds.includes('plugin')) return false
  return true
}

export function approvalNoticeForMessage(channelId: string, context: RuntimeMetadata): string {
  return channelHasInteractiveApproval(channelId) && requiresRejectReason(context)
    ? REJECT_REASON_APPROVAL_NOTICE
    : RENDER_ONLY_APPROVAL_NOTICE
}

export function humanizeChannelId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ') || id
}
