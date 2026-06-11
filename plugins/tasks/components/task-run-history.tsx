'use client'

import { useState } from 'react'
import { useTaskRunHistory, type TaskOutcome, type TaskRunEntry } from "@makinbakin/sdk/hooks"
import { Badge, Separator } from "@makinbakin/sdk/ui"
import { ChevronRight } from 'lucide-react'

function relativeTime(ts: string): string {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ts
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (diffDays === 0) return `Today ${time}`
  if (diffDays === 1) return `Yesterday ${time}`
  // Prior-year timestamps carry the year — "Jan 5" alone is ambiguous once
  // runs and completions live longer than the calendar.
  const sameYear = d.getFullYear() === now.getFullYear()
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })} ${time}`
}

function formatDuration(ms?: number): string | null {
  if (ms == null) return null
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

// `settled` is blue, not green — a settled turn is not a succeeded task (#476);
// green is reserved for the task-done outcome badge.
const STATUS_CLASS: Record<TaskRunEntry['status'], string> = {
  settled: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  superseded: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  lost: 'bg-red-500/10 text-red-400 border-red-500/20',
  running: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
}

const OUTCOME_CLASS: Record<TaskOutcome['state'], string> = {
  done: 'bg-green-500/10 text-green-400 border-green-500/20',
  blocked: 'bg-red-500/10 text-red-400 border-red-500/20',
  in_progress: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  archived: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
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
                <span className="text-[11px] text-muted-foreground/70">{relativeTime(outcome.completedAt)}</span>
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
                  <span className="text-muted-foreground w-[130px] shrink-0 text-xs">{relativeTime(run.startedAt)}</span>
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
