'use client'

import { useQueryState } from '@makinbakin/sdk/hooks'
import { SegmentedControl } from '@makinbakin/sdk/patterns'
import { useAgentsData, type AgentsWindow } from '../hooks/use-agents-data'
import { useAgentOperationalData } from '../hooks/use-agent-operational-data'
import { AgentPulse } from './agent-pulse'
import { AgentsUsageChart } from './agents-usage-chart'
import { HealthTabIntro } from './health-tab-intro'

const WINDOWS: readonly AgentsWindow[] = ['24h', '7d', '30d']
const WINDOW_LABEL: Record<AgentsWindow, string> = {
  '24h': '24h',
  '7d': '7d',
  '30d': '30d',
}

function agentsWindow(value: string): AgentsWindow {
  return WINDOWS.includes(value as AgentsWindow) ? value as AgentsWindow : '24h'
}

export function AgentsTab() {
  const [windowParam, setWindowParam] = useQueryState('agents_window', '24h')
  const window = agentsWindow(windowParam)
  const resources = useAgentsData(window)
  const operations = useAgentOperationalData()
  const backgroundErrors = [
    resources.history.backgroundError,
    resources.effort.backgroundError,
    resources.latestSessions.backgroundError,
    operations.liveNow.backgroundError,
    operations.contextReport.backgroundError,
    operations.settings.backgroundError,
  ].filter((message): message is string => Boolean(message))

  return (
    <div className="min-w-0 space-y-bakin-6" data-testid="health-agents-tab">
      <HealthTabIntro
        title="Agents"
        description="Compare token use, cost, tracked work, and recorded outcomes across agents. Spot unusual spend or missing results; today’s totals are still in progress."
        actions={(
          <>
            <SegmentedControl
              options={WINDOWS.map((value) => ({ value, label: WINDOW_LABEL[value] }))}
              value={window}
              onValueChange={setWindowParam}
              ariaLabel="Agents window"
            />
          </>
        )}
      />

      {backgroundErrors.length > 0 && (
        <p role="status" className="text-bakin-typography-size-meta text-bakin-signal-highlight">
          Some agent evidence is incomplete: {backgroundErrors.length === 1 ? backgroundErrors[0] : `${backgroundErrors.length} sources could not be fully verified`}.
        </p>
      )}

      <AgentPulse
        effort={resources.effort.data}
        history={resources.history.data}
        latestSessions={resources.latestSessions.data}
        liveNow={operations.liveNow.data}
        context={operations.contextReport.data}
        contextBudgetBytes={operations.settings.data?.dispatch?.contextBudgetBytes ?? null}
        pending={{
          effort: resources.effort.loading,
          history: resources.history.loading,
          latestSessions: resources.latestSessions.loading,
          liveNow: operations.liveNow.loading,
          context: operations.contextReport.loading,
          settings: operations.settings.loading,
        }}
        unavailable={{
          effort: resources.effort.error !== null,
          history: resources.history.error !== null,
          latestSessions: resources.latestSessions.error !== null,
          liveNow: operations.liveNow.error !== null,
          context: operations.contextReport.error !== null,
          settings: operations.settings.error !== null,
        }}
        errors={[
          resources.effort.error,
          resources.history.error,
          resources.latestSessions.error,
          operations.liveNow.error,
          operations.contextReport.error,
          operations.settings.error,
        ].filter((message): message is string => Boolean(message))}
        latestSessionFailedAgents={resources.latestSessionSource?.status === 'partial'
          ? resources.latestSessionSource.failedAgents
          : []}
        liveNowStale={operations.liveNow.stale === true}
        onRetry={() => { void Promise.all([resources.refresh(), operations.refresh()]) }}
      />
      <AgentsUsageChart
        data={resources.history.data}
        loading={resources.history.loading}
        error={resources.history.error}
        onRetry={() => void resources.history.refresh()}
      />
    </div>
  )
}
