'use client'

import { Fragment, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@makinbakin/sdk/ui'
import { useOccurrences, type ScheduleJob, type ScheduleOccurrence, type ScheduledDomainEvent } from '@makinbakin/sdk/hooks'
import {
  RecurringDaySummary,
  type RecurringDaySummaryTone,
} from '@makinbakin/sdk/patterns'
import { AgentBadge } from './agent-badge'
import { EventChip, eventInstant } from './event-popover'
import './schedule-calendar.css'

export const CALENDAR_HOURS = Array.from({ length: 24 }, (_, i) => i)
const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0, 0, 0, 0)
  return d
}

function getWeekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })
}

export function formatHour(h: number): string {
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}

/** Local wall-clock label of an occurrence instant ("11:05pm"). */
export function formatInstantTime(at: string): string {
  const d = new Date(at)
  const h = d.getHours()
  const m = d.getMinutes()
  const period = h >= 12 ? 'pm' : 'am'
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${display}${period}` : `${display}:${m.toString().padStart(2, '0')}${period}`
}

/** Index jobs by id for occurrence → job lookup. */
export function jobsById(jobs: ScheduleJob[]): Map<string, ScheduleJob> {
  return new Map(jobs.map(job => [job.id, job]))
}

function localDayKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function occurrenceKey(occurrence: ScheduleOccurrence): string {
  return `${occurrence.jobId}-${occurrence.at}`
}

function needsSummaryAttention(occurrence: ScheduleOccurrence): boolean {
  return occurrence.disposition === 'skipped' || occurrence.disposition === 'pending'
}

function recurringSummaryDetail(occurrences: ScheduleOccurrence[]): string {
  const done = occurrences.filter(
    occurrence => occurrence.disposition === 'created' || occurrence.disposition === 'seeded',
  ).length
  const skipped = occurrences.filter(occurrence => occurrence.disposition === 'skipped').length
  const pending = occurrences.filter(occurrence => occurrence.disposition === 'pending').length
  const future = occurrences
    .filter(occurrence => !occurrence.past)
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  if (skipped > 0 || pending > 0) {
    return [
      `${done} done`,
      skipped > 0 ? `${skipped} skipped` : null,
      pending > 0 ? `${pending} pending` : null,
      future.length > 0 ? `${future.length} scheduled` : null,
    ].filter(Boolean).join(' · ')
  }

  if (future.length > 0) return `${done} done · ${future.length} scheduled`
  return `${done} done`
}

interface DailyRecurringSummary {
  job: ScheduleJob
  detail: string
  tone: RecurringDaySummaryTone
}

/** Prefer authored copy; suppress runtime command slugs masquerading as descriptions. */
function calendarDescription(job: ScheduleJob): string | undefined {
  const description = job.description?.trim()
  if (description) return description

  const prompt = job.taskPrompt?.trim()
  if (!prompt) return undefined

  const normalizedPrompt = prompt.replace(/^bakin:schedule:/i, '')
  return normalizedPrompt.toLowerCase() === job.id.toLowerCase() ? undefined : prompt
}

/** Fired/skipped marker for past occurrences (ledger disposition). */
function DispositionDot({ occurrence }: { occurrence: ScheduleOccurrence }) {
  if (!occurrence.past || !occurrence.disposition) return null
  const created = occurrence.disposition === 'created'
  return (
    <span
      title={created ? 'Fired' : `Skipped${occurrence.skipReason ? ` — ${occurrence.skipReason}` : ''}`}
      className={`size-bakin-2 shrink-0 rounded-bakin-pill ${
        created ? 'bg-bakin-action-primary-background' : 'bg-bakin-signal-highlight'
      }`}
    />
  )
}

/** A single occurrence card — used in the weekly grid and today timeline. */
export function OccurrenceCard({
  occurrence,
  job,
  onClick,
  expanded,
}: {
  occurrence: ScheduleOccurrence
  job: ScheduleJob
  onClick: () => void
  expanded?: boolean
}) {
  const time = formatInstantTime(occurrence.at)
  const past = occurrence.past
  const description = calendarDescription(job)

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onClick}
      className={`
        group/card mb-bakin-1 !h-auto min-h-bakin-8 w-full min-w-0 justify-start overflow-hidden whitespace-normal
        rounded-bakin-control border-bakin-border-subtle bg-bakin-canvas-default !p-0 text-left
        hover:bg-bakin-surface-default
        ${past ? 'opacity-50 hover:opacity-70' : ''}
      `}
    >
      <span className={`
        grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-bakin-2
        ${expanded ? 'gap-y-bakin-1 px-bakin-3 py-bakin-2' : 'px-bakin-2 py-bakin-2'}
      `}>
        <span className={description ? 'row-span-2 self-start' : 'self-start'}>
          <AgentBadge agentId={job.agentId} size="md" showName={false} />
        </span>
        <span className={`min-w-0 truncate font-bakin-typography-weight-medium leading-tight ${
          expanded
            ? 'text-bakin-typography-size-body'
            : 'text-bakin-typography-size-meta'
        } ${past ? 'text-bakin-text-muted' : 'text-bakin-text-primary'}`}>
          {job.displayName || job.id}
        </span>
        <span className="flex shrink-0 items-center justify-end gap-bakin-1 text-right">
          <DispositionDot occurrence={occurrence} />
          <span className="text-right font-bakin-typography-family-mono text-bakin-typography-size-meta tabular-nums text-bakin-text-muted">
            {time}
          </span>
        </span>

        {description && (
          <span className={`col-start-2 col-end-4 min-w-0 leading-tight text-bakin-text-muted ${
            expanded
              ? 'line-clamp-3 text-bakin-typography-size-meta'
              : 'line-clamp-1 text-bakin-typography-size-meta'
          }`}>
            {description}
          </span>
        )}

        {expanded && job.humanSchedule && (
          <span className="col-start-2 col-end-4 mt-bakin-1 block font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
            {job.humanSchedule}
          </span>
        )}
      </span>
    </Button>
  )
}

export function CalendarWeekly({
  jobs,
  onSelectJob,
}: {
  jobs: ScheduleJob[]
  onSelectJob: (job: ScheduleJob) => void
}) {
  const now = new Date()
  const [weekStart, setWeekStart] = useState(() => getWeekStart(now))
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart])
  const weekEnd = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 7)
    return d
  }, [weekStart])

  // Server-computed placements — the one occurrence engine (kind-aware,
  // tz/DST-correct) plus plugin-contributed domain events (#191).
  const { occurrences, events, refresh } = useOccurrences(weekStart.toISOString(), weekEnd.toISOString())
  const byId = useMemo(() => jobsById(jobs), [jobs])
  const visibleOccurrences = useMemo(() => {
    const from = weekStart.getTime()
    const to = weekEnd.getTime()
    return occurrences.filter((occurrence) => {
      const instant = new Date(occurrence.at).getTime()
      return instant >= from && instant < to
    })
  }, [occurrences, weekEnd, weekStart])
  const visibleEvents = useMemo(() => {
    const from = weekStart.getTime()
    const to = weekEnd.getTime()
    return events.filter((event) => {
      const instant = new Date(eventInstant(event)).getTime()
      return instant >= from && instant < to
    })
  }, [events, weekEnd, weekStart])

  const { recurringByDay, collapsedOccurrenceKeys } = useMemo(() => {
    const grouped = new Map<string, ScheduleOccurrence[]>()

    for (const occurrence of visibleOccurrences) {
      const key = `${localDayKey(occurrence.at)}::${occurrence.jobId}`
      const group = grouped.get(key) ?? []
      group.push(occurrence)
      grouped.set(key, group)
    }

    const summaries: Record<string, DailyRecurringSummary[]> = {}
    const collapsed = new Set<string>()

    for (const group of grouped.values()) {
      if (group.length < 2) continue

      const job = byId.get(group[0]!.jobId)
      if (!job) continue

      const day = localDayKey(group[0]!.at)
      const summary: DailyRecurringSummary = {
        job,
        detail: recurringSummaryDetail(group),
        tone: group.some(needsSummaryAttention) ? 'attention' : 'neutral',
      }

      if (!summaries[day]) summaries[day] = []
      summaries[day]!.push(summary)

      for (const occurrence of group) {
        collapsed.add(occurrenceKey(occurrence))
      }
    }

    for (const day of Object.keys(summaries)) {
      summaries[day]!.sort((a, b) =>
        (a.job.displayName || a.job.id).localeCompare(b.job.displayName || b.job.id))
    }

    return {
      recurringByDay: summaries,
      collapsedOccurrenceKeys: collapsed,
    }
  }, [byId, visibleOccurrences])

  const prev = () => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })
  const next = () => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })
  const goToday = () => setWeekStart(getWeekStart(now))

  const isToday = (d: Date) =>
    d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()

  // Grid: [localDow-localHour] → occurrences (instants land in browser-local cells)
  const grid = useMemo(() => {
    const map: Record<string, ScheduleOccurrence[]> = {}
    for (const occurrence of visibleOccurrences) {
      if (collapsedOccurrenceKeys.has(occurrenceKey(occurrence))) continue
      const d = new Date(occurrence.at)
      const key = `${d.getDay()}-${d.getHours()}`
      if (!map[key]) map[key] = []
      map[key]!.push(occurrence)
    }
    return map
  }, [collapsedOccurrenceKeys, visibleOccurrences])

  // Domain events land in the same cells, rendered as distinct chips.
  const eventGrid = useMemo(() => {
    const map: Record<string, ScheduledDomainEvent[]> = {}
    for (const event of visibleEvents) {
      const d = new Date(eventInstant(event))
      const key = `${d.getDay()}-${d.getHours()}`
      if (!map[key]) map[key] = []
      map[key]!.push(event)
    }
    return map
  }, [visibleEvents])

  return (
    <div className="flex h-full min-h-0 flex-col gap-bakin-3">
      <div className="flex items-center gap-bakin-2">
        <Button variant="ghost" size="icon-sm" onClick={prev} aria-label="Previous week">
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span className="w-60 text-center text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary">
          {weekDates[0]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {' — '}
          {weekDates[6]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <Button variant="ghost" size="icon-sm" onClick={next} aria-label="Next week">
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button variant="outline" size="xs" className="ml-bakin-2" onClick={goToday}>Today</Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-bakin-surface border border-bakin-border-subtle bg-bakin-canvas-default">
        <div className="grid" data-schedule-week-grid>
          <div className="sticky top-0 z-10 bg-bakin-surface-default" />
          {weekDates.map((d, i) => (
            <div
              key={i}
              className={`
                sticky top-0 z-10 border-l border-bakin-border-subtle bg-bakin-surface-default
                px-bakin-1 py-bakin-2 text-center font-bakin-typography-weight-medium tracking-wide
                ${isToday(d)
                  ? 'text-bakin-signal-accent'
                  : 'text-bakin-text-muted'
                }
              `}
            >
              <span className="mb-bakin-1 block text-bakin-typography-size-meta uppercase leading-none tracking-widest">
                {DOW_LABELS[d.getDay()]}
              </span>
              <span className={isToday(d) ? 'text-bakin-signal-accent' : 'text-bakin-text-primary'}>{d.getDate()}</span>
              {recurringByDay[localDayKey(d)]?.length ? (
                <span className="mt-bakin-2 grid gap-bakin-1 text-left normal-case tracking-normal">
                  {recurringByDay[localDayKey(d)]!.map(summary => (
                    <RecurringDaySummary
                      key={summary.job.id}
                      title={summary.job.displayName || summary.job.id}
                      detail={summary.detail}
                      tone={summary.tone}
                      leading={<AgentBadge agentId={summary.job.agentId} size="md" showName={false} />}
                      onClick={() => onSelectJob(summary.job)}
                    />
                  ))}
                </span>
              ) : null}
            </div>
          ))}

          {CALENDAR_HOURS.map(hour => (
            <Fragment key={hour}>
              <div className="border-t border-bakin-border-subtle pr-bakin-2 pt-bakin-3 text-right font-bakin-typography-family-mono text-bakin-typography-size-meta tabular-nums text-bakin-text-muted">
                {formatHour(hour)}
              </div>
              {Array.from({ length: 7 }, (_, dow) => {
                const cellOccurrences = grid[`${dow}-${hour}`] || []
                const cellEvents = eventGrid[`${dow}-${hour}`] || []
                const today = isToday(weekDates[dow]!)
                return (
                  <div
                    key={`${dow}-${hour}`}
                    className={`
                      min-h-bakin-12 border-l border-t border-bakin-border-subtle p-bakin-1
                      ${today ? 'bg-bakin-signal-accent/5' : ''}
                      ${cellOccurrences.length + cellEvents.length === 0 ? 'hover:bg-bakin-surface-default' : ''}
                    `}
                  >
                    {cellOccurrences.map(occurrence => {
                      const job = byId.get(occurrence.jobId)
                      if (!job) return null
                      return (
                        <OccurrenceCard
                          key={`${occurrence.jobId}-${occurrence.at}`}
                          occurrence={occurrence}
                          job={job}
                          onClick={() => onSelectJob(job)}
                        />
                      )
                    })}
                    {cellEvents.map(event => (
                      <EventChip key={`${event.pluginId}-${event.id}`} event={event} compact onRescheduled={refresh} />
                    ))}
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}
