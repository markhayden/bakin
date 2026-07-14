import type { AgentUsage } from '@makinbakin/sdk/types'
import type { ContextSummaryData, InteractionSummaryData, UsageHistoryData } from '../types'

export interface OverviewResource<T> {
  data: T | null
  loading: boolean
  error: string | null
  onRetry?: () => void
}

export interface OverviewTelemetry {
  history: OverviewResource<UsageHistoryData>
  sessions: OverviewResource<AgentUsage[]>
  interactions: OverviewResource<InteractionSummaryData>
  context: OverviewResource<ContextSummaryData> & { budgetBytes: number | null }
}

export const EMPTY_OVERVIEW_TELEMETRY: OverviewTelemetry = {
  history: { data: null, loading: false, error: null },
  sessions: { data: null, loading: false, error: null },
  interactions: { data: null, loading: false, error: null },
  context: { data: null, budgetBytes: null, loading: false, error: null },
}
