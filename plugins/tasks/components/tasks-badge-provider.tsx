'use client'

import type { NavBadge } from '@makinbakin/sdk'
import { useNavBadge } from '@makinbakin/sdk/hooks'
import { useTaskSummary } from '../hooks/use-task-summary'

/**
 * Background component (renders nothing) mounted via the host's
 * `nav-badge-providers` slot. Keeps the Tasks nav item's badge in sync with
 * tasks needing attention, by winning severity (bakin #265):
 *   - blocked > 0 → red `error` count (most urgent)
 *   - else review > 0 → amber `attention` count
 *   - else cleared
 * Source of truth is the task board; refresh rides the existing taskboard
 * SSE signal — no cron, heartbeat, or MCP traffic.
 */
export function TasksBadgeProvider() {
  const { summary } = useTaskSummary()

  const badge: NavBadge | null = !summary
    ? null
    : summary.blocked > 0
      ? { count: summary.blocked, tone: 'error' }
      : summary.review > 0
        ? { count: summary.review, tone: 'attention' }
        : null

  useNavBadge('tasks', 'tasks', badge)

  return null
}
