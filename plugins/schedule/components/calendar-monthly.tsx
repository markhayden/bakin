'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@makinbakin/sdk/ui'
import { CalendarGrid } from '@makinbakin/sdk/patterns'
import { useOccurrences, type ScheduleJob, type ScheduleOccurrence, type ScheduledDomainEvent } from '@makinbakin/sdk/hooks'
import { AgentBadge } from './agent-badge'
import { jobsById } from './calendar-weekly'
import { EventChip, eventInstant } from './event-popover'

const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Occurrence or domain event flattened into the shared CalendarGrid item shape. */
type MonthCalendarItem =
  | { kind: 'occurrence'; key: string; date: string; occurrence: ScheduleOccurrence; job: ScheduleJob }
  | { kind: 'event'; key: string; date: string; event: ScheduledDomainEvent }

export function CalendarMonthly({
  jobs,
  onSelectJob,
}: {
  jobs: ScheduleJob[]
  onSelectJob: (job: ScheduleJob) => void
}) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())

  const monthStart = useMemo(() => new Date(year, month, 1), [year, month])
  const monthEnd = useMemo(() => new Date(year, month + 1, 1), [year, month])

  // Server-computed placements (kind-aware, tz/DST-correct) + domain events.
  const { occurrences, events, refresh } = useOccurrences(monthStart.toISOString(), monthEnd.toISOString())
  const byId = useMemo(() => jobsById(jobs), [jobs])

  // At month zoom a job that fires multiple times a day collapses to one row;
  // the shared CalendarGrid owns day placement and the overflow disclosure.
  const items = useMemo<MonthCalendarItem[]>(() => {
    const list: MonthCalendarItem[] = []
    const seen = new Set<string>()
    for (const occurrence of occurrences) {
      const d = new Date(occurrence.at)
      if (d.getMonth() !== month || d.getFullYear() !== year) continue
      const dayJobKey = `${d.getDate()}:${occurrence.jobId}`
      if (seen.has(dayJobKey)) continue
      seen.add(dayJobKey)
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
  }, [byId, events, month, occurrences, year])

  const prev = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const next = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }
  const goToday = () => { setYear(now.getFullYear()); setMonth(now.getMonth()) }

  return (
    <div className="flex h-full min-h-0 flex-col gap-bakin-3">
      <div className="flex items-center gap-bakin-2">
        <Button variant="ghost" size="icon-sm" onClick={prev} aria-label="Previous month">
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span className="w-40 text-center font-bakin-typography-weight-medium text-bakin-text-primary">
          {MONTH_LABELS[month]} {year}
        </span>
        <Button variant="ghost" size="icon-sm" onClick={next} aria-label="Next month">
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button variant="outline" size="xs" className="ml-bakin-2" onClick={goToday}>Today</Button>
      </div>

      <CalendarGrid
        view="month"
        date={monthStart}
        label={`${MONTH_LABELS[month]} ${year} schedule`}
        items={items}
        className="min-h-0 flex-1"
        renderItem={(item) => item.kind === 'occurrence' ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => onSelectJob(item.job)}
            className="h-auto min-h-bakin-6 w-full min-w-0 justify-start gap-bakin-2 px-bakin-1"
          >
            <span className="shrink-0">
              <AgentBadge agentId={item.job.agentId} size="sm" showName={false} />
            </span>
            <span className="min-w-0 truncate text-bakin-typography-size-meta text-bakin-text-muted">
              {item.job.displayName || item.job.id}
            </span>
          </Button>
        ) : (
          <EventChip event={item.event} compact onRescheduled={refresh} />
        )}
      />
    </div>
  )
}
