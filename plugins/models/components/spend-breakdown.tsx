'use client'

import { useMemo } from 'react'
import { RankedBarChart, type ChartDatum } from '@makinbakin/sdk/charts'
import { Section, Stack } from '@makinbakin/sdk/layout'
import { ListRow, ListRows, Pagination, SegmentedControl } from '@makinbakin/sdk/patterns'
import { SystemState } from '@makinbakin/sdk/ui'

import type { SpendResponse } from './use-models-data'
import { formatTokens, formatUsd } from './spend-utils'

export type SpendBreakdownDimension = 'agents' | 'providers' | 'models' | 'work'

interface BreakdownRow {
  id: string
  title: string
  description?: string
  metrics: Array<{ label: string; value: string }>
  costUsdMicros: number | null
}

const DIMENSIONS = [
  { value: 'agents', label: 'Agents' },
  { value: 'providers', label: 'Providers' },
  { value: 'models', label: 'Models' },
  { value: 'work', label: 'Work types' },
] as const

function rowsFor(spend: SpendResponse, dimension: SpendBreakdownDimension): BreakdownRow[] {
  if (dimension === 'agents') {
    return spend.byAgent.map((row) => ({
      id: row.agent,
      title: row.agent,
      metrics: [
        { label: 'Runs', value: String(row.runs) },
        { label: 'Estimated cost', value: formatUsd(row.costUsdMicros) },
      ],
      costUsdMicros: row.costUsdMicros,
    }))
  }

  if (dimension === 'providers') {
    return Object.entries(spend.facets?.monthly.byProvider ?? {}).map(([provider, row]) => ({
      id: provider,
      title: provider,
      description: 'Current monthly cap window',
      metrics: [
        {
          label: 'Metered',
          value: row.meteredUsdMicros > 0
            ? formatUsd(row.meteredUsdMicros)
            : row.unpricedMeteredTokens > 0
              ? `$ unavailable · ${formatTokens(row.unpricedMeteredTokens)} unpriced`
              : '—',
        },
        { label: 'Subscription', value: row.subscriptionTokens > 0 ? `${formatTokens(row.subscriptionTokens)} tokens` : '—' },
      ],
      costUsdMicros: row.meteredUsdMicros > 0
        ? row.meteredUsdMicros
        : row.unpricedMeteredTokens > 0
          ? null
          : 0,
    }))
  }

  if (dimension === 'models') {
    return spend.byModel.map((row) => ({
      id: row.model,
      title: row.model,
      metrics: [
        { label: 'Runs', value: String(row.runs) },
        { label: 'Estimated cost', value: formatUsd(row.costUsdMicros) },
      ],
      costUsdMicros: row.costUsdMicros,
    }))
  }

  return (spend.byWorkClass ?? []).map((row) => ({
    id: row.workClass,
    title: row.workClass === 'unclassified' ? 'Unclassified work' : row.workClass,
    description: row.workClass === 'unclassified' ? 'Recorded before work-class attribution was available.' : undefined,
    metrics: [
      { label: 'Runs', value: String(row.runs) },
      { label: 'Tokens', value: formatTokens(row.totalTokens) },
      { label: 'Estimated cost', value: formatUsd(row.costUsdMicros) },
      { label: 'Subscription', value: row.subscriptionTokens > 0 ? `${formatTokens(row.subscriptionTokens)} tokens` : '—' },
      { label: 'Average / run', value: formatUsd(row.avgCostUsdMicros) },
    ],
    costUsdMicros: row.costUsdMicros,
  }))
}

function chartLabelFor(dimension: SpendBreakdownDimension): string {
  if (dimension === 'agents') return 'Top agent spend'
  if (dimension === 'providers') return 'Top provider spend'
  if (dimension === 'models') return 'Top model spend'
  return 'Top work type spend'
}

