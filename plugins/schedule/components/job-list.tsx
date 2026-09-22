'use client'

import { useMemo } from 'react'
import { DataTable, type DataTableColumn, type DataTableSort } from '@makinbakin/sdk/patterns'
import { AgentBadge } from './agent-badge'
import { JobActionsMenu, JobNameCell, JobScheduleCell, JobStatusBadge, type JobScoreInfo } from './job-row'

import type { ScheduleJob } from "@makinbakin/sdk/hooks"

export type JobSortField = 'name' | 'agent' | 'schedule' | 'status'

export const JOB_SORT_LABELS = {
  default: 'Default order',
  'name:asc': 'Name: A–Z', 'name:desc': 'Name: Z–A',
  'agent:asc': 'Agent: A–Z', 'agent:desc': 'Agent: Z–A',
  'schedule:asc': 'Next run: earliest first', 'schedule:desc': 'Next run: latest first',
  'status:asc': 'Status: A–Z', 'status:desc': 'Status: Z–A',
}

export function parseJobSort(value: string): DataTableSort<JobSortField> | undefined {
  if (value === 'default' || !Object.hasOwn(JOB_SORT_LABELS, value)) return undefined
  const [field, dir] = value.split(':')
  return { field: field as JobSortField, dir: dir as 'asc' | 'desc' }
}

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
      narrow: 'primary',
      sortable: true,
      sortValue: JOB_SORT_VALUE.name,
      headClassName: 'min-w-64',
      cell: job => <JobNameCell job={job} scoreInfo={showScores ? scoreMap?.get(job.id) : undefined} />,
    },
    {
      key: 'agent',
      header: 'Agent',
      narrow: 'label',
      sortable: true,
      sortValue: JOB_SORT_VALUE.agent,
      headClassName: 'min-w-36',
      cell: job => <AgentBadge agentId={job.agentId} size="md" />,
    },
    {
      key: 'schedule',
      header: 'Schedule',
      narrow: 'label',
      sortable: true,
      sortValue: JOB_SORT_VALUE.schedule,
      headClassName: 'min-w-48',
      cell: job => <JobScheduleCell job={job} />,
    },
    {
      key: 'status',
      header: 'Status',
      narrow: 'meta',
      sortable: true,
      sortValue: JOB_SORT_VALUE.status,
      headClassName: 'min-w-28',
      cell: job => <JobStatusBadge job={job} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      narrow: 'trailing',
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
      listVariant="separated"
      tableProps={{ 'data-testid': 'job-list', className: 'min-w-max' }}
      onRowActivate={onSelect}
      rowActivateLabel={job => `Open ${job.displayName || job.id}`}
    />
  )
}
