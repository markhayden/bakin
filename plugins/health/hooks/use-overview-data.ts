'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { SearchReadiness } from '@makinbakin/sdk/types'
import type {
  ContextSettingsData,
  ContextSummaryData,
  HealthSummary,
  InteractionSummaryData,
  LiveNowData,
} from '../types'
import { buildHealthOverviewViewModel } from '../lib/health-view-model'
import {
  isContextSettingsData,
  isContextSummaryData,
  isLiveNowData,
} from '../lib/agent-operational-route-guards'
import { isInteractionSummaryResponse } from '../lib/interaction-summary-route-schema'
import {
  useOverviewAgentsData,
  type OverviewAgentsDataResources,
} from './use-agents-data'
import { useHealthReport, type UseHealthReportResult } from './use-health-report'
import {
  useHealthResource,
  type UseHealthResourceResult,
} from './use-health-resource'
import { requestJsonWithGuard, requestJsonWithSchema } from '../lib/client-request'
import {
  healthLiveSummaryClientSchema,
  searchReadinessResponseSchema,
} from '../lib/route-schemas'

const LIVE_FACTS_REFRESH_MS = 15_000
const SEARCH_READINESS_REFRESH_MS = 30_000
const OPERATIONS_REFRESH_MS = 60_000
const INTERACTIONS_REFRESH_MS = 15_000

export interface SearchReadinessProjection {
  reportId: string
  readiness: SearchReadiness
}

export interface UseOverviewDataResult {
  report: UseHealthReportResult
  summary: UseHealthResourceResult<HealthSummary>
  liveNow: UseHealthResourceResult<LiveNowData>
  searchReadiness: UseHealthResourceResult<SearchReadinessProjection>
  agents: OverviewAgentsDataResources
  interactions: UseHealthResourceResult<InteractionSummaryData>
  contextReport: UseHealthResourceResult<ContextSummaryData>
  settings: UseHealthResourceResult<ContextSettingsData>
  model: ReturnType<typeof buildHealthOverviewViewModel>
  loading: boolean
  refreshing: boolean
  error: string | null
  backgroundError: string | null
  runChecks: UseHealthReportResult['runChecks']
  refresh: () => Promise<void>
}

function firstError(errors: Array<string | null>): string | null {
  return errors.find((error): error is string => error !== null) ?? null
}

/**
 * Fetch only the live facts needed by Overview. The report remains the source
 * of truth; a newer Search projection triggers a cached report read before it
 * is allowed to replace the report's embedded Search state.
 */
export function useOverviewData(): UseOverviewDataResult {
  const report = useHealthReport()
  const summary = useHealthResource<HealthSummary>('/api/plugins/health/summary', {
    intervalMs: LIVE_FACTS_REFRESH_MS,
    request: (url, context) => requestJsonWithSchema(
      url, context, 'Live system facts', healthLiveSummaryClientSchema,
    ),
  })
  const liveNow = useHealthResource<LiveNowData>('/api/plugins/health/live-now', {
    intervalMs: LIVE_FACTS_REFRESH_MS,
    request: (url, context) => requestJsonWithGuard(url, context, 'Live agent activity', isLiveNowData),
  })
  const searchReadiness = useHealthResource<SearchReadinessProjection>(
    '/api/plugins/health/search-readiness',
    {
      intervalMs: SEARCH_READINESS_REFRESH_MS,
      request: (url, context) => requestJsonWithSchema(
        url, context, 'Search readiness', searchReadinessResponseSchema,
      ),
    },
  )
  const agents = useOverviewAgentsData('24h')
  const interactions = useHealthResource<InteractionSummaryData>('/api/plugins/health/interaction-summary?window=1h', {
    intervalMs: INTERACTIONS_REFRESH_MS,
    request: (url, context) => requestJsonWithGuard(
      url,
      context,
      'Interaction activity',
      (value): value is InteractionSummaryData => isInteractionSummaryResponse(value, '1h'),
    ),
  })
  const contextReport = useHealthResource<ContextSummaryData>('/api/context-report', {
    intervalMs: OPERATIONS_REFRESH_MS,
    request: (url, context) => requestJsonWithGuard(url, context, 'Context report', isContextSummaryData),
  })
  const settings = useHealthResource<ContextSettingsData>('/api/settings', {
    intervalMs: OPERATIONS_REFRESH_MS,
    request: (url, context) => requestJsonWithGuard(url, context, 'Context settings', isContextSettingsData),
  })
  const reportRefresh = report.refresh
  const summaryRefresh = summary.refresh
  const liveNowRefresh = liveNow.refresh
  const searchReadinessRefresh = searchReadiness.refresh
  const mismatchRefreshRef = useRef<string | null>(null)

  const projection = searchReadiness.data
  const reportId = report.data?.id ?? null
  useEffect(() => {
    if (!projection || !reportId || projection.reportId === reportId) {
      mismatchRefreshRef.current = null
      return
    }
    const mismatch = `${reportId}->${projection.reportId}`
    if (mismatchRefreshRef.current === mismatch) return
    mismatchRefreshRef.current = mismatch
    void reportRefresh('background')
  }, [projection, reportId, reportRefresh])

  const matchingSearch = !report.data
    ? projection?.readiness ?? null
    : projection?.reportId === report.data.id
      ? projection.readiness
      : report.data.subsystems.search
  const model = useMemo(() => buildHealthOverviewViewModel({
    report: report.data,
    searchReadiness: matchingSearch,
    summary: summary.data,
    liveNow: liveNow.data,
  }), [liveNow.data, matchingSearch, report.data, summary.data])

  const refresh = useCallback(async () => {
    await Promise.all([
      reportRefresh('background'),
      summaryRefresh('background'),
      liveNowRefresh('background'),
      searchReadinessRefresh('background'),
      agents.refresh(),
      interactions.refresh('background'),
      contextReport.refresh('background'),
      settings.refresh('background'),
    ])
  }, [agents, contextReport, interactions, liveNowRefresh, reportRefresh, searchReadinessRefresh, settings, summaryRefresh])

  return {
    report,
    summary,
    liveNow,
    searchReadiness,
    agents,
    interactions,
    contextReport,
    settings,
    model,
    loading: report.loading,
    refreshing: report.refreshing || summary.refreshing || liveNow.refreshing || searchReadiness.refreshing
      || agents.refreshing || interactions.refreshing || contextReport.refreshing || settings.refreshing,
    error: report.error,
    backgroundError: firstError([
      report.backgroundError,
      summary.error,
      summary.backgroundError,
      liveNow.error,
      liveNow.backgroundError,
      searchReadiness.error,
      searchReadiness.backgroundError,
      agents.history.backgroundError,
      agents.latestSessions.backgroundError,
      interactions.backgroundError,
      contextReport.backgroundError,
      settings.backgroundError,
    ]),
    runChecks: report.runChecks,
    refresh,
  }
}
