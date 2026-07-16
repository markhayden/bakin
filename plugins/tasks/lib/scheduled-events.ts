/**
 * tasks.scheduledEvents provider (#191) — the in-tree proving consumer of the
 * scheduled-domain-events contract. Waiting tasks (future `availableAt`) and
 * deadline tasks (`dueAt`) appear on the Schedule calendars as read-only
 * events deep-linked to the board; `tasks.rescheduleEvent` moves the
 * underlying date — the contract's one sanctioned mutation.
 */
import type { ScheduledDomainEvent, ScheduledEventsQuery, ScheduledEventReschedule, ScheduledEventRescheduleResult } from '@makinbakin/sdk'
import { readTaskboard, updateTask } from '../../../src/core/task-store'
import type { Task, ColumnId } from '../types'

/** Columns whose tasks still have a future — done/archived contribute nothing. */
const LIVE_COLUMNS: ColumnId[] = ['backlog', 'todo', 'inProgress', 'review', 'blocked']

/** Event ids are `${taskId}:${scheduled|due}` — one task can carry both. */
function parseEventId(eventId: string): { taskId: string; field: 'availableAt' | 'dueAt' } | null {
  const sep = eventId.lastIndexOf(':')
  if (sep <= 0) return null
  const suffix = eventId.slice(sep + 1)
  if (suffix !== 'scheduled' && suffix !== 'due') return null
  return { taskId: eventId.slice(0, sep), field: suffix === 'scheduled' ? 'availableAt' : 'dueAt' }
}

function inRange(iso: string | undefined, fromMs: number, toMs: number): boolean {
  if (!iso) return false
  const ms = Date.parse(iso)
  return Number.isFinite(ms) && ms >= fromMs && ms < toMs
}

function liveTasks(): Task[] {
  const board = readTaskboard()
  return LIVE_COLUMNS.flatMap((col) => (board.columns[col] ?? []) as Task[])
}

export async function listScheduledTaskEvents(query: ScheduledEventsQuery): Promise<ScheduledDomainEvent[]> {
  const fromMs = Date.parse(query.from)
  const toMs = Date.parse(query.to)
  const events: ScheduledDomainEvent[] = []

  for (const task of liveTasks()) {
    if (inRange(task.availableAt, fromMs, toMs)) {
      events.push({
        id: `${task.id}:scheduled`,
        pluginId: 'tasks',
        title: task.title,
        startsAt: new Date(Date.parse(task.availableAt!)).toISOString(),
        kind: 'task-scheduled',
        status: 'waiting',
        url: `/tasks?taskId=${task.id}`,
        reschedulable: true,
        ...(task.agent ? { metadata: { agent: task.agent } } : {}),
      })
    }
    if (inRange(task.dueAt, fromMs, toMs)) {
      events.push({
        id: `${task.id}:due`,
        pluginId: 'tasks',
        title: task.title,
        dueAt: new Date(Date.parse(task.dueAt!)).toISOString(),
        kind: 'task-due',
        url: `/tasks?taskId=${task.id}`,
        reschedulable: true,
        ...(task.agent ? { metadata: { agent: task.agent } } : {}),
      })
    }
  }
  return events
}

export async function rescheduleTaskEvent(input: ScheduledEventReschedule): Promise<ScheduledEventRescheduleResult> {
  const parsed = parseEventId(input.eventId)
  if (!parsed) return { ok: false, error: `Unknown event id shape: ${input.eventId}` }
  const toMs = Date.parse(input.to)
  if (!Number.isFinite(toMs)) return { ok: false, error: `Not an ISO instant: ${input.to}` }

  const task = liveTasks().find((t) => t.id === parsed.taskId)
  if (!task) return { ok: false, error: `No live task ${parsed.taskId}` }

  await updateTask(parsed.taskId, { [parsed.field]: new Date(toMs).toISOString() })
  return { ok: true }
}
