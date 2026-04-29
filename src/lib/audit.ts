import { appendAudit as coreAppend } from '../core/audit'
import { getContentDir } from '../core/content-dir'

/**
 * Convenience wrapper around core/audit that resolves contentDir automatically.
 * Writes to audit.jsonl, broadcasts via SSE, and indexes through search.
 */
export function appendAudit(event: string, agent: string, data: Record<string, unknown> = {}) {
  coreAppend(getContentDir(), event, agent, data)
}
