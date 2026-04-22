'use client'

import { useMemo } from 'react'
import { Clock } from 'lucide-react'
import {
  AGENT_STYLES,
  FALLBACK_STYLE,
  getJobHour,
  getJobMinute,
  formatJobTime,
  formatHour,
  jobOnDow,
  JobCard,
} from './calendar-weekly'
import type { ScheduleJob } from "@bakin/sdk/hooks"

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6) // 6am–10pm

export function CalendarToday({
  jobs,
  onSelectJob,
}: {
  jobs: ScheduleJob[]
  onSelectJob: (job: ScheduleJob) => void
}) {
  const now = new Date()
  const currentHour = now.getHours()
  const dow = now.getDay()

  const todayFormatted = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  // Filter jobs that run today, grouped by hour
  const hourGrid = useMemo(() => {
    const map: Record<number, ScheduleJob[]> = {}
    let total = 0
    for (const job of jobs) {
      const hour = getJobHour(job)
      if (hour === null) continue
      if (!jobOnDow(job, dow)) continue
      if (!map[hour]) map[hour] = []
      map[hour]!.push(job)
      total++
    }
    return { map, total }
  }, [jobs, dow])

  // Sort jobs within each hour by minute
  const sortedHourJobs = (hourJobs: ScheduleJob[]) =>
    [...hourJobs].sort((a, b) => getJobMinute(a) - getJobMinute(b))

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Clock className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{todayFormatted}</span>
        <span className="text-xs text-muted-foreground">
          {hourGrid.total} job{hourGrid.total !== 1 ? 's' : ''} scheduled
        </span>
      </div>

      {/* Timeline */}
      <div className="overflow-auto flex-1 min-h-0 border border-border/30 rounded-lg bg-background/50">
        <div className="divide-y divide-border/[0.06]">
          {HOURS.map(hour => {
            const hourJobs = hourGrid.map[hour] || []
            const isPast = hour < currentHour
            const isCurrent = hour === currentHour

            return (
              <div
                key={hour}
                className={`
                  flex gap-4 px-4 py-3 min-h-[56px]
                  ${isCurrent ? 'bg-blue-500/[0.04]' : ''}
                `}
              >
                {/* Time gutter */}
                <div className="w-[60px] shrink-0 pt-0.5">
                  <span className={`text-xs font-mono tabular-nums ${isCurrent ? 'text-blue-400 font-medium' : 'text-zinc-600'}`}>
                    {formatHour(hour)}
                  </span>
                  {isCurrent && (
                    <div className="mt-1 h-[2px] w-full rounded-full bg-blue-500/40" />
                  )}
                </div>

                {/* Job cards */}
                <div className="flex-1 min-w-0">
                  {hourJobs.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {sortedHourJobs(hourJobs).map(job => (
                        <JobCard
                          key={job.id}
                          job={job}
                          onClick={() => onSelectJob(job)}
                          expanded
                          past={isPast}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
