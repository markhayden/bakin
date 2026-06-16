'use client'

import { useState } from 'react'
import { useTaskRunHistory, type TaskOutcome, type TaskRunEntry } from "@makinbakin/sdk/hooks"
import { Badge, Separator } from "@makinbakin/sdk/ui"
import { formatDateTime, formatDuration, toneBadgeClass } from "@makinbakin/sdk/utils"
import { ChevronRight } from 'lucide-react'

// `settled` is blue (info), not green — a settled turn is not a succeeded task (#476);
// green (success) is reserved for the task-done outcome badge.
const STATUS_CLASS: Record<TaskRunEntry['status'], string> = {
  settled: toneBadgeClass('info'),
  superseded: toneBadgeClass('muted'),
  lost: toneBadgeClass('error'),
  running: toneBadgeClass('pending'),
}

const OUTCOME_CLASS: Record<TaskOutcome['state'], string> = {
  done: toneBadgeClass('success'),
  blocked: toneBadgeClass('error'),
  in_progress: toneBadgeClass('pending'),
  archived: toneBadgeClass('muted'),
}

const OUTCOME_LABEL: Record<TaskOutcome['state'], string> = {
  done: 'done',
  blocked: 'blocked',
  in_progress: 'in progress',
  archived: 'archived',
}

/**
 * Per-task dispatch history (#463), styled as a peer of the Notes section:
 * its own leading divider + a NOTES-style header, expanded by default and
 * collapsible. Renders nothing (no orphan divider) until runs load or when a
 * task has no runs.
 */
export function TaskRunHistory({ taskId }: { taskId: string }) {
  const { runs, outcome, loading } = useTaskRunHistory(taskId)
  const [open, setOpen] = useState(true)

  if (loading || runs.length === 0) return null

  const last = runs[0] // newest-first
  const summary = `${runs.length} run${runs.length === 1 ? '' : 's'} · last ${last.status}`

  return (
    <>
      <Separator />
      <div>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 w-full text-left"
        >
          <h3 className="text-[11px] text-muted-foreground uppercase tracking-wider">Run History</h3>
          <span className="text-[11px] text-muted-foreground/70">{summary}</span>
          {outcome && (
            <>
              <Badge variant="outline" className={OUTCOME_CLASS[outcome.state]}>{OUTCOME_LABEL[outcome.state]}</Badge>
              {outcome.completedAt && (
                <span className="text-[11px] text-muted-foreground/70">{formatDateTime(outcome.completedAt)}</span>
              )}
            </>
          )}
          <ChevronRight className={`size-3 text-muted-foreground ml-auto transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        {open && (
          <div className="mt-3 space-y-1">
            {runs.map(run => {
              const dur = formatDuration(run.durationMs)
              return (
                <div key={run.runId} className="flex items-center gap-3 text-sm py-1.5 border-b border-border/50 last:border-0">
                  <span className="text-muted-foreground w-6 shrink-0 text-xs font-mono">#{run.seq}</span>
                  <span className="text-muted-foreground w-[130px] shrink-0 text-xs">{formatDateTime(run.startedAt)}</span>
                  <Badge variant="outline" className={STATUS_CLASS[run.status]}>{run.status}</Badge>
                  <span className="text-xs text-muted-foreground">{run.agent}</span>
                  {dur && <span className="text-xs text-muted-foreground">{dur}</span>}
                  {run.settleReason && <span className="text-xs text-muted-foreground truncate">{run.settleReason}</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
