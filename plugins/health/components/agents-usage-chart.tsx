'use client'

import { ChartExplainer, EmptyState, ErrorState, LineChart, SectionCard } from '@makinbakin/sdk/components'
import { Skeleton } from '@makinbakin/sdk/ui'
import { TrendingUp } from 'lucide-react'
import type { UsageHistoryData } from '../types'
import { formatTokenCount } from '../lib/format'

interface AgentsUsageChartProps {
  data: UsageHistoryData | null
  loading: boolean
  error: string | null
  onRetry: () => void
}

interface TrendData {
  data: Array<{ x: string; xLabel: string; values: Record<string, number> }>
  series: Array<{ key: string; label: string }>
  takeaway: string
}

function buildTrend(history: UsageHistoryData): TrendData | null {
  const days = [...new Set(history.byDay.map((row) => row.day))].sort()
  if (days.length === 0) return null

  const agentTotals = new Map<string, number>()
  const valuesByDay = new Map(days.map((day) => [day, Object.create(null) as Record<string, number>]))
  for (const cell of history.byAgentDay) {
    const values = valuesByDay.get(cell.day)
    if (!values) continue
    values[cell.agent] = cell.tokens.total
    agentTotals.set(cell.agent, (agentTotals.get(cell.agent) ?? 0) + cell.tokens.total)
  }

  if (agentTotals.size === 0) {
    for (const row of history.byDay) valuesByDay.get(row.day)!['All agents'] = row.tokens.total
    agentTotals.set('All agents', history.byDay.reduce((sum, row) => sum + row.tokens.total, 0))
  }

  const series = [...agentTotals.keys()]
    .sort((a, b) => (agentTotals.get(b) ?? 0) - (agentTotals.get(a) ?? 0) || a.localeCompare(b))
    .map((agent) => ({ key: agent, label: agent }))
  const data = days.map((day) => ({
    x: day,
    xLabel: day.slice(5),
    values: valuesByDay.get(day)!,
  }))
  const completedDays = data.filter((row) => row.x !== history.throughDay)
  const busiestCompletedDay = completedDays.reduce<{ row: TrendData['data'][number]; total: number } | null>((best, row) => {
    const total = Object.values(row.values).reduce((sum, value) => sum + value, 0)
    return !best || total > best.total ? { row, total } : best
  }, null)
  const currentDay = data.find((row) => row.x === history.throughDay)
  const currentTotal = currentDay
    ? Object.values(currentDay.values).reduce((sum, value) => sum + value, 0)
    : 0
  const leader = series[0]?.label
  const completedDayCopy = busiestCompletedDay
    ? completedDays.length === 1
      ? `The last completed day, ${busiestCompletedDay.row.xLabel}, had ${formatTokenCount(busiestCompletedDay.total)} tokens.`
      : `Among completed days, ${busiestCompletedDay.row.xLabel} had the most token use: ${formatTokenCount(busiestCompletedDay.total)}.`
    : ''
  const currentDayCopy = currentDay
    ? ` Today is still being counted: ${formatTokenCount(currentTotal)} tokens so far.`
    : ' Today has no recorded token use yet.'
  const leaderCopy = leader ? ` ${leader} used the most across these calendar days.` : ''
  const takeaway = `${completedDayCopy}${currentDayCopy}${leaderCopy}`.trim()

  return { data, series, takeaway }
}

/** Historical transcript-observed tokens, with a visible takeaway and exact table. */
export function AgentsUsageChart({ data, loading, error, onRetry }: AgentsUsageChartProps) {
  const trend = data ? buildTrend(data) : null

  return (
    <SectionCard
      title={<h3>Usage over time</h3>}
      icon={TrendingUp}
      description="Daily token use by agent. Today is still being counted."
      className="min-w-0"
    >
      {loading && !data ? (
        <div role="status" aria-label="Loading usage over time" className="space-y-2">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : error && !data ? (
        <ErrorState title="Token trend unavailable" message={error} retry={onRetry} className="py-8" />
      ) : !trend ? (
        <EmptyState
          variant="section"
          title="No transcript usage was recorded in this window."
          description={data?.scannedAt ? 'The transcript scan completed, but found no token traffic.' : 'The first transcript scan has not completed yet.'}
        />
      ) : (
        <>
          <ChartExplainer>{trend.takeaway}</ChartExplainer>
          <div className="w-full max-w-4xl" data-agent-token-trend-plot>
            <LineChart
              data={trend.data}
              series={trend.series}
              label="Usage over time"
              description="Daily token use split by agent."
              height={144}
              formatValue={formatTokenCount}
            />
          </div>
        </>
      )}
    </SectionCard>
  )
}
