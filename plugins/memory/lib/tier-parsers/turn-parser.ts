/**
 * Turn tier parser — one runtime JSONL line → one `MemoryRow | null`.
 *
 * Skipped event types (null):
 *   - `session` (session header; exposed via session tier instead)
 *   - `model_change`
 *   - `thinking_level_change`
 *   - `custom` (any customType, incl. `model-snapshot`)
 *   - `custom_message` and any unknown `type`
 *
 * Indexed event types:
 *   - `message` role=user                             → eventType='message'
 *   - `message` role=assistant, no toolCall blocks    → eventType='message'
 *   - `message` role=assistant, ≥1 toolCall block     → eventType='tool_call'
 *   - `message` role=toolResult                       → eventType='tool_result'
 *
 * Content extraction:
 *   - `message`: text blocks only, joined with "\n\n" (thinking blocks excluded).
 *   - `tool_call`: JSON-stringify each toolCall (name + arguments).
 *   - `tool_result`: text blocks joined.
 *
 * Truncation: content sliced at 32 KB; `meta.truncated=true` and
 * `meta.rawByteOffset=<caller-supplied line offset>` so the UI can re-fetch
 * the full line from the underlying JSONL file via `sourceRef`.
 */
import { createHash } from 'crypto'
import type { MemoryRow, TurnMeta, TurnEventType } from '../types'

const MAX_CONTENT_BYTES = 32 * 1024

export function parseTurnLine(
  agent: string,
  sessionId: string,
  sessionKey: string,
  line: string,
  lineByteOffset: number,
): MemoryRow | null {
  if (!line) return null
  let obj: Record<string, unknown>
  try {
    const parsed = JSON.parse(line)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    obj = parsed as Record<string, unknown>
  } catch {
    return null
  }

  const type = typeof obj.type === 'string' ? obj.type : ''
  if (type !== 'message') return null

  const eventId = typeof obj.id === 'string' ? obj.id : null
  if (!eventId) return null

  const messageRaw = obj.message
  if (!messageRaw || typeof messageRaw !== 'object' || Array.isArray(messageRaw)) return null
  const msg = messageRaw as Record<string, unknown>
  const role = typeof msg.role === 'string' ? msg.role : null
  if (!role) return null

  const contentBlocks = Array.isArray(msg.content) ? (msg.content as unknown[]) : []
  const classification = classify(role, contentBlocks, msg)
  if (!classification) return null

  const rawContent = extractContent(classification.eventType, role, contentBlocks, msg)
  const { content, truncated } = truncateContent(rawContent)

  const timestampMs = parseTimestamp(obj.timestamp)
  const usage = extractUsage(msg.usage)
  const costUsd = extractCost(msg.usage)

  const meta: TurnMeta = {
    sessionId,
    sessionKey,
    eventType: classification.eventType,
    role,
    parentId: typeof obj.parentId === 'string' ? obj.parentId : null,
    timestamp: timestampMs,
    tool: classification.tool,
    toolCallId: classification.toolCallId,
    usage: usage === null ? null : usage,
    costUsd,
    provider: pickNullableString(msg.provider),
    model: pickNullableString(msg.model),
    truncated,
    rawByteOffset: lineByteOffset,
  }

  const title = buildTitle(classification, role)

  return {
    id: rowId(agent, sessionId, eventId),
    tier: 'turn',
    agent,
    title,
    snippet: content.length > 2048 ? content.slice(0, 2048) : content,
    content,
    sourceRef: {
      backend: 'runtime',
      path: '',
      file: `${sessionId}.jsonl`,
      offset: lineByteOffset,
      sessionId,
      eventId,
    },
    updatedAt: timestampMs,
    createdAt: timestampMs,
    meta: JSON.stringify(meta),
  }
}

export function rowId(agent: string, sessionId: string, eventId: string): string {
  const hash = createHash('sha256').update(`${agent}|${sessionId}|${eventId}`).digest('hex').slice(0, 16)
  return `turn:${hash}`
}

// ─── Classification ──────────────────────────────────────────────────────────

