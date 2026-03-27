'use client'

import { useMemo } from 'react'
import type { TaskColumns } from '../types'

interface TaskMetricsProps {
  columns: TaskColumns
}

export function TaskMetrics({ columns }: TaskMetricsProps) {
  const metrics = useMemo(() => {
    const active = columns.inProgress.length + columns.review.length
    const blocked = columns.blocked.length
    const total = Object.values(columns).reduce((sum, col) => sum + col.length, 0)

    const todayStr = new Date().toISOString().slice(0, 10)
    const completedToday = [...columns.done, ...columns.confirmed].filter(
      t => t.date?.startsWith(todayStr)
    ).length

    const activeAgents = new Set<string>()
    for (const task of [...columns.inProgress, ...columns.review]) {
      if (task.agent) activeAgents.add(task.agent)
    }

    return { active, blocked, completedToday, total, agentsActive: activeAgents.size }
  }, [columns])

  return (
    <div className="flex items-center gap-5">
      <Stat label="Active" value={metrics.active} color="text-blue-400" dotColor="bg-blue-400" />
      <Stat label="Blocked" value={metrics.blocked} color={metrics.blocked > 0 ? 'text-red-400' : 'text-muted-foreground'} dotColor={metrics.blocked > 0 ? 'bg-red-400' : 'bg-muted-foreground/50'} />
      <Stat label="Done Today" value={metrics.completedToday} color="text-green-400" dotColor="bg-green-400" />
      <Stat label="Total" value={metrics.total} color="text-foreground" dotColor="bg-foreground/50" />
      <Stat label="Agents" value={metrics.agentsActive} color="text-violet-400" dotColor="bg-violet-400" />
    </div>
  )
}

function Stat({ label, value, color, dotColor }: { label: string; value: number; color: string; dotColor: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`size-1.5 rounded-full ${dotColor} shrink-0`} />
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-sm font-mono font-semibold tabular-nums ${color}`}>{value}</span>
    </div>
  )
}
