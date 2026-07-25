'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@makinbakin/sdk/ui'
import { useOccurrences, type ScheduleJob, type ScheduleOccurrence, type ScheduledDomainEvent } from '@makinbakin/sdk/hooks'
import { AgentBadge } from './agent-badge'
import { jobsById } from './calendar-weekly'
import { EventChip, eventInstant } from './event-popover'

function getCalendarGrid(year: number, month: number): (Date | null)[] {
  const days: Date[] = []
  const d = new Date(year, month, 1)
  while (d.getMonth() === month) {
    days.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  const firstDow = days[0]!.getDay()
  const grid: (Date | null)[] = []
  for (let i = 0; i < firstDow; i++) grid.push(null)
  grid.push(...days)
  while (grid.length % 7 !== 0) grid.push(null)
  return grid
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

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

  const grid = useMemo(() => getCalendarGrid(year, month), [year, month])
  const monthStart = useMemo(() => new Date(year, month, 1), [year, month])
  const monthEnd = useMemo(() => new Date(year, month + 1, 1), [year, month])

  // Server-computed placements (kind-aware, tz/DST-correct) + domain events.
  const { occurrences, events, refresh } = useOccurrences(monthStart.toISOString(), monthEnd.toISOString())
  const byId = useMemo(() => jobsById(jobs), [jobs])

  // Day-of-month → the day's occurrences (local dates; dedupe a job that
  // fires multiple times a day down to one row at month zoom).
  const occurrencesByDay = useMemo(() => {
    const map = new Map<number, ScheduleOccurrence[]>()
    for (const occurrence of occurrences) {
      const d = new Date(occurrence.at)
      if (d.getMonth() !== month || d.getFullYear() !== year) continue
      const day = d.getDate()
      const existing = map.get(day) ?? []
      if (!existing.some(o => o.jobId === occurrence.jobId)) existing.push(occurrence)
      map.set(day, existing)
    }
    return map
  }, [occurrences, month, year])

  const eventsByDay = useMemo(() => {
    const map = new Map<number, ScheduledDomainEvent[]>()
    for (const event of events) {
      const d = new Date(eventInstant(event))
      if (d.getMonth() !== month || d.getFullYear() !== year) continue
      const day = d.getDate()
      map.set(day, [...(map.get(day) ?? []), event])
    }
    return map
  }, [events, month, year])

  const today = new Date()
  const isToday = (d: Date) =>
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()

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

      <div className="grid min-h-0 flex-1 grid-cols-7 gap-px overflow-auto rounded-bakin-surface border border-bakin-border-subtle bg-bakin-border-subtle">
        {DOW_LABELS.map(d => (
          <div key={d} className="bg-bakin-surface-default py-bakin-2 text-center text-bakin-typography-size-meta font-bakin-typography-weight-medium uppercase tracking-widest text-bakin-text-muted">
            {d}
          </div>
        ))}

        {grid.map((date, i) => {
          if (!date) {
            return <div key={`empty-${i}`} className="min-h-24 bg-bakin-canvas-default/60" />
          }

          const dayOccurrences = occurrencesByDay.get(date.getDate()) || []
          const dayEvents = eventsByDay.get(date.getDate()) || []
          const hasRuns = dayOccurrences.length + dayEvents.length > 0
          const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
          const isPast = date.getTime() < todayStart.getTime()
          const MAX_SHOW = 3

          return (
            <div
              key={date.getDate()}
              className={`
                min-h-24 bg-bakin-canvas-default p-bakin-2 transition-colors
                ${isToday(date) ? 'bg-bakin-signal-accent/5' : ''}
                ${hasRuns ? 'hover:bg-bakin-surface-default' : ''}
              `}
            >
              <div className={`
                mb-bakin-2 flex size-bakin-6 items-center justify-center rounded-bakin-pill
                text-bakin-typography-size-meta
                ${isToday(date)
                  ? 'bg-bakin-signal-accent font-bakin-typography-weight-semibold text-bakin-canvas-default'
                  : 'text-bakin-text-muted'
                }
              `}>
                {date.getDate()}
              </div>

              <div className={`flex flex-col gap-bakin-1 ${isPast ? 'opacity-50' : ''}`}>
                {dayOccurrences.slice(0, MAX_SHOW).map(occurrence => {
                  const job = byId.get(occurrence.jobId)
                  if (!job) return null
                  return (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      key={occurrence.jobId}
                      onClick={() => onSelectJob(job)}
                      className="h-auto min-h-bakin-6 w-full min-w-0 justify-start gap-bakin-2 px-bakin-1"
                    >
                      <span className="shrink-0">
                        <AgentBadge agentId={job.agentId} size="sm" showName={false} />
                      </span>
                      <span className="min-w-0 truncate text-bakin-typography-size-meta text-bakin-text-muted">
                        {job.displayName || job.id}
                      </span>
                    </Button>
                  )
                })}
                {dayOccurrences.length > MAX_SHOW && (
                  <span className="pl-bakin-1 text-bakin-typography-size-meta font-bakin-typography-weight-medium text-bakin-text-muted">
                    +{dayOccurrences.length - MAX_SHOW} more
                  </span>
                )}
                {dayEvents.map(event => (
                  <EventChip key={`${event.pluginId}-${event.id}`} event={event} compact onRescheduled={refresh} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
