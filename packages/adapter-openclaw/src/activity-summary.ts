/**
 * OpenClaw activity summarization — pure tool-call/shell/URL summarizers and
 * redaction-aware preview helpers. No adapter state; the gateway-event chunk
 * machine (`stream-events.ts`) feeds it tool names/args from pushed frames.
 * (The transcript-record → ChatChunk path that used to live here died with
 * the trajectory activity tail.)
 */
import { redactSensitiveText } from '@bakin/core/redact'
import { isPlainObject, parseJsonObject } from './runtime-utils'

/** Max chars for an unknown-value activity preview before middle-truncation. */
const OPENCLAW_ACTIVITY_PREVIEW_CHARS = 500

export function normalizeToolResultStatus(status: string | undefined, exitCode: number | undefined): string {
  if (status && status.length > 0) return status
  if (typeof exitCode === 'number') return exitCode === 0 ? 'completed' : 'failed'
  return 'completed'
}

/**
 * Trajectory bash commands arrive wrapped for the shell —
 * `/bin/zsh -lc "actual command"` — which buries the interesting part.
 * Strip the wrapper (and its quotes) for display.
 */
export function unwrapShellWrapper(command: string): string {
  const match = command.trim().match(/^(?:\/bin\/)?(?:z|ba)?sh\s+-l?c\s+([\s\S]*)$/)
  if (!match) return command
  const inner = match[1].trim()
  const quote = inner[0]
  if ((quote === '"' || quote === "'") && inner.endsWith(quote) && inner.length > 1) {
    return inner.slice(1, -1)
  }
  return inner
}

export function summarizeOpenClawToolCall(name: string, args: unknown): string {
  if (isPlainObject(args)) {
    const command = args.command
    // `exec` is the session-file name; the live trajectory calls it `bash`.
    if ((name === 'exec' || name === 'bash') && typeof command === 'string' && command.trim()) {
      return `${name}: ${firstLine(unwrapShellWrapper(command))}`
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

  if ((name === 'exec' || name === 'bash') && isPlainObject(args)) {
    const command = typeof args.command === 'string' ? args.command.trim() : ''
    return summarizeShellCommandPurpose(unwrapShellWrapper(command))
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
