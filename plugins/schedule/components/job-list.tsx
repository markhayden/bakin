'use client'

import { ShieldAlert } from 'lucide-react'
import { DataTable, ListRow, type DataTableColumn } from '@makinbakin/sdk/patterns'
import { AgentBadge } from './agent-badge'
import { JobRow, JobStatusBadge, type JobScoreInfo } from './job-row'
import type { ScheduleJob } from "@makinbakin/sdk/hooks"

const JOB_COLUMNS: ReadonlyArray<DataTableColumn<ScheduleJob>> = [
  { key: 'name', header: 'Name', headClassName: 'min-w-64' },
  { key: 'agent', header: 'Agent', headClassName: 'min-w-36' },
  { key: 'schedule', header: 'Schedule', headClassName: 'min-w-48' },
  { key: 'status', header: 'Status', headClassName: 'min-w-28' },
  { key: 'actions', header: 'Actions', hideLabel: true, headClassName: 'w-12' },
]

function MobileJobRow({
  job,
  onSelect,
  scoreInfo,
}: {
  job: ScheduleJob
  onSelect: () => void
  scoreInfo?: JobScoreInfo
}) {
  const label = job.displayName || job.id
  const source = job.source === 'adopted'
    ? 'Adopted'
    : job.isBakinJob
      ? 'Bakin schedule'
      : 'Runtime cron'

  return (
    <ListRow
      interactive={{ label: `Open ${label}`, onActivate: onSelect }}
      className="px-bakin-3 py-bakin-4"
    >
        <span className="flex w-full min-w-0 flex-col gap-y-bakin-2">
          <span className="flex min-w-0 items-start gap-x-bakin-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bakin-typography-weight-semibold text-bakin-text-primary">
                {label}
              </span>
              <span className="mt-bakin-1 block text-bakin-typography-size-meta uppercase tracking-wider text-bakin-text-muted">
                {source}
              </span>
            </span>
            <JobStatusBadge job={job} />
          </span>

          <span className="flex min-w-0 items-center gap-bakin-3">
            <AgentBadge agentId={job.agentId} size="sm" showName={false} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-bakin-typography-size-body text-bakin-text-muted">
                {job.humanSchedule}
                {job.tz ? (
                  <span className="ml-bakin-1 text-bakin-typography-size-meta opacity-60">
                    {job.tz.replace(/^.*\//, '')}
                  </span>
                ) : null}
              </span>
              {job.nextRun && !job.paused ? (
                <span className="mt-bakin-1 block text-bakin-typography-size-meta text-bakin-text-muted">
                  Next {new Date(job.nextRun).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              ) : null}
            </span>
          </span>

          {job.toolsAllowMissing ? (
            <span className="inline-flex items-center gap-bakin-1 text-bakin-typography-size-meta text-bakin-signal-highlight">
              <ShieldAlert className="size-bakin-3" aria-hidden="true" />
              Missing cron tools
            </span>
          ) : null}

          {scoreInfo ? (
            <span className="font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-signal-highlight">
              RRF {scoreInfo.score.toFixed(3)}
            </span>
          ) : null}
        </span>
    </ListRow>
  )
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
    <DataTable
      label="Scheduled jobs"
      columns={JOB_COLUMNS}
      rows={jobs}
      rowKey={job => job.id}
      listVariant="bordered"
      tableProps={{ 'data-testid': 'job-list', className: 'min-w-max' }}
      renderTableRow={job => (
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
      )}
      renderRow={job => (
        <MobileJobRow
          key={job.id}
          job={job}
          onSelect={() => onSelect(job)}
          scoreInfo={showScores ? scoreMap?.get(job.id) : undefined}
        />
      )}
    />
  )
}
