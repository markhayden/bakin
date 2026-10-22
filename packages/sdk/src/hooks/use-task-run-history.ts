'use client'

import { useState, useEffect } from 'react'

/** Task-level terminal outcome (mirrors plugins/tasks TaskOutcome). */
export interface TaskOutcome {
  state: 'done' | 'blocked' | 'archived' | 'in_progress'
  /** Set when state === 'done' and a completion row exists. */
  completedAt?: string // ISO
  /** Agent that recorded the completion, when known. */
  agent?: string
}

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

/** Fetch a task's dispatch run history (newest-first) + task outcome from the execution ledger. */
export function useTaskRunHistory(taskId: string | null, limit = 50) {
  const [runs, setRuns] = useState<TaskRunEntry[]>([])
  const [outcome, setOutcome] = useState<TaskOutcome | undefined>(undefined)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // Reset first so a taskId switch never shows the previous task's history
    // while the new fetch is in flight.
    setRuns([])
    setOutcome(undefined)
    if (!taskId) return
    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/plugins/tasks/${taskId}/runs?limit=${limit}`, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data) {
          setRuns(data.runs || [])
          setOutcome(data.outcome)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [taskId, limit])

  return { runs, outcome, loading }
}
