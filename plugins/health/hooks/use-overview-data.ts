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
import { useAgentsData, type AgentsDataResources } from './use-agents-data'
import { useHealthReport, type UseHealthReportResult } from './use-health-report'
import {
  useHealthResource,
  type HealthResourceRequestContext,
  type UseHealthResourceResult,
} from './use-health-resource'

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
  agents: AgentsDataResources
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || isNonNegativeNumber(value)
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isInteractionCategory(value: unknown): value is InteractionSummaryData['categories'][number]['key'] {
  return value === 'tools' || value === 'api' || value === 'agents'
}

function isInteractionSummaryData(value: unknown): value is InteractionSummaryData {
  const validShape = isRecord(value)
    && (value.window === '5m' || value.window === '1h' || value.window === '24h')
    && isRecord(value.coverage)
    && isIsoTimestamp(value.coverage.startsAt)
    && ((value.coverage.reason === 'full_window' && value.coverage.hasFullWindow === true)
      || ((value.coverage.reason === 'process_restart' || value.coverage.reason === 'buffer_limit')
        && value.coverage.hasFullWindow === false))
    && isRecord(value.totals)
    && isNonNegativeNumber(value.totals.count)
    && isNonNegativeNumber(value.totals.errors)
    && isNonNegativeNumber(value.totals.unverified)
    && isNonNegativeNumber(value.totals.foreground)
    && isNonNegativeNumber(value.totals.background)
    && Array.isArray(value.categories)
    && value.categories.every((row) => isRecord(row)
      && isInteractionCategory(row.key)
      && isNonNegativeNumber(row.count)
      && isNonNegativeNumber(row.errors))
    && Array.isArray(value.topDestinations)
    && value.topDestinations.every((row) => isRecord(row)
      && isInteractionCategory(row.category)
      && typeof row.name === 'string'
      && isNonNegativeNumber(row.count)
      && isNonNegativeNumber(row.errors)
      && isNullableNonNegativeNumber(row.medianDurationMs))
    && Array.isArray(value.timeBuckets)
    && value.timeBuckets.every((bucket) => isRecord(bucket)
      && typeof bucket.start === 'string'
      && isNonNegativeNumber(bucket.count)
      && isNonNegativeNumber(bucket.failureCount)
      && isNonNegativeNumber(bucket.failureRate))
  if (!validShape) return false

  const summary = value as unknown as InteractionSummaryData
  const categoryKeys = new Set(summary.categories.map((category) => category.key))
  const categoryCount = summary.categories.reduce((total, category) => total + category.count, 0)
  const categoryErrors = summary.categories.reduce((total, category) => total + category.errors, 0)
  const bucketCount = summary.timeBuckets.reduce((total, bucket) => total + bucket.count, 0)
  const bucketErrors = summary.timeBuckets.reduce((total, bucket) => total + bucket.failureCount, 0)

  return summary.categories.length === 3
    && categoryKeys.size === 3
    && summary.categories.every((category) => category.errors <= category.count)
    && summary.topDestinations.every((destination) => destination.errors <= destination.count)
    && summary.timeBuckets.every((bucket) => bucket.failureCount <= bucket.count)
    && summary.totals.errors + summary.totals.unverified <= summary.totals.count
    && summary.totals.foreground + summary.totals.background === summary.totals.count
    && categoryCount === summary.totals.count
    && categoryErrors === summary.totals.errors
    && bucketCount === summary.totals.count
    && bucketErrors === summary.totals.errors
}

async function requestValidated<T>(
  url: string,
  context: HealthResourceRequestContext,
  label: string,
  validate: (value: unknown) => value is T,
): Promise<T> {
  const response = await fetch(url, { signal: context.signal })
  if (!response.ok) throw new Error(`${label} could not be loaded (${response.status})`)
  const payload: unknown = await response.json()
  if (!validate(payload)) throw new Error(`${label} returned an invalid response`)
  return payload
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
  })
  const liveNow = useHealthResource<LiveNowData>('/api/plugins/health/live-now', {
    intervalMs: LIVE_FACTS_REFRESH_MS,
    request: (url, context) => requestValidated(url, context, 'Live agent activity', isLiveNowData),
  })
  const searchReadiness = useHealthResource<SearchReadinessProjection>(
    '/api/plugins/health/search-readiness',
    { intervalMs: SEARCH_READINESS_REFRESH_MS },
  )
  const agents = useAgentsData('24h')
  const interactions = useHealthResource<InteractionSummaryData>('/api/plugins/health/interaction-summary?window=1h', {
    intervalMs: INTERACTIONS_REFRESH_MS,
    request: (url, context) => requestValidated(url, context, 'Interaction activity', isInteractionSummaryData),
  })
  const contextReport = useHealthResource<ContextSummaryData>('/api/context-report', {
    intervalMs: OPERATIONS_REFRESH_MS,
    request: (url, context) => requestValidated(url, context, 'Context report', isContextSummaryData),
  })
  const settings = useHealthResource<ContextSettingsData>('/api/settings', {
    intervalMs: OPERATIONS_REFRESH_MS,
    request: (url, context) => requestValidated(url, context, 'Context settings', isContextSettingsData),
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
