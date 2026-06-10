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
    if (!taskId) {
      setRuns([])
      setOutcome(undefined)
      return
    }
    setLoading(true)
    fetch(`/api/plugins/tasks/${taskId}/runs?limit=${limit}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data) {
          setRuns(data.runs || [])
          setOutcome(data.outcome)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [taskId, limit])

  return { runs, outcome, loading }
}
