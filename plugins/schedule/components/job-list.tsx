'use client'

import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { JobRow } from './job-row'
import type { ScheduleJob } from '@/hooks/use-schedule'

export function JobList({
  jobs,
  onSelect,
  onPause,
  onResume,
  onRunNow,
  onDelete,
}: {
  jobs: ScheduleJob[]
  onSelect: (job: ScheduleJob) => void
  onPause: (jobId: string) => void
  onResume: (jobId: string) => void
  onRunNow: (jobId: string) => void
  onDelete: (jobId: string) => void
}) {
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
          />
        ))}
      </TableBody>
    </Table>
  )
}
