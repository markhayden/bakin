---
title: Scheduled Domain Events
description: Put your plugin's dates — publish dates, milestones, deadlines — on the Schedule calendar without giving up ownership.
---

Your plugin owns dates that aren't cron jobs: a content item's publish date, a project milestone, an approval deadline. The scheduled-events contract puts them on Bakin's Schedule calendars (Today, Week, Month) as read-only events with a deep link back into your plugin — and, optionally, a single "reschedule" verb that routes back through you.

Ownership never moves. Schedule displays; you mutate.

## The contract in one registration

Register a hook named `{yourPluginId}.scheduledEvents` in `activate()`:

```ts
import type { ScheduledDomainEvent, ScheduledEventsQuery } from '@makinbakin/sdk'

ctx.hooks.register(
  'myplugin.scheduledEvents',
  async ({ from, to }: ScheduledEventsQuery): Promise<ScheduledDomainEvent[]> => {
    return listMyDatedThingsBetween(from, to).map((item) => ({
      id: item.id,                       // stable within your plugin
      pluginId: 'myplugin',              // must match your plugin id
      title: item.title,
      startsAt: item.publishAt,          // ISO instant (or dueAt for deadlines)
      kind: 'publish',                   // your vocabulary
      status: item.status,               // display-only, optional
      url: `/myplugin?item=${item.id}`,  // deep link into your UI
    }))
  },
  { hookKind: 'rpc', label: 'My scheduled events' },
)
```

That's the whole integration. Schedule discovers every hook ending in `.scheduledEvents`, queries it with the visible range, and renders your events with your plugin's name on them.

## Rules the boundary enforces

Schedule validates every row and **drops your whole provider from that response** if any row fails — your bug never breaks the calendar, it just removes your events (and logs a warning naming you):

- `startsAt`/`endsAt`/`dueAt` must be real ISO-8601 instants; at least one of `startsAt`/`dueAt` is required.
- `pluginId` must equal the plugin that registered the hook — no contributing events "as" another plugin.
- Answer within **2 seconds**. Slow providers are dropped for that response. Keep the handler a cheap read.

`dueAt`-only events render as deadlines (distinct color); `startsAt` events as scheduled items.

## Optional: the reschedule verb

If your dates can be moved, register the companion hook and set `reschedulable: true` on those events:

```ts
import type { ScheduledEventReschedule, ScheduledEventRescheduleResult } from '@makinbakin/sdk'

ctx.hooks.register(
  'myplugin.rescheduleEvent',
  async ({ eventId, to }: ScheduledEventReschedule): Promise<ScheduledEventRescheduleResult> => {
    const item = findItem(eventId)
    if (!item) return { ok: false, error: `Unknown event ${eventId}` }
    await moveItem(item, to) // YOUR write, your validation, your audit
    return { ok: true }
  },
  { hookKind: 'rpc', label: 'Reschedule my event' },
)
```

Schedule then offers a date picker on your events; your rejection message (`{ ok: false, error }`) is shown to the user verbatim. This is the contract's only mutation — everything else is a deep link into your own UI.

## Keeping the calendar fresh

When your dates change outside the reschedule flow, emit the change event so open calendars refetch:

```ts
ctx.activity.audit('scheduled_events_changed', 'system', { reason: 'publish date edited' })
```

(Task-store writes already trigger a refetch; this is for your plugin's own data.)

## Reference

- Types: `ScheduledDomainEvent`, `ScheduledEventsQuery`, `ScheduledEventReschedule` — exported from `@makinbakin/sdk`.
- In-tree example: the tasks plugin (`plugins/tasks/lib/scheduled-events.ts`) contributes waiting (`availableAt`) and due (`dueAt`) tasks, both reschedulable.
- Feed endpoint (what Schedule's calendars consume): `GET /api/plugins/schedule/occurrences?from=&to=` — your events ride alongside job occurrences, with `droppedProviders` naming any provider that failed validation.
