'use client'

import { useMemo } from 'react'
import { ShieldAlert } from 'lucide-react'
import { DataTable, ListRow, type DataTableColumn } from '@makinbakin/sdk/patterns'
import { Overline, Text } from '@makinbakin/sdk/ui'
import { AgentBadge } from './agent-badge'
import { JobActionsMenu, JobNameCell, JobScheduleCell, JobStatusBadge, type JobScoreInfo } from './job-row'

import type { ScheduleJob } from "@makinbakin/sdk/hooks"

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
              <Overline className="mt-bakin-1 block">
                {source}
              </Overline>
            </span>
            <JobStatusBadge job={job} />
          </span>

          <span className="flex min-w-0 items-center gap-bakin-3">
            <AgentBadge agentId={job.agentId} size="sm" showName={false} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-bakin-typography-size-body text-bakin-text-muted">
                {job.humanSchedule}
                {job.tz ? (
                  <Text as="span" size="meta" tone="muted" className="ml-bakin-1">
                    {job.tz.replace(/^.*\//, '')}
                  </Text>
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
            <span className="font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-data-series-1">
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
  const columns = useMemo<ReadonlyArray<DataTableColumn<ScheduleJob>>>(() => [
    {
      key: 'name',
      header: 'Name',
      headClassName: 'min-w-64',
      cell: job => <JobNameCell job={job} scoreInfo={showScores ? scoreMap?.get(job.id) : undefined} />,
    },
    {
      key: 'agent',
      header: 'Agent',
      headClassName: 'min-w-36',
      cell: job => <AgentBadge agentId={job.agentId} size="md" />,
    },
    {
      key: 'schedule',
      header: 'Schedule',
      headClassName: 'min-w-48',
      cell: job => <JobScheduleCell job={job} />,
    },
    {
      key: 'status',
      header: 'Status',
      headClassName: 'min-w-28',
      cell: job => <JobStatusBadge job={job} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      hideLabel: true,
      headClassName: 'w-12',
      cell: job => (
        <JobActionsMenu
          job={job}
          onPause={() => onPause(job.id)}
          onResume={() => onResume(job.id)}
          onRunNow={() => onRunNow(job.id)}
          onDelete={() => onDelete(job.id)}
          onEdit={() => onEdit(job)}
          onDuplicate={() => onDuplicate(job)}
          onAdopt={() => onAdopt(job)}
          onRestoreNative={() => onRestoreNative(job.id)}
          onSkipNext={() => onSkipNext(job.id)}
        />
      ),
    },
  ], [onAdopt, onDelete, onDuplicate, onEdit, onPause, onRestoreNative, onResume, onRunNow, onSkipNext, scoreMap, showScores])

  return (
    <DataTable
      label="Scheduled jobs"
      // Kept collapsing: these rows carry narrow-render configuration and
      // read better stacked than as a horizontally scrolling table.
      collapseBelow="2xl"
      columns={columns}
      rows={jobs}
      rowKey={job => job.id}
      listVariant="bordered"
      tableProps={{ 'data-testid': 'job-list', className: 'min-w-max' }}
      onRowActivate={onSelect}
      rowActivateLabel={job => `Open ${job.displayName || job.id}`}
      // `group` feeds the actions menu's hover reveal on the wide render.
      rowProps={() => ({ className: 'group' })}
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
