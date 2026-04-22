'use client'

import { Fragment, useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from "@bakin/sdk/ui"
import { AgentBadge } from './agent-badge'
import type { ScheduleJob } from "@bakin/sdk/hooks"

// Agent-keyed style tokens — each entry is a self-contained visual identity
// Uses inline style objects for gradient backgrounds (Tailwind can't do arbitrary gradients)
export const AGENT_STYLES: Record<string, {
  border: string
  bg: string         // Tailwind bg for the card surface
  glow: string       // box-shadow color token (rgba)
  accent: string     // text color for the time pill
  dot: string        // status dot color
  gradient: string   // CSS gradient for the top accent bar
}> = {
  main:    { border: 'border-blue-500/30',    bg: 'bg-blue-500/[0.06]',    glow: 'rgba(96,165,250,0.10)',  accent: 'text-blue-400',    dot: 'bg-blue-400',    gradient: 'linear-gradient(135deg, rgba(96,165,250,0.4), rgba(96,165,250,0.08))' },
  chef:   { border: 'border-green-500/30',   bg: 'bg-green-500/[0.06]',   glow: 'rgba(74,222,128,0.10)',  accent: 'text-green-400',   dot: 'bg-green-400',   gradient: 'linear-gradient(135deg, rgba(74,222,128,0.4), rgba(74,222,128,0.08))' },
  pixel:   { border: 'border-violet-500/30',  bg: 'bg-violet-500/[0.06]',  glow: 'rgba(167,139,250,0.10)', accent: 'text-violet-400',  dot: 'bg-violet-400',  gradient: 'linear-gradient(135deg, rgba(167,139,250,0.4), rgba(167,139,250,0.08))' },
  rolo:    { border: 'border-orange-500/30',  bg: 'bg-orange-500/[0.06]',  glow: 'rgba(251,146,60,0.10)',  accent: 'text-orange-400',  dot: 'bg-orange-400',  gradient: 'linear-gradient(135deg, rgba(251,146,60,0.4), rgba(251,146,60,0.08))' },
  patch:   { border: 'border-zinc-500/30',    bg: 'bg-zinc-500/[0.06]',    glow: 'rgba(161,161,170,0.10)', accent: 'text-zinc-400',    dot: 'bg-zinc-400',    gradient: 'linear-gradient(135deg, rgba(161,161,170,0.4), rgba(161,161,170,0.08))' },
  explorer:   { border: 'border-emerald-500/30', bg: 'bg-emerald-500/[0.06]', glow: 'rgba(52,211,153,0.10)',  accent: 'text-emerald-400', dot: 'bg-emerald-400', gradient: 'linear-gradient(135deg, rgba(52,211,153,0.4), rgba(52,211,153,0.08))' },
  trainer:    { border: 'border-cyan-500/30',    bg: 'bg-cyan-500/[0.06]',    glow: 'rgba(34,211,238,0.10)',  accent: 'text-cyan-400',    dot: 'bg-cyan-400',    gradient: 'linear-gradient(135deg, rgba(34,211,238,0.4), rgba(34,211,238,0.08))' },
  coach:     { border: 'border-amber-500/30',   bg: 'bg-amber-500/[0.06]',   glow: 'rgba(251,191,36,0.10)',  accent: 'text-amber-400',   dot: 'bg-amber-400',   gradient: 'linear-gradient(135deg, rgba(251,191,36,0.4), rgba(251,191,36,0.08))' },
}

export const FALLBACK_STYLE = AGENT_STYLES.patch!

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6) // 6am–10pm
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

export function getJobHour(job: ScheduleJob): number | null {
  if (!job.cron) return null
  const parts = job.cron.split(/\s+/)
  if (parts.length < 5) return null
  const hourField = parts[1]
  if (!hourField || hourField === '*') return 9
  const h = parseInt(hourField, 10)
  return isNaN(h) ? null : h
}

export function getJobMinute(job: ScheduleJob): number {
  if (!job.cron) return 0
  const parts = job.cron.split(/\s+/)
  if (parts.length < 5) return 0
  const minField = parts[0]
  if (!minField || minField === '*' || minField.includes('/')) return 0
  const m = parseInt(minField, 10)
  return isNaN(m) ? 0 : m
}

