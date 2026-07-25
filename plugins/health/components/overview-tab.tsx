'use client'

import type { HealthIncident } from '@makinbakin/sdk/types'
import { useOverviewData, type UseOverviewDataResult } from '../hooks/use-overview-data'
import type { HealthOverviewViewModel } from '../lib/health-view-model'
import { OverviewAlerts } from './overview-alerts'
import { HealthTabIntro } from './health-tab-intro'
import { OverviewOperations } from './overview-operations'
import { OverviewPlatformPulse } from './overview-platform-pulse'
import {
  EMPTY_OVERVIEW_TELEMETRY,
  type OverviewTelemetry,
} from './overview-telemetry'

export interface OverviewTabViewProps {
  model: HealthOverviewViewModel
  telemetry?: OverviewTelemetry
  loading?: boolean
  checking?: boolean
  error?: string | null
  backgroundError?: string | null
  onRetry?: () => void
  onRepair?: (incident: HealthIncident) => void
  onRerun?: (incident: HealthIncident) => void
  onAck?: (incident: HealthIncident, action: 'ack' | 'snooze' | 'clear', window?: '24h' | '7d') => void
}

export function OverviewTabView({
  model,
  telemetry = EMPTY_OVERVIEW_TELEMETRY,
  loading = false,
  checking = false,
  error = null,
  backgroundError = null,
  onRetry,
  onRepair,
  onRerun,
  onAck,
}: OverviewTabViewProps) {
  return (
    <div className="min-w-0 space-y-4" data-testid="health-overview-tab">
      <HealthTabIntro
        title="Overview"
        description="See what needs attention, fix it, and confirm Bakin is working."
      />

      <OverviewPlatformPulse
        model={model}
        loading={loading}
        checking={checking}
        error={error}
        onRetry={onRetry}
      />

      {backgroundError && model.reportId && (
        <p className="rounded-lg bg-warning/5 px-3 py-2 text-xs text-warning ring-1 ring-warning/20">
          Some live data could not refresh. Showing the last verified snapshot: {backgroundError}
        </p>
      )}

      <OverviewAlerts model={model} onRepair={onRepair} onRerun={onRerun} onAck={onAck} />

      <OverviewOperations model={model} telemetry={telemetry} />
    </div>
  )
}

export interface OverviewTabProps {
  /** Allows the page shell to share one report hook with its Run checks action. */
  data?: UseOverviewDataResult
  onRepair?: (incident: HealthIncident) => void
  onRerun?: (incident: HealthIncident) => void
  onAck?: (incident: HealthIncident, action: 'ack' | 'snooze' | 'clear', window?: '24h' | '7d') => void
}

function ConnectedOverviewTab({
  data,
  onRepair,
  onRerun,
  onAck,
}: Required<Pick<OverviewTabProps, 'data'>> & Omit<OverviewTabProps, 'data'>) {
  const contextError = data.contextReport.error ?? data.settings.error
  const contextReady = !data.contextReport.loading && !data.settings.loading && contextError === null
  const telemetry: OverviewTelemetry = {
    history: {
      data: data.agents.history.data,
      loading: data.agents.history.loading,
      error: data.agents.history.error,
      onRetry: () => { void data.agents.history.refresh() },
    },
    sessions: {
      data: data.agents.latestSessions.data,
      loading: data.agents.latestSessions.loading,
      error: data.agents.latestSessions.error,
      onRetry: () => { void data.agents.latestSessions.refresh() },
    },
    interactions: {
      data: data.interactions.data,
      loading: data.interactions.loading,
      error: data.interactions.error,
      onRetry: () => { void data.interactions.refresh() },
    },
    context: {
      data: contextReady ? data.contextReport.data : null,
      budgetBytes: data.settings.data?.dispatch?.contextBudgetBytes ?? null,
      loading: data.contextReport.loading || data.settings.loading,
      error: contextError,
      onRetry: () => { void Promise.all([data.contextReport.refresh(), data.settings.refresh()]) },
    },
  }

  return (
    <OverviewTabView
      model={data.model}
      telemetry={telemetry}
      loading={data.loading}
      checking={data.report.refreshing}
      error={data.error}
      backgroundError={data.backgroundError}
      onRetry={() => { void data.refresh() }}
      onRepair={onRepair}
      onRerun={onRerun ?? (() => { void data.runChecks() })}
      onAck={onAck}
    />
  )
}

function OwnedOverviewTab(props: Omit<OverviewTabProps, 'data'>) {
  const data = useOverviewData()
  return <ConnectedOverviewTab data={data} {...props} />
}

export function OverviewTab({ data, ...props }: OverviewTabProps) {
  return data ? <ConnectedOverviewTab data={data} {...props} /> : <OwnedOverviewTab {...props} />
}
