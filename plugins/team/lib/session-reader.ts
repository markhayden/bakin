/**
 * Runtime session JSONL -> structured message stream.
 *
 * Sibling to `src/core/agent-usage.ts`. Where agent-usage sums tokens and
 * cost across the latest session, session-reader returns the *messages*
 * themselves so the Active Context tab can show what the agent has been
 * sent and what it has produced.
 *
 * Discovery mirrors agent-usage: most recent session by the first JSONL
 * line's timestamp. Runtime entry update time is only a fallback because
 * sessions can be touched out of order.
 */
import type { AgentRuntimeAdapter, RuntimeMemoryEntry } from '@bakin/core/adapters/runtime'
import { createLogger } from '../../../src/core/logger'
import type { SessionMessage, SessionTranscript } from '../types'

const log = createLogger('team:session-reader')

const DEFAULT_MAX_MESSAGES = 200
const SESSION_JSONL_SOURCE_KIND = 'session_jsonl'

type RuntimeSessionMemory = Pick<AgentRuntimeAdapter['memory'], 'listTiers' | 'listEntries' | 'getEntry'>

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
export function parseSessionTranscriptContent(
  content: string,
  maxMessages: number,
): SessionTranscript | null {
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
 * agent has no sessions in the runtime memory tier yet.
 */
export async function readLatestSessionTranscript(
  runtime: RuntimeSessionMemory,
  agentId: string,
  opts?: { maxMessages?: number },
): Promise<SessionTranscript | null> {
  const max = opts?.maxMessages ?? DEFAULT_MAX_MESSAGES
  const latest = await getLatestSessionEntry(runtime, agentId)
  if (!latest) return null
  return parseSessionTranscriptContent(latest.content, max)
}

async function getLatestSessionEntry(
  runtime: RuntimeSessionMemory,
  agentId: string,
): Promise<RuntimeMemoryEntry | null> {
  const tierId = await getSessionJsonlTierId(runtime)
  if (!tierId) return null

  let entries: RuntimeMemoryEntry[]
  try {
    entries = await runtime.listEntries(tierId, { agentId })
  } catch (err) {
    log.debug('Failed to list runtime session entries', { agentId, error: err instanceof Error ? err.message : String(err) })
    return null
  }

  let latest: { entry: RuntimeMemoryEntry; ts: number } | null = null
  for (const entry of entries) {
    let full: RuntimeMemoryEntry | null
    try {
      full = await runtime.getEntry(tierId, entry.id, { agentId })
    } catch (err) {
      log.debug('Failed to read runtime session entry', { agentId, sessionId: entry.id, error: err instanceof Error ? err.message : String(err) })
      continue
    }
    if (!full) continue
    const ts = sessionTimestamp(full.content) ?? timestampMs(full.updatedAt) ?? timestampMs(entry.updatedAt) ?? 0
    if (!latest || ts > latest.ts) latest = { entry: full, ts }
  }

  return latest?.entry ?? null
}

async function getSessionJsonlTierId(runtime: RuntimeSessionMemory): Promise<string | null> {
  try {
    const tiers = await runtime.listTiers()
    return tiers.find((tier) => tier.metadata?.sourceKind === SESSION_JSONL_SOURCE_KIND)?.id ?? null
  } catch (err) {
    log.debug('Failed to discover runtime session transcript tier', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

function sessionTimestamp(content: string): number | null {
  const firstLine = content.split('\n').find((line) => line.trim())
  if (!firstLine) return null
  try {
    const entry = JSON.parse(firstLine) as { timestamp?: string }
    return timestampMs(entry.timestamp)
  } catch {
    return null
  }
}

function timestampMs(value: string | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}
