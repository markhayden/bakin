'use client'

import { useMemo } from 'react'
import { Clock } from 'lucide-react'
import { useOccurrences, type ScheduleJob, type ScheduleOccurrence, type ScheduledDomainEvent } from '@makinbakin/sdk/hooks'
import { OccurrenceCard, formatHour, jobsById, CALENDAR_HOURS } from './calendar-weekly'
import { EventChip, eventInstant } from './event-popover'

export function CalendarToday({
  jobs,
  onSelectJob,
}: {
  jobs: ScheduleJob[]
  onSelectJob: (job: ScheduleJob) => void
}) {
  const now = new Date()
  const currentHour = now.getHours()

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

  // Group today's occurrences + domain events by local hour.
  const hourGrid = useMemo(() => {
    const map: Record<number, ScheduleOccurrence[]> = {}
    for (const occurrence of occurrences) {
      const hour = new Date(occurrence.at).getHours()
      if (!map[hour]) map[hour] = []
      map[hour]!.push(occurrence)
    }
    return { map, total: occurrences.length + events.length }
  }, [occurrences, events])

  const eventHourGrid = useMemo(() => {
    const map: Record<number, ScheduledDomainEvent[]> = {}
    for (const event of events) {
      const hour = new Date(eventInstant(event)).getHours()
      if (!map[hour]) map[hour] = []
      map[hour]!.push(event)
    }
    return map
  }, [events])

  return (
    <div className="flex h-full min-h-0 flex-col gap-bakin-3">
      <div className="flex flex-wrap items-center gap-x-bakin-3 gap-y-bakin-1">
        <Clock className="size-bakin-4 text-bakin-text-muted" aria-hidden="true" />
        <span className="font-bakin-typography-weight-medium text-bakin-text-primary">{todayFormatted}</span>
        <span className="text-bakin-typography-size-meta text-bakin-text-muted">
          {hourGrid.total} run{hourGrid.total !== 1 ? 's' : ''} scheduled
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-bakin-surface border border-bakin-border-subtle bg-bakin-canvas-default">
        <div className="divide-y divide-bakin-border-subtle">
          {CALENDAR_HOURS.map(hour => {
            const hourOccurrences = hourGrid.map[hour] || []
            const hourEvents = eventHourGrid[hour] || []
            const isCurrent = hour === currentHour

            return (
              <div
                key={hour}
                className={`
                  flex min-h-14 gap-bakin-4 px-bakin-4 py-bakin-3
                  ${isCurrent ? 'bg-bakin-signal-accent/5' : ''}
                `}
              >
                <div className="w-16 shrink-0 pt-bakin-1">
                  <span className={`font-bakin-typography-family-mono text-bakin-typography-size-meta tabular-nums ${
                    isCurrent
                      ? 'font-bakin-typography-weight-medium text-bakin-signal-accent'
                      : 'text-bakin-text-muted'
                  }`}>
                    {formatHour(hour)}
                  </span>
                  {isCurrent && (
                    <div className="mt-bakin-1 h-0.5 w-full rounded-bakin-pill bg-bakin-signal-accent/50" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  {hourOccurrences.length + hourEvents.length > 0 ? (
                    <div className="grid grid-cols-1 gap-bakin-2 sm:grid-cols-2 lg:grid-cols-3">
                      {hourOccurrences.map(occurrence => {
                        const job = byId.get(occurrence.jobId)
                        if (!job) return null
                        return (
                          <OccurrenceCard
                            key={`${occurrence.jobId}-${occurrence.at}`}
                            occurrence={occurrence}
                            job={job}
                            onClick={() => onSelectJob(job)}
                            expanded
                          />
                        )
                      })}
                      {hourEvents.map(event => (
                        <EventChip key={`${event.pluginId}-${event.id}`} event={event} onRescheduled={refresh} />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
