'use client'

import { useEffect, useState, useRef, useCallback } from 'react'

export interface GateStatus {
  stepId: string
  label: string
  description?: string
  childTaskId?: string
}

/**
 * Hook that tracks gate status for workflow tasks.
 * Fetches batch gate status on mount and polls every 15s since gate events are infrequent.
 */
export function useGateStatus(taskIds: string[]): Record<string, GateStatus | null> {
  const [gates, setGates] = useState<Record<string, GateStatus | null>>({})
  const prevIdsRef = useRef('')

  const fetchGateStatus = useCallback(async (ids: string[]) => {
    if (ids.length === 0) {
      setGates({})
      return
    }
    try {
      const res = await fetch(`/api/plugins/workflows/gates/status?taskIds=${ids.join(',')}`)
      if (res.ok) {
        const data = await res.json()
        setGates(data.gates || {})
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
      fetchGateStatus(taskIds)
    }
  }, [taskIds, fetchGateStatus])

  // Poll every 15s for gate status changes
  useEffect(() => {
    if (taskIds.length === 0) return
    const timer = setInterval(() => fetchGateStatus(taskIds), 15_000)
    return () => clearInterval(timer)
  }, [taskIds, fetchGateStatus])

  return gates
}
