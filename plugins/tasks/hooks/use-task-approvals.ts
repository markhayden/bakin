'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePluginEvent } from '@makinbakin/sdk/hooks'
import type { TaskApproval } from '../types'

export interface TaskApprovalsState {
  /** Pending approvals keyed by the task they are decided on. */
  byTask: Record<string, TaskApproval[]>
  /** First load in flight (never true for refreshes — the board keeps its last signal). */
  loading: boolean
  /** The last fetch failed; `byTask` holds the last good answer. */
  failed: boolean
  refresh: () => Promise<void>
}

/**
 * The board is the inbox (spec D7): pending approval records of every kind
 * drive the "Needs approval" signal and the task-detail panel. One fetch of
 * the pending set (small by nature — no per-task URL), refreshed on the
 * approval and board events; no polling.
 *
 * `taskIds` narrows the request to one task (the detail drawer); the board
 * passes nothing and reads every pending record.
 */
export function useTaskApprovals(taskIds?: readonly string[], enabled = true): TaskApprovalsState {
  const [byTask, setByTask] = useState<Record<string, TaskApproval[]>>({})
  const [loading, setLoading] = useState(enabled)
  const [failed, setFailed] = useState(false)
  const key = taskIds ? [...taskIds].sort().join(',') : ''
  const keyRef = useRef(key)
  keyRef.current = key

  const refresh = useCallback(async () => {
    if (!enabled) return
    const requestKey = keyRef.current
    try {
      const url = requestKey ? `/api/approvals?status=pending&taskIds=${encodeURIComponent(requestKey)}` : '/api/approvals?status=pending'
      const res = await fetch(url)
      if (!res.ok) throw new Error(`approvals ${res.status}`)
      const data = await res.json() as { approvals?: TaskApproval[] }
      // A slower response for a previous task set never overwrites the current one.
      if (keyRef.current !== requestKey) return
      const next: Record<string, TaskApproval[]> = {}
      for (const approval of data.approvals ?? []) {
        (next[approval.owner.taskId] ??= []).push(approval)
      }
      setByTask(next)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => { void refresh() }, [refresh, key])
  usePluginEvent('approval.pending', () => { void refresh() })
  usePluginEvent('approval.resolved', () => { void refresh() })
  usePluginEvent('taskboard', () => { void refresh() })
  usePluginEvent('bakin.reconcile', () => { void refresh() })

  return useMemo(() => ({ byTask, loading, failed, refresh }), [byTask, loading, failed, refresh])
}

/** Card copy for a task's pending approvals: the single title, or a count. */
export function approvalLabelFor(approvals: readonly TaskApproval[] | undefined): string | undefined {
  if (!approvals || approvals.length === 0) return undefined
  if (approvals.length === 1) return approvals[0]!.request.title
  return `${approvals.length} decisions waiting`
}
