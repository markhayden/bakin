'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  HealthRepairApplyResult,
  HealthRepairPlan,
  HealthRepairTarget,
  HealthReport,
} from '@makinbakin/sdk/types'
import { withDeadline } from '../lib/request-deadline'
import { healthRepairApplyReportSchema, healthRepairPlanSchema } from '../lib/route-schemas'

export const HEALTH_REPAIR_PLAN_TIMEOUT_MS = 15_000
export const HEALTH_REPAIR_APPLY_TIMEOUT_MS = 5 * 60_000
export const HEALTH_REPAIR_BODY_TIMEOUT_MS = 15_000

export interface HealthRepairRequestTimeouts {
  planMs?: number
  applyMs?: number
  responseBodyMs?: number
}

export class HealthRepairOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HealthRepairOutcomeUnknownError'
  }
}

interface RepairApplyResponse {
  planId: string
  basedOnReportId: string
  results: HealthRepairApplyResult[]
  affectedCheckIds: string[]
  verifiedReportId: string
  verifiedIncidentIds: string[]
  report: HealthReport
}

function errorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === 'object' && 'error' in value && typeof value.error === 'string') return value.error
  return fallback
}

function errorCode(value: unknown): string | null {
  return value && typeof value === 'object' && 'code' in value && typeof value.code === 'string'
    ? value.code
    : null
}

async function responseJson(response: Response): Promise<unknown> {
  return await response.json().catch(() => null)
}

function parseRepairPlan(value: unknown): HealthRepairPlan {
  const parsed = healthRepairPlanSchema.safeParse(value)
  if (!parsed.success) throw new Error('Repair plan response was invalid')
  return parsed.data as unknown as HealthRepairPlan
}

function parseRepairApply(value: unknown): RepairApplyResponse {
  const parsed = healthRepairApplyReportSchema.safeParse(value)
  if (!parsed.success) {
    throw new HealthRepairOutcomeUnknownError(
      'The repair server responded, but Bakin could not confirm the result. Refresh Health before trying again.',
    )
  }
  return parsed.data as unknown as RepairApplyResponse
}

export function useRepairPlan(
  target: HealthRepairTarget,
  timeouts: HealthRepairRequestTimeouts = {},
) {
  const [plan, setPlan] = useState<HealthRepairPlan | null>(null)
  const [result, setResult] = useState<RepairApplyResponse | null>(null)
  const [planning, setPlanning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [outcomeUnknown, setOutcomeUnknown] = useState(false)
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
    setOutcomeUnknown(false)
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
    setOutcomeUnknown(false)
    setResult(null)
    let timedOut = false
    try {
      const planMs = timeouts.planMs ?? HEALTH_REPAIR_PLAN_TIMEOUT_MS
      const response = await withDeadline(
        fetch('/api/plugins/health/doctor/repair/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: stableTarget }),
          signal: controller.signal,
        }),
        planMs,
        {
          onTimeout: () => {
            timedOut = true
            controller.abort()
          },
          timeoutError: () => new Error('Repair planning timed out. Try again.'),
        },
      )
      const bodyMs = timeouts.responseBodyMs ?? HEALTH_REPAIR_BODY_TIMEOUT_MS
      const body = await withDeadline(responseJson(response), bodyMs, {
        onTimeout: () => {
          timedOut = true
          controller.abort()
        },
        timeoutError: () => new Error('The repair plan response timed out. Try again.'),
      })
      if (!response.ok) throw new Error(errorMessage(body, `Repair planning failed (${response.status})`))
      if (generation !== generationRef.current || controller.signal.aborted) return null
      const next = parseRepairPlan(body)
      setPlan(next)
      return next
    } catch (caught) {
      if ((!timedOut && controller.signal.aborted) || generation !== generationRef.current) return null
      setError(caught instanceof Error ? caught.message : String(caught))
      return null
    } finally {
      if (generation === generationRef.current) setPlanning(false)
    }
  }, [stableTarget, timeouts.planMs, timeouts.responseBodyMs])

  const applyRepair = useCallback(async (
    itemIds: string[],
    confirmedItemIds: string[],
  ): Promise<RepairApplyResponse | null> => {
    if (!plan || itemIds.length === 0) return null
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const generation = ++generationRef.current
    setApplying(true)
    setError(null)
    setStale(false)
    setOutcomeUnknown(false)
    try {
      const applyMs = timeouts.applyMs ?? HEALTH_REPAIR_APPLY_TIMEOUT_MS
      const response = await withDeadline(
        fetch('/api/plugins/health/doctor/repair/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId: plan.planId, itemIds, confirmedItemIds }),
          signal: controller.signal,
        }),
        applyMs,
        {
          onTimeout: () => controller.abort(),
          timeoutError: () => new HealthRepairOutcomeUnknownError(
            'The repair request timed out and may still have completed. Refresh Health to confirm the current state.',
          ),
        },
      )
      const bodyMs = timeouts.responseBodyMs ?? HEALTH_REPAIR_BODY_TIMEOUT_MS
      let body: unknown
      try {
        body = await withDeadline(responseJson(response), bodyMs, {
          onTimeout: () => controller.abort(),
          timeoutError: () => new Error(`Repair response timed out after ${bodyMs}ms`),
        })
      } catch (caught) {
        if (response.ok) {
          throw new HealthRepairOutcomeUnknownError(
            'The repair server responded, but Bakin could not read its confirmation. Refresh Health to confirm the current state.',
          )
        }
        throw caught
      }
      if (!response.ok) {
        if (errorCode(body) === 'STALE_PLAN') setStale(true)
        throw new Error(errorMessage(body, `Repair apply failed (${response.status})`))
      }
      if (generation !== generationRef.current) return null
      const next = parseRepairApply(body)
      setResult(next)
      return next
    } catch (caught) {
      if (generation !== generationRef.current) return null
      setOutcomeUnknown(caught instanceof HealthRepairOutcomeUnknownError)
      setError(caught instanceof Error ? caught.message : String(caught))
      return null
    } finally {
      if (generation === generationRef.current) setApplying(false)
    }
  }, [plan, timeouts.applyMs, timeouts.responseBodyMs])

  return { plan, result, planning, applying, error, stale, outcomeUnknown, planRepair, applyRepair }
}