export function formatJobTime(job: ScheduleJob): string {
  const h = getJobHour(job)
  if (h === null) return ''
  const m = getJobMinute(job)
  const period = h >= 12 ? 'pm' : 'am'
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${display}${period}` : `${display}:${m.toString().padStart(2, '0')}${period}`
}

export function jobOnDow(job: ScheduleJob, dow: number): boolean {
  if (!job.cron) return false
  const parts = job.cron.split(/\s+/)
  if (parts.length < 5) return false
  const dowField = parts[4]
  const domField = parts[2]
  if (!dowField || !domField) return false
  if (dowField === '*' && domField === '*') return true
  if (dowField === '*') return true

  const dows = expandDow(dowField)
  return dows.includes(dow)
}

function expandDow(field: string): number[] {
  const result: number[] = []
  for (const part of field.split(',')) {
    if (part.includes('-')) {
      const [a, b] = part.split('-')
      for (let i = parseInt(a!, 10); i <= parseInt(b!, 10); i++) result.push(i)
    } else if (part.includes('/')) {
      const [, step] = part.split('/')
      const s = parseInt(step!, 10)
      for (let i = 0; i <= 6; i += s) result.push(i)
    } else if (part === '*') {
      for (let i = 0; i <= 6; i++) result.push(i)
    } else {
      result.push(parseInt(part, 10))
    }
  }
  return result
}

export function formatHour(h: number): string {
  if (h === 0) return '12 AM'
  if (h < 12) return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}

/** A single job card — used in weekly grid and today timeline */
export function JobCard({ job, onClick, expanded, past }: { job: ScheduleJob; onClick: () => void; expanded?: boolean; past?: boolean }) {
  const s = AGENT_STYLES[job.agentId || ''] || FALLBACK_STYLE
  const time = formatJobTime(job)

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
        {/* Row 1: avatar + name + time pill */}
        <div className="flex items-center gap-1.5 min-w-0">
          <AgentBadge agentId={job.agentId} size="sm" showName={expanded} />
          <span className={`font-medium truncate flex-1 leading-tight ${expanded ? 'text-sm' : 'text-[11px]'} ${past ? 'text-zinc-500' : 'text-zinc-200'}`}>
            {job.displayName || job.id}
          </span>
          {time && (
            <span className={`font-mono ${past ? 'text-zinc-600' : s.accent} opacity-70 shrink-0 tabular-nums ${expanded ? 'text-xs' : 'text-[9px]'}`}>
              {time}
            </span>
          )}
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

  const prev = () => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })
  const next = () => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })
  const goToday = () => setWeekStart(getWeekStart(now))

  const isToday = (d: Date) =>
    d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()

  // Build grid: [dow][hour] → jobs[]  (only cells on or after job's creation date)
  const grid = useMemo(() => {
    const map: Record<string, ScheduleJob[]> = {}
    for (const job of jobs) {
      const hour = getJobHour(job)
      if (hour === null) continue
      const jobStart = job.createdAt ? new Date(job.createdAt) : null
      const jobStartDay = jobStart
        ? new Date(jobStart.getFullYear(), jobStart.getMonth(), jobStart.getDate())
        : null
      for (let dow = 0; dow < 7; dow++) {
        if (jobOnDow(job, dow)) {
          const cellDate = weekDates[dow]!
          if (jobStartDay && cellDate < jobStartDay) continue
          const key = `${dow}-${hour}`
          if (!map[key]) map[key] = []
          map[key]!.push(job)
        }
      }
    }
    return map
  }, [jobs, weekDates])

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Navigation */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={prev}><ChevronLeft className="size-4" /></Button>
        <span className="text-sm font-medium w-[240px] text-center">
          {weekDates[0]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {' \u2014 '}
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
          {HOURS.map(hour => (
            <Fragment key={hour}>
              <div className="text-[10px] text-zinc-600 text-right pr-2.5 py-3 border-t border-border/[0.06] font-mono tabular-nums">
                {formatHour(hour)}
              </div>
              {Array.from({ length: 7 }, (_, dow) => {
                const cellJobs = grid[`${dow}-${hour}`] || []
                const today = isToday(weekDates[dow]!)
                const cellDate = weekDates[dow]!
                const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
                const isPast = cellDate.getTime() < todayStart.getTime() || (today && hour < now.getHours())
                return (
                  <div
                    key={`${dow}-${hour}`}
                    className={`
                      border-l border-t border-border/[0.06] p-1
                      ${today ? 'bg-blue-500/[0.02]' : ''}
                      ${cellJobs.length === 0 ? 'hover:bg-white/[0.01]' : ''}
                    `}
                  >
                    {cellJobs.map(j => (
                      <JobCard key={j.id} job={j} onClick={() => onSelectJob(j)} past={isPast} />
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
