/**
 * Audit tier parser — translates a single `~/.bakin/audit.jsonl` line into
 * a `MemoryRow` for the `bakin_memory` table, tier='audit'.
 *
 * Pure function, no I/O. Returns null for anything that can't be parsed into
 * a valid entry so the indexer can skip without aborting the batch.
 */
import { createHash } from 'crypto'
import type { MemoryRow } from '../types'

const SNIPPET_CAP = 2048

interface RawAuditEntry {
  ts?: unknown
  event?: unknown
  agent?: unknown
  channel?: unknown
  actor?: unknown
  data?: unknown
}

export function parseAuditLine(
  line: string,
  sourcePath: string,
  offset: number,
): MemoryRow | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  let entry: RawAuditEntry
  try {
    entry = JSON.parse(trimmed)
  } catch {
    return null
  }

  const ts = typeof entry.ts === 'string' ? entry.ts : null
  const event = typeof entry.event === 'string' ? entry.event : null
  if (!ts || !event) return null

  const updatedAt = Date.parse(ts)
  if (!Number.isFinite(updatedAt)) return null

  const rawAgent = typeof entry.agent === 'string' ? entry.agent : ''
  const agent = rawAgent.length > 0 ? rawAgent : 'system'
  const channel = typeof entry.channel === 'string' ? entry.channel : null
  const actor = typeof entry.actor === 'string' ? entry.actor : null
  const data = entry.data ?? {}

  const content = `${event} by ${agent}: ${safeStringify(data)}`
  const snippet = content.length > SNIPPET_CAP ? content.slice(0, SNIPPET_CAP) : content

  const idHash = createHash('sha256')
    .update(`${ts}|${event}|${agent}`)
    .digest('hex')
    .slice(0, 16)

  return {
    id: `audit:${idHash}`,
    tier: 'audit',
    agent,
    title: event,
    snippet,
    content,
    sourceRef: {
      backend: 'bakin',
      path: sourcePath,
      file: 'audit.jsonl',
      offset,
    },
    updatedAt,
    createdAt: updatedAt,
    meta: JSON.stringify({
      event,
      agent,
      channel,
      actor,
      data,
    }),
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '""'
  }
}
