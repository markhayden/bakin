'use client'

import { AreaChart, type ChartDatum } from '@makinbakin/sdk/charts'
import { Section, Stack } from '@makinbakin/sdk/layout'
import { SegmentedControl, StatGroup, StatTile } from '@makinbakin/sdk/patterns'
import { Banner, Button, Skeleton, SystemState, Text } from '@makinbakin/sdk/ui'

import { SpendBreakdown, type SpendBreakdownDimension } from './spend-breakdown'
import { formatTokens, formatUsd } from './spend-utils'
import { UtilizationTiles } from './utilization-tiles'
import type { BudgetRuleWire, SpendResponse } from '../types'
import type { SpendData } from './use-spend-data'

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

/** The month-to-date pace in plain words, with the basis it rests on (D27). */
function paceLine(spend: SpendResponse): string {
  const pace = spend.pace?.monthly
  if (!pace) return 'Pace unavailable.'
  const basis = spend.observedDays
  const days = basis?.month ?? null
  const basisCopy = days === null
    ? 'observed days unknown'
    : days === 0
      ? 'no observed days yet'
      : `based on ${days} observed day${days === 1 ? '' : 's'}${basis && days < basis.daysIntoMonth ? ` of ${basis.daysIntoMonth}` : ''}`
  if (pace.meteredUsdMicros === null && pace.subscriptionTokens === null) {
    return 'Not enough of the month has passed to project a pace.'
  }
  const parts: string[] = []
  if (pace.meteredUsdMicros !== null) parts.push(`~${formatUsd(pace.meteredUsdMicros)} metered`)
  if (pace.subscriptionTokens !== null && pace.subscriptionTokens > 0) parts.push(`~${formatTokens(pace.subscriptionTokens)} subscription tokens`)
  return parts.length === 0
    ? 'Not enough of the month has passed to project a pace.'
    : `On pace for ${parts.join(' and ')} this month — ${basisCopy}.`
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
  const monthlyMeteredTokens = (month?.meteredTokens ?? 0) + (monthUnattributed?.meteredTokens ?? 0)
  const monthlyMetered = month
    ? month.meteredUsdMicros + (monthUnattributed?.meteredUsdMicros ?? 0)
    : 0
  const monthlySubscription = month
    ? month.subscriptionTokens + (monthUnattributed?.subscriptionTokens ?? 0)
    : 0
  // Lane-honest tiles: a lane with no rows at all reads "not metered" /
  // "none", never "$ unavailable" (that state is reserved for unpriced rows).
  // Zero SUMS are not proof of an empty lane: unpriced media has zero tokens
  // and zero priced dollars, a subscription turn can lack token evidence,
  // and an unavailable observed-usage store hides everything outside tasks —
  // those read "unknown", not "none".
  const observedUnavailable = spend.facets?.observedUsageEvidence?.status === 'unavailable'
  const meteredLaneEmpty = !observedUnavailable && monthlyMeteredTokens === 0 && monthlyMetered === 0 && (month?.unpricedMeteredTokens ?? 0) === 0 && !spend.byModel.some((row) => row.costUsdMicros === null && row.runs > 0)
  const subscriptionLaneEmpty = !observedUnavailable && monthlySubscription === 0 && !(spend.byWorkClass ?? []).some((row) => row.totalTokens === null && row.runs > 0)
  const meteredUnknown = !meteredLaneEmpty && monthlyMetered === 0 && monthlyMeteredTokens === 0
  const subscriptionUnknown = !subscriptionLaneEmpty && monthlySubscription === 0

  return (
    <Section spacing="compact" aria-label="Spending overview">
      <Stack gap="dense">
        <h2>Spending overview</h2>
        <Text size="body" tone="muted" as="p" className="max-w-prose leading-relaxed">
          Costs are estimates from recorded token usage. Cached-token discounts may make provider invoices slightly lower.
        </Text>
      </Stack>

      <StatGroup label="Spend summary">
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
          value={meteredLaneEmpty ? 'Not metered' : meteredUnknown ? 'Unknown' : formatUsd(monthlyMetered, month?.unpricedMeteredTokens ?? 0)}
          valueTone={meteredLaneEmpty || meteredUnknown ? 'neutral' : undefined}
          sub={meteredLaneEmpty
            ? 'No pay-per-token usage this month'
            : meteredUnknown
              ? (observedUnavailable ? 'Observed usage is unavailable — Health names the gap' : 'Usage recorded without a price — Health names the gap')
              : `${formatTokens(monthlyMeteredTokens)} tokens`}
        />
        <StatTile
          variant="surface"
          label="Month subscription"
          value={subscriptionLaneEmpty ? 'None' : subscriptionUnknown ? 'Unknown' : formatTokens(monthlySubscription)}
          valueTone={subscriptionLaneEmpty || subscriptionUnknown ? 'neutral' : undefined}
          sub={subscriptionLaneEmpty
            ? 'No subscription-plan usage this month'
            : subscriptionUnknown
              ? (observedUnavailable ? 'Observed usage is unavailable — Health names the gap' : 'Usage recorded without token counts — Health names the gap')
              : 'Tokens included in subscription plans'}
        />
      </StatGroup>

      <Text size="body" as="p" data-testid="spend-pace" className="max-w-prose leading-relaxed">
        {paceLine(spend)}
      </Text>

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
      {m.spendStale ? (
        <Banner
          tone="attention"
          announce="polite"
          title="Showing the last reading — the refresh failed"
          description={m.spendStale}
          action={<Button type="button" variant="outline" size="sm" onClick={() => void m.refreshSpend()}>Retry</Button>}
        />
      ) : null}
      <SpendOverview
        spend={m.spend}
        rules={m.budgetRules ?? []}
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
