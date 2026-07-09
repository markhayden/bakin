'use client'

import { useEffect, useState, useCallback } from 'react'
import { usePluginEvent } from '@makinbakin/sdk/hooks'

export interface BrandGateStatus {
  /** taskId → the missing/draft brandId it is deferring on. */
  perTask: Record<string, string>
}

const EMPTY: BrandGateStatus = { perTask: {} }

/**
 * Poll the brands plugin's side-effect-free blocked-tasks status (#419) so
 * brand-blocked tasks stop sitting invisibly in todo — mirror of
 * use-budget-status. 15s cadence + immediate refetch on brand SSE events.
 */
export function useBrandStatus(): BrandGateStatus {
  const [status, setStatus] = useState<BrandGateStatus>(EMPTY)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/brands/blocked-tasks')
      if (!res.ok) return
      const data = (await res.json()) as Partial<BrandGateStatus>
      setStatus({ perTask: data.perTask ?? {} })
    } catch {
      // best effort — the board renders without badges on a blip
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const timer = setInterval(fetchStatus, 15_000)
    return () => clearInterval(timer)
  }, [fetchStatus])
  usePluginEvent('brand.dispatch_blocked', fetchStatus)
  usePluginEvent('brand.changed', fetchStatus)

  return status
}

export interface BrandHold {
  /** The missing/draft brand the task waits on. */
  brandId: string
  detail: string
}

/** Why a todo task isn't dispatching (brand gate), or null when it would. */
export function brandHoldReason(status: BrandGateStatus, task: { id: string }): BrandHold | null {
  const brandId = status.perTask[task.id]
  if (!brandId) return null
  return { brandId, detail: `waiting on brand '${brandId}' — recreate it or relink (Brands page)` }
}
