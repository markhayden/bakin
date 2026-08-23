'use client'

import { useState } from 'react'
import { AreaChart, ChartExplainer, StackedColumnChart } from '@makinbakin/sdk/charts'
import { Panel } from '@makinbakin/sdk/layout'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { SegmentedControl } from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  SystemState,
  Text,
} from '@makinbakin/sdk/ui'
import { ArrowUpRight, TrendingUp } from 'lucide-react'
import type { UsageHistoryData } from '../types'
import { formatRuntimeCost, formatTokenCount } from '../lib/format'
import { scopeUsageHistoryToCompleteEvidence } from '../lib/usage-coverage'

interface AgentsUsageChartProps {
  data: UsageHistoryData | null
  loading: boolean
  error: string | null
  onRetry: () => void
}

interface TrendData {
  data: Array<{
    x: string
    xLabel: string
    values: Record<string, number>
    missingLabels: Record<string, string>
  }>
  seriesKeys: string[]
  takeaway: string
}

type UsageMetric = 'tokens' | 'cost'

/** Beyond this many day buckets, columns get unreadable — the trend renders as a stacked area. */
const WIDE_WINDOW_DAYS = 10

const USAGE_METRICS = [
  { value: 'tokens', label: 'Tokens' },
  { value: 'cost', label: 'Reported cost' },
] as const

function buildTrend(history: UsageHistoryData, metric: UsageMetric): TrendData | null {
  const days = [...new Set([
    ...history.byDay.map((row) => row.day),
    ...history.byAgentDay.map((row) => row.day),
  ])].sort()
  if (days.length === 0) return null

  const allAgents = [...new Set([
    ...history.byAgent.map((row) => row.agent),
    ...history.byAgentDay.map((row) => row.agent),
  ])]
  const agentTotals = new Map<string, number>()
  let usesAggregateTokenSeries = false
  const valuesByDay = new Map(days.map((day) => [day, Object.create(null) as Record<string, number>]))
  const missingLabelsByDay = new Map(days.map((day) => [day, Object.create(null) as Record<string, string>]))
  const observedAgentDays = new Set<string>()
  for (const cell of history.byAgentDay) {
    const values = valuesByDay.get(cell.day)
    if (!values) continue
    const value = metric === 'tokens' ? cell.tokens.total : cell.costUsdMicros
    if (metric === 'cost') observedAgentDays.add(`${cell.day}\u0000${cell.agent}`)
    if (value === null) continue
    values[cell.agent] = value
    agentTotals.set(cell.agent, (agentTotals.get(cell.agent) ?? 0) + value)
  }

  if (metric === 'tokens' && agentTotals.size === 0) {
    usesAggregateTokenSeries = true
    for (const row of history.byDay) valuesByDay.get(row.day)!['All agents'] = row.tokens.total
    agentTotals.set('All agents', history.byDay.reduce((sum, row) => sum + row.tokens.total, 0))
  }
  if (agentTotals.size === 0) return null

  if (metric === 'cost') {
    for (const day of days) {
      const missingLabels = missingLabelsByDay.get(day)!
      for (const agent of allAgents) {
        if (!observedAgentDays.has(`${day}\u0000${agent}`)) missingLabels[agent] = 'No activity'
      }
    }
  }

  const rankedAgents = [...agentTotals.keys()]
    .sort((a, b) => (agentTotals.get(b) ?? 0) - (agentTotals.get(a) ?? 0) || a.localeCompare(b))
  const seriesKeys = usesAggregateTokenSeries
    ? rankedAgents
    : [...new Set([...rankedAgents, ...allAgents])]
      .sort((a, b) => (agentTotals.get(b) ?? 0) - (agentTotals.get(a) ?? 0) || a.localeCompare(b))
  const data = days.map((day) => ({
    x: day,
    xLabel: day.slice(5),
    values: valuesByDay.get(day)!,
    missingLabels: missingLabelsByDay.get(day)!,
  }))
  const completedDays = data.filter((row) => (
    row.x !== history.throughDay
    && (metric === 'tokens' || Object.values(row.values).some(Number.isFinite))
  ))
  const busiestCompletedDay = completedDays.reduce<{ row: TrendData['data'][number]; total: number } | null>((best, row) => {
    const total = Object.values(row.values).reduce((sum, value) => sum + value, 0)
    return !best || total > best.total ? { row, total } : best
  }, null)
  const currentDay = data.find((row) => row.x === history.throughDay)
  const currentDayHasValues = currentDay
    ? Object.values(currentDay.values).some(Number.isFinite)
    : false
  const currentTotal = currentDay
    ? Object.values(currentDay.values).reduce((sum, value) => sum + value, 0)
    : 0
  const leader = rankedAgents[0]
  const completedDayCopy = busiestCompletedDay
    ? completedDays.length === 1
      ? `The last completed day, ${busiestCompletedDay.row.xLabel}, had ${metric === 'tokens' ? `${formatTokenCount(busiestCompletedDay.total)} tokens` : `${formatRuntimeCost(busiestCompletedDay.total / 1_000_000)} reported cost`}.`
      : `Among completed days, ${busiestCompletedDay.row.xLabel} had the most ${metric === 'tokens' ? 'token use' : 'reported cost'}: ${metric === 'tokens' ? formatTokenCount(busiestCompletedDay.total) : formatRuntimeCost(busiestCompletedDay.total / 1_000_000)}.`
    : ''
  const currentDayCopy = currentDay && (metric === 'tokens' || currentDayHasValues)
    ? ` Today is still being counted: ${metric === 'tokens' ? `${formatTokenCount(currentTotal)} tokens` : `${formatRuntimeCost(currentTotal / 1_000_000)} reported cost`} so far.`
    : metric === 'cost'
      ? ' Today has no reported cost evidence yet.'
      : ' Today has no recorded token use yet.'
  const leaderCopy = leader
    ? ` ${leader} ${metric === 'tokens' ? 'used' : 'reported'} the most across these calendar days.`
    : ''
  const takeaway = `${completedDayCopy}${currentDayCopy}${leaderCopy}`.trim()

  return { data, seriesKeys, takeaway }
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1)
}

