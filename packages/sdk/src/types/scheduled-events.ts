/**
 * Plugin-contributed scheduled domain events (#191).
 *
 * Plugins own dates that are NOT cron jobs — publish dates, milestones,
 * deadlines. The Schedule plugin renders them on its calendars alongside job
 * occurrences, read-only, with clear source labels. Ownership never moves:
 * Schedule displays; the owning plugin mutates.
 *
 * ## The contract (hook convention — no registration API)
 *
 * A provider registers ONE hook in `activate()`, named by suffix convention:
 *
 * ```ts
 * ctx.hooks.register(
 *   'myplugin.scheduledEvents',
 *   async ({ from, to }: ScheduledEventsQuery): Promise<ScheduledDomainEvent[]> =>
 *     listMyEventsBetween(from, to),
 *   { hookKind: 'rpc', label: 'My scheduled events' },
 * )
 * ```
 *
 * Schedule discovers every hook ending in `.scheduledEvents`, invokes each
 * with the query range (bounded timeout, parallel), validates rows, and
 * drops a failing/invalid/slow provider from that response with a warning —
 * a missing or broken plugin never breaks the calendar.
 *
 * Optionally, a provider may also register `myplugin.rescheduleEvent`
 * (`ScheduledEventReschedule` → `ScheduledEventRescheduleResult`) and set
 * `reschedulable: true` on its events — Schedule then offers a date-picker
 * that calls the owner to move the event's PRIMARY date. This is the one
 * mutation verb in the contract; everything else is a deep link.
 *
 * When a provider's underlying dates change, emit
 * `ctx.activity.audit('scheduled_events_changed', …)` so calendars refetch.
 */

/** One read-only dated event owned by a plugin, rendered by Schedule. */
export interface ScheduledDomainEvent {
  /** Stable within the owning plugin (used as the reschedule target). */
  id: string
  /** Must equal the registering plugin's id — validated at the boundary. */
  pluginId: string
  title: string
  /** ISO instant the event starts/happens. One of startsAt/dueAt required. */
  startsAt?: string
  /** ISO instant a ranged event ends. */
  endsAt?: string
  /** ISO deadline — rendered distinctly from startsAt. */
  dueAt?: string
  /** Owner vocabulary, e.g. 'task-scheduled' | 'task-due' | 'publish' | 'milestone'. */
  kind: string
  /** Owner vocabulary, display-only. */
  status?: string
  /** Deep link into the owning plugin's UI. */
  url?: string
  /** True ⇒ the owner registered `{pluginId}.rescheduleEvent`. */
  reschedulable?: boolean
  /** Read-only extras for popover display. */
  metadata?: Record<string, unknown>
}

/** Input to `{pluginId}.scheduledEvents`. */
export interface ScheduledEventsQuery {
  /** ISO instant, inclusive lower bound. */
  from: string
  /** ISO instant, exclusive upper bound. */
  to: string
}

/** Input to the optional `{pluginId}.rescheduleEvent` hook. */
export interface ScheduledEventReschedule {
  /** The event's `id` as the owner reported it. */
  eventId: string
  /** New ISO instant for the event's primary date (startsAt, or dueAt for
   *  deadline-kinded events) — the owner decides which field moves. */
  to: string
}

export type ScheduledEventRescheduleResult =
  | { ok: true }
  | { ok: false; error: string }
