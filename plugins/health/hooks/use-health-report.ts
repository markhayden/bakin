'use client'

import { useCallback, useMemo } from 'react'
import { usePluginEvent } from '@makinbakin/sdk/hooks'
import type { HealthReport } from '@makinbakin/sdk/types'
import {
  useHealthResource,
  type UseHealthResourceResult,
} from './use-health-resource'
import { healthReportNeedsFreshSweep } from '../lib/health-view-model'
import {
  HEALTH_REPORT_READ_TIMEOUT_MS,
  HEALTH_REPORT_REFRESH_MS,
  HEALTH_REPORT_SWEEP_TIMEOUT_MS,
  HEALTH_REPORT_URL,
  requestHealthReport,
} from '../lib/health-report-client'

export {
  HEALTH_REPORT_READ_TIMEOUT_MS,
  HEALTH_REPORT_REFRESH_MS,
  HEALTH_REPORT_SWEEP_TIMEOUT_MS,
} from '../lib/health-report-client'

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
    request: (url, context) => requestHealthReport(url, {
      fresh: context.reason === 'explicit' || context.reason === 'stale',
      signal: context.signal,
    }),
  })
  const { data, refresh } = resource
  const stale = useMemo(() => resource.stale === true || (data !== null && isHealthReportStale(data)), [data, resource.stale])

  usePluginEvent('health.report.changed', () => {
    void refresh('reconcile')
  })

  usePluginEvent('bakin.reconcile', () => { void refresh('reconcile') })

  const runChecks = useCallback(() => refresh('explicit'), [refresh])

  return { ...resource, stale, runChecks }
}
