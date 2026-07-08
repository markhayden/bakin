/**
 * OpenClaw activity summarization — transcript record → displayable ChatChunk.
 *
 * Turns OpenClaw session-transcript records (assistant messages with tool
 * calls, tool-result messages) into the ChatChunk activity stream the UI
 * renders, plus the pure tool-call/shell/URL summarizers and redaction-aware
 * preview helpers behind it. No adapter state; the session reader feeds it
 * raw records.
 */
import type { ChatChunk } from '@bakin/core/adapters/runtime'
import { firstString, isPlainObject, parseJsonObject, redactSensitiveText } from './runtime-utils'

/** Max chars for an unknown-value activity preview before middle-truncation. */
const OPENCLAW_ACTIVITY_PREVIEW_CHARS = 500

export function activityChunksFromOpenClawTranscriptRecord(record: Record<string, unknown>): ChatChunk[] {
  if (record.type !== 'message') return []
  const message = record.message
  if (!isPlainObject(message)) return []
  const role = message.role
  if (role === 'assistant') return activityChunksFromAssistantMessage(message)
  if (role === 'toolResult') return activityChunkFromToolResultMessage(message)
  return []
}

export function activityChunksFromAssistantMessage(message: Record<string, unknown>): ChatChunk[] {
  const content = Array.isArray(message.content) ? message.content : []
  const chunks: ChatChunk[] = []
  for (const part of content) {
    if (!isPlainObject(part) || part.type !== 'toolCall') continue
    const name = typeof part.name === 'string' && part.name.length > 0 ? part.name : 'tool'
    const args = part.arguments
    const summary = firstString(part.summary, part.purpose, part.displayLabel)
      ?? summarizeOpenClawToolPurpose(name, args)
    chunks.push({
      type: 'tool',
      content: summarizeOpenClawToolCall(name, args),
      data: {
        phase: 'call',
        callId: typeof part.id === 'string' ? part.id : undefined,
        toolName: name,
        status: 'running',
        ...(summary ? { summary } : {}),
        inputPreview: previewUnknown(args),
      },
    })
  }
  return chunks
}

export function activityChunkFromToolResultMessage(message: Record<string, unknown>): ChatChunk[] {
  const toolName = typeof message.toolName === 'string' && message.toolName.length > 0 ? message.toolName : 'tool'
  const details = isPlainObject(message.details) ? message.details : {}
  const status = typeof details.status === 'string' ? details.status : undefined
  const label = status ? `${toolName} ${status}` : `${toolName} finished`
  return [{
    type: 'tool',
      content: label,
      data: {
        phase: 'result',
        toolName,
        callId: typeof message.toolCallId === 'string' ? message.toolCallId : undefined,
        status: normalizeToolResultStatus(status, typeof details.exitCode === 'number' ? details.exitCode : undefined),
        exitCode: typeof details.exitCode === 'number' ? details.exitCode : undefined,
        durationMs: typeof details.durationMs === 'number' ? details.durationMs : undefined,
        outputPreview: previewUnknown(message.content),
      },
  }]
}

export function normalizeToolResultStatus(status: string | undefined, exitCode: number | undefined): string {
  if (status && status.length > 0) return status
  if (typeof exitCode === 'number') return exitCode === 0 ? 'completed' : 'failed'
  return 'completed'
}

export function summarizeOpenClawToolCall(name: string, args: unknown): string {
  if (isPlainObject(args)) {
    const command = args.command
    if (name === 'exec' && typeof command === 'string' && command.trim()) {
      return `exec: ${firstLine(command)}`
    }
    const path = args.path
    if (name === 'read' && typeof path === 'string' && path.trim()) {
      return `read: ${truncateMiddle(path.trim(), 140)}`
    }
    const action = args.action
    if (name === 'process' && typeof action === 'string' && action.trim()) {
      return `process: ${action.trim()}`
    }
  }
  return name
}

