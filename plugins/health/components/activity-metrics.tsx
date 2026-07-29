'use client'

import { Grid } from '@makinbakin/sdk/layout'
import { StatTile } from '@makinbakin/sdk/patterns'
import { Activity, AlertCircle, Bot, CheckCircle2 } from 'lucide-react'
import { isAttributedAgentRow } from '../lib/activity-feed-compat'
import type { UsageFeedData } from '../types'

const WINDOW_LABEL: Record<UsageFeedData['window'], string> = {
  '5m': 'last 5 minutes',
  '1h': 'last hour',
  '24h': 'last 24 hours',
}

function successPercent(data: UsageFeedData): number | null {
  if (data.totals.count === 0) return null
  return (data.outcomes.succeeded / data.totals.count) * 100
}

function successTone(data: UsageFeedData): 'success' | 'attention' | 'danger' {
  if (data.totals.errorRate >= 0.1) return 'danger'
  if (data.outcomes.failed > 0 || data.outcomes.unverified > 0 || data.outcomes.canceled > 0) return 'attention'
  return 'success'
}

function formatPercent(value: number): string {
  return value >= 99.95 || Number.isInteger(value) ? `${Math.round(value)}%` : `${value.toFixed(1)}%`
}

export function ActivityMetrics({
  data,
  compatibilityLimited = false,
}: {
  data: UsageFeedData
  compatibilityLimited?: boolean
}) {
  const rate = successPercent(data)
  const failed = data.outcomes.failed
  const unverified = data.outcomes.unverified
  const agents = data.byAgent
    .filter(isAttributedAgentRow)
    .sort((left, right) => right.count - left.count)
  const busiest = agents[0]
  const attention = failed + unverified
  const interactionWindow = data.coverage.hasFullWindow
    ? WINDOW_LABEL[data.window]
    : data.coverage.reason === 'process_restart'
      ? 'Partial window · since restart'
      : 'Partial window · retained history'

  return (
    <Grid
      layout="quarters"
      gap="dense"
      role="group"
      aria-label="Activity metrics"
      data-testid="activity-metrics"
    >
      <StatTile
        icon={Activity}
        label="Interactions"
        value={data.totals.count.toLocaleString()}
        sub={compatibilityLimited ? 'Partial data · restart Bakin for exact metrics' : interactionWindow}
      />
      <StatTile
        icon={CheckCircle2}
        label="Success rate"
        value={rate === null || compatibilityLimited ? '—' : formatPercent(rate)}
        valueTone={rate !== null && !compatibilityLimited ? successTone(data) : 'neutral'}
        {...(rate !== null && !compatibilityLimited
          ? { progress: { percent: rate, tone: successTone(data) } }
          : {})}
        sub={compatibilityLimited
          ? 'Partial data'
          : rate === null
            ? 'No activity recorded'
            : `${data.outcomes.succeeded.toLocaleString()} of ${data.totals.count.toLocaleString()} succeeded`}
      />
      <StatTile
        icon={AlertCircle}
        label="Hiccups"
        value={attention.toLocaleString()}
        valueTone={failed > 0 ? 'danger' : unverified > 0 ? 'attention' : 'neutral'}
        sub={attention > 0
          ? `${failed.toLocaleString()} failed · ${unverified.toLocaleString()} ${unverified === 1 ? 'result' : 'results'} not observed`
          : 'No hiccups in this window'}
      />
      <StatTile
        icon={Bot}
        label="Agents observed"
        value={(data.agentCount ?? agents.length).toLocaleString()}
        sub={busiest
          ? `Busiest: ${busiest.agent} (${busiest.count.toLocaleString()})`
          : 'No agent activity recorded'}
      />
    </Grid>
  )
}
