'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  HealthRepairApplyResult,
  HealthRepairPlan,
  HealthRepairTarget,
  HealthReport,
} from '@makinbakin/sdk/types'

interface RepairApplyResponse {
  planId: string
  basedOnReportId: string
  results: HealthRepairApplyResult[]
  affectedCheckIds: string[]
  verifiedReportId: string
  verifiedIncidentIds: string[]
  report: HealthReport
}

interface RepairErrorResponse {
  error?: string
  code?: string
  itemIds?: string[]
}

function errorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && 'error' in value && typeof value.error === 'string') return value.error
  return fallback
}

export function useRepairPlan(target: HealthRepairTarget) {
  const [plan, setPlan] = useState<HealthRepairPlan | null>(null)
  const [result, setResult] = useState<RepairApplyResponse | null>(null)
  const [planning, setPlanning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const targetKey = JSON.stringify(target)
  const stableTarget = useMemo(() => JSON.parse(targetKey) as HealthRepairTarget, [targetKey])

  useEffect(() => {
    generationRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    setPlan(null)
    setResult(null)
    setError(null)
    setStale(false)
    setPlanning(false)
    setApplying(false)
    return () => {
      generationRef.current += 1
      controllerRef.current?.abort()
      controllerRef.current = null
    }
  }, [targetKey])

  const planRepair = useCallback(async (): Promise<HealthRepairPlan | null> => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const generation = ++generationRef.current
    setPlanning(true)
    setError(null)
    setStale(false)
    setResult(null)
    try {
      const response = await fetch('/api/plugins/health/doctor/repair/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: stableTarget }),
        signal: controller.signal,
      })
      const body = await response.json() as HealthRepairPlan | RepairErrorResponse
      if (!response.ok) throw new Error(errorMessage(body, `Repair planning failed (${response.status})`))
      if (generation !== generationRef.current || controller.signal.aborted) return null
      const next = body as HealthRepairPlan
      setPlan(next)
      return next
    } catch (caught) {
      if (controller.signal.aborted || generation !== generationRef.current) return null
      setError(caught instanceof Error ? caught.message : String(caught))
      return null
    } finally {
      if (generation === generationRef.current) setPlanning(false)
    }
  }, [stableTarget])

  const applyRepair = useCallback(async (
    itemIds: string[],
    confirmedItemIds: string[],
  ): Promise<RepairApplyResponse | null> => {
    if (!plan || itemIds.length === 0) return null
    const generation = ++generationRef.current
    setApplying(true)
    setError(null)
    setStale(false)
    try {
      const response = await fetch('/api/plugins/health/doctor/repair/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan.planId, itemIds, confirmedItemIds }),
      })
      const body = await response.json() as RepairApplyResponse | RepairErrorResponse
      if (!response.ok) {
        if ((body as RepairErrorResponse).code === 'STALE_PLAN') setStale(true)
        throw new Error(errorMessage(body, `Repair apply failed (${response.status})`))
      }
      if (generation !== generationRef.current) return null
      const next = body as RepairApplyResponse
      setResult(next)
      return next
    } catch (caught) {
      if (generation !== generationRef.current) return null
      setError(caught instanceof Error ? caught.message : String(caught))
      return null
    } finally {
      if (generation === generationRef.current) setApplying(false)
    }
  }, [plan])

  return { plan, result, planning, applying, error, stale, planRepair, applyRepair }
}
