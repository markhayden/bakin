'use client'

import { useRunHistory } from '@/hooks/use-schedule'
import { Badge } from '@/components/ui/badge'

function formatTime(ts: string): string {
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

export function RunHistory({ jobId }: { jobId: string }) {
  const { runs, loading } = useRunHistory(jobId)

  if (loading) {
    return <div className="text-sm text-muted-foreground py-4">Loading runs...</div>
  }

  if (runs.length === 0) {
    return <div className="text-sm text-muted-foreground py-4">No run history yet.</div>
  }

  return (
    <div className="space-y-2">
      {runs.map(run => (
        <div key={run.runId} className="flex items-center gap-3 text-sm py-1.5 border-b border-border/50 last:border-0">
          <span className="text-muted-foreground w-[140px] shrink-0 text-xs">{formatTime(run.timestamp)}</span>
          <Badge
            variant="outline"
            className={
              run.status === 'ok' || run.status === 'success'
                ? 'bg-green-500/10 text-green-400 border-green-500/20'
                : 'bg-red-500/10 text-red-400 border-red-500/20'
            }
          >
            {run.status}
          </Badge>
          {run.taskId && (
            <span className="text-xs text-muted-foreground font-mono">{run.taskId.slice(0, 8)}</span>
          )}
          {run.error && (
            <span className="text-xs text-red-400 truncate">{run.error}</span>
          )}
        </div>
      ))}
    </div>
  )
}
