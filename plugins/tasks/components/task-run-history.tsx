'use client'

import { useState } from 'react'
import { useTaskRunHistory, type TaskOutcome, type TaskRunEntry } from '@makinbakin/sdk/hooks'
import {
  BakinDrawerSection,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@makinbakin/sdk/ui'
import { StatusBadge, type StatusTone } from '@makinbakin/sdk/patterns'
import { formatDateTime, formatDuration } from '@makinbakin/sdk/utils'
import { ChevronRight } from 'lucide-react'

// A settled dispatch is informational, not successful. Success remains
// reserved for the task-level done outcome.
const STATUS_TONE: Record<TaskRunEntry['status'], StatusTone> = {
  settled: 'neutral',
  superseded: 'neutral',
  lost: 'danger',
  running: 'attention',
}

const OUTCOME_TONE: Record<TaskOutcome['state'], StatusTone> = {
  done: 'success',
  blocked: 'danger',
  in_progress: 'attention',
  archived: 'neutral',
}

const OUTCOME_LABEL: Record<TaskOutcome['state'], string> = {
  done: 'Done',
  blocked: 'Blocked',
  in_progress: 'In progress',
  archived: 'Archived',
}

/**
 * Per-task dispatch history. It stays absent until at least one run exists,
 * then uses the shared drawer hierarchy and disclosure contract.
 */
export function TaskRunHistory({ taskId }: { taskId: string }) {
  const { runs, outcome, loading } = useTaskRunHistory(taskId)
  const [open, setOpen] = useState(true)

  if (loading || runs.length === 0) return null

  const last = runs[0]
  const summary = `${runs.length} run${runs.length === 1 ? '' : 's'} · last ${last.status}`

  return (
    <BakinDrawerSection
      title="Run history"
      actions={outcome ? (
        <StatusBadge tone={OUTCOME_TONE[outcome.state]} variant="solid" size="xs">
          {OUTCOME_LABEL[outcome.state]}
        </StatusBadge>
      ) : undefined}
    >
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="@container/run border-b-0"
      >
        <CollapsibleTrigger>
          <span className="min-w-0">
            <span className="block text-bakin-typography-size-body text-bakin-text-primary">{summary}</span>
            {outcome?.completedAt ? (
              <span className="block text-bakin-typography-size-meta font-bakin-typography-weight-regular text-bakin-text-muted">
                Completed {formatDateTime(outcome.completedAt)}
              </span>
            ) : null}
          </span>
          <ChevronRight
            aria-hidden="true"
            className={`size-bakin-4 shrink-0 text-bakin-text-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ol className="m-0 list-none divide-y divide-bakin-border-subtle p-0">
            {runs.map((run) => {
              const duration = formatDuration(run.durationMs)
              return (
                <li
                  key={run.runId}
                  className="grid min-w-0 gap-bakin-2 py-bakin-3 first:pt-0 @md/run:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-x-bakin-3 gap-y-bakin-1">
                    <span className="font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">
                      #{run.seq}
                    </span>
                    <time className="text-bakin-typography-size-meta text-bakin-text-muted">
                      {formatDateTime(run.startedAt)}
                    </time>
                    <StatusBadge tone={STATUS_TONE[run.status]} size="xs">
                      {run.status}
                    </StatusBadge>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-bakin-3 gap-y-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted @md/run:justify-end">
                    <span>{run.agent}</span>
                    {duration ? <span>{duration}</span> : null}
                  </div>
                  {run.settleReason ? (
                    <p className="m-0 break-words text-bakin-typography-size-meta text-bakin-text-muted @md/run:col-span-2">
                      {run.settleReason}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </CollapsibleContent>
      </Collapsible>
    </BakinDrawerSection>
  )
}
