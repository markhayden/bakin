'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { usePluginEvent } from '@makinbakin/sdk/hooks'
import type { HealthReport } from '@makinbakin/sdk/types'
import {
  useHealthResource,
  type HealthResourceRequestContext,
  type UseHealthResourceResult,
} from './use-health-resource'
import { healthReportNeedsFreshSweep } from '../lib/health-view-model'

const HEALTH_REPORT_URL = '/api/plugins/health/doctor'
export const HEALTH_REPORT_REFRESH_MS = 60_000
export const HEALTH_REPORT_READ_TIMEOUT_MS = 15_000
export const HEALTH_REPORT_SWEEP_TIMEOUT_MS = 60_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseHealthReportResponse(value: unknown): HealthReport {
  if (!isRecord(value)) throw new Error('Health report response was invalid')
  const report = value
  if (typeof report.id !== 'string'
    || typeof report.revision !== 'number'
    || typeof report.generatedAt !== 'string'
    || typeof report.overallStatus !== 'string'
    || !Array.isArray(report.checks)
    || !Array.isArray(report.observations)
    || !Array.isArray(report.incidents)
    || !isRecord(report.subsystems)
    || !isRecord(report.subsystems.search)
    || !isRecord(report.summary)) {
    throw new Error('Health report response was invalid')
  }
  return report as unknown as HealthReport
}

async function requestHealthReport(
  url: string,
  context: HealthResourceRequestContext,
): Promise<HealthReport> {
  const fresh = context.reason === 'explicit' || context.reason === 'stale'
  const requestUrl = fresh ? `${url}${url.includes('?') ? '&' : '?'}fresh=true` : url
  const response = await fetch(requestUrl, { signal: context.signal })
  if (!response.ok) throw new Error(`Request failed (${response.status})`)
  return parseHealthReportResponse(await response.json())
}

/** Whether the cached report needs a report-only sweep rather than another cached read. */
export function isHealthReportStale(report: HealthReport, now: number = Date.now()): boolean {
  return healthReportNeedsFreshSweep(report, now)
}

export interface UseHealthReportResult extends UseHealthResourceResult<HealthReport> {
  /** True when the displayed report contains missing, failed, or expired evidence. */
  stale: boolean
  /** Request a fresh, globally single-flight report sweep. */
  runChecks: () => Promise<HealthReport | null>
}

export function useHealthReport(): UseHealthReportResult {
  const resource = useHealthResource<HealthReport>(HEALTH_REPORT_URL, {
    intervalMs: HEALTH_REPORT_REFRESH_MS,
    timeoutMs: (reason) => reason === 'explicit' || reason === 'stale'
      ? HEALTH_REPORT_SWEEP_TIMEOUT_MS
      : HEALTH_REPORT_READ_TIMEOUT_MS,
    request: requestHealthReport,
  })
  const { data, refresh } = resource
  const autoRefreshAttemptedRef = useRef(false)
  const stale = useMemo(() => resource.stale === true || (data !== null && isHealthReportStale(data)), [data, resource.stale])

  usePluginEvent('health.report.changed', () => {
    void refresh('background')
  })

  useEffect(() => {
    if (!data) return
    if (!isHealthReportStale(data)) {
      autoRefreshAttemptedRef.current = false
      return
    }
    if (autoRefreshAttemptedRef.current) return
    autoRefreshAttemptedRef.current = true
    void refresh('stale')
  }, [data, refresh])

  const runChecks = useCallback(() => refresh('explicit'), [refresh])

  return { ...resource, stale, runChecks }
}
