'use client'

import { useMemo, useState, useCallback } from 'react'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SortableHead, type SortDir } from '@/components/sortable-head'
import { JobRow, type JobScoreInfo } from './job-row'
import type { ScheduleJob } from '@/hooks/use-schedule'

type SortField = 'name' | 'agent' | 'schedule' | 'status'

function statusRank(job: ScheduleJob): number {
  if (job.paused) return 2
  if (!job.enabled) return 1
  return 0
}

export function JobList({
  jobs,
  onSelect,
  onPause,
  onResume,
  onRunNow,
  onDelete,
  onEdit,
  onDuplicate,
  onSkipNext,
  scoreMap,
  showScores,
  isSearching,
}: {
  jobs: ScheduleJob[]
  onSelect: (job: ScheduleJob) => void
  onPause: (jobId: string) => void
  onResume: (jobId: string) => void
  onRunNow: (jobId: string) => void
  onDelete: (jobId: string) => void
  onEdit: (job: ScheduleJob) => void
  onDuplicate: (job: ScheduleJob) => void
  onSkipNext: (jobId: string) => void
  scoreMap?: Map<string, JobScoreInfo>
  showScores?: boolean
  /** While an Antfly search is active, sort headers are disabled so the
   *  relevance order from the parent filter memo wins. */
  isSearching?: boolean
}) {
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }, [sortField])

  const sorted = useMemo(() => {
    if (isSearching) return jobs
    return [...jobs].sort((a, b) => {
      let cmp = 0
      if (sortField === 'name') cmp = a.displayName.localeCompare(b.displayName)
      else if (sortField === 'agent') cmp = (a.agentId ?? '').localeCompare(b.agentId ?? '')
      else if (sortField === 'schedule') cmp = a.humanSchedule.localeCompare(b.humanSchedule)
      else if (sortField === 'status') cmp = statusRank(a) - statusRank(b)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [jobs, sortField, sortDir, isSearching])

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-sm">No scheduled jobs found.</p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead field="name" current={sortField} dir={sortDir} onSort={toggleSort} disabled={isSearching}>
            Name
          </SortableHead>
          <SortableHead field="agent" current={sortField} dir={sortDir} onSort={toggleSort} disabled={isSearching}>
            Agent
          </SortableHead>
          <SortableHead field="schedule" current={sortField} dir={sortDir} onSort={toggleSort} disabled={isSearching}>
            Schedule
          </SortableHead>
          <SortableHead field="status" current={sortField} dir={sortDir} onSort={toggleSort} disabled={isSearching}>
            Status
          </SortableHead>
          <TableHead className="w-[60px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map(job => (
          <JobRow
            key={job.id}
            job={job}
            onClick={() => onSelect(job)}
            onPause={() => onPause(job.id)}
            onResume={() => onResume(job.id)}
            onRunNow={() => onRunNow(job.id)}
            onDelete={() => onDelete(job.id)}
            onEdit={() => onEdit(job)}
            onDuplicate={() => onDuplicate(job)}
            onSkipNext={() => onSkipNext(job.id)}
            scoreInfo={showScores ? scoreMap?.get(job.id) : undefined}
          />
        ))}
      </TableBody>
    </Table>
  )
}
