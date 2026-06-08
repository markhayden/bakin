'use client'

import { useState } from 'react'
import { useTaskRunHistory, type TaskRunEntry } from "@makinbakin/sdk/hooks"
import { Badge, Skeleton } from "@makinbakin/sdk/ui"
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
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`
}

function formatDuration(ms?: number): string | null {
  if (ms == null) return null
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

const STATUS_CLASS: Record<TaskRunEntry['status'], string> = {
  settled: 'bg-green-500/10 text-green-400 border-green-500/20',
  superseded: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  lost: 'bg-red-500/10 text-red-400 border-red-500/20',
  running: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
}

/**
 * Collapsible per-task dispatch history (#463). Hidden entirely when a task has
 * no runs (not yet dispatched). The header summary surfaces the abnormal cases
 * ("3 runs · last superseded") without expanding.
 */
export function TaskRunHistory({ taskId }: { taskId: string }) {
  const { runs, loading } = useTaskRunHistory(taskId)
  const [open, setOpen] = useState(false)

  if (loading) return <Skeleton className="h-6 w-40" />
  if (runs.length === 0) return null // nothing dispatched yet → no section

  const last = runs[0] // newest-first
  const summary = `${runs.length} run${runs.length === 1 ? '' : 's'} · last ${last.status}`

  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex items-center gap-2 w-full text-left">
        <ChevronRight className={`size-3 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
        <h3 className="text-[11px] text-muted-foreground uppercase tracking-wider">Run History</h3>
        <span className="text-xs text-muted-foreground">{summary}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1">
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
  )
}
