import type { AgentUsage } from '@makinbakin/sdk/types'
import type {
  AgentEffortData,
  AgentEffortRow,
  ContextSummaryAgent,
  ContextSummaryData,
  LiveNowData,
  LiveRunEntry,
  UsageEvidenceCoverageStatus,
  UsageHistoryData,
} from '../types'

export type AgentReviewState = 'review' | 'clear' | 'unknown'

type HistoryRow = UsageHistoryData['byAgent'][number]

export interface AgentPulseRow {
  agent: string
  reviewState: AgentReviewState
  effort: AgentEffortRow | null
  history: HistoryRow | null
  latestSession: AgentUsage | null
  liveRun: LiveRunEntry | null
  liveRunCount: number
  context: ContextSummaryAgent | null
  startupContextPercent: number | null
  historyCostUsdMicros: number | null
  costedMessages: number
  messageCount: number
  observedTokens: number | null
  usageCoverage: UsageEvidenceCoverageStatus
  evidenceAligned: boolean
}

interface AgentPulseInput {
  effort: AgentEffortData | null
  history: UsageHistoryData | null
  latestSessions: AgentUsage[]
  liveNow: LiveNowData | null
  context: ContextSummaryData | null
  contextBudgetBytes: number | null
}

function byAgent<T>(rows: T[], getAgent: (row: T) => string): Map<string, T> {
  return new Map(rows.map((row) => [getAgent(row), row]))
}

function usageCoverageForAgent(
  agent: string,
  history: UsageHistoryData | null,
  effort: AgentEffortData | null,
  historyRow: HistoryRow | null,
  effortRow: AgentEffortRow | null,
): UsageEvidenceCoverageStatus {
  const explicit = history?.coverage?.agents.find((entry) => entry.agent === agent)?.status
    ?? effort?.coverage?.agents.find((entry) => entry.agent === agent)?.status
  if (explicit) return explicit
  if (history?.coverage || effort?.coverage) return 'unavailable'
  // Mixed-version fallback: only evidence that names this agent can establish
  // coverage. A fleet-level timestamp alone cannot turn an absent row into 0.
  if ((history?.scannedAt && historyRow)
    || (effort?.scannedAt && effortRow !== null && effortRow.totalObservedTokens !== null)) {
    return 'complete'
  }
  return 'unavailable'
}

/** Join independently loaded agent evidence without manufacturing healthy zeroes. */
export function buildAgentPulseRows({
  effort,
  history,
  latestSessions,
  liveNow,
  context,
  contextBudgetBytes,
}: AgentPulseInput): AgentPulseRow[] {
  const efforts = byAgent(effort?.agents ?? [], (row) => row.agent)
  const histories = byAgent(history?.byAgent ?? [], (row) => row.agent)
  const sessions = byAgent(latestSessions, (row) => row.agent)
  const liveRuns = new Map<string, LiveRunEntry[]>()
  for (const run of liveNow?.runs ?? []) {
    const runs = liveRuns.get(run.agent) ?? []
    runs.push(run)
    liveRuns.set(run.agent, runs)
  }
  const contexts = byAgent(context?.agents ?? [], (row) => row.agentId)
  const agents = new Set([
    ...efforts.keys(),
    ...histories.keys(),
    ...(history?.coverage?.agents.map((entry) => entry.agent) ?? []),
    ...(effort?.coverage?.agents.map((entry) => entry.agent) ?? []),
    ...sessions.keys(),
    ...liveRuns.keys(),
    ...contexts.keys(),
  ])
  const evidenceAligned = Boolean(
    effort?.scannedAt
    && history?.scannedAt
    && effort.scannedAt === history.scannedAt,
  )

  return [...agents].map((agent): AgentPulseRow => {
    const effortRow = efforts.get(agent) ?? null
    const historyRow = histories.get(agent) ?? null
    const contextRow = contexts.get(agent) ?? null
    const agentLiveRuns = liveRuns.get(agent) ?? []
    const liveRun = [...agentLiveRuns].sort((left, right) => right.runningForMs - left.runningForMs)[0] ?? null
    const usageCoverage = usageCoverageForAgent(agent, history, effort, historyRow, effortRow)
    const reviewState: AgentReviewState = effortRow && effortRow.flags.length > 0
      ? 'review'
      : !effortRow || effortRow.totalObservedTokens === null || usageCoverage !== 'complete'
        ? 'unknown'
        : 'clear'
    const startupContextPercent = contextRow && contextBudgetBytes && contextBudgetBytes > 0
      ? Math.round((contextRow.estimatedMaxTaskBytes / contextBudgetBytes) * 100)
      : null

    return {
      agent,
      reviewState,
      effort: effortRow,
      history: historyRow,
      latestSession: sessions.get(agent) ?? null,
      liveRun,
      liveRunCount: agentLiveRuns.length,
      context: contextRow,
      startupContextPercent,
      historyCostUsdMicros: usageCoverage === 'complete' ? historyRow?.costUsdMicros ?? null : null,
      costedMessages: usageCoverage === 'complete' ? historyRow?.costedMessages ?? 0 : 0,
      messageCount: usageCoverage === 'complete' ? historyRow?.messageCount ?? 0 : 0,
      observedTokens: usageCoverage === 'complete'
        ? historyRow?.tokens.total ?? effortRow?.totalObservedTokens ?? 0
        : null,
      usageCoverage,
      evidenceAligned,
    }
  }).sort((left, right) => {
    const reviewOrder = Number(right.reviewState === 'review') - Number(left.reviewState === 'review')
    if (reviewOrder !== 0) return reviewOrder
    const liveOrder = Number(Boolean(right.liveRun)) - Number(Boolean(left.liveRun))
    if (liveOrder !== 0) return liveOrder
    const usageOrder = (right.observedTokens ?? -1) - (left.observedTokens ?? -1)
    if (usageOrder !== 0) return usageOrder
    return left.agent.localeCompare(right.agent)
  })
}
