'use client'

import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from "@bakin/sdk/ui"
import { AgentBadge } from './agent-badge'
import type { ScheduleJob } from "@bakin/sdk/hooks"

// Matching glow colors from the weekly view's AGENT_STYLES
const AGENT_DOT_GLOW: Record<string, string> = {
  main:    'rgba(96,165,250,0.35)',
  chef:   'rgba(74,222,128,0.35)',
  pixel:   'rgba(167,139,250,0.35)',
  rolo:    'rgba(251,146,60,0.35)',
  patch:   'rgba(161,161,170,0.25)',
  explorer:   'rgba(52,211,153,0.35)',
  trainer:    'rgba(34,211,238,0.35)',
  coach:     'rgba(251,191,36,0.35)',
}

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = []
  const d = new Date(year, month, 1)
  while (d.getMonth() === month) {
    days.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return days
}

function getCalendarGrid(year: number, month: number): (Date | null)[] {
  const days = getDaysInMonth(year, month)
  const firstDow = days[0]!.getDay()
  const grid: (Date | null)[] = []
  for (let i = 0; i < firstDow; i++) grid.push(null)
  grid.push(...days)
  while (grid.length % 7 !== 0) grid.push(null)
  return grid
}

function jobFiringOnDay(job: ScheduleJob, date: Date): boolean {
  if (!job.cron) return false
  const parts = job.cron.split(/\s+/)
  if (parts.length < 5) return false
  const [, , domField, monField, dowField] = parts

  if (monField !== '*') {
    const months = expandField(monField!, 1, 12)
    if (!months.includes(date.getMonth() + 1)) return false
  }

  const domMatch = domField === '*'
  const dowMatch = dowField === '*'

  if (!domMatch && !dowMatch) {
    const doms = expandField(domField!, 1, 31)
    const dows = expandField(dowField!, 0, 6)
    if (!doms.includes(date.getDate()) && !dows.includes(date.getDay())) return false
  } else if (!domMatch) {
    const doms = expandField(domField!, 1, 31)
    if (!doms.includes(date.getDate())) return false
  } else if (!dowMatch) {
    const dows = expandField(dowField!, 0, 6)
    if (!dows.includes(date.getDay())) return false
  }

  return true
}

function expandField(field: string, min: number, max: number): number[] {
  const result: number[] = []
  for (const part of field.split(',')) {
    if (part.includes('/')) {
      const [range, step] = part.split('/')
      const s = parseInt(step!, 10)
      const start = range === '*' ? min : parseInt(range!, 10)
      for (let i = start; i <= max; i += s) result.push(i)
    } else if (part.includes('-')) {
      const [a, b] = part.split('-')
      for (let i = parseInt(a!, 10); i <= parseInt(b!, 10); i++) result.push(i)
    } else if (part === '*') {
      for (let i = min; i <= max; i++) result.push(i)
    } else {
      result.push(parseInt(part, 10))
    }
  }
  return result
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

  const jobsByDay = useMemo(() => {
    const map = new Map<number, ScheduleJob[]>()
    const days = getDaysInMonth(year, month)
    for (const day of days) {
      const matches = jobs.filter(j => {
        if (!jobFiringOnDay(j, day)) return false
        // Only show on or after the job's creation date
        if (j.createdAt) {
          const created = new Date(j.createdAt)
          const createdDay = new Date(created.getFullYear(), created.getMonth(), created.getDate())
          if (day < createdDay) return false
        }
        return true
      })
      if (matches.length > 0) map.set(day.getDate(), matches)
    }
    return map
  }, [jobs, year, month])

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

          const dayJobs = jobsByDay.get(date.getDate()) || []
          const hasJobs = dayJobs.length > 0
          const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
          const isPast = date.getTime() < todayStart.getTime()
          const MAX_SHOW = 3

          return (
            <div
              key={date.getDate()}
              className={`
                bg-background min-h-[88px] p-2 transition-colors
                ${isToday(date) ? 'bg-blue-500/[0.04]' : ''}
                ${hasJobs ? 'hover:bg-white/[0.02]' : ''}
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

              {/* Job indicators */}
              <div className={`flex flex-col gap-1 ${isPast ? 'opacity-35 saturate-[0.3]' : ''}`}>
                {dayJobs.slice(0, MAX_SHOW).map(j => (
                  <button
                    key={j.id}
                    onClick={() => onSelectJob(j)}
                    className={`group/dot flex items-center gap-1.5 w-full hover:bg-white/[0.04] rounded px-1 py-0.5 -mx-1 transition-colors ${isPast ? 'hover:opacity-60' : ''}`}
                  >
                    <span
                      className="shrink-0 transition-transform group-hover/dot:scale-110"
                      style={{ filter: isPast ? 'none' : `drop-shadow(0 0 3px ${AGENT_DOT_GLOW[j.agentId || ''] || 'transparent'})` }}
                    >
                      <AgentBadge agentId={j.agentId} size="sm" showName={false} />
                    </span>
                    <span className={`text-[10px] truncate transition-colors ${isPast ? 'text-zinc-600' : 'text-zinc-400 group-hover/dot:text-zinc-300'}`}>
                      {j.displayName || j.id}
                    </span>
                  </button>
                ))}
                {dayJobs.length > MAX_SHOW && (
                  <span className="text-[9px] text-zinc-600 pl-1 font-medium">
                    +{dayJobs.length - MAX_SHOW} more
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
