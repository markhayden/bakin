'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { RankedBarChart, type ChartDatum } from '@makinbakin/sdk/charts'
import { Section, Stack } from '@makinbakin/sdk/layout'
import {
  DataTable,
  SegmentedControl,
  type DataTableColumn,
  type DataTableSort,
} from '@makinbakin/sdk/patterns'
import { SystemState } from '@makinbakin/sdk/ui'

import type { SpendResponse } from './use-models-data'
import { formatTokens, formatUsd } from './spend-utils'

export type SpendBreakdownDimension = 'agents' | 'providers' | 'models' | 'work'

/** Sort keys shared by every dimension; a dimension only marks the ones it carries. */
type SpendSortField = 'cost' | 'runs' | 'tokens'

interface BreakdownRow {
  id: string
  title: string
  description?: string
  /** Ranking + cost-sort basis; `null` means "known to be unavailable". */
  costUsdMicros: number | null
  /** Display for the cost column — providers show a metered/unpriced blend. */
  costLabel: string
  runs: number | null
  totalTokens: number | null
  subscriptionTokens: number | null
  avgCostUsdMicros: number | null
}

const DIMENSIONS = [
  { value: 'agents', label: 'Agents' },
  { value: 'providers', label: 'Providers' },
  { value: 'models', label: 'Models' },
  { value: 'work', label: 'Work types' },
] as const

function subscriptionLabel(tokens: number | null): string {
  return tokens !== null && tokens > 0 ? `${formatTokens(tokens)} tokens` : '—'
}

function rowsFor(spend: SpendResponse, dimension: SpendBreakdownDimension): BreakdownRow[] {
  if (dimension === 'agents') {
    return spend.byAgent.map((row) => ({
      id: row.agent,
      title: row.agent,
      costUsdMicros: row.costUsdMicros,
      costLabel: formatUsd(row.costUsdMicros),
      runs: row.runs,
      totalTokens: null,
      subscriptionTokens: null,
      avgCostUsdMicros: null,
    }))
  }

  if (dimension === 'providers') {
    return Object.entries(spend.facets?.monthly.byProvider ?? {}).map(([provider, row]) => ({
      id: provider,
      title: provider,
      description: 'Current monthly cap window',
      costUsdMicros: row.meteredUsdMicros > 0
        ? row.meteredUsdMicros
        : row.unpricedMeteredTokens > 0
          ? null
          : 0,
      costLabel: row.meteredUsdMicros > 0
        ? formatUsd(row.meteredUsdMicros)
        : row.unpricedMeteredTokens > 0
          ? `$ unavailable · ${formatTokens(row.unpricedMeteredTokens)} unpriced`
          : '—',
      runs: null,
      totalTokens: null,
      subscriptionTokens: row.subscriptionTokens,
      avgCostUsdMicros: null,
    }))
  }

  if (dimension === 'models') {
    return spend.byModel.map((row) => ({
      id: row.model,
      title: row.model,
      costUsdMicros: row.costUsdMicros,
      costLabel: formatUsd(row.costUsdMicros),
      runs: row.runs,
      totalTokens: null,
      subscriptionTokens: null,
      avgCostUsdMicros: null,
    }))
  }

  return (spend.byWorkClass ?? []).map((row) => ({
    id: row.workClass,
    title: row.workClass === 'unclassified' ? 'Unclassified work' : row.workClass,
    description: row.workClass === 'unclassified' ? 'Recorded before work-class attribution was available.' : undefined,
    costUsdMicros: row.costUsdMicros,
    costLabel: formatUsd(row.costUsdMicros),
    runs: row.runs,
    totalTokens: row.totalTokens,
    subscriptionTokens: row.subscriptionTokens,
    avgCostUsdMicros: row.avgCostUsdMicros,
  }))
}

function chartLabelFor(dimension: SpendBreakdownDimension): string {
  if (dimension === 'agents') return 'Top agent spend'
  if (dimension === 'providers') return 'Top provider spend'
  if (dimension === 'models') return 'Top model spend'
  return 'Top work type spend'
}

function subjectHeaderFor(dimension: SpendBreakdownDimension): string {
  if (dimension === 'agents') return 'Agent'
  if (dimension === 'providers') return 'Provider'
  if (dimension === 'models') return 'Model'
  return 'Work type'
}

function sortValue(row: BreakdownRow, field: SpendSortField): number | null {
  if (field === 'cost') return row.costUsdMicros
  if (field === 'runs') return row.runs
  return row.totalTokens
}