/** Historical transcript-observed usage and runtime-reported cost in one surface. */
export function AgentsUsageChart({ data, loading, error, onRetry }: AgentsUsageChartProps) {
  const [metric, setMetric] = useState<UsageMetric>('tokens')
  const scoped = data ? scopeUsageHistoryToCompleteEvidence(data) : null
  const visibleData = scoped?.history ?? null
  const evidenceIncomplete = scoped !== null && scoped.status !== 'complete'
  const evidenceLimited = evidenceIncomplete || (scoped?.excludedAgentCount ?? 0) > 0
  const trend = visibleData ? buildTrend(visibleData, metric) : null
  const costedMessages = visibleData?.byAgent.reduce((sum, row) => sum + row.costedMessages, 0) ?? null
  const messageCount = visibleData?.byAgent.reduce((sum, row) => sum + row.messageCount, 0) ?? null
  const reportedCostRows = visibleData?.byAgent.filter((row) => Number.isFinite(row.costUsdMicros)) ?? []
  const reportedCost = visibleData && costedMessages !== null && costedMessages > 0 && reportedCostRows.length > 0
    ? reportedCostRows.reduce((sum, row) => sum + row.costUsdMicros!, 0)
    : null
  const costCoverage = visibleData && costedMessages !== null && messageCount !== null && messageCount > 0
    ? `${costedMessages} of ${messageCount} messages from ${visibleData.since} through ${visibleData.throughDay} reported cost. Today is still being counted.`
    : null
  const partialCostCoverage = costedMessages !== null
    && messageCount !== null
    && costedMessages < messageCount
  const zeroReportedCost = metric === 'cost'
    && reportedCost === 0
    && costedMessages !== null
    && costedMessages > 0
    && !partialCostCoverage
  const chartLabel = metric === 'tokens' ? 'Usage over time' : 'Reported cost over time'

  return (
    <Card className="min-w-0" data-section-card>
      <CardHeader>
        <CardTitle className="flex items-center gap-bakin-2">
          <TrendingUp className="size-bakin-4 text-bakin-text-muted" aria-hidden="true" />
          <h3>Usage &amp; cost</h3>
        </CardTitle>
        <CardDescription className="max-w-3xl">
          See where tokens and runtime-reported cost accumulated across agents.
        </CardDescription>
        <CardAction>
          <SegmentedControl
            options={USAGE_METRICS}
            value={metric}
            onValueChange={setMetric}
            ariaLabel="Usage metric"
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-bakin-3">
      {loading && !data ? (
        <div role="status" aria-label="Loading usage and cost" className="space-y-bakin-2">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <>
          {error && !data ? (
            <div>
              <SystemState
                kind="error"
                scope="section"
                headingLevel={4}
                title="Usage and cost unavailable"
                description={error}
                action={<Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>}
              />
              <p role="status" className="text-bakin-typography-size-meta text-bakin-text-muted">
                Cost could not be checked because {lowerFirst(error)}.
              </p>
            </div>
          ) : (
            <>
              {scoped && evidenceLimited && (
                <Alert tone="neutral" role="status">
                  <AlertDescription>
                  {scoped.status === 'complete' && scoped.excludedAgentCount > 0
                    ? `The current scan verified ${scoped.includedAgentCount} agent${scoped.includedAgentCount === 1 ? '' : 's'}. ${scoped.excludedAgentCount} retained agent row${scoped.excludedAgentCount === 1 ? ' is' : 's are'} excluded because it was not part of that scan.`
                    : scoped.includedAgentCount > 0
                    ? `Transcript coverage is ${scoped.status}. Totals include only ${scoped.includedAgentCount} fully scanned agent${scoped.includedAgentCount === 1 ? '' : 's'}; ${scoped.excludedAgentCount} unverified agent${scoped.excludedAgentCount === 1 ? ' is' : 's are'} excluded.`
                    : 'Current transcript coverage is unavailable. Retained rows are excluded until a new scan verifies them.'}
                  </AlertDescription>
                </Alert>
              )}
              {visibleData && visibleData.byAgent.length > 0 && (
                <Panel padding="compact" className="flex flex-wrap items-baseline gap-x-bakin-6 gap-y-bakin-1">
                  <Text size="meta" tone="muted" as="p">
                    Reported cost <span className="ml-bakin-1 font-bakin-typography-weight-semibold tabular-nums text-bakin-text-primary">{reportedCost === null ? 'Unavailable' : `${formatRuntimeCost(reportedCost / 1_000_000)}${partialCostCoverage ? '+' : ''}`}</span>
                  </Text>
                  {costCoverage && <Text size="meta" tone="muted" as="p">{costCoverage}</Text>}
                </Panel>
              )}
              {!trend ? (
                <SystemState
                  kind="initial-empty"
                  scope="section"
                  headingLevel={4}
                  title={evidenceLimited
                    ? 'No fully verified usage total is available yet.'
                    : metric === 'tokens'
                      ? 'No transcript usage was recorded in this window.'
                      : 'No runtime-reported cost is available in this window.'}
                  description={evidenceLimited
                    ? 'Run the transcript scan again; retained rows stay hidden from current totals until their agents are verified.'
                    : data?.scannedAt
                    ? metric === 'cost'
                      ? 'The transcript scan found message activity, but none included runtime-reported cost.'
                      : 'The transcript scan completed, but found no matching evidence.'
                    : 'The first transcript scan has not completed yet.'}
                />
              ) : (
                <>
                  {!zeroReportedCost && (
                    <ChartExplainer>
                      {metric === 'cost' && partialCostCoverage
                        ? `Reported-cost coverage is partial. ${trend.takeaway}`
                        : trend.takeaway}
                    </ChartExplainer>
                  )}
                  {zeroReportedCost ? (
                    <div
                      data-reported-cost-zero
                      className="flex min-h-28 flex-col items-center justify-center rounded-bakin-control border border-dashed border-bakin-border-subtle bg-bakin-canvas-default px-bakin-4 py-bakin-6 text-center"
                    >
                      <strong className="text-bakin-typography-size-title tabular-nums text-bakin-text-primary">$0.00</strong>
                      <Text size="meta" tone="muted" className="mt-bakin-1">
                        All {costedMessages} cost-reporting messages returned $0.00 in this window.
                      </Text>
                    </div>
                  ) : trend.data.length > WIDE_WINDOW_DAYS ? (
                    <div className="w-full" data-agent-token-trend-plot>
                      <AreaChart
                        key={metric}
                        stacked
                        data={trend.data}
                        series={trend.seriesKeys.map((seriesKey) => ({ key: seriesKey, label: seriesKey }))}
                        label={chartLabel}
                        height={144}
                        formatValue={metric === 'tokens'
                          ? formatTokenCount
                          : (value) => formatRuntimeCost(value / 1_000_000)}
                      />
                    </div>
                  ) : (
                    <div className="w-full" data-agent-token-trend-plot>
                      <StackedColumnChart
                        key={metric}
                        data={trend.data}
                        seriesKeys={trend.seriesKeys}
                        label={chartLabel}
                        dataLabel={`${chartLabel} data`}
                        partialKeys={visibleData ? [visibleData.throughDay] : []}
                        height={144}
                        missingValue={metric === 'cost' ? 'Unreported' : undefined}
                        missingBucketLabel={metric === 'cost' ? 'Unreported' : undefined}
                        formatValue={metric === 'tokens'
                          ? formatTokenCount
                          : (value) => formatRuntimeCost(value / 1_000_000)}
                      />
                    </div>
                  )}
                </>
              )}
            </>
          )}
          <PluginLink
            to="/models?tab=spend"
            className="inline-flex items-center gap-bakin-1 rounded-bakin-control text-bakin-typography-size-meta font-bakin-typography-weight-medium text-bakin-signal-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bakin-focus-ring"
          >
            View budgets in Models <ArrowUpRight className="size-bakin-3" aria-hidden="true" />
          </PluginLink>
        </>
      )}
      </CardContent>
    </Card>
  )
}
