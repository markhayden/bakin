'use client'

import { Table, TableBody, TableHead, TableHeader, TableRow } from "@makinbakin/sdk/ui"
import { JobRow, type JobScoreInfo } from './job-row'
import type { ScheduleJob } from "@makinbakin/sdk/hooks"

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
  return (
    <Table data-testid="job-list" className="min-w-max">
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-64">Name</TableHead>
          <TableHead className="min-w-36">Agent</TableHead>
          <TableHead className="min-w-48">Schedule</TableHead>
          <TableHead className="min-w-28">Status</TableHead>
          <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
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
