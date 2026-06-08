'use client'

import { useState, useEffect } from 'react'

/** One dispatch attempt for a task (mirrors plugins/tasks TaskRunEntry). */
export interface TaskRunEntry {
  runId: string
  taskId: string
  seq: number
  agent: string
  status: 'running' | 'settled' | 'superseded' | 'lost'
  startedAt: string
  settledAt?: string
  settleReason?: string
  durationMs?: number
}

/** Fetch a task's dispatch run history (newest-first) from the execution ledger. */
export function useTaskRunHistory(taskId: string | null, limit = 50) {
  const [runs, setRuns] = useState<TaskRunEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!taskId) {
      setRuns([])
      return
    }
    setLoading(true)
    fetch(`/api/plugins/tasks/${taskId}/runs?limit=${limit}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data) setRuns(data.runs || [])
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [taskId, limit])

  return { runs, loading }
}
