import type { ReactNode } from 'react'

import { BoundedOverflow } from '../layout/bounded-overflow'
import { cn } from '../utils'
import { CHART_SERIES_COLORS } from './palette'

export interface ChartDatum {
  /** Stable x-axis key. */
  x: string
  /** Human-readable x-axis label; defaults to `x`. */
  xLabel?: string
  /** Finite values keyed by `ChartSeries.key`. Omit a key when it is unknown. */
  values: Record<string, number>
  /** Per-series labels for intentionally absent cells. */
  missingLabels?: Record<string, string>
}

export interface ChartSeries {
  key: string
  label: string
  /** CSS color. Defaults to the matching fixed categorical token. */
  color?: string
}

export interface ChartDataTableProps {
  data: readonly ChartDatum[]
  series: readonly ChartSeries[]
  /** Accessible table name and visible disclosure label. */
  caption: string
  formatValue?: (value: number) => ReactNode
  /** Rendered when a series has no finite value; defaults to “Not reported”. */
  missingValue?: ReactNode
  /** Rendered across the table body when there are no rows. */
  emptyLabel?: ReactNode
  /** Starts the exact-data disclosure open. */
  defaultOpen?: boolean
  /** Visually hide the exact table when the owning visual is intentionally compact. */
  visuallyHidden?: boolean
  className?: string
}

/** Compatibility name retained for chart implementations migrating in T33b. */
export const CHART_TOKEN_COLORS = CHART_SERIES_COLORS

export function chartSeriesColor(series: ChartSeries, index: number): string {
  return series.color ?? CHART_SERIES_COLORS[index % CHART_SERIES_COLORS.length]!
}

function ExactTable({
  caption,
  data,
  emptyLabel,
  formatValue,
  missingValue,
  series,
}: Required<Pick<ChartDataTableProps, 'caption' | 'data' | 'emptyLabel' | 'formatValue' | 'missingValue' | 'series'>>) {
  return (
    <table
      className="min-w-full border-collapse text-left text-[length:var(--bakin-typography-size-meta)]"
      data-slot="chart-exact-table"
    >
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-bakin-border-subtle text-bakin-text-muted">
          <th scope="col" className="px-bakin-2 py-bakin-2 font-bakin-typography-weight-medium">Label</th>
          {series.map((item) => (
            <th
              key={item.key}
              scope="col"
              className="px-bakin-2 py-bakin-2 text-right font-bakin-typography-weight-medium"
            >
              {item.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.length === 0 ? (
          <tr>
            <td colSpan={series.length + 1} className="px-bakin-2 py-bakin-3 text-bakin-text-muted">
              {emptyLabel}
            </td>
          </tr>
        ) : data.map((datum) => (
          <tr key={datum.x} className="border-b border-bakin-border-subtle last:border-0">
            <th
              scope="row"
              className="max-w-64 px-bakin-2 py-bakin-2 font-bakin-typography-weight-medium text-bakin-text-primary"
            >
              <span className="block min-w-48 break-words">{datum.xLabel ?? datum.x}</span>
            </th>
            {series.map((item) => {
              const value = datum.values[item.key]
              const isMissing = !Number.isFinite(value)
              return (
                <td
                  key={item.key}
                  data-missing={isMissing ? 'true' : undefined}
                  className={cn(
                    'whitespace-nowrap px-bakin-2 py-bakin-2 text-right font-bakin-typography-family-mono tabular-nums',
                    isMissing ? 'text-bakin-text-muted' : 'text-bakin-text-primary',
                  )}
                >
                  {isMissing
                    ? datum.missingLabels?.[item.key] ?? missingValue
                    : formatValue(value!)}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Exact values for visual charts, either disclosed visibly or retained for compact summaries. */
export function ChartDataTable({
  data,
  series,
  caption,
  formatValue = (value) => value.toLocaleString(),
  missingValue = 'Not reported',
  emptyLabel = 'No data available.',
  defaultOpen = false,
  visuallyHidden = false,
  className,
}: ChartDataTableProps) {
  const table = (
    <ExactTable
      caption={caption}
      data={data}
      emptyLabel={emptyLabel}
      formatValue={formatValue}
      missingValue={missingValue}
      series={series}
    />
  )

  if (visuallyHidden) {
    return <div className={cn('sr-only', className)} data-slot="chart-data-table">{table}</div>
  }

  return (
    <details
      className={cn('mt-bakin-3 min-w-0 max-w-full text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted', className)}
      data-slot="chart-data-table"
      open={defaultOpen || undefined}
    >
      <summary className="w-fit cursor-pointer rounded-bakin-control underline-offset-4 hover:text-bakin-text-primary hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring">
        View {caption}
      </summary>
      <BoundedOverflow
        label={`${caption} table`}
        className="mt-bakin-2 w-full rounded-bakin-surface border border-bakin-border-subtle"
      >
        {table}
      </BoundedOverflow>
    </details>
  )
}
