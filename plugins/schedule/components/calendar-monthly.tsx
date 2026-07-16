'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from "@makinbakin/sdk/ui"
import { useOccurrences, type ScheduleJob, type ScheduleOccurrence } from "@makinbakin/sdk/hooks"
import { AgentBadge } from './agent-badge'
import { agentDotGlow } from './agent-colors'
import { jobsById } from './calendar-weekly'

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

  // Server-computed placements (kind-aware, tz/DST-correct).
  const { occurrences } = useOccurrences(monthStart.toISOString(), monthEnd.toISOString())
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
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Navigation */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={prev}><ChevronLeft className="size-4" /></Button>
        <span className="text-sm font-medium w-[160px] text-center">{MONTH_LABELS[month]} {year}</span>
        <Button variant="ghost" size="sm" onClick={next}><ChevronRight className="size-4" /></Button>
        <Button variant="ghost" size="sm" className="text-xs ml-2" onClick={goToday}>Today</Button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-px rounded-lg overflow-auto flex-1 min-h-0 border border-border/20 bg-border/10">
        {/* Headers */}
        {DOW_LABELS.map(d => (
          <div key={d} className="bg-muted/20 text-center text-[9px] text-zinc-500 uppercase tracking-widest py-2 font-medium">
            {d}
          </div>
        ))}

        {/* Day cells */}
        {grid.map((date, i) => {
          if (!date) {
            return <div key={`empty-${i}`} className="bg-background/30 min-h-[88px]" />
          }

          const dayOccurrences = occurrencesByDay.get(date.getDate()) || []
          const hasRuns = dayOccurrences.length > 0
          const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
          const isPast = date.getTime() < todayStart.getTime()
          const MAX_SHOW = 3

          return (
            <div
              key={date.getDate()}
              className={`
                bg-background min-h-[88px] p-2 transition-colors
                ${isToday(date) ? 'bg-blue-500/[0.04]' : ''}
                ${hasRuns ? 'hover:bg-white/[0.02]' : ''}
              `}
            >
              {/* Date number */}
              <div className={`
                text-[11px] mb-1.5 w-6 h-6 flex items-center justify-center rounded-full -ml-0.5
                ${isToday(date)
                  ? 'bg-blue-500 text-white font-semibold'
                  : 'text-zinc-500'
                }
              `}>
                {date.getDate()}
              </div>

              {/* Run indicators */}
              <div className={`flex flex-col gap-1 ${isPast ? 'opacity-35 saturate-[0.3]' : ''}`}>
                {dayOccurrences.slice(0, MAX_SHOW).map(occurrence => {
                  const job = byId.get(occurrence.jobId)
                  if (!job) return null
                  return (
                    <button
                      key={occurrence.jobId}
                      onClick={() => onSelectJob(job)}
                      className={`group/dot flex items-center gap-1.5 w-full hover:bg-white/[0.04] rounded px-1 py-0.5 -mx-1 transition-colors ${isPast ? 'hover:opacity-60' : ''}`}
                    >
                      <span
                        className="shrink-0 transition-transform group-hover/dot:scale-110"
                        style={{ filter: isPast ? 'none' : `drop-shadow(0 0 3px ${agentDotGlow(job.agentId)})` }}
                      >
                        <AgentBadge agentId={job.agentId} size="sm" showName={false} />
                      </span>
                      <span className={`text-[10px] truncate transition-colors ${isPast ? 'text-zinc-600' : 'text-zinc-400 group-hover/dot:text-zinc-300'}`}>
                        {job.displayName || job.id}
                      </span>
                    </button>
                  )
                })}
                {dayOccurrences.length > MAX_SHOW && (
                  <span className="text-[9px] text-zinc-600 pl-1 font-medium">
                    +{dayOccurrences.length - MAX_SHOW} more
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
