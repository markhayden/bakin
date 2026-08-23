'use client'

import { assignSeriesColors, CHART_MAX_SERIES, StackedColumnChart } from '@makinbakin/sdk/charts'
import { formatRelativeTime } from '@makinbakin/sdk/conversation'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { ListRow, ListRows, StatGroup, StatTile, StatusBadge } from '@makinbakin/sdk/patterns'
import { Badge, Button, Separator, Skeleton, SystemState, Text } from '@makinbakin/sdk/ui'
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
  const chartSeries = rankedRows
    .slice(0, rankedRows.length > CHART_MAX_SERIES ? CHART_MAX_SERIES - 1 : CHART_MAX_SERIES)
    .map((row) => row.agent)
  const colors = assignSeriesColors(chartSeries)
  const cost = visibleHistory ? reportedCost(visibleHistory) : null
  const running = new Set(model.rightNow.runningAgents)

  return (
    <section className="min-w-0 p-bakin-4 @[52rem]/health:p-bakin-6" data-testid="overview-agent-spend" aria-labelledby="overview-agent-spend-title">
      <div className="flex flex-wrap items-start justify-between gap-bakin-3">
        <div className="flex items-center gap-bakin-2">
          <Coins className="size-bakin-4 text-bakin-text-muted" aria-hidden="true" />
          <h3 id="overview-agent-spend-title">Agent spend</h3>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-bakin-2 text-bakin-typography-size-meta font-bakin-typography-weight-medium text-bakin-text-muted">
          {history?.scannedAt && (
            <time dateTime={history.scannedAt}>
              {scanLabel(history.scannedAt)}
            </time>
          )}
          {scoped && evidenceLimited && (
            <StatusBadge tone="attention" variant="outline">
              {scoped.status === 'complete'
                ? 'Scoped coverage'
                : scoped.includedAgentCount > 0
                  ? 'Partial coverage'
                  : 'Scan unavailable'}
            </StatusBadge>
          )}
          <Badge tone="neutral" variant="soft">
            {history ? usageWindowScopeLabel(history.since, history.throughDay) : '24h'}
            {history ? <span className="sr-only"> — {history.since} through {history.throughDay}</span> : null}
          </Badge>
        </div>
      </div>

      {resource.loading && !history ? (
        <div role="status" aria-label="Loading agent spend" className="mt-bakin-4 space-y-bakin-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : resource.error && !history ? (
        <SystemState
          kind="error"
          scope="section"
          headingLevel={4}
          title="Agent usage is unavailable."
          action={resource.onRetry
            ? <Button size="sm" variant="outline" onClick={resource.onRetry}>Try again</Button>
            : undefined}
        />
      ) : history && evidenceLimited && scoped?.includedAgentCount === 0 ? (
        <SystemState
          kind="initial-empty"
          scope="section"
          headingLevel={4}
          title={scoped.status === 'complete'
            ? 'The current scan did not verify the retained agent rows, so they are not shown as current spend.'
            : 'Current transcript coverage is unavailable. Retained rows are not shown as current agent spend until a new scan verifies them.'}
        />
      ) : !visibleHistory || total === 0 ? (
        <SystemState
          kind="initial-empty"
          scope="section"
          headingLevel={4}
          title={evidenceLimited
            ? 'No token traffic was recorded for the fully scanned agents.'
            : 'No agent token traffic has been recorded yet.'}
        />
      ) : (
        <>
          <StatGroup label="Agent spend summary" className="mt-bakin-4 gap-x-bakin-6">
            <StatTile
              label="Tokens"
              value={formatTokenCount(total)}
              sub={evidenceLimited ? 'Fully scanned agents only' : 'Observed transcript traffic'}
            />
            <StatTile
              label="Cost"
              value={cost === null ? '—' : `${formatRuntimeCost(cost.usd)}${cost.complete && !evidenceLimited ? '' : '+'}`}
              sub={cost === null
                ? 'Cost unavailable'
                : cost.complete === false || evidenceLimited ? 'Partial runtime-reported cost' : 'Runtime-reported cost'}
            />
          </StatGroup>

          <div className="mt-bakin-4" role="group" aria-label="Agent token use by day">
            <StackedColumnChart
              data={chartData(visibleHistory)}
              height={112}
              formatValue={formatTokenCount}
              emptyLabel="No daily token history is available."
            />
          </div>

          <Separator className="mt-bakin-4" />
          <div className="mt-bakin-3">
            <ListRows variant="plain" aria-label="Top agents by token use">
              {rows.map((row) => {
                const isRunning = running.has(row.agent)
                return (
                  <ListRow key={row.agent} className="p-bakin-0">
                    <PluginLink
                      to={`/team/${encodeURIComponent(row.agent)}?tab=diagnostics`}
                      data-testid="agent-spend-row"
                      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-bakin-3 rounded-bakin-control px-bakin-1 py-bakin-1 hover:bg-bakin-surface-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bakin-focus-ring"
                    >
                      <span className="flex min-w-0 items-center gap-bakin-2">
                        <span className="size-bakin-2 shrink-0 rounded-bakin-pill" style={{ backgroundColor: colors.get(row.agent) }} aria-hidden="true" />
                        <span className="truncate text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary">{row.agent}</span>
                        {isRunning && <StatusBadge tone="success" variant="outline">Working</StatusBadge>}
                      </span>
                      <span data-testid="agent-spend-metric" className="text-right tabular-nums">
                        <strong className="block text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary">{formatTokenCount(row.tokens.total)}</strong>
                        <Text size="meta" tone="muted" className="block">{rowCost(row) ?? 'cost —'}</Text>
                      </span>
                    </PluginLink>
                  </ListRow>
                )
              })}
            </ListRows>
            <PluginLink
              to="/health?tab=agents"
              className="mt-bakin-3 inline-flex items-center gap-bakin-1 text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-signal-accent underline-offset-4 hover:underline focus-visible:rounded-bakin-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bakin-focus-ring"
            >
              Agent details <ArrowUpRight className="size-bakin-3" aria-hidden="true" />
            </PluginLink>
          </div>
        </>
      )}
    </section>
  )
}
