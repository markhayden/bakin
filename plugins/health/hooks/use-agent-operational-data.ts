'use client'

import type {
  ContextSettingsData,
  ContextSummaryData,
  LiveNowData,
} from '../types'
import {
  isContextSettingsData,
  isContextSummaryData,
  isLiveNowData,
} from '../lib/agent-operational-route-guards'
import {
  useHealthResource,
  type HealthResourceRequestContext,
  type UseHealthResourceResult,
} from './use-health-resource'

const LIVE_POLL_MS = 15_000
const OPERATIONS_POLL_MS = 60_000

export interface AgentOperationalResources {
  liveNow: UseHealthResourceResult<LiveNowData>
  contextReport: UseHealthResourceResult<ContextSummaryData>
  settings: UseHealthResourceResult<ContextSettingsData>
  refreshing: boolean
  refresh: () => Promise<void>
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

export function useAgentOperationalData(): AgentOperationalResources {
  const liveNow = useHealthResource<LiveNowData>('/api/plugins/health/live-now', {
    intervalMs: LIVE_POLL_MS,
    request: (url, context) => requestValidated(url, context, 'Live agent activity', isLiveNowData),
  })
  const contextReport = useHealthResource<ContextSummaryData>('/api/context-report', {
    intervalMs: OPERATIONS_POLL_MS,
    request: (url, context) => requestValidated(url, context, 'Context report', isContextSummaryData),
  })
  const settings = useHealthResource<ContextSettingsData>('/api/settings', {
    intervalMs: OPERATIONS_POLL_MS,
    request: (url, context) => requestValidated(url, context, 'Context settings', isContextSettingsData),
  })

  const refresh = async () => {
    await Promise.all([
      liveNow.refresh(),
      contextReport.refresh(),
      settings.refresh(),
    ])
  }

  return {
    liveNow,
    contextReport,
    settings,
    refreshing: liveNow.refreshing || contextReport.refreshing || settings.refreshing,
    refresh,
  }
}
