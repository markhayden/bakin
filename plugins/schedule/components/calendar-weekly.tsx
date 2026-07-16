'use client'

import { Fragment, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from "@makinbakin/sdk/ui"
import { useOccurrences, type ScheduleJob, type ScheduleOccurrence, type ScheduledDomainEvent } from "@makinbakin/sdk/hooks"
import { AgentBadge } from './agent-badge'
import { agentStyle } from './agent-colors'
import { EventChip, eventInstant } from './event-popover'

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

/** Fired/skipped marker for past occurrences (ledger disposition). */
function DispositionDot({ occurrence }: { occurrence: ScheduleOccurrence }) {
  if (!occurrence.past || !occurrence.disposition) return null
  const created = occurrence.disposition === 'created'
  return (
    <span
      title={created ? 'Fired' : `Skipped${occurrence.skipReason ? ` — ${occurrence.skipReason}` : ''}`}
      className={`size-1.5 rounded-full shrink-0 ${created ? 'bg-emerald-400' : 'bg-amber-400'}`}
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
  const s = agentStyle(job.agentId)
  const time = formatInstantTime(occurrence.at)
  const past = occurrence.past

  return (
    <button
      onClick={onClick}
      className={`
        group/card relative w-full text-left rounded-md mb-1
        border ${s.border} ${s.bg}
        transition-all duration-200
        ${past
          ? 'opacity-35 saturate-[0.3] hover:opacity-50'
          : 'hover:scale-[1.02] hover:brightness-125'
        }
      `}
      style={{ boxShadow: past ? 'none' : `0 1px 6px -1px ${s.glow}` }}
    >
      <div className={expanded ? 'px-3 py-2.5' : 'px-2 py-1.5'}>
        {/* Row 1: avatar + name + disposition + time pill */}
        <div className="flex items-center gap-1.5 min-w-0">
          <AgentBadge agentId={job.agentId} size="sm" showName={expanded} />
          <span className={`font-medium truncate flex-1 leading-tight ${expanded ? 'text-sm' : 'text-[11px]'} ${past ? 'text-zinc-500' : 'text-zinc-200'}`}>
            {job.displayName || job.id}
          </span>
          <DispositionDot occurrence={occurrence} />
          <span className={`font-mono ${past ? 'text-zinc-600' : s.accent} opacity-70 shrink-0 tabular-nums ${expanded ? 'text-xs' : 'text-[9px]'}`}>
            {time}
          </span>
        </div>

        {/* Row 2: prompt snippet */}
        {job.taskPrompt && (
          <p className={`leading-snug mt-1 ${past ? 'text-zinc-600' : 'text-zinc-500'} ${expanded ? 'text-xs pl-0 line-clamp-3' : 'text-[10px] pl-[26px] line-clamp-5'}`}>
            {job.taskPrompt}
          </p>
        )}

        {/* Row 3: schedule (expanded only) */}
        {expanded && job.humanSchedule && (
          <p className={`text-[10px] ${past ? 'text-zinc-600' : s.accent} opacity-50 mt-1.5 font-mono`}>
            {job.humanSchedule}
          </p>
        )}
      </div>
    </button>
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

  const prev = () => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })
  const next = () => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })
  const goToday = () => setWeekStart(getWeekStart(now))

  const isToday = (d: Date) =>
    d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()

  // Grid: [localDow-localHour] → occurrences (instants land in browser-local cells)
  const grid = useMemo(() => {
    const map: Record<string, ScheduleOccurrence[]> = {}
    for (const occurrence of occurrences) {
      const d = new Date(occurrence.at)
      const key = `${d.getDay()}-${d.getHours()}`
      if (!map[key]) map[key] = []
      map[key]!.push(occurrence)
    }
    return map
  }, [occurrences])

  // Domain events land in the same cells, rendered as distinct chips.
  const eventGrid = useMemo(() => {
    const map: Record<string, ScheduledDomainEvent[]> = {}
    for (const event of events) {
      const d = new Date(eventInstant(event))
      const key = `${d.getDay()}-${d.getHours()}`
      if (!map[key]) map[key] = []
      map[key]!.push(event)
    }
    return map
  }, [events])

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Navigation */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={prev}><ChevronLeft className="size-4" /></Button>
        <span className="text-sm font-medium w-[240px] text-center">
          {weekDates[0]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {' — '}
          {weekDates[6]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <Button variant="ghost" size="sm" onClick={next}><ChevronRight className="size-4" /></Button>
        <Button variant="ghost" size="sm" className="text-xs ml-2" onClick={goToday}>Today</Button>
      </div>

      {/* Timeline grid */}
      <div className="overflow-auto flex-1 min-h-0 border border-border/30 rounded-lg bg-background/50">
        <div className="grid" style={{ gridTemplateColumns: '56px repeat(7, 250px)' }}>
          {/* Header row */}
          <div className="bg-muted/20 sticky top-0 z-10 backdrop-blur-sm" />
          {weekDates.map((d, i) => (
            <div
              key={i}
              className={`
                sticky top-0 z-10 backdrop-blur-sm border-l border-border/10
                text-center text-[11px] py-2.5 font-medium tracking-wide
                ${isToday(d)
                  ? 'bg-blue-500/[0.08] text-blue-400'
                  : 'bg-muted/20 text-zinc-500'
                }
              `}
            >
              <span className="uppercase text-[9px] tracking-widest block leading-none mb-0.5 opacity-60">
                {DOW_LABELS[d.getDay()]}
              </span>
              <span className={isToday(d) ? 'text-blue-300' : 'text-zinc-400'}>{d.getDate()}</span>
            </div>
          ))}

          {/* Hour rows */}
          {CALENDAR_HOURS.map(hour => (
            <Fragment key={hour}>
              <div className="text-[10px] text-zinc-600 text-right pr-2.5 py-3 border-t border-border/[0.06] font-mono tabular-nums">
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
                      border-l border-t border-border/[0.06] p-1
                      ${today ? 'bg-blue-500/[0.02]' : ''}
                      ${cellOccurrences.length + cellEvents.length === 0 ? 'hover:bg-white/[0.01]' : ''}
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
