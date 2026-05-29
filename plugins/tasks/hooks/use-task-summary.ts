'use client'

import { useCallback, useEffect, useState } from 'react'
import { useContentStore } from '@makinbakin/sdk/hooks'

export interface TaskSummary {
  blocked: number
  review: number
}

interface UseTaskSummaryResult {
  summary: TaskSummary | null
}

/**
 * Cheap blocked/review counts for the Tasks nav badge. Hits the dedicated
 * `/summary` endpoint (numbers only) and refetches whenever the existing
 * SSE-driven `taskboardVersion` bumps — the same signal the Kanban board
 * uses — so the badge stays current with no new EventSource.
 */
export function useTaskSummary(): UseTaskSummaryResult {
  const [summary, setSummary] = useState<TaskSummary | null>(null)
  const taskboardVersion = useContentStore((s) => s.taskboardVersion)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/plugins/tasks/summary')
      if (!response.ok) throw new Error(`Failed to load task summary (${response.status})`)
      const data = await response.json() as Partial<TaskSummary>
      setSummary({
        blocked: typeof data.blocked === 'number' ? data.blocked : 0,
        review: typeof data.review === 'number' ? data.review : 0,
      })
    } catch (err) {
      // Keep the last good value; the next taskboard bump retries. Log at
      // debug so a persistently-failing summary is diagnosable without noise.
      console.debug('[tasks] nav-badge summary fetch failed', err)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh, taskboardVersion])

  return { summary }
}
