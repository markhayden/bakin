'use client'

import type { AgentUsage } from '@makinbakin/sdk/types'
import type {
  AgentEffortData,
  UsageHistoryData,
  UsageHistoryWindow,
} from '../types'
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

export const AGENTS_POLL_MS = 60_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isNullableNonNegativeNumber(value: unknown): value is number | null {
  return value === null || isNonNegativeNumber(value)
}

function hasTokenCounts(value: unknown): boolean {
  return isRecord(value)
    && isNonNegativeNumber(value.input)
    && isNonNegativeNumber(value.output)
    && isNonNegativeNumber(value.cacheRead)
    && isNonNegativeNumber(value.cacheWrite)
    && isNonNegativeNumber(value.total)
}

function isUsageRollup(value: unknown): boolean {
  return isRecord(value)
    && hasTokenCounts(value.tokens)
    && isNullableNonNegativeNumber(value.costUsdMicros)
    && isNonNegativeNumber(value.costedMessages)
    && isNonNegativeNumber(value.messageCount)
}

function isUsageHistoryData(value: unknown): value is UsageHistoryData {
  return isRecord(value)
    && (value.window === '24h' || value.window === '7d' || value.window === '30d')
    && typeof value.since === 'string'
    && typeof value.throughDay === 'string'
    && (value.scannedAt === null || typeof value.scannedAt === 'string')
    && Array.isArray(value.byAgent)
    && value.byAgent.every((row) => isUsageRollup(row) && typeof row.agent === 'string')
    && Array.isArray(value.byDay)
    && value.byDay.every((row) => isUsageRollup(row) && typeof row.day === 'string')
    && Array.isArray(value.byAgentDay)
    && value.byAgentDay.every((row) => isUsageRollup(row) && typeof row.agent === 'string' && typeof row.day === 'string')
}

function isAgentEffortData(value: unknown): value is AgentEffortData {
  return isRecord(value)
    && (value.window === '24h' || value.window === '7d' || value.window === '30d')
    && (value.scannedAt === null || typeof value.scannedAt === 'string')
    && Array.isArray(value.agents)
    && value.agents.every((row) => isRecord(row)
      && typeof row.agent === 'string'
      && isNonNegativeNumber(row.windowTokens)
      && isNullableNonNegativeNumber(row.windowCostUsdMicros)
      && isNonNegativeNumber(row.runs)
      && isNonNegativeNumber(row.completions)
      && isNullableNonNegativeNumber(row.tokensPerCompletion)
      && isNullableNonNegativeNumber(row.totalObservedTokens)
      && isNullableNonNegativeNumber(row.unattributedTokens)
      && Array.isArray(row.flags)
      && row.flags.every((flag) => isRecord(flag)
        && (flag.kind === 'effort-no-outcome' || flag.kind === 'spike' || flag.kind === 'unattributed')
        && typeof flag.message === 'string'))
}

function isAgentUsage(value: unknown): value is AgentUsage {
  return isRecord(value)
    && typeof value.agent === 'string'
    && typeof value.sessionId === 'string'
    && typeof value.sessionStarted === 'string'
    && typeof value.model === 'string'
    && isNonNegativeNumber(value.messages)
    && hasTokenCounts(value.tokens)
    && isRecord(value.cost)
    && isNullableNonNegativeNumber(value.cost.input)
    && isNullableNonNegativeNumber(value.cost.output)
    && isNullableNonNegativeNumber(value.cost.cacheRead)
    && isNullableNonNegativeNumber(value.cost.cacheWrite)
    && isNullableNonNegativeNumber(value.cost.total)
    && (value.cost.source === 'runtime' || value.cost.source === 'unavailable')
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

const requestHistory = (url: string, context: HealthResourceRequestContext) =>
  requestValidated(url, context, 'Usage history', isUsageHistoryData)

const requestEffort = (url: string, context: HealthResourceRequestContext) =>
  requestValidated(url, context, 'Agent outcomes', isAgentEffortData)

const requestLatestSessions = (url: string, context: HealthResourceRequestContext) =>
  requestValidated(url, context, 'Latest session usage', (value): value is AgentUsage[] =>
    Array.isArray(value) && value.every(isAgentUsage))

/**
 * All Agents-tab reads use the shared cancellable Health resource lifecycle.
 * History and outcomes take the same window; latest-session traffic retains
 * its explicitly labeled snapshot scope.
 */
export function useAgentsData(window: AgentsWindow): AgentsDataResources {
  const history = useHealthResource<UsageHistoryData>(
    `/api/plugins/health/usage-history?window=${window}`,
    { intervalMs: AGENTS_POLL_MS, request: requestHistory },
  )
  const effort = useHealthResource<AgentEffortData>(
    `/api/plugins/health/agent-effort?window=${window}`,
    { intervalMs: AGENTS_POLL_MS, request: requestEffort },
  )
  const latestSessions = useHealthResource<AgentUsage[]>(
    '/api/plugins/health/usage',
    { intervalMs: AGENTS_POLL_MS, request: requestLatestSessions },
  )
  const refresh = async () => {
    await Promise.all([
      history.refresh(),
      effort.refresh(),
      latestSessions.refresh(),
    ])
  }

  return {
    history,
    effort,
    latestSessions,
    loading: history.loading && effort.loading && latestSessions.loading,
    refreshing: history.refreshing || effort.refreshing || latestSessions.refreshing,
    refresh,
  }
}
