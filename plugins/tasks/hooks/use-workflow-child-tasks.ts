'use client'

import { useEffect, useState, useRef, useCallback } from 'react'

export interface WorkflowChildTask {
  stepId: string
  label: string
  childTaskId: string
}

/**
 * Nested-workflow parents: which child task each in-progress workflow step is
 * waiting on, so the parent card can point at it. Fetches the batch on mount
 * and polls every 15s since step changes are infrequent. (Pending approvals
 * are NOT read here — `useTaskApprovals` owns the "Needs approval" signal.)
 */
export function useWorkflowChildTasks(taskIds: string[]): Record<string, WorkflowChildTask | null> {
  const [children, setChildren] = useState<Record<string, WorkflowChildTask | null>>({})
  const prevIdsRef = useRef('')

  const fetchChildren = useCallback(async (ids: string[]) => {
    if (ids.length === 0) {
      setChildren({})
      return
    }
    try {
      const res = await fetch(`/api/plugins/workflows/gates/status?taskIds=${ids.join(',')}`)
      if (res.ok) {
        const data = await res.json() as { gates?: Record<string, WorkflowChildTask | null> }
        setChildren(data.gates || {})
      }
    } catch {
      // best effort
    }
  }, [])

  // Fetch when workflow task IDs change
  useEffect(() => {
    const key = taskIds.sort().join(',')
    if (key !== prevIdsRef.current) {
      prevIdsRef.current = key
      fetchChildren(taskIds)
    }
  }, [taskIds, fetchChildren])

  // Poll every 15s for step changes
  useEffect(() => {
    if (taskIds.length === 0) return
    const timer = setInterval(() => fetchChildren(taskIds), 15_000)
    return () => clearInterval(timer)
  }, [taskIds, fetchChildren])

  return children
}
