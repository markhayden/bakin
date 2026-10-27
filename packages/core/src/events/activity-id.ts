/**
 * Activity-feed identities — ONE derivation shared by the HTTP snapshot
 * (`GET /api/activity`) and the live SSE path (`use-sse`), so the browser can
 * merge the two without duplicating an entry that arrived both ways.
 *
 * Pure and synchronous; safe in the browser and on the server.
 */

/** FNV-1a 32-bit over UTF-16 code units, base36. Separates same-instant entries. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/** Identity of one task-log entry: the persisted entry and its live broadcast share it. */
export function taskLogActivityId(taskId: string, timestamp: string, author: string, message: string): string {
  return `log:${taskId}:${timestamp}:${author}:${shortHash(message)}`
}

/**
 * Identity of one audit record. The data fingerprint separates same-instant
 * records from one agent (two tasks created in one millisecond); the HTTP
 * snapshot and the SSE frame carry the same JSON, so both derive the same id.
 */
export function auditActivityId(entry: { ts: string; event: string; agent?: string; data?: unknown }): string {
  return `audit:${entry.ts}:${entry.event}:${entry.agent || 'system'}:${shortHash(JSON.stringify(entry.data ?? {}))}`
}
