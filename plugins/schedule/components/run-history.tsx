'use client'

import { useRunHistory } from '@makinbakin/sdk/hooks'
import { StatusBadge, type StatusTone } from '@makinbakin/sdk/patterns'
import { Skeleton, SystemState } from '@makinbakin/sdk/ui'
import { formatDateTime } from '@makinbakin/sdk/utils'

function runTone(status: string): StatusTone {
  if (status === 'success') return 'success'
  if (status === 'skipped' || status === 'pending') return 'attention'
  return 'danger'
}

export function RunHistory({ jobId }: { jobId: string }) {
  const { runs, loading } = useRunHistory(jobId)

  if (loading) {
    return (
      <SystemState
        kind="loading"
        scope="inline"
        headingLevel={4}
        title="Loading run history"
        description="Recent executions will appear here."
        preview={(
          <div className="col-span-full grid gap-bakin-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-bakin-8 w-full" />
            ))}
          </div>
        )}
      />
    )
  }

  if (runs.length === 0) {
    return (
      <SystemState
        kind="initial-empty"
        scope="inline"
        headingLevel={4}
        title="No run history yet"
        description="Executions will appear here after this job runs."
      />
    )
  }

  return (
    <ol className="m-0 grid list-none divide-y divide-bakin-border-subtle p-0">
      {runs.map((run) => (
        <li key={run.runId} className="flex min-w-0 flex-wrap items-center gap-x-bakin-3 gap-y-bakin-2 py-bakin-2">
          <time className="w-36 shrink-0 text-bakin-typography-size-meta text-bakin-text-muted">
            {formatDateTime(run.timestamp)}
          </time>
          <StatusBadge tone={runTone(run.status)} variant="solid" size="xs">
            {run.status}
          </StatusBadge>
          {run.status === 'skipped' && run.skippedReason ? (
            <span className="min-w-0 text-bakin-typography-size-meta text-bakin-text-muted">
              {run.skippedReason}
            </span>
          ) : null}
          {run.taskId ? (
            <code className="font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
              {run.taskId.slice(0, 8)}
            </code>
          ) : null}
          {run.error ? (
            <span className="min-w-0 flex-1 truncate text-bakin-typography-size-meta text-bakin-signal-danger">
              {run.error}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
