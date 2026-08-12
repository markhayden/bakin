'use client'

import { useMemo, useState } from 'react'
import { CalendarGrid, CalendarItem, CalendarNav } from '@makinbakin/sdk/patterns'
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
      <CalendarNav
        navLabel="Month navigation"
        previousLabel="Previous month"
        nextLabel="Next month"
        onPrevious={prev}
        onNext={next}
        onToday={goToday}
        label={<>{MONTH_LABELS[month]} {year}</>}
      />

      <CalendarGrid
        view="month"
        date={monthStart}
        label={`${MONTH_LABELS[month]} ${year} schedule`}
        items={items}
        dimPastDays
        className="min-h-0 flex-1"
        renderItem={(item) => item.kind === 'occurrence' ? (
          <CalendarItem
            title={item.job.displayName || item.job.id}
            leading={<AgentBadge agentId={item.job.agentId} size="sm" showName={false} />}
            onClick={() => onSelectJob(item.job)}
          />
        ) : (
          <EventChip event={item.event} compact onRescheduled={refresh} />
        )}
      />
    </div>
  )
}
