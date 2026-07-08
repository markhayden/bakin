'use client'

import { useEffect, useState, useCallback } from 'react'

export interface BudgetGateStatus {
  paused: boolean
  configured: boolean
  perAgent: Record<string, 'ok' | 'warn' | 'deferred'>
  deferredProviders: string[]
}

const EMPTY: BudgetGateStatus = { paused: false, configured: false, perAgent: {}, deferredProviders: [] }

/**
 * Poll the models plugin's side-effect-free budget status (cost-control v2)
 * so budget-deferred tasks stop sitting invisibly in todo. Same 15s cadence
 * as the workflow gate poll — budget state changes on that timescale.
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

  return status
}

/** Why a todo task isn't dispatching right now, or null when it would. */
export function budgetHoldReason(status: BudgetGateStatus, agent: string | undefined): string | null {
  if (status.paused) return 'Dispatch paused (kill switch)'
  if (agent && status.perAgent[agent] === 'deferred') return 'Budget-deferred — cap reached'
  return null
}
