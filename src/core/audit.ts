/**
 * Core audit logging for Beacon.
 * Append-only JSONL file for system events.
 */
import { appendFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { broadcastAuditEvent } from './sse'
import { createLogger } from './logger'
import { indexAuditEvent } from './antfly'

const log = createLogger('audit')

export function appendAudit(
  contentDir: string,
  event: string,
  agent: string,
  data: Record<string, unknown> = {}
): void {
  const entry = {
    ts: new Date().toISOString(),
    event,
    agent,
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

  broadcastAuditEvent(entry)

  // Index to Antfly (fire-and-forget)
  indexAuditEvent(entry).catch(() => {
    // Non-blocking — antfly may be disabled or down
  })
}
