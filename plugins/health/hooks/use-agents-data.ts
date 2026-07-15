'use client'

import { useCallback } from 'react'

import type { AgentUsage } from '@makinbakin/sdk/types'
import type {
  AgentEffortData,
  UsageHistoryData,
  UsageHistoryWindow,
} from '../types'
import {
  isAgentEffortResponse,
  isAgentUsageResponse,
  isUsageHistoryResponse,
} from '../lib/agent-route-schemas'
import {
  useHealthResource,
  type HealthResourceRequestContext,
  type UseHealthResourceResult,
} from './use-health-resource'

export type AgentsWindow = UsageHistoryWindow

export interface AgentsDataResources {
  history: UseHealthResourceResult<UsageHistoryData>
  effort: UseHealthResourceResult<AgentEffortData>
  latestSessions: UseHealthResourceResult<AgentUsage[]>
  loading: boolean
  refreshing: boolean
  refresh: () => Promise<void>
}

export type OverviewAgentsDataResources = Omit<AgentsDataResources, 'effort'>

export const AGENTS_POLL_MS = 60_000

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

const requestHistory = (window: AgentsWindow) => (url: string, context: HealthResourceRequestContext) =>
  requestValidated(url, context, 'Usage history', (value): value is UsageHistoryData =>
    isUsageHistoryResponse(value, window))

const requestEffort = (window: AgentsWindow) => (url: string, context: HealthResourceRequestContext) =>
  requestValidated(url, context, 'Agent outcomes', (value): value is AgentEffortData =>
    isAgentEffortResponse(value, window))

const requestLatestSessions = (url: string, context: HealthResourceRequestContext) =>
  requestValidated(url, context, 'Latest session usage', isAgentUsageResponse)

/**
 * All Agents-tab reads use the shared cancellable Health resource lifecycle.
 * History and outcomes take the same window; latest-session traffic retains
 * its explicitly labeled snapshot scope.
 */
function useAgentResources(window: AgentsWindow, includeEffort: boolean): AgentsDataResources {
  const history = useHealthResource<UsageHistoryData>(
    `/api/plugins/health/usage-history?window=${window}`,
    { intervalMs: AGENTS_POLL_MS, request: requestHistory(window) },
  )
  const effort = useHealthResource<AgentEffortData>(
    includeEffort ? `/api/plugins/health/agent-effort?window=${window}` : null,
    { intervalMs: AGENTS_POLL_MS, request: requestEffort(window) },
  )
  const latestSessions = useHealthResource<AgentUsage[]>(
    '/api/plugins/health/usage',
    { intervalMs: AGENTS_POLL_MS, request: requestLatestSessions },
  )
  const refreshHistory = history.refresh
  const refreshEffort = effort.refresh
  const refreshLatestSessions = latestSessions.refresh
  const refresh = useCallback(async () => {
    await Promise.all([
      refreshHistory(),
      ...(includeEffort ? [refreshEffort()] : []),
      refreshLatestSessions(),
    ])
  }, [includeEffort, refreshEffort, refreshHistory, refreshLatestSessions])

  return {
    history,
    effort,
    latestSessions,
    loading: history.loading && (!includeEffort || effort.loading) && latestSessions.loading,
    refreshing: history.refreshing || (includeEffort && effort.refreshing) || latestSessions.refreshing,
    refresh,
  }
}

export function useAgentsData(window: AgentsWindow): AgentsDataResources {
  return useAgentResources(window, true)
}

/** Overview needs spend history and current sessions, not outcome diagnostics. */
export function useOverviewAgentsData(window: AgentsWindow): OverviewAgentsDataResources {
  const { effort: _effort, ...resources } = useAgentResources(window, false)
  return resources
}
