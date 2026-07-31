'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@makinbakin/sdk/ui'
import { CalendarGrid } from '@makinbakin/sdk/patterns'
import { useOccurrences, type ScheduleJob, type ScheduleOccurrence, type ScheduledDomainEvent } from '@makinbakin/sdk/hooks'
import { AgentBadge } from './agent-badge'
import { RecurringDaySummary, type RecurringDaySummaryTone } from './recurring-day-summary'
import { EventChip, eventInstant } from './event-popover'

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
        flex w-full min-w-0 items-start gap-x-bakin-2
        ${expanded ? 'px-bakin-3 py-bakin-2' : 'px-bakin-2 py-bakin-2'}
      `}>
        <span className="self-start">
          <AgentBadge agentId={job.agentId} size="md" showName={false} />
        </span>
        <span className={`flex min-w-0 flex-1 flex-col ${expanded ? 'gap-y-bakin-1' : ''}`}>
          <span className="flex min-w-0 items-start gap-x-bakin-2">
            <span className={`min-w-0 flex-1 truncate font-bakin-typography-weight-medium leading-tight ${
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
          </span>

          {description && (
            <span className={`min-w-0 leading-tight text-bakin-text-muted ${
              expanded
                ? 'line-clamp-3 text-bakin-typography-size-meta'
                : 'line-clamp-1 text-bakin-typography-size-meta'
            }`}>
              {description}
            </span>
          )}

          {expanded && job.humanSchedule && (
            <span className="mt-bakin-1 block font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
              {job.humanSchedule}
            </span>
          )}
        </span>
      </span>
    </Button>
  )
}

/** Occurrence or domain event flattened into the shared CalendarGrid item shape. */
type WeekCalendarItem =
  | { kind: 'occurrence'; key: string; date: string; occurrence: ScheduleOccurrence; job: ScheduleJob }
  | { kind: 'event'; key: string; date: string; event: ScheduledDomainEvent }

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

  // Occurrences (minus collapsed recurring series) and domain events flow
  // into the shared CalendarGrid; the kit owns hour-by-day placement.
  const items = useMemo<WeekCalendarItem[]>(() => {
    const list: WeekCalendarItem[] = []
    for (const occurrence of visibleOccurrences) {
      if (collapsedOccurrenceKeys.has(occurrenceKey(occurrence))) continue
      const job = byId.get(occurrence.jobId)
      if (!job) continue
      list.push({
        kind: 'occurrence',
        key: `occurrence-${occurrenceKey(occurrence)}`,
        date: occurrence.at,
        occurrence,
        job,
      })
    }
    for (const event of visibleEvents) {
      list.push({
        kind: 'event',
        key: `event-${event.pluginId}-${event.id}`,
        date: eventInstant(event),
        event,
      })
    }
    return list
  }, [byId, collapsedOccurrenceKeys, visibleEvents, visibleOccurrences])

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

      <CalendarGrid
        view="week"
        date={weekStart}
        label="Weekly schedule"
        items={items}
        className="min-h-0 flex-1"
        renderDayHeader={(day) => {
          const summaries = recurringByDay[localDayKey(day)]
          if (!summaries?.length) return null
          return (
            <span className="mt-bakin-2 grid gap-bakin-1 text-left normal-case tracking-normal">
              {summaries.map(summary => (
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
          )
        }}
        renderItem={(item) => item.kind === 'occurrence' ? (
          <OccurrenceCard
            occurrence={item.occurrence}
            job={item.job}
            onClick={() => onSelectJob(item.job)}
          />
        ) : (
          <EventChip event={item.event} compact onRescheduled={refresh} />
        )}
      />
    </div>
  )
}
