'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePluginEvent } from '@makinbakin/sdk/hooks'

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
 * SSE 'taskboard' events — the same signal the Kanban board
 * uses — so the badge stays current with no new EventSource.
 */
export function useTaskSummary(): UseTaskSummaryResult {
  const [summary, setSummary] = useState<TaskSummary | null>(null)

  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attempts = useRef(0)

  const refresh = useCallback(async function refresh() {
    const seq = ++generation.current
    request.current?.abort()
    if (retry.current) clearTimeout(retry.current)
    const controller = new AbortController()
    request.current = controller
    const deadline = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch('/api/plugins/tasks/summary', { signal: controller.signal })
      if (!response.ok) throw new Error(`Failed to load task summary (${response.status})`)
      const data = await response.json() as Partial<TaskSummary>
      if (!Number.isSafeInteger(data.blocked) || !Number.isSafeInteger(data.review)
        || data.blocked! < 0 || data.review! < 0) throw new Error('Invalid task summary')
      if (seq !== generation.current) return
      attempts.current = 0
      setSummary({ blocked: data.blocked!, review: data.review! })
    } catch (err) {
      if (seq !== generation.current) return
      console.debug('[tasks] nav-badge summary fetch failed', err)
      retry.current = setTimeout(() => { void refresh() }, Math.min(1000 * 2 ** attempts.current++, 30_000))
    } finally {
      clearTimeout(deadline)
    }
  }, [])

  usePluginEvent('taskboard', () => { void refresh() })
  usePluginEvent('bakin.reconcile', () => { void refresh() })
  useEffect(() => {
    void refresh()
    return () => {
      // Invalidate every outstanding response when this subscription unmounts.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++
      request.current?.abort()
      if (retry.current) clearTimeout(retry.current)
    }
  }, [refresh])

  return { summary }
}
