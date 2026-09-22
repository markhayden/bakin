'use client'

import { AreaChart, type ChartDatum } from '@makinbakin/sdk/charts'
import { Grid, Section, Stack } from '@makinbakin/sdk/layout'
import { SegmentedControl, StatTile } from '@makinbakin/sdk/patterns'
import { Skeleton, SystemState, Text } from '@makinbakin/sdk/ui'

import { SpendBreakdown, type SpendBreakdownDimension } from './spend-breakdown'
import { budgetRuleLabel, budgetRuleSpend, formatRuleUnit, formatTokens, formatUsd } from './spend-utils'
import type { BudgetRuleWire, SpendResponse } from '../types'
import type { SpendData } from './use-spend-data'

function utilizationTone(percent: number): 'success' | 'attention' | 'danger' {
  if (percent >= 100) return 'danger'
  if (percent >= 80) return 'attention'
  return 'success'
}

function UtilizationTiles({
  rules,
  spend,
}: {
  rules: BudgetRuleWire[]
  spend: SpendResponse
}) {
  if (!spend.facets) return null

  const tiles = rules.flatMap((rule) => (
    (['daily', 'monthly'] as const).flatMap((windowName) => {
      const configuredCap = windowName === 'daily' ? rule.dailyCap : rule.monthlyCap
      if (!configuredCap) return []
      const cap = rule.lane === 'metered' ? configuredCap * 1_000_000 : configuredCap
      const spent = budgetRuleSpend(rule, spend.facets![windowName])
      const percent = cap > 0 ? (spent / cap) * 100 : 0
      return [{
        id: `${budgetRuleLabel(rule)}-${windowName}`,
        label: `${budgetRuleLabel(rule)} · ${windowName}`,
        value: `${Math.round(percent)}%`,
        sub: `${formatRuleUnit(rule.lane, spent, rule.lane === 'metered')} of ${formatRuleUnit(rule.lane, cap, rule.lane === 'metered')}`,
        percent,
      }]
    })
  ))

  if (tiles.length === 0) return null

  return (
    <Grid layout="auto-fill" gap="dense" role="group" aria-label="Budget utilization">
      {tiles.map((tile) => (
        <StatTile
          key={tile.id}
          variant="surface"
          label={tile.label}
          value={tile.value}
          valueTone={utilizationTone(tile.percent)}
          sub={tile.sub}
          progress={{
            percent: tile.percent,
            tone: utilizationTone(tile.percent),
            label: `${tile.label} utilization`,
          }}
        />
      ))}
    </Grid>
  )
}

const TREND_METRICS = [
  { value: 'cost', label: 'Estimated cost' },
  { value: 'tokens', label: 'Subscription tokens' },
] as const

