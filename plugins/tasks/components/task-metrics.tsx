'use client'

import { useMemo } from 'react'
import { Stack } from '@makinbakin/sdk/layout'
import { StatGroup, StatTile } from '@makinbakin/sdk/patterns'
import { Text } from '@makinbakin/sdk/ui'
import type { TaskColumns } from '../types'

interface TaskMetricsProps {
  columns: TaskColumns
  timestamp?: string
}

export function TaskMetrics({ columns, timestamp }: TaskMetricsProps) {
  const metrics = useMemo(() => {
    const active = columns.inProgress.length + columns.review.length
    const blocked = columns.blocked.length
    const total = Object.values(columns).reduce((sum, col) => sum + col.length, 0)

    const todayStr = new Date().toISOString().slice(0, 10)
    const completedToday = [...columns.done, ...columns.archived].filter(
      t => t.date?.startsWith(todayStr)
    ).length

    const activeAgents = new Set<string>()
    for (const task of [...columns.inProgress, ...columns.review]) {
      if (task.agent) activeAgents.add(task.agent)
    }

    return { active, blocked, completedToday, total, agentsActive: activeAgents.size }
  }, [columns])

  return (
    <Stack gap="dense">
      <StatGroup label="Task summary metrics">
        <StatTile label="Active" value={metrics.active} valueTone="accent" />
        <StatTile label="Blocked" value={metrics.blocked} valueTone={metrics.blocked > 0 ? 'danger' : 'neutral'} />
        <StatTile label="Done today" value={metrics.completedToday} valueTone="success" />
        <StatTile label="Total" value={metrics.total} />
        <StatTile label="Agents" value={metrics.agentsActive} valueTone="accent" />
      </StatGroup>
      {timestamp && (
        <Text size="meta" tone="muted" mono className="self-end">
          Updated {timestamp}
        </Text>
      )}
    </Stack>
  )
}
