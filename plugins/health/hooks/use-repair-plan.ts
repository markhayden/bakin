'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  HealthRepairApplyResult,
  HealthRepairPlan,
  HealthRepairTarget,
  HealthReport,
} from '@makinbakin/sdk/types'
import { OperationStartError, startOperation, useOperation } from '@makinbakin/sdk/hooks'
import { OPERATOR_DECLARATION_HEADERS } from '@makinbakin/sdk/utils'
import { withDeadline } from '../lib/request-deadline'
import { healthRepairApplyReportSchema, healthRepairPlanSchema } from '../lib/route-schemas'

export const HEALTH_REPAIR_PLAN_TIMEOUT_MS = 15_000
export const HEALTH_REPAIR_BODY_TIMEOUT_MS = 15_000

export interface HealthRepairRequestTimeouts {
  planMs?: number
  responseBodyMs?: number
}

export interface RepairApplyResponse {
  planId: string
  basedOnReportId: string
  results: HealthRepairApplyResult[]
  affectedCheckIds: string[]
  verifiedReportId: string
  remainingIncidentIds: string[]
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

/**
 * Plan a repair, then run it as an operation (#895): apply answers at once
 * with the operation id and the repair is followed live (`useOperation`) —
 * no request deadline, no "outcome unknown" guess. The apply rows arrive in
 * the operation's result body when it finishes.
 */
export function useRepairPlan(
  target: HealthRepairTarget,
  timeouts: HealthRepairRequestTimeouts = {},
) {
  const [plan, setPlan] = useState<HealthRepairPlan | null>(null)
  const [planning, setPlanning] = useState(false)
  const [starting, setStarting] = useState(false)
  const [started, setStarted] = useState<{ operationId: string; bootId: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const targetKey = JSON.stringify(target)
  const stableTarget = useMemo(() => JSON.parse(targetKey) as HealthRepairTarget, [targetKey])
  const followed = useOperation<RepairApplyResponse>(started?.operationId ?? null, started ? { bootId: started.bootId } : {})

  useEffect(() => {
    generationRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    setPlan(null)
    setStarted(null)
    setError(null)
    setStale(false)
    setPlanning(false)
    setStarting(false)
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
    setStarted(null)
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
  ): Promise<{ operationId: string; bootId: string } | null> => {
    if (!plan || itemIds.length === 0) return null
    const generation = ++generationRef.current
    setStarting(true)
    setError(null)
    setStale(false)
    try {
      const next = await startOperation(() => fetch('/api/plugins/health/doctor/repair/apply', {
        method: 'POST',
        // Applying here may decide a pending approval or confirm non-safe
        // items — both are the operator's word (#898).
        headers: { 'Content-Type': 'application/json', ...OPERATOR_DECLARATION_HEADERS },
        body: JSON.stringify({ planId: plan.planId, itemIds, confirmedItemIds }),
      }))
      if (generation !== generationRef.current) return null
      setStarted({ operationId: next.operationId, bootId: next.bootId })
      return next
    } catch (caught) {
      if (generation !== generationRef.current) return null
      if (caught instanceof OperationStartError && errorCode(caught.body) === 'STALE_PLAN') setStale(true)
      setError(caught instanceof Error ? caught.message : String(caught))
      return null
    } finally {
      if (generation === generationRef.current) setStarting(false)
    }
  }, [plan])

  const parsed = useMemo(() => {
    const body = followed.operation?.result?.httpStatus === 200 ? followed.operation.result.body : null
    if (!body) return null
    const result = healthRepairApplyReportSchema.safeParse(body)
    return result.success ? result.data as unknown as RepairApplyResponse : null
  }, [followed.operation])

  return {
    plan,
    planning,
    /** The POST that starts the repair is in flight. */
    starting,
    /** The running repair, followed live (null before apply). */
    operation: started ? followed.operation : null,
    children: followed.children,
    phase: started ? followed.phase : null,
    cancel: followed.cancel,
    /** The apply report, once the operation finished with one. */
    result: parsed,
    error,
    stale,
    planRepair,
    applyRepair,
  }
}
