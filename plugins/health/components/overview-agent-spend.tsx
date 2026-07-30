'use client'

import { assignSeriesColors, CHART_MAX_SERIES, StackedColumnChart } from '@makinbakin/sdk/charts'
import { formatAbsoluteTime, formatRelativeTime } from '@makinbakin/sdk/conversation'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { Button, Skeleton } from '@makinbakin/sdk/ui'
import { ArrowUpRight, Coins } from 'lucide-react'
import type { HealthOverviewViewModel } from '../lib/health-view-model'
import { formatRuntimeCost, formatTokenCount } from '../lib/format'
import { scopeUsageHistoryToCompleteEvidence } from '../lib/usage-coverage'
import { usageWindowScopeLabel } from '../lib/usage-window'
import type { UsageHistoryData } from '../types'
import type { OverviewTelemetry } from './overview-telemetry'

function chartData(history: UsageHistoryData) {
  const days = [...new Set([
    ...history.byDay.map((row) => row.day),
    ...history.byAgentDay.map((row) => row.day),
  ])].sort()
  const values = new Map(days.map((day) => [day, Object.create(null) as Record<string, number>]))

  for (const cell of history.byAgentDay) {
    const day = values.get(cell.day)
    if (day) day[cell.agent] = cell.tokens.total
  }
  if (history.byAgentDay.length === 0) {
    for (const day of history.byDay) values.get(day.day)!['All agents'] = day.tokens.total
  }

  return days.map((day) => ({
    x: day,
    xLabel: day === history.throughDay ? 'Today' : day.slice(5),
    values: values.get(day)!,
  }))
}

function reportedCost(history: UsageHistoryData): { usd: number; complete: boolean } | null {
  const known = history.byAgent.filter((row) => row.costUsdMicros !== null)
  if (known.length === 0) return null
  const messageCount = history.byAgent.reduce((sum, row) => sum + row.messageCount, 0)
  const costedMessages = history.byAgent.reduce((sum, row) => sum + row.costedMessages, 0)
  return {
    usd: known.reduce((sum, row) => sum + (row.costUsdMicros ?? 0), 0) / 1_000_000,
    complete: messageCount > 0
      ? costedMessages >= messageCount
      : known.length === history.byAgent.length,
  }
}

function rowCost(row: UsageHistoryData['byAgent'][number]): string | null {
  if (row.costUsdMicros === null) return null
  const complete = row.messageCount === 0 || row.costedMessages >= row.messageCount
  return `${formatRuntimeCost(row.costUsdMicros / 1_000_000)}${complete ? '' : '+'}`
}

function scanLabel(value: string): string {
  const relative = formatRelativeTime(value)
  if (relative === 'now') return 'Scanned now'
  return /^\d+[mhd]$/.test(relative) ? `Scanned ${relative} ago` : `Scanned ${relative}`
}