function trendLabel(startMs: number, window: string): string {
  const date = new Date(startMs)
  if (window === '24h') {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(date)
  }
  if (window === 'all') {
    return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(date)
  }
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

function SpendTrend({
  spend,
  metric,
  onMetricChange,
}: {
  spend: SpendResponse
  metric: 'cost' | 'tokens'
  onMetricChange: (metric: 'cost' | 'tokens') => void
}) {
  const seriesKey = metric === 'cost' ? 'cost' : 'tokens'
  const chartData: ChartDatum[] = (spend.timeline ?? []).map((bucket) => {
    const values: Record<string, number> = metric === 'cost'
      ? bucket.costUsdMicros === null
        ? {}
        : { cost: bucket.costUsdMicros }
      : { tokens: bucket.subscriptionTokens }
    return {
      x: String(bucket.startMs),
      xLabel: trendLabel(bucket.startMs, spend.window),
      values,
      missingLabels: metric === 'cost' && bucket.costUsdMicros === null
        ? { cost: 'Cost unavailable · unpriced usage recorded' }
        : undefined,
    }
  })
  const chartLabel = metric === 'cost'
    ? 'Estimated spend over time'
    : 'Subscription token use over time'

  return (
    <Section className="@container/spend-trend" spacing="compact" divider="top" aria-label="Spend over time">
      <div className="flex min-w-0 flex-col items-start gap-bakin-3 @2xl/spend-trend:flex-row @2xl/spend-trend:items-center @2xl/spend-trend:justify-between">
        <div className="min-w-0">
          <h3>Spend over time</h3>
          <Text size="meta" tone="muted" as="p" className="mt-bakin-1 leading-relaxed">
            One unit per view keeps estimated dollars distinct from subscription-plan usage.
          </Text>
        </div>
        <SegmentedControl
          options={TREND_METRICS}
          value={metric}
          onValueChange={onMetricChange}
          ariaLabel="Spend trend metric"
          idPrefix="spend-trend"
        />
      </div>
      <div
        id={`spend-trend-panel-${metric}`}
        role="tabpanel"
        aria-labelledby={`spend-trend-tab-${metric}`}
        className="min-w-0"
      >
        <AreaChart
          data={chartData}
          series={[{
            key: seriesKey,
            label: metric === 'cost' ? 'Estimated cost' : 'Subscription tokens',
          }]}
          label={chartLabel}
          description={`${chartLabel} across the selected ${spend.window} window.`}
          height={160}
          formatValue={metric === 'cost' ? formatUsd : formatTokens}
          emptyLabel="No spend history is available in this window."
        />
      </div>
    </Section>
  )
}

function SpendOverview({
  spend,
  rules,
  metric,
  onMetricChange,
}: {
  spend: SpendResponse
  rules: BudgetRuleWire[]
  metric: 'cost' | 'tokens'
  onMetricChange: (metric: 'cost' | 'tokens') => void
}) {
  const month = spend.facets?.monthly.global
  const monthUnattributed = month?.unattributed
  const monthlyMetered = month
    ? month.meteredUsdMicros + (monthUnattributed?.meteredUsdMicros ?? 0)
    : 0
  const monthlySubscription = month
    ? month.subscriptionTokens + (monthUnattributed?.subscriptionTokens ?? 0)
    : 0

  return (
    <Section spacing="compact" aria-label="Spending overview">
      <Stack gap="dense">
        <h2>Spending overview</h2>
        <Text size="body" tone="muted" as="p" className="max-w-prose leading-relaxed">
          Costs are estimates from recorded token usage. Cached-token discounts may make provider invoices slightly lower.
        </Text>
      </Stack>

      <Grid layout="thirds" gap="dense" role="group" aria-label="Spend summary">
        <StatTile
          variant="surface"
          label={`${spend.window} estimated cost`}
          value={formatUsd(
            spend.totalUsdMicros,
            spend.facets?.monthly.global.unpricedMeteredTokens ?? 0,
          )}
          sub="Attributed runs in the selected window"
        />
        <StatTile
          variant="surface"
          label="Month metered"
          value={formatUsd(monthlyMetered, month?.unpricedMeteredTokens ?? 0)}
          sub={`${formatTokens((month?.meteredTokens ?? 0) + (monthUnattributed?.meteredTokens ?? 0))} tokens`}
        />
        <StatTile
          variant="surface"
          label="Month subscription"
          value={formatTokens(monthlySubscription)}
          sub="Tokens included in subscription plans"
        />
      </Grid>

      <SpendTrend spend={spend} metric={metric} onMetricChange={onMetricChange} />
      <UtilizationTiles rules={rules} spend={spend} />
    </Section>
  )
}

export function OverviewTab({
  m,
  breakdown,
  metric,
  pageValue,
  showAllValue,
  onBreakdownChange,
  onMetricChange,
  onPageChange,
  onShowAllChange,
}: {
  m: SpendData
  breakdown: SpendBreakdownDimension
  metric: 'cost' | 'tokens'
  pageValue: string
  showAllValue: string
  onBreakdownChange: (dimension: SpendBreakdownDimension) => void
  onMetricChange: (metric: 'cost' | 'tokens') => void
  onPageChange: (page: string) => void
  onShowAllChange: (showAll: string) => void
}) {
  if (m.spendLoading && !m.spend) return <Skeleton className="h-56 w-full" />
  if (!m.spend) {
    return (
      <SystemState
        kind="error"
        scope="page"
        recovery="unavailable"
        title="Spend data is unavailable"
        description="The execution ledger could not provide spend records. Limits remain editable in the other tab."
      />
    )
  }
  return (
    <div className="@container/spend flex min-w-0 flex-col gap-bakin-8">
      <SpendOverview
        spend={m.spend}
        rules={m.budgetRules}
        metric={metric}
        onMetricChange={onMetricChange}
      />
      <SpendBreakdown
        spend={m.spend}
        dimension={breakdown}
        pageValue={pageValue}
        showAllValue={showAllValue}
        onDimensionChange={onBreakdownChange}
        onPageChange={onPageChange}
        onShowAllChange={onShowAllChange}
      />
    </div>
  )
}
