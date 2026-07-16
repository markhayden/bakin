'use client'

import { useMemo } from 'react'
import { Clock } from 'lucide-react'
import { useOccurrences, type ScheduleJob, type ScheduleOccurrence, type ScheduledDomainEvent } from "@makinbakin/sdk/hooks"
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Clock className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{todayFormatted}</span>
        <span className="text-xs text-muted-foreground">
          {hourGrid.total} run{hourGrid.total !== 1 ? 's' : ''} scheduled
        </span>
      </div>

      {/* Timeline */}
      <div className="overflow-auto flex-1 min-h-0 border border-border/30 rounded-lg bg-background/50">
        <div className="divide-y divide-border/[0.06]">
          {CALENDAR_HOURS.map(hour => {
            const hourOccurrences = hourGrid.map[hour] || []
            const hourEvents = eventHourGrid[hour] || []
            const isCurrent = hour === currentHour

            return (
              <div
                key={hour}
                className={`
                  flex gap-4 px-4 py-3 min-h-[56px]
                  ${isCurrent ? 'bg-blue-500/[0.04]' : ''}
                `}
              >
                {/* Time gutter */}
                <div className="w-[60px] shrink-0 pt-0.5">
                  <span className={`text-xs font-mono tabular-nums ${isCurrent ? 'text-blue-400 font-medium' : 'text-zinc-600'}`}>
                    {formatHour(hour)}
                  </span>
                  {isCurrent && (
                    <div className="mt-1 h-[2px] w-full rounded-full bg-blue-500/40" />
                  )}
                </div>

                {/* Occurrence cards */}
                <div className="flex-1 min-w-0">
                  {hourOccurrences.length + hourEvents.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
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
