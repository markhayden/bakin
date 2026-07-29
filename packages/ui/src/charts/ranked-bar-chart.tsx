'use client'

import { useId, useMemo } from 'react'

import { ChartDataTable, chartSeriesColor, type ChartDatum, type ChartSeries } from './chart-data-table'

export interface RankedBarChartProps {
  data: readonly ChartDatum[]
  /** Ranked bars intentionally compare one unit at a time. */
  series: ChartSeries
  /** Accessible name for the chart and basis for its exact-data caption. */
  label: string
  description?: string
  formatValue?: (value: number) => string
  emptyLabel?: string
  /** Disable only when an equivalent exact table is rendered beside the chart. */
  showDataTable?: boolean
}

function reportedValue(value: number | undefined): number | null {
  return Number.isFinite(value) && value! >= 0 ? value! : null
}

/**
 * Ranked single-unit comparison with full labels, visible exact values, and
 * an exact-data disclosure. Long entity names stay readable because they are
 * never squeezed into an x-axis.
 */
export function RankedBarChart({
  data,
  series,
  label,
  description,
  formatValue = (value) => value.toLocaleString(),
  emptyLabel = 'No reported data in this window.',
  showDataTable = true,
}: RankedBarChartProps) {
  const descriptionId = useId()
  const ranked = useMemo(
    () => data
      .map((datum, index) => ({
        datum,
        index,
        value: reportedValue(datum.values[series.key]),
      }))
      .sort((a, b) => {
        if (a.value === null && b.value === null) return a.index - b.index
        if (a.value === null) return 1
        if (b.value === null) return -1
        return b.value - a.value || a.index - b.index
      })
      .map(({ datum }) => datum),
    [data, series.key],
  )
  const reported = ranked.flatMap((datum) => {
    const value = reportedValue(datum.values[series.key])
    return value === null ? [] : [value]
  })
  const max = Math.max(0, ...reported)
  const table = showDataTable
    ? (
        <ChartDataTable
          data={ranked}
          series={[series]}
          caption={`${label} data`}
          formatValue={formatValue}
        />
      )
    : null

  if (ranked.length === 0 || reported.length === 0) {
    return (
      <div className="min-w-0" data-slot="ranked-bar-chart">
        <div role="status" className="py-bakin-6 text-center text-[length:var(--bakin-typography-size-body)] text-bakin-text-muted">
          {emptyLabel}
        </div>
        {table}
      </div>
    )
  }

  return (
    <div className="min-w-0" data-slot="ranked-bar-chart">
      <div
        role="group"
        aria-label={label}
        aria-describedby={description ? descriptionId : undefined}
        className="flex min-w-0 flex-col gap-bakin-3"
      >
        {description ? <p id={descriptionId} className="sr-only">{description}</p> : null}
        {ranked.map((datum) => {
          const value = reportedValue(datum.values[series.key])
          const datumLabel = datum.xLabel ?? datum.x
          const valueLabel = value === null
            ? datum.missingLabels?.[series.key] ?? 'Not reported'
            : formatValue(value)
          const width = value === null || max === 0 ? 0 : (value / max) * 100

          return (
            <div
              key={datum.x}
              data-slot="ranked-bar-row"
              data-row-key={datum.x}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-x-bakin-4 gap-y-bakin-2"
            >
              <span className="min-w-0 break-words text-[length:var(--bakin-typography-size-body)] font-bakin-typography-weight-medium text-bakin-text-primary">
                {datumLabel}
              </span>
              <span
                data-missing={value === null ? 'true' : undefined}
                className="whitespace-nowrap font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] tabular-nums text-bakin-text-muted"
              >
                {valueLabel}
              </span>
              <div
                role={value === null ? undefined : 'img'}
                tabIndex={value === null ? undefined : 0}
                aria-label={value === null ? undefined : `${datumLabel} — ${series.label}: ${valueLabel}`}
                className="col-span-2 h-bakin-3 overflow-hidden rounded-bakin-control bg-bakin-surface-subtle outline-none focus-visible:ring-2 focus-visible:ring-bakin-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bakin-surface-default"
              >
                {value !== null && value > 0 ? (
                  <div
                    data-series={series.key}
                    className="h-full min-w-px rounded-bakin-control"
                    style={{
                      backgroundColor: chartSeriesColor(series, 0),
                      width: `${width}%`,
                    }}
                  />
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      {table}
    </div>
  )
}
