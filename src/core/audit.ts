/**
 * Core audit logging for Bakin.
 * Append-only JSONL file for system events.
 */
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { createLogger } from './logger'

const log = createLogger('audit')

export interface AuditEvent {
  ts: string
  event: string
  agent: string
  channel?: string
  data: Record<string, unknown>
}

/**
 * Read audit events back, filtered by kind and recency. The sanctioned read
 * path over audit.jsonl — health checks and reports should use this rather
 * than hand-parsing the file. Tolerant of malformed lines.
 */
export function queryAuditEvents(
  contentDir: string,
  opts: { kinds?: string[]; sinceMs?: number; limit?: number } = {},
): AuditEvent[] {
  const auditFile = join(contentDir, 'audit.jsonl')
  if (!existsSync(auditFile)) return []

  const kinds = opts.kinds ? new Set(opts.kinds) : null
  const cutoff = opts.sinceMs !== undefined ? Date.now() - opts.sinceMs : null
  const results: AuditEvent[] = []
  let raw: string
  try {
    raw = readFileSync(auditFile, 'utf-8')
  } catch (err) {
    log.warn('Failed to read audit file for query', err)
    return []
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let entry: AuditEvent
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof entry?.event !== 'string' || typeof entry?.ts !== 'string') continue
    if (kinds && !kinds.has(entry.event)) continue
    if (cutoff !== null) {
      const tsMs = Date.parse(entry.ts)
      if (Number.isNaN(tsMs) || tsMs < cutoff) continue
    }
    results.push(entry)
  }

  return opts.limit !== undefined ? results.slice(-opts.limit) : results
}

export function appendAudit(
  contentDir: string,
  event: string,
  agent: string,
  data: Record<string, unknown> = {},
  channel?: 'human' | 'mcp' | 'rest' | 'cli' | 'system',
): void {
  const entry = {
    ts: new Date().toISOString(),
    event,
    agent,
    ...(channel ? { channel } : {}),
    data,
  }

  const auditFile = join(contentDir, 'audit.jsonl')
  try {
    const dir = dirname(auditFile)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(auditFile, JSON.stringify(entry) + '\n')
  } catch (err) {
    log.error('Failed to write audit entry', err, { event, agent })
  }

  // Use globalThis to reach the real SSE clients. Next.js API routes get a
  // separate webpack module instance of sse.ts with an empty clients Set.
  // The custom server's sse.ts registers the real broadcast on globalThis.
  const broadcastFn = (globalThis as any).__bakinBroadcastAudit
  if (broadcastFn) {
    broadcastFn(entry)
  } else {
    log.warn('SSE broadcast not available — audit event written to disk only', { event })
  }

  // The memory plugin's indexer picks up audit.jsonl changes via the watcher
  // and indexes them into the bakin_memory table (tier=audit).
}
