'use client'

import { useCallback } from 'react'

import type { AgentUsage } from '@makinbakin/sdk/types'
import type {
  AgentEffortData,
  UsageHistoryData,
  UsageHistoryWindow,
} from '../types'
import {
  type AgentUsageSnapshotData,
  isAgentUsageSnapshotResponse,
  isAgentEffortResponse,
  isAgentUsageResponse,
  isUsageHistoryResponse,
} from '../lib/agent-route-schemas'
import {
  useHealthResource,
  type HealthResourceRequestContext,
  type UseHealthResourceResult,
} from './use-health-resource'
import { requestJsonWithGuard } from '../lib/client-request'

export type AgentsWindow = UsageHistoryWindow

export interface AgentsDataResources {
  history: UseHealthResourceResult<UsageHistoryData>
  effort: UseHealthResourceResult<AgentEffortData>
  latestSessions: UseHealthResourceResult<AgentUsage[]>
  latestSessionSource: AgentUsageSnapshotSource | null
  loading: boolean
  refreshing: boolean
  refresh: () => Promise<void>
}

export type OverviewAgentsDataResources = Omit<AgentsDataResources, 'effort'>

export const AGENTS_POLL_MS = 60_000

export type AgentUsageSnapshotSource = AgentUsageSnapshotData['source'] | {
  status: 'unknown'
  reason: 'legacy_server'
  failedAgents: []
}

interface AgentUsageSnapshotClientData {
  generatedAt: string | null
  source: AgentUsageSnapshotSource
  sessions: AgentUsage[]
}

const requestHistory = (window: AgentsWindow) => (url: string, context: HealthResourceRequestContext) =>
  requestJsonWithGuard(url, context, 'Usage history', (value): value is UsageHistoryData =>
    isUsageHistoryResponse(value, window))

const requestEffort = (window: AgentsWindow) => (url: string, context: HealthResourceRequestContext) =>
  requestJsonWithGuard(url, context, 'Agent outcomes', (value): value is AgentEffortData =>
    isAgentEffortResponse(value, window))

async function responseJson(response: Response, label: string): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new Error(`${label} returned invalid JSON`)
  }
}

async function requestLatestSessions(
  url: string,
  context: HealthResourceRequestContext,
): Promise<AgentUsageSnapshotClientData> {
  const response = await fetch(url, { signal: context.signal })
  if (response.status === 404) {
    const sessions = await requestJsonWithGuard(
      '/api/plugins/health/usage',
      context,
      'Latest session usage',
      isAgentUsageResponse,
    )
    return {
      generatedAt: null,
      source: { status: 'unknown', reason: 'legacy_server', failedAgents: [] },
      sessions,
    }
  }
  if (!response.ok) throw new Error(`Latest session usage could not be loaded (${response.status})`)
  const payload = await responseJson(response, 'Latest session usage')
  if (!isAgentUsageSnapshotResponse(payload)) {
    throw new Error('Latest session usage returned an invalid response')
  }
  return payload
}

function sourceMessage(source: AgentUsageSnapshotSource | null): string | null {
  if (!source || source.status === 'complete') return null
  if (source.status === 'partial') {
    return `Latest-session evidence is partial for ${source.failedAgents.join(', ')}.`
  }
  if (source.status === 'unknown') {
    return 'Latest-session coverage cannot be verified until Bakin is restarted.'
  }
  return source.reason === 'agent_roster_unavailable'
    ? 'The runtime agent roster is unavailable.'
    : 'The runtime transcript source is unavailable.'
}

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
  const latestSnapshot = useHealthResource<AgentUsageSnapshotClientData>(
    '/api/plugins/health/usage-snapshot',
    { intervalMs: AGENTS_POLL_MS, request: requestLatestSessions },
  )
  const source = latestSnapshot.data?.source ?? null
  const sourceError = source?.status === 'unavailable' ? sourceMessage(source) : null
  const sourceWarning = source?.status === 'partial' || source?.status === 'unknown'
    ? sourceMessage(source)
    : null
  const latestSessions: UseHealthResourceResult<AgentUsage[]> = {
    ...latestSnapshot,
    data: sourceError ? null : (latestSnapshot.data?.sessions ?? null),
    error: latestSnapshot.error ?? sourceError,
    backgroundError: latestSnapshot.backgroundError ?? sourceWarning,
    refresh: async (reason) => {
      const next = await latestSnapshot.refresh(reason)
      return next?.source.status === 'unavailable' ? null : (next?.sessions ?? null)
    },
  }
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
    latestSessionSource: source,
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