interface Classified {
  eventType: TurnEventType
  tool?: string
  toolCallId?: string
}

function classify(
  role: string,
  content: unknown[],
  msg: Record<string, unknown>,
): Classified | null {
  if (role === 'user') return { eventType: 'message' }
  if (role === 'toolResult') {
    return {
      eventType: 'tool_result',
      tool: pickNullableString(msg.toolName) ?? undefined,
      toolCallId: pickNullableString(msg.toolCallId) ?? undefined,
    }
  }
  if (role === 'assistant') {
    const firstToolCall = content.find(
      (b): b is Record<string, unknown> =>
        !!b && typeof b === 'object' && (b as Record<string, unknown>).type === 'toolCall',
    )
    if (firstToolCall) {
      return {
        eventType: 'tool_call',
        tool: pickNullableString(firstToolCall.name) ?? undefined,
        toolCallId: pickNullableString(firstToolCall.id) ?? undefined,
      }
    }
    return { eventType: 'message' }
  }
  // Unknown role → skip (system prompts etc. are already filtered by type).
  return null
}

// ─── Content extraction ──────────────────────────────────────────────────────

function extractContent(
  eventType: TurnEventType,
  role: string,
  content: unknown[],
  msg: Record<string, unknown>,
): string {
  if (eventType === 'tool_call') {
    const blocks = content
      .filter(
        (b): b is Record<string, unknown> =>
          !!b && typeof b === 'object' && (b as Record<string, unknown>).type === 'toolCall',
      )
      .map((b) => JSON.stringify({ name: b.name, arguments: b.arguments }))
    return blocks.join('\n\n')
  }

  // message + tool_result: text blocks only. For toolResult messages the
  // content layout is identical (array of { type: 'text', text }).
  const texts = content
    .filter(
      (b): b is Record<string, unknown> =>
        !!b && typeof b === 'object' && (b as Record<string, unknown>).type === 'text',
    )
    .map((b) => (typeof b.text === 'string' ? b.text : ''))
    .filter((t) => t.length > 0)
  if (texts.length > 0) return texts.join('\n\n')

  // Fall back to toolName (helps tool_result rows with empty content blocks).
  if (role === 'toolResult' && typeof msg.toolName === 'string') return msg.toolName
  return ''
}

function truncateContent(raw: string): { content: string; truncated: boolean } {
  if (Buffer.byteLength(raw, 'utf-8') <= MAX_CONTENT_BYTES) {
    return { content: raw, truncated: false }
  }
  // Slice by bytes, but produce a valid UTF-8 string.
  const buf = Buffer.from(raw, 'utf-8').subarray(0, MAX_CONTENT_BYTES)
  return { content: buf.toString('utf-8'), truncated: true }
}

// ─── Usage / cost / timestamp helpers ────────────────────────────────────────

function extractUsage(raw: unknown): TurnMeta['usage'] | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  const out: NonNullable<TurnMeta['usage']> = {}
  if (typeof u.input === 'number') out.inputTokens = u.input
  if (typeof u.output === 'number') out.outputTokens = u.output
  if (typeof u.cacheRead === 'number') out.cacheRead = u.cacheRead
  if (typeof u.cacheWrite === 'number') out.cacheWrite = u.cacheWrite
  return Object.keys(out).length === 0 ? null : out
}

function extractCost(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  const cost = u.cost
  if (!cost || typeof cost !== 'object') return null
  const total = (cost as Record<string, unknown>).total
  return typeof total === 'number' ? total : null
}

function parseTimestamp(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Date.parse(v)
    if (!Number.isNaN(n)) return n
  }
  return Date.now()
}

function pickNullableString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

// ─── Title ───────────────────────────────────────────────────────────────────

function buildTitle(c: Classified, role: string): string {
  if (c.eventType === 'tool_call') return `tool_call: ${c.tool ?? 'unknown'}`
  if (c.eventType === 'tool_result') return `tool_result: ${c.tool ?? 'unknown'}`
  return `message: ${role}`
}
