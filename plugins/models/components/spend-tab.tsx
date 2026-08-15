'use client'

import { useState } from 'react'
import { AreaChart, type ChartDatum } from '@makinbakin/sdk/charts'
import { Grid, Section, Stack } from '@makinbakin/sdk/layout'
import { SegmentedControl, StatTile } from '@makinbakin/sdk/patterns'
import {
  Banner,
  Button,
  Field,
  FieldError,
  Input,
  Skeleton,
  SystemState,
} from '@makinbakin/sdk/ui'

import { BillingLanesSection, BudgetRulesSection } from './spend-budget-controls'
import {
  SpendBreakdown,
  type SpendBreakdownDimension,
} from './spend-breakdown'
import {
  budgetRuleLabel,
  budgetRuleSpend,
  formatRuleUnit,
  formatTokens,
  formatUsd,
  parseCapInput,
} from './spend-utils'
import type {
  BudgetIncidentWire,
  BudgetRuleWire,
  ModelsData,
  SpendResponse,
} from './use-models-data'

export { parseCapInput } from './spend-utils'

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

/**
 * One incident: the Banner's action slot stays a button row (its contract),
 * while the cap input and its rejection message live below the banner inside a
 * Field. A rejected raise is announced — FieldError carries `role="alert"`, so
 * the message reaches assistive tech instead of only being painted red.
 */
function IncidentBanner({
  incident,
  resolveIncident,
}: {
  incident: BudgetIncidentWire
  resolveIncident: ModelsData['resolveIncident']
}) {
  const [raiseValue, setRaiseValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isCap = incident.kind === 'cap'

  return (
    <div className="flex min-w-0 flex-col gap-bakin-2">
      <Banner
        tone={isCap ? 'danger' : 'attention'}
        announce={incident.status === 'open' ? 'assertive' : 'off'}
        title={isCap ? 'Budget cap reached' : 'Budget warning'}
        description={(
          <span>
            {incident.scopeId ? `${incident.scope} “${incident.scopeId}”` : 'Global'} · {incident.window} · {incident.lane} at{' '}
            {formatRuleUnit(incident.lane, incident.spentValue, incident.unit === 'usd_micros')} of{' '}
            {formatRuleUnit(incident.lane, incident.capValue, incident.unit === 'usd_micros')}.
          </span>
        )}
        action={(
          <>
            {isCap ? (
              <Button
                type="button"
                size="sm"
                onClick={async () => {
                  const cap = parseCapInput(raiseValue)
                  if (cap === undefined) {
                    setError('Enter a valid cap first. Token caps accept k or M suffixes.')
                    return
                  }
                  setError(await resolveIncident(incident.id, 'raise', cap))
                }}
              >
                Raise and resume
              </Button>
            ) : null}
            {incident.status === 'open' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => setError(await resolveIncident(incident.id, 'ack'))}
              >
                Acknowledge
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => setError(await resolveIncident(incident.id, 'resume'))}
            >
              {incident.atCap === 'pause' && isCap ? 'Resume as-is' : 'Dismiss'}
            </Button>
          </>
        )}
      />
      {isCap || error ? (
        <Field name={`budget-incident-${incident.id}-cap`} invalid={Boolean(error)}>
          {isCap ? (
            <Input
              aria-label={`New cap for incident ${incident.id}`}
              className="w-36"
              placeholder={incident.lane === 'metered' ? 'New dollar cap' : 'New token cap'}
              value={raiseValue}
              onChange={(event) => setRaiseValue(event.currentTarget.value)}
            />
          ) : null}
          {error ? <FieldError match>{error}</FieldError> : null}
        </Field>
      ) : null}
    </div>
  )
}

function IncidentBanners({
  incidents,
  resolveIncident,
}: {
  incidents: BudgetIncidentWire[]
  resolveIncident: ModelsData['resolveIncident']
}) {
  const live = incidents.filter((incident) => incident.status !== 'resolved')
  if (live.length === 0) return null

  return (
    <div className="flex min-w-0 flex-col gap-bakin-3">
      {live.map((incident) => (
        <IncidentBanner
          key={incident.id}
          incident={incident}
          resolveIncident={resolveIncident}
        />
      ))}
    </div>
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
    <div className="@container/spend-trend min-w-0 border-t border-bakin-border-subtle pt-bakin-6">
      <div className="mb-bakin-4 flex min-w-0 flex-col items-start gap-bakin-3 @2xl/spend-trend:flex-row @2xl/spend-trend:items-center @2xl/spend-trend:justify-between">
        <div className="min-w-0">
          <h3>Spend over time</h3>
          <p className="mt-bakin-1 text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
            One unit per view keeps estimated dollars distinct from subscription-plan usage.
          </p>
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
    </div>
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
        <p className="max-w-prose text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">
          Costs are estimates from recorded token usage. Cached-token discounts may make provider invoices slightly lower.
        </p>
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

export function SpendTab({
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
  m: ModelsData
  breakdown: SpendBreakdownDimension
  metric: 'cost' | 'tokens'
  pageValue: string
  showAllValue: string
  onBreakdownChange: (dimension: SpendBreakdownDimension) => void
  onMetricChange: (metric: 'cost' | 'tokens') => void
  onPageChange: (page: string) => void
  onShowAllChange: (showAll: string) => void
}) {
  return (
    <div className="@container/spend flex min-w-0 flex-col gap-bakin-8">
      {m.budgetStatus?.paused ? (
        <Banner
          tone="danger"
          announce="assertive"
          title="All task dispatch is paused"
          description="No new billed work will start until an operator resumes dispatch."
        />
      ) : null}
      {m.budgetError ? (
        <Banner
          tone="danger"
          announce="assertive"
          title="Budget information could not be loaded or updated"
          description={m.budgetError}
        />
      ) : null}
      {m.budgetWarnings.map((warning) => (
        <Banner
          key={warning}
          tone="attention"
          title="Budget rule needs review"
          description={warning}
        />
      ))}
      <IncidentBanners incidents={m.incidents} resolveIncident={m.resolveIncident} />

      {m.spendLoading && !m.spend ? (
        <Skeleton className="h-56 w-full" />
      ) : !m.spend ? (
        <SystemState
          kind="error"
          scope="page"
          recovery="unavailable"
          title="Spend data is unavailable"
          description="The execution ledger could not provide spend records. Model configuration remains available in the other tabs."
        />
      ) : (
        <>
          <SpendOverview
            spend={m.spend}
            rules={m.budgetRules}
            metric={metric}
            onMetricChange={onMetricChange}
          />
          <BudgetRulesSection m={m} />
          <BillingLanesSection m={m} />
          <SpendBreakdown
            spend={m.spend}
            dimension={breakdown}
            pageValue={pageValue}
            showAllValue={showAllValue}
            onDimensionChange={onBreakdownChange}
            onPageChange={onPageChange}
            onShowAllChange={onShowAllChange}
          />
        </>
      )}
    </div>
  )
}