/** Right-aligned mono figure — the shared treatment for every numeric cell. */
function Figure({ children }: { children: ReactNode }) {
  return (
    <span className="font-bakin-typography-family-mono tabular-nums text-bakin-text-primary">
      {children}
    </span>
  )
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
  // Server order until the reader picks a column — the consumer owns ordering.
  const [sort, setSort] = useState<DataTableSort<SpendSortField> | null>(null)
  const sortedRows = useMemo(() => {
    if (!sort) return rows
    const { field, dir } = sort
    return [...rows].sort((a, b) => {
      const av = sortValue(a, field)
      const bv = sortValue(b, field)
      // Unknown figures park at the bottom in both directions — a missing
      // cost is never presented as the cheapest row.
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return dir === 'asc' ? av - bv : bv - av
    })
  }, [rows, sort])
  const pageSize = 8
  const page = Math.max(1, Number.parseInt(pageValue, 10) || 1)
  const showAll = showAllValue === 'true'
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visibleRows = showAll
    ? sortedRows
    : sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize)
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

  const columns = useMemo<ReadonlyArray<DataTableColumn<BreakdownRow, SpendSortField>>>(() => {
    const subject: DataTableColumn<BreakdownRow, SpendSortField> = {
      key: 'subject',
      header: subjectHeaderFor(dimension),
      headClassName: 'min-w-48',
      cellClassName: 'whitespace-normal',
      cell: (row) => (
        <div className="grid min-w-0 gap-bakin-1">
          <span className="min-w-0 break-words font-bakin-typography-weight-semibold text-bakin-text-primary">
            {row.title}
          </span>
          {row.description ? (
            <span className="min-w-0 break-words text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
              {row.description}
            </span>
          ) : null}
        </div>
      ),
    }

    const runs: DataTableColumn<BreakdownRow, SpendSortField> = {
      key: 'runs',
      header: 'Runs',
      sortable: true,
      align: 'end',
      cell: (row) => <Figure>{row.runs === null ? '—' : String(row.runs)}</Figure>,
    }
    const tokens: DataTableColumn<BreakdownRow, SpendSortField> = {
      key: 'tokens',
      header: 'Tokens',
      sortable: true,
      align: 'end',
      cell: (row) => <Figure>{row.totalTokens === null ? '—' : formatTokens(row.totalTokens)}</Figure>,
    }
    const cost: DataTableColumn<BreakdownRow, SpendSortField> = {
      key: 'cost',
      header: dimension === 'providers' ? 'Metered' : 'Estimated cost',
      sortable: true,
      align: 'end',
      cellClassName: 'whitespace-normal',
      cell: (row) => <Figure>{row.costLabel}</Figure>,
    }
    const subscription: DataTableColumn<BreakdownRow, SpendSortField> = {
      key: 'subscription',
      header: 'Subscription',
      align: 'end',
      cell: (row) => <Figure>{subscriptionLabel(row.subscriptionTokens)}</Figure>,
    }
    const average: DataTableColumn<BreakdownRow, SpendSortField> = {
      key: 'average',
      header: 'Average / run',
      align: 'end',
      cell: (row) => <Figure>{row.avgCostUsdMicros === null ? '—' : formatUsd(row.avgCostUsdMicros)}</Figure>,
    }

    if (dimension === 'providers') return [subject, cost, subscription]
    if (dimension === 'work') return [subject, runs, tokens, cost, subscription, average]
    return [subject, runs, cost]
  }, [dimension])

  return (
    <Section className="@container/spend-breakdown" spacing="compact" divider="top" aria-label="Spend breakdown">
      <div className="flex min-w-0 flex-col items-stretch gap-bakin-3 @2xl/spend-breakdown:flex-row @2xl/spend-breakdown:items-start @2xl/spend-breakdown:justify-between">
        <Stack gap="dense">
          <h2>
            Spend breakdown
          </h2>
          <p className="max-w-prose text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">
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
            setSort(null)
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
        <div className="grid min-w-0 gap-bakin-8 @5xl/spend-breakdown:grid-cols-[minmax(16rem,0.7fr)_minmax(0,1.3fr)]">
          <div className="min-w-0 @5xl/spend-breakdown:border-r @5xl/spend-breakdown:border-bakin-border-subtle @5xl/spend-breakdown:pr-bakin-8">
            <p className="mb-bakin-4 text-bakin-typography-size-meta font-bakin-typography-weight-semibold uppercase tracking-wide text-bakin-text-muted">
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
            {/* Comparable per-dimension figures read as a table: one column per
                metric, right-aligned mono figures, and sortable cost/runs/tokens
                beside the ranked chart. */}
            <DataTable
              label={`${DIMENSIONS.find((item) => item.value === dimension)?.label} spend`}
              collapseBelow="none"
              columns={columns}
              rows={visibleRows}
              rowKey={(row) => row.id}
              rowProps={(row) => ({ 'data-spend-row': row.id })}
              sort={sort ?? undefined}
              onSortChange={(field) => {
                setSort((prev) => prev?.field === field
                  ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                  : { field, dir: 'desc' })
                onPageChange('1')
              }}
              pagination={{
                page: safePage,
                pageSize,
                showAll,
                total: sortedRows.length,
                ariaLabel: 'Spend breakdown pagination',
                onPageChange: (next) => onPageChange(String(next)),
                onShowAllChange: (next) => {
                  onShowAllChange(String(next))
                  onPageChange('1')
                },
              }}
            />
          </div>
        </div>
      )}
    </Section>
  )
}
