import type {
  UsageEvidenceCoverageStatus,
  UsageHistoryData,
} from '../types'

export interface ScopedUsageHistory {
  history: UsageHistoryData
  status: UsageEvidenceCoverageStatus
  includedAgentCount: number
  excludedAgentCount: number
}

/**
 * Restrict aggregate usage to agents whose current transcript sweep completed.
 * Durable rows can outlive the scanner process, so rows alone are never proof
 * that a current fleet total is complete.
 */
export function scopeUsageHistoryToCompleteEvidence(history: UsageHistoryData): ScopedUsageHistory {
  const status = history.coverage?.status ?? (history.scannedAt ? 'complete' : 'unavailable')
  const knownAgents = new Set([
    ...history.byAgent.map((row) => row.agent),
    ...history.byAgentDay.map((row) => row.agent),
    ...(history.coverage?.agents.map((entry) => entry.agent) ?? []),
  ])

  // Mixed-version fallback: before the explicit coverage contract existed,
  // a completed scan timestamp was the only available completeness signal.
  if (!history.coverage && history.scannedAt) {
    return {
      history,
      status,
      includedAgentCount: knownAgents.size,
      excludedAgentCount: 0,
    }
  }

  const completeAgents = new Set(
    history.coverage?.agents
      .filter((entry) => entry.status === 'complete')
      .map((entry) => entry.agent) ?? [],
  )
  const scoped = {
    ...history,
    // Fleet day rollups cannot be separated safely. Rebuild charts only from
    // the attributed agent×day cells retained below.
    byDay: [],
    byAgent: history.byAgent.filter((row) => completeAgents.has(row.agent)),
    byAgentDay: history.byAgentDay.filter((row) => completeAgents.has(row.agent)),
  }

  return {
    history: scoped,
    status,
    includedAgentCount: completeAgents.size,
    excludedAgentCount: [...knownAgents].filter((agent) => !completeAgents.has(agent)).length,
  }
}
