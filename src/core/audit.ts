/**
 * Core audit logging for Bakin.
 * Append-only JSONL file for system events.
 */
import { appendFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { createLogger } from './logger'
import { indexAuditEvent } from './antfly'

const log = createLogger('audit')

export function appendAudit(
  contentDir: string,
  event: string,
  agent: string,
  data: Record<string, unknown> = {},
  channel?: 'mcp' | 'rest' | 'cli' | 'system',
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

  // Index to Antfly (fire-and-forget)
  indexAuditEvent(entry).catch(() => {
    // Non-blocking — antfly may be disabled or down
  })
}
