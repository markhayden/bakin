/**
 * GET /api/activity — unified activity feed combining audit events + task logs.
 *
 * Returns up to 50 most-recent events sorted by timestamp descending. The
 * audit side reads only the newest entries (bounded tail read, never the
 * whole log); ids come from the shared activity-id derivation so the browser
 * can merge this snapshot with live SSE events without duplicates.
 */
import { getContentDir } from '@/core/content-dir'
import { queryAuditEvents } from '@/core/audit'
import { createLogger } from '@/core/logger'
import { readTaskboard } from '@/core/task-store'
import { mapAuditMessage } from '@bakin/core/events/audit-message'
import { auditActivityId, taskLogActivityId } from '@bakin/core/events/activity-id'
import type { ActivityEvent } from '@makinbakin/sdk/types'

const log = createLogger('activity')

/** Feed size — the snapshot the browser merges with live events. */
export const ACTIVITY_LIMIT = 50

/** Normalize old truncated UTC timestamps (e.g. "2026-03-21 21:37") to proper ISO 8601 */
function normalizeTimestamp(ts: string): string {
  if (ts.includes('T')) return ts
  return ts.replace(' ', 'T') + ':00Z'
}

export async function get(_req: Request): Promise<Response> {
  const events: ActivityEvent[] = []

  try {
    for (const entry of queryAuditEvents(getContentDir(), { limit: ACTIVITY_LIMIT })) {
      const data = entry.data || {}
      events.push({
        id: auditActivityId(entry),
        ts: entry.ts,
        type: 'audit',
        agent: entry.agent || 'system',
        message: mapAuditMessage(entry.event, data),
        taskId: data.taskId as string | undefined,
        taskTitle: data.title as string | undefined,
        eventName: entry.event,
        ...(data.duplicate ? { duplicate: true } : {}),
        data,
      })
    }
  } catch (err) {
    log.error('Failed to read audit events for the activity feed', err)
  }

  try {
    for (const task of Object.values(readTaskboard().columns).flat()) {
      for (const entry of task.log ?? []) {
        const ts = normalizeTimestamp(entry.timestamp)
        events.push({
          id: taskLogActivityId(task.id, entry.timestamp, entry.author, entry.message),
          ts,
          type: 'log',
          agent: entry.author || 'system',
          message: entry.message,
          taskId: task.id,
          taskTitle: task.title,
        })
      }
    }
  } catch (err) {
    log.error('Failed to read task logs for the activity feed', err)
  }

  events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
  return Response.json({ events: events.slice(0, ACTIVITY_LIMIT) })
}