export function SpendBreakdown({
  spend,
  dimension,
  pageValue,
  showAllValue,
  onDimensionChange,
  onPageChange,
  onShowAllChange,
}: {
  spend: SpendResponse
  dimension: SpendBreakdownDimension
  pageValue: string
  showAllValue: string
  onDimensionChange: (dimension: SpendBreakdownDimension) => void
  onPageChange: (page: string) => void
  onShowAllChange: (showAll: string) => void
}) {
  const rows = useMemo(() => rowsFor(spend, dimension), [dimension, spend])
  const pageSize = 8
  const page = Math.max(1, Number.parseInt(pageValue, 10) || 1)
  const showAll = showAllValue === 'true'
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visibleRows = showAll
    ? rows
    : rows.slice((safePage - 1) * pageSize, safePage * pageSize)
  const chartData = useMemo<ChartDatum[]>(
    () => rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        if (a.row.costUsdMicros === null && b.row.costUsdMicros === null) return a.index - b.index
        if (a.row.costUsdMicros === null) return 1
        if (b.row.costUsdMicros === null) return -1
        return b.row.costUsdMicros - a.row.costUsdMicros || a.index - b.index
      })
      .slice(0, 8)
      .map(({ row }) => {
        const values: Record<string, number> = row.costUsdMicros === null
          ? {}
          : { cost: row.costUsdMicros }
        return {
          x: row.id,
          xLabel: row.title,
          values,
          missingLabels: row.costUsdMicros === null ? { cost: 'Cost unavailable' } : undefined,
        }
      }),
    [rows],
  )

  return (
    <Section className="@container/spend-breakdown" spacing="compact" divider="top" aria-label="Spend breakdown">
      <div className="flex min-w-0 flex-col items-stretch gap-bakin-3 @2xl/spend-breakdown:flex-row @2xl/spend-breakdown:items-start @2xl/spend-breakdown:justify-between">
        <Stack gap="dense">
          <h2>
            Spend breakdown
          </h2>
          <p className="m-0 max-w-prose text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">
            Inspect one allocation at a time. Provider totals use the current monthly budget window; the other views follow the selected page window.
          </p>
        </Stack>
        <SegmentedControl
          options={DIMENSIONS}
          value={dimension}
          onValueChange={(next) => {
            onDimensionChange(next)
            onPageChange('1')
            onShowAllChange('false')
          }}
          ariaLabel="Spend breakdown"
          idPrefix="spend-breakdown"
        />
      </div>

      {rows.length === 0 ? (
        <SystemState
          kind="initial-empty"
          scope="section"
          title={`No ${DIMENSIONS.find((item) => item.value === dimension)?.label.toLowerCase()} in this window`}
          description="Choose another breakdown or widen the spend window."
        />
      ) : (
        <>
          <div className="grid min-w-0 gap-bakin-8 @5xl/spend-breakdown:grid-cols-[minmax(16rem,0.7fr)_minmax(0,1.3fr)]">
            <div className="min-w-0 @5xl/spend-breakdown:border-r @5xl/spend-breakdown:border-bakin-border-subtle @5xl/spend-breakdown:pr-bakin-8">
              <p className="m-0 mb-bakin-4 text-bakin-typography-size-meta font-bakin-typography-weight-semibold uppercase tracking-wide text-bakin-text-muted">
                Highest estimated cost
              </p>
              <RankedBarChart
                data={chartData}
                series={{ key: 'cost', label: 'Estimated cost' }}
                label={chartLabelFor(dimension)}
                description={`The eight highest known ${dimension} cost totals in the current breakdown window.`}
                formatValue={formatUsd}
                compactData
              />
            </div>
            <div
              id={`spend-breakdown-panel-${dimension}`}
              role="tabpanel"
              aria-labelledby={`spend-breakdown-tab-${dimension}`}
              className="min-w-0"
            >
              <ListRows
                aria-label={`${DIMENSIONS.find((item) => item.value === dimension)?.label} spend`}
                variant="bordered"
                columns="minmax(12rem,1fr) minmax(0,1.35fr)"
                columnsAt="2xl"
              >
                {visibleRows.map((row) => (
                  <ListRow
                    key={row.id}
                    data-spend-row={row.id}
                    className="px-bakin-4 py-bakin-4"
                  >
                    <div className="min-w-0">
                      <p className="m-0 break-words font-bakin-typography-weight-semibold text-bakin-text-primary">
                        {row.title}
                      </p>
                      {row.description ? (
                        <p className="m-0 mt-bakin-1 text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
                          {row.description}
                        </p>
                      ) : null}
                    </div>
                    <dl className="m-0 grid min-w-0 grid-cols-2 gap-x-bakin-4 gap-y-bakin-3 @lg/list-rows:grid-cols-[repeat(auto-fit,minmax(7rem,1fr))]">
                      {row.metrics.map((metric) => (
                        <div key={metric.label} className="min-w-0">
                          <dt className="text-bakin-typography-size-meta text-bakin-text-muted">
                            {metric.label}
                          </dt>
                          <dd className="m-0 mt-bakin-1 break-words font-bakin-typography-family-mono text-bakin-typography-size-body font-bakin-typography-weight-semibold tabular-nums text-bakin-text-primary">
                            {metric.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </ListRow>
                ))}
              </ListRows>
            </div>
          </div>
          <Pagination
            page={safePage}
            pageSize={pageSize}
            showAll={showAll}
            total={rows.length}
            ariaLabel="Spend breakdown pagination"
            onPageChange={(next) => onPageChange(String(next))}
            onShowAllChange={(next) => {
              onShowAllChange(String(next))
              onPageChange('1')
            }}
          />
        </>
      )}
    </Section>
  )
}