export function summarizeOpenClawToolPurpose(name: string, args: unknown): string | undefined {
  if (name === 'read' && isPlainObject(args)) {
    const path = typeof args.path === 'string' ? args.path.trim() : ''
    if (!path) return undefined
    if (/\/skills\/[^/]+\/SKILL\.md$/.test(path)) return 'Reading workflow instructions'
    return `Reading ${basenameForDisplay(path)}`
  }

  if (name === 'process' && isPlainObject(args)) {
    const action = typeof args.action === 'string' ? args.action.trim() : ''
    if (action === 'poll') return 'Waiting for command output'
  }

  if (name === 'exec' && isPlainObject(args)) {
    const command = typeof args.command === 'string' ? args.command.trim() : ''
    return summarizeShellCommandPurpose(command)
  }

  if (name === 'web_fetch') {
    return summarizeWebFetchPurpose(args)
  }

  return summarizeToolNamePurpose(name)
}

export function summarizeShellCommandPurpose(command: string): string | undefined {
  if (!command) return undefined
  const first = command.split(/\r?\n/)[0]?.trim() ?? ''
  if (/\bgh\s+issue\b/.test(first)) return 'Checking GitHub issues'
  if (/\bgh\s+pr\b/.test(first)) return 'Checking GitHub pull requests'
  const bxContextSummary = summarizeBxContextCommand(first)
  if (bxContextSummary) return bxContextSummary
  const fetchedUrl = extractUrlForDisplay(command)
  if (fetchedUrl) return `Fetching ${fetchedUrl}`
  if (/^python3?\s+-\s*<<|^python3?\s+-c\b/.test(first)) return 'Preparing structured tool arguments'
  if (/^cat\s+>\s+\/tmp\//.test(first)) return 'Preparing a temporary helper script'
  return undefined
}

export function summarizeBxContextCommand(command: string): string | undefined {
  const match = command.match(/^bx\s+context\s+(.+?)(?:\s+--\S+|$)/)
  if (!match) return undefined
  const topic = cleanShellArgumentForDisplay(match[1])
  const githubReleaseRepo = topic.match(/\bgithub\s+releases?\b.*\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/i)
  if (githubReleaseRepo) return `Checking GitHub releases for ${githubReleaseRepo[1]}`
  return topic ? `Looking up ${truncateMiddle(topic, 100)}` : 'Looking up context'
}

export function summarizeToolNamePurpose(toolName: string): string | undefined {
  if (/^bakin_exec_projects_get$/.test(toolName)) return 'Reading project details'
  if (/^bakin_exec_projects_apply_plan$/.test(toolName)) return 'Applying confirmed project plan'
  if (/^bakin_exec_projects_update$/.test(toolName)) return 'Updating project details'
  if (/^bakin_exec_projects_add_item$/.test(toolName)) return 'Adding a project checklist item'
  if (/^bakin_exec_projects_(list|search)$/.test(toolName)) return 'Inspecting projects'
  if (/^bakin_exec_messaging_/.test(toolName)) return 'Updating messaging content'
  if (toolName === 'web_fetch') return 'Fetching web content'
  return undefined
}

export function summarizeWebFetchPurpose(args: unknown): string {
  const url = extractUrlForDisplay(args)
  return url ? `Fetching ${url}` : 'Fetching web content'
}

export function extractUrlForDisplay(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const parsed = parseJsonObject(value)
    if (parsed) return extractUrlForDisplay(parsed)
    const trimmed = value.trim()
    if (/^https?:\/\//i.test(trimmed)) return truncateMiddle(redactSensitiveText(trimmed), 140)
    const match = trimmed.match(/https?:\/\/[^\s"'`\\]+/i)
    return match ? truncateMiddle(redactSensitiveText(match[0]), 140) : undefined
  }
  if (!isPlainObject(value)) return undefined
  for (const key of ['url', 'uri', 'href']) {
    const raw = value[key]
    if (typeof raw === 'string' && raw.trim()) {
      return truncateMiddle(redactSensitiveText(raw.trim()), 140)
    }
  }
  return undefined
}

export function cleanShellArgumentForDisplay(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export function basenameForDisplay(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.split('/').pop() || normalized
}

export function firstLine(value: string): string {
  return truncateMiddle(redactSensitiveText(value.trim().split(/\r?\n/)[0] ?? ''), 160)
}

export function previewUnknown(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  return truncateMiddle(redactSensitiveText(raw ?? ''), OPENCLAW_ACTIVITY_PREVIEW_CHARS)
}

export function truncateMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  const head = Math.max(1, Math.floor((maxChars - 3) * 0.65))
  const tail = Math.max(1, maxChars - 3 - head)
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}