export function OverviewAgentSpend({
  resource,
  model,
}: {
  resource: OverviewTelemetry['history']
  model: HealthOverviewViewModel
}) {
  const history = resource.data
  const scoped = history ? scopeUsageHistoryToCompleteEvidence(history) : null
  const visibleHistory = scoped?.history ?? null
  const evidenceIncomplete = scoped !== null && scoped.status !== 'complete'
  const evidenceLimited = evidenceIncomplete || (scoped?.excludedAgentCount ?? 0) > 0
  const rankedRows = [...(visibleHistory?.byAgent ?? [])]
    .sort((left, right) => right.tokens.total - left.tokens.total || left.agent.localeCompare(right.agent))
  const rows = rankedRows.slice(0, 4)
  const total = visibleHistory?.byAgent.length
    ? visibleHistory.byAgent.reduce((sum, row) => sum + row.tokens.total, 0)
    : scoped?.status === 'complete'
      ? visibleHistory?.byDay.reduce((sum, row) => sum + row.tokens.total, 0) ?? 0
      : 0
  const maximum = Math.max(1, ...rows.map((row) => row.tokens.total))
  const chartSeries = rankedRows
    .slice(0, rankedRows.length > CHART_MAX_SERIES ? CHART_MAX_SERIES - 1 : CHART_MAX_SERIES)
    .map((row) => row.agent)
  const colors = assignSeriesColors(chartSeries)
  const cost = visibleHistory ? reportedCost(visibleHistory) : null
  const running = new Set(model.rightNow.runningAgents)

  return (
    <section className="min-w-0 p-4 @[52rem]/health:p-5" data-testid="overview-agent-spend" aria-labelledby="overview-agent-spend-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Coins className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 id="overview-agent-spend-title" className="font-semibold text-foreground">Agent spend</h3>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] font-medium text-muted-foreground">
          {history?.scannedAt && (
            <time dateTime={history.scannedAt} title={formatAbsoluteTime(history.scannedAt)}>
              {scanLabel(history.scannedAt)}
            </time>
          )}
          {scoped && evidenceLimited && (
            <span className="rounded-full bg-warning/10 px-2.5 py-1 text-warning">
              {scoped.status === 'complete'
                ? 'Scoped coverage'
                : scoped.includedAgentCount > 0
                  ? 'Partial coverage'
                  : 'Scan unavailable'}
            </span>
          )}
          <span
            className="rounded-full bg-foreground/[0.06] px-2.5 py-1"
            title={history ? `${history.since} through ${history.throughDay}` : undefined}
          >
            {history ? usageWindowScopeLabel(history.since, history.throughDay) : '24h'}
          </span>
        </div>
      </div>

      {resource.loading && !history ? (
        <div role="status" aria-label="Loading agent spend" className="mt-5 space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : resource.error && !history ? (
        <div className="mt-5 flex min-h-44 flex-col items-center justify-center gap-3 text-center">
          <span className="text-sm text-muted-foreground">Agent usage is unavailable.</span>
          {resource.onRetry && <Button size="sm" variant="outline" onClick={resource.onRetry}>Try again</Button>}
        </div>
      ) : history && evidenceLimited && scoped?.includedAgentCount === 0 ? (
        <div className="mt-5 flex min-h-44 items-center justify-center px-4 text-center text-sm text-muted-foreground">
          {scoped.status === 'complete'
            ? 'The current scan did not verify the retained agent rows, so they are not shown as current spend.'
            : 'Current transcript coverage is unavailable. Retained rows are not shown as current agent spend until a new scan verifies them.'}
        </div>
      ) : !visibleHistory || total === 0 ? (
        <div className="mt-5 flex min-h-44 items-center justify-center text-sm text-muted-foreground">
          {evidenceLimited
            ? 'No token traffic was recorded for the fully scanned agents.'
            : 'No agent token traffic has been recorded yet.'}
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <strong className="block text-2xl font-semibold tabular-nums text-foreground">{formatTokenCount(total)} tokens</strong>
              <span className="text-xs text-muted-foreground">
                {evidenceLimited ? 'Fully scanned agents only' : 'Observed transcript traffic'}
              </span>
            </div>
            <div>
              <strong className="block text-lg font-semibold tabular-nums text-foreground">
                {cost === null ? 'Cost unavailable' : `${formatRuntimeCost(cost.usd)}${cost.complete && !evidenceLimited ? '' : '+'}`}
              </strong>
              <span className="text-xs text-muted-foreground">
                {cost?.complete === false || evidenceLimited ? 'Partial runtime-reported cost' : 'Runtime-reported cost'}
              </span>
            </div>
          </div>

          <div className="mt-4" role="group" aria-label="Agent token use by day">
            <StackedColumnChart
              data={chartData(visibleHistory)}
              height={112}
              formatValue={formatTokenCount}
              emptyLabel="No daily token history is available."
            />
          </div>

          <div className="mt-4 border-t border-border/70 pt-3">
            <div className="space-y-2">
              {rows.map((row) => {
                const isRunning = running.has(row.agent)
                return (
                  <PluginLink
                    key={row.agent}
                    to={`/team/${encodeURIComponent(row.agent)}?tab=diagnostics`}
                    data-testid="agent-spend-row"
                    className="group grid min-w-0 grid-cols-[minmax(0,1fr)_4rem] items-center gap-x-3 gap-y-1.5 rounded-md px-1 py-1.5 hover:bg-foreground/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring @[24rem]/health:grid-cols-[minmax(5rem,.7fr)_minmax(3rem,1.5fr)_4rem]"
                  >
                    <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colors.get(row.agent) }} aria-hidden="true" />
                      <span className="truncate text-sm font-medium text-foreground">{row.agent}</span>
                      {isRunning && <span className="text-[10px] font-medium uppercase tracking-wide text-success">Working</span>}
                    </span>
                    <span
                      data-testid="agent-spend-bar"
                      className="col-span-2 row-start-2 h-1.5 overflow-hidden rounded-full bg-foreground/10 @[24rem]/health:col-span-1 @[24rem]/health:col-start-2 @[24rem]/health:row-start-1"
                      aria-hidden="true"
                    >
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${Math.max(2, (row.tokens.total / maximum) * 100)}%`, backgroundColor: colors.get(row.agent) }}
                      />
                    </span>
                    <span data-testid="agent-spend-metric" className="col-start-2 row-start-1 w-16 text-right tabular-nums @[24rem]/health:col-start-3">
                      <strong className="block text-sm font-medium text-foreground">{formatTokenCount(row.tokens.total)}</strong>
                      <span className="block text-[10px] text-muted-foreground">{rowCost(row) ?? 'cost —'}</span>
                    </span>
                  </PluginLink>
                )
              })}
            </div>
            <PluginLink
              to="/health?tab=agents"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Agent details <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </PluginLink>
          </div>
        </>
      )}
    </section>
  )
}
