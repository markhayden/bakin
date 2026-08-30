'use client'

import { useMemo } from 'react'
import { ShieldAlert } from 'lucide-react'
import { DataTable, ListRow, type DataTableColumn, type DataTableSort } from '@makinbakin/sdk/patterns'
import { Overline, Text } from '@makinbakin/sdk/ui'
import { AgentBadge } from './agent-badge'
import { JobActionsMenu, JobNameCell, JobScheduleCell, JobStatusBadge, type JobScoreInfo } from './job-row'

import type { ScheduleJob } from "@makinbakin/sdk/hooks"

export type JobSortField = 'name' | 'agent' | 'schedule' | 'status'

type JobSortValue = string | number | Date | null | undefined

/**
 * One accessor per sortable column. Shared by the DataTable headers and by
 * `sortJobs`, so the page can sort the WHOLE filtered list before it slices
 * a page off — a header click must never reorder just the visible ten.
 */
const JOB_SORT_VALUE: Record<JobSortField, (job: ScheduleJob) => JobSortValue> = {
  name: job => job.displayName || job.id,
  agent: job => job.agentId ?? job.teamId ?? null,
  // Next fire time — the order a schedule column is read for. Paused jobs
  // show no next run, so they sort last like the cell's missing line.
  schedule: job => (job.nextRun && !job.paused ? new Date(job.nextRun) : null),
  status: job => jobStatusKey(job),
}

function compareJobSortValues(a: JobSortValue, b: JobSortValue): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/** Stable whole-list sort with the DataTable semantics: missing values last either way. */
export function sortJobs(jobs: readonly ScheduleJob[], sort: DataTableSort<JobSortField> | undefined): ScheduleJob[] {
  if (!sort) return [...jobs]
  const accessor = JOB_SORT_VALUE[sort.field]
  const sign = sort.dir === 'asc' ? 1 : -1
  return jobs
    .map((job, index) => ({ job, index, value: accessor(job) }))
    .sort((a, b) => {
      const aMissing = a.value === null || a.value === undefined
      const bMissing = b.value === null || b.value === undefined
      if (aMissing !== bMissing) return aMissing ? 1 : -1
      if (aMissing && bMissing) return a.index - b.index
      const order = compareJobSortValues(a.value, b.value) * sign
      return order !== 0 ? order : a.index - b.index
    })
    .map(entry => entry.job)
}

/** Sort key mirroring JobStatusBadge's precedence, from row data only. */
function jobStatusKey(job: ScheduleJob): string {
  if (job.paused) return job.pauseReason === 'auto-failures' ? 'auto-paused' : 'paused'
  if (job.skipNextN && job.skippedCount !== undefined && job.skippedCount < job.skipNextN) return 'skipping'
  if (job.consecutiveFailures > 0) return 'failures'
  if (job.completed) return 'completed'
  if (!job.enabled) return 'disabled'
  return 'active'
}

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
              <Text size="body" tone="muted" className="block truncate">
                {job.humanSchedule}
                {job.tz ? (
                  <Text as="span" size="meta" tone="muted" className="ml-bakin-1">
                    {job.tz.replace(/^.*\//, '')}
                  </Text>
                ) : null}
              </Text>
              {job.nextRun && !job.paused ? (
                <Text size="meta" tone="muted" className="mt-bakin-1 block">
                  Next {new Date(job.nextRun).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Text>
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
  sort,
  onSortChange,
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
  /** Controlled by the page, which sorts the whole filtered list before paginating. */
  sort?: DataTableSort<JobSortField>
  onSortChange?: (field: JobSortField) => void
}) {
  const columns = useMemo<ReadonlyArray<DataTableColumn<ScheduleJob, JobSortField>>>(() => [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      sortValue: JOB_SORT_VALUE.name,
      headClassName: 'min-w-64',
      cell: job => <JobNameCell job={job} scoreInfo={showScores ? scoreMap?.get(job.id) : undefined} />,
    },
    {
      key: 'agent',
      header: 'Agent',
      sortable: true,
      sortValue: JOB_SORT_VALUE.agent,
      headClassName: 'min-w-36',
      cell: job => <AgentBadge agentId={job.agentId} size="md" />,
    },
    {
      key: 'schedule',
      header: 'Schedule',
      sortable: true,
      sortValue: JOB_SORT_VALUE.schedule,
      headClassName: 'min-w-48',
      cell: job => <JobScheduleCell job={job} />,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: JOB_SORT_VALUE.status,
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
      sort={sort}
      onSortChange={onSortChange}
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
