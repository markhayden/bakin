/**
 * OpenClaw session JSONL → structured message stream.
 *
 * Sibling to `src/core/agent-usage.ts`. Where agent-usage sums tokens and
 * cost across the latest session, session-reader returns the *messages*
 * themselves so the Active Context tab can show what the agent has been
 * sent and what it has produced.
 *
 * Discovery mirrors agent-usage: most recent session by the first JSONL
 * line's timestamp (file mtime is unreliable — sessions can be touched out
 * of order).
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../../../src/core/logger'
import { getOpenClawPath } from '@bakin/core/openclaw-home'
import type { SessionMessage, SessionTranscript } from '../types'

const log = createLogger('team:session-reader')

const DEFAULT_MAX_MESSAGES = 200

interface JsonlEntry {
  type?: string
  id?: string
  timestamp?: string
  toolName?: string
  message?: {
    role?: string
    model?: string
    content?: string | unknown
  }
}

/**
 * Pick the most recent session file inside `<agentDir>/sessions/`.
 * Returns null when the directory is missing or empty.
 */
function getLatestSession(agentDir: string): string | null {
  const sessionsDir = join(agentDir, 'sessions')
  try {
    const candidates = readdirSync(sessionsDir).filter(
      (f) => f.endsWith('.jsonl') && !f.includes('.deleted'),
    )

    let latest: { path: string; ts: number } | null = null
    for (const f of candidates) {
      const filePath = join(sessionsDir, f)
      try {
        const firstLine = readFileSync(filePath, 'utf-8').split('\n')[0]
        const entry = JSON.parse(firstLine) as { timestamp?: string }
        const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0
        if (!latest || ts > latest.ts) latest = { path: filePath, ts }
      } catch {
        const mtime = statSync(filePath).mtimeMs
        if (!latest || mtime > latest.ts) latest = { path: filePath, ts: mtime }
      }
    }
    return latest?.path ?? null
  } catch {
    return null
  }
}

/**
 * Stringify any content shape from a JSONL message. Strings pass through;
 * arrays/objects pretty-print as JSON so tool calls stay readable.
 */
function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (content == null) return ''
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

/**
 * Parse a session JSONL file into a structured message stream.
 *
 * Skip rules:
 *   - non-message entries (`session`, etc.) are dropped
 *   - malformed lines are silently ignored (don't blow up the whole transcript)
 *   - messages with no role and no content are skipped
 */
function parseSessionTranscript(
  filePath: string,
  maxMessages: number,
): SessionTranscript | null {
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch (err) {
    log.debug('Failed to read session file', { filePath, error: err instanceof Error ? err.message : String(err) })
    return null
  }

  const lines = content.split('\n').filter((l) => l.trim())

  let sessionId = ''
  let sessionStarted: string | null = null
  const allMessages: SessionMessage[] = []

  for (const line of lines) {
    let entry: JsonlEntry
    try {
      entry = JSON.parse(line) as JsonlEntry
    } catch {
      continue
    }

    if (entry.type === 'session') {
      sessionId = entry.id ?? sessionId
      sessionStarted = entry.timestamp ?? sessionStarted
      continue
    }

    if (entry.type !== 'message' || !entry.message) continue

    const role = entry.message.role
    if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') continue

    const text = stringifyContent(entry.message.content)
    if (!text && role !== 'tool') continue

    allMessages.push({
      role,
      content: text,
      model: entry.message.model,
      ts: entry.timestamp,
      toolName: role === 'tool' ? entry.toolName : undefined,
    })
  }

  const truncated = allMessages.length > maxMessages
  const messages = truncated ? allMessages.slice(-maxMessages) : allMessages

  return {
    sessionId,
    sessionStarted,
    messages,
    truncated,
    totalMessages: allMessages.length,
  }
}

/**
 * Read the latest session transcript for an agent. Returns null if the
 * agent has no sessions on disk yet.
 */
export function readLatestSessionTranscript(
  agentId: string,
  opts?: { maxMessages?: number },
): SessionTranscript | null {
  const max = opts?.maxMessages ?? DEFAULT_MAX_MESSAGES
  const agentDir = getOpenClawPath('agents', agentId)
  const sessionFile = getLatestSession(agentDir)
  if (!sessionFile) return null
  return parseSessionTranscript(sessionFile, max)
}
