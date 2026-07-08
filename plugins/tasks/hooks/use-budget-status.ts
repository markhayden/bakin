'use client'

import { useEffect, useState, useCallback } from 'react'
import { usePluginEvent } from '@makinbakin/sdk/hooks'

export interface BudgetGateStatus {
  paused: boolean
  configured: boolean
  perAgent: Record<string, 'ok' | 'warn' | 'deferred'>
  /** Per-todo-task holds computed server-side with the gate's own routing
   *  resolution (covers tag/origin-routed and unassigned tasks). */
  perTask: Record<string, 'deferred'>
  deferredProviders: string[]
}

const EMPTY: BudgetGateStatus = { paused: false, configured: false, perAgent: {}, perTask: {}, deferredProviders: [] }

/**
 * Poll the models plugin's side-effect-free budget status (cost-control v2)
 * so budget-deferred tasks stop sitting invisibly in todo. 15s cadence (same
 * as the workflow gate poll) + an immediate refetch on budget SSE events so
 * incidents/resolutions reflect without waiting out the poll.
 */
export function useBudgetStatus(): BudgetGateStatus {
  const [status, setStatus] = useState<BudgetGateStatus>(EMPTY)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/budget/status')
      if (!res.ok) return
      const data = (await res.json()) as Partial<BudgetGateStatus>
      setStatus({
        paused: data.paused === true,
        configured: data.configured === true,
        perAgent: data.perAgent ?? {},
        perTask: data.perTask ?? {},
        deferredProviders: data.deferredProviders ?? [],
      })
    } catch {
      // best effort — the board renders without badges on a blip
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const timer = setInterval(fetchStatus, 15_000)
    return () => clearInterval(timer)
  }, [fetchStatus])
  usePluginEvent('budget.incident_opened', fetchStatus)
  usePluginEvent('budget.incident_resolved', fetchStatus)

  return status
}

export interface BudgetHold {
  /** Bold badge label — distinguishes the kill switch from a cap hold. */
  label: 'Dispatch paused' | 'Budget-deferred'
  /** One-line reason + where to fix it. */
  detail: string
}

/** Why a todo task isn't dispatching right now, or null when it would. */
export function budgetHoldReason(status: BudgetGateStatus, task: { id: string; agent?: string }): BudgetHold | null {
  if (status.paused) return { label: 'Dispatch paused', detail: 'kill switch — resume in the header banner or `bakin budget resume`' }
  if (status.perTask[task.id] === 'deferred' || (task.agent && status.perAgent[task.agent] === 'deferred')) {
    return { label: 'Budget-deferred', detail: 'cap reached — resolve in Models → Spend' }
  }
  return null
}
