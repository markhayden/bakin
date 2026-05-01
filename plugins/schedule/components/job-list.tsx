'use client'

import { Table, TableBody, TableHead, TableHeader, TableRow } from "@bakin/sdk/ui"
import { EmptyState } from "@bakin/sdk/components"
import { CalendarClock } from 'lucide-react'
import { JobRow, type JobScoreInfo } from './job-row'
import type { ScheduleJob } from "@bakin/sdk/hooks"

export function JobList({
  jobs,
  onSelect,
  onPause,
  onResume,
  onRunNow,
  onDelete,
  onEdit,
  onDuplicate,
  onAdopt,
  onRestoreNative,
  onSkipNext,
  scoreMap,
  showScores,
}: {
  jobs: ScheduleJob[]
  onSelect: (job: ScheduleJob) => void
  onPause: (jobId: string) => void
  onResume: (jobId: string) => void
  onRunNow: (jobId: string) => void
  onDelete: (jobId: string) => void
  onEdit: (job: ScheduleJob) => void
  onDuplicate: (job: ScheduleJob) => void
  onAdopt: (job: ScheduleJob) => void
  onRestoreNative: (jobId: string) => void
  onSkipNext: (jobId: string) => void
  scoreMap?: Map<string, JobScoreInfo>
  showScores?: boolean
}) {
  if (jobs.length === 0) {
    return <EmptyState icon={CalendarClock} title="No scheduled jobs found" />
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[250px]">Name</TableHead>
          <TableHead className="w-[130px]">Agent</TableHead>
          <TableHead className="w-[200px]">Schedule</TableHead>
          <TableHead className="w-[100px]">Status</TableHead>
          <TableHead className="w-[60px]" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map(job => (
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
            onAdopt={() => onAdopt(job)}
            onRestoreNative={() => onRestoreNative(job.id)}
            onSkipNext={() => onSkipNext(job.id)}
            scoreInfo={showScores ? scoreMap?.get(job.id) : undefined}
          />
        ))}
      </TableBody>
    </Table>
  )
}
