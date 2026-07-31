'use client'

import { useMemo } from 'react'
import { Clock } from 'lucide-react'
import { CalendarGrid } from '@makinbakin/sdk/patterns'
import { useOccurrences, type ScheduleJob, type ScheduleOccurrence, type ScheduledDomainEvent } from '@makinbakin/sdk/hooks'
import { OccurrenceCard, jobsById } from './calendar-weekly'
import { EventChip, eventInstant } from './event-popover'

/** Occurrence or domain event flattened into the shared CalendarGrid item shape. */
type TodayCalendarItem =
  | { kind: 'occurrence'; key: string; date: string; occurrence: ScheduleOccurrence; job: ScheduleJob }
  | { kind: 'event'; key: string; date: string; event: ScheduledDomainEvent }

export function CalendarToday({
  jobs,
  onSelectJob,
}: {
  jobs: ScheduleJob[]
  onSelectJob: (job: ScheduleJob) => void
}) {
  const now = new Date()

  const dayStart = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const dayEnd = useMemo(() => {
    const d = new Date(dayStart)
    d.setDate(d.getDate() + 1)
    return d
  }, [dayStart])

  const { occurrences, events, refresh } = useOccurrences(dayStart.toISOString(), dayEnd.toISOString())
  const byId = useMemo(() => jobsById(jobs), [jobs])

  const todayFormatted = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const total = occurrences.length + events.length

  // The shared CalendarGrid owns hour-row placement and current-hour marking.
  const items = useMemo<TodayCalendarItem[]>(() => {
    const list: TodayCalendarItem[] = []
    for (const occurrence of occurrences) {
      const job = byId.get(occurrence.jobId)
      if (!job) continue
      list.push({
        kind: 'occurrence',
        key: `occurrence-${occurrence.jobId}-${occurrence.at}`,
        date: occurrence.at,
        occurrence,
        job,
      })
    }
    for (const event of events) {
      list.push({
        kind: 'event',
        key: `event-${event.pluginId}-${event.id}`,
        date: eventInstant(event),
        event,
      })
    }
    return list
  }, [byId, events, occurrences])

  return (
    <div className="flex h-full min-h-0 flex-col gap-bakin-3">
      <div className="flex flex-wrap items-center gap-x-bakin-3 gap-y-bakin-1">
        <Clock className="size-bakin-4 text-bakin-text-muted" aria-hidden="true" />
        <span className="font-bakin-typography-weight-medium text-bakin-text-primary">{todayFormatted}</span>
        <span className="text-bakin-typography-size-meta text-bakin-text-muted">
          {total} run{total !== 1 ? 's' : ''} scheduled
        </span>
      </div>

      <CalendarGrid
        view="day"
        date={dayStart}
        label="Today's schedule"
        items={items}
        className="min-h-0 flex-1"
        renderItem={(item) => item.kind === 'occurrence' ? (
          <OccurrenceCard
            occurrence={item.occurrence}
            job={item.job}
            onClick={() => onSelectJob(item.job)}
            expanded
          />
        ) : (
          <EventChip event={item.event} onRescheduled={refresh} />
        )}
      />
    </div>
  )
}
