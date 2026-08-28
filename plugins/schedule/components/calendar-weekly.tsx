'use client'

import { useMemo, useState } from 'react'
import { CalendarGrid, CalendarItem, CalendarNav, StatusMarker } from '@makinbakin/sdk/patterns'
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
    <StatusMarker
      tone={created ? 'success' : 'attention'}
      label={created ? 'Fired' : `Skipped${occurrence.skipReason ? ` — ${occurrence.skipReason}` : ''}`}
    />
  )
}

/**
 * A single occurrence entry — used in the weekly grid and today timeline.
 * Both surfaces are hour-gridded, so the entry carries no time label — the
 * row it sits in already says when.
 */
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
  return (
    <CalendarItem
      density={expanded ? 'expanded' : 'compact'}
      past={occurrence.past}
      title={job.displayName || job.id}
      detail={calendarDescription(job)}
      meta={expanded ? job.humanSchedule : undefined}
      leading={<AgentBadge agentId={job.agentId} size="md" showName={false} />}
      marker={<DispositionDot occurrence={occurrence} />}
      onClick={onClick}
    />
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
    <div className="flex min-w-0 flex-col gap-bakin-3">
      {/* The nav insets itself; the grid below is full-bleed — its page-mode
          scroll region owns the canonical insets internally. */}
      <div className="px-bakin-4 @md/page-shell:px-bakin-6">
        <CalendarNav
          navLabel="Week navigation"
          previousLabel="Previous week"
          nextLabel="Next week"
          onPrevious={prev}
          onNext={next}
          onToday={goToday}
          label={(
            <>
              {weekDates[0]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              {' — '}
              {weekDates[6]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </>
          )}
        />
      </div>

      <CalendarGrid
        view="week"
        date={weekStart}
        label="Weekly schedule"
        items={items}
        scroll="page"
        renderDayHeader={(day) => {
          const summaries = recurringByDay[localDayKey(day)]
          if (!summaries?.length) return null
          return (
            <span className="mt-bakin-2 grid gap-bakin-1">
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
