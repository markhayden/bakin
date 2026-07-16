# Scheduled Domain Events (#191)

> Plugins contribute read-only dated events (publish dates, milestones,
> deadlines) to the Schedule calendars without giving up ownership. Shipped
> PR4 of the schedule initiative, 2026-07-15.

## The contract

Hook suffix convention — NO core registry, NO manifest surface:

- **`{pluginId}.scheduledEvents`** (`hookKind: 'rpc'`): `ScheduledEventsQuery
  { from, to }` → `ScheduledDomainEvent[]`. Types SDK-exported
  (`packages/sdk/src/types/scheduled-events.ts` — authoring docs live in the
  type module; external-author guide:
  `docs/src/content/docs/extending/plugins/scheduled-events.md`).
- **`{pluginId}.rescheduleEvent`** (optional): `{ eventId, to }` →
  `{ ok } | { ok: false, error }` — the ONE sanctioned mutation. Events opt
  in via `reschedulable: true`. Everything else is a deep link (`url`).

## Fan-in (Schedule side)

`plugins/schedule/lib/domain-events.ts` (`collectDomainEvents`, pure DI):
discovers providers via `getRegisteredHooks()` suffix match, invokes them in
PARALLEL under a **2s per-provider budget**, zod-validates at the boundary
(ISO instants, one of startsAt/dueAt required, `pluginId` must match the
provider — no spoofed ownership). A provider that throws / times out /
returns any invalid row is **dropped from that response** and named in
`droppedProviders` (+ a logged warning with elapsed ms — watch these to
retune the budget). A missing/broken plugin never breaks the calendar (#191
acceptance criterion, teeth in `tests/plugins/schedule/domain-events.test.ts`).

Events ride the occurrences feed: `GET /api/plugins/schedule/occurrences`
returns `{ occurrences, events, unevaluated, droppedProviders }`.

## Reschedule path

`POST /api/plugins/schedule/events/reschedule { pluginId, eventId, to }` →
invokes the owner hook; 404 when the plugin doesn't support it; the owner's
rejection propagates verbatim. Schedule NEVER writes plugin domain data.

## UI

`plugins/schedule/components/event-popover.tsx` — `EventChip` renders on all
three calendar views: dashed border, `owner · kind` label, rose (deadline) /
teal (start), no agent identity — unmistakable from job occurrence cards.
Popover: details + Open deep link + Reschedule (whole flow in a
ConfirmDialog with a datetime picker; owner rejection shown in-dialog).
`useOccurrences` (SDK hook) surfaces `events` + `droppedProviders` and
refetches on `schedule.*` events, `taskboard` broadcasts, and the documented
`<pluginId>.scheduled_events_changed` audit convention.

## Providers

- **tasks** (in-tree proving consumer, `plugins/tasks/lib/scheduled-events.ts`):
  waiting tasks (`availableAt` → kind `task-scheduled`) and deadlines
  (`dueAt` → kind `task-due`), deep-linked `/tasks?taskId=…`, both
  reschedulable (moves the underlying field via the task store; done/archived
  contribute nothing).
- **messaging / projects** (external, bakin-bits-official): adopt the same
  contract — the bits work item of the initiative. NOTE: PR2 renamed the
  `ensureBakinJob` hook result (`cron` → `kind`/`expr`) — reconcile messaging
  if it reads `result.cron`.

## Key files

- Contract: `packages/sdk/src/types/scheduled-events.ts`
- Fan-in: `plugins/schedule/lib/domain-events.ts`; route wiring in
  `plugins/schedule/lib/routes/jobs.ts` (occurrences + events/reschedule)
- UI: `plugins/schedule/components/event-popover.tsx`, wired in all three
  `calendar-*.tsx`
- Tasks provider: `plugins/tasks/lib/scheduled-events.ts` (+ hook
  registrations in `plugins/tasks/index.ts`)
- Tests: `tests/plugins/schedule/domain-events.test.ts` (fan-in isolation),
  `tests/plugins/tasks/scheduled-events.test.ts` (provider),
  `tests/plugins/schedule/calendar-views.test.tsx` (chips + reschedule flow),
  `tests/plugins/schedule/routes-jobs.test.ts` (routes)
