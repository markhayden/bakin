'use client'

import { useId, useMemo } from 'react'

import { ChartDataTable, chartSeriesColor, type ChartDatum, type ChartSeries } from './chart-data-table'

export interface RankedBarChartProps {
  data: readonly ChartDatum[]
  /** Ranked bars intentionally compare one unit at a time. */
  series: ChartSeries
  /**
   * Optional highlighted sub-segment of each bar (e.g. the failed portion of a
   * call total). Its value is read from `datum.values[secondary.key]`, must
   * share the primary unit, and renders as a full-opacity inset segment over a
   * muted total; the legend, per-bar accessible label, and exact table carry
   * both numbers. Color defaults to the second categorical slot.
   */
  secondary?: ChartSeries
  /** Accessible name for the chart and basis for its exact-data caption. */
  label: string
  description?: string
  formatValue?: (value: number) => string
  emptyLabel?: string
  /** Disable only when an equivalent exact table is rendered beside the chart. */
  showDataTable?: boolean
  /** Collapse the exact-data table behind its disclosure for space-tight contexts. */
  compactData?: boolean
}

const MUTED_TOTAL_OPACITY = 0.45

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
  secondary,
  label,
  description,
  formatValue = (value) => value.toLocaleString(),
  emptyLabel = 'No reported data in this window.',
  showDataTable = true,
  compactData = false,
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
          series={secondary ? [series, secondary] : [series]}
          caption={`${label} data`}
          formatValue={formatValue}
          defaultOpen={!compactData}
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
          const secondaryValue = secondary ? reportedValue(datum.values[secondary.key]) : null
          const secondaryValueLabel = secondary
            ? secondaryValue === null
              ? datum.missingLabels?.[secondary.key] ?? 'Not reported'
              : formatValue(secondaryValue)
            : null
          const secondaryWidth = secondaryValue !== null && value !== null && value > 0
            ? Math.min(100, (secondaryValue / value) * 100)
            : 0

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
                {secondary && secondaryValue !== null && secondaryValue > 0
                  ? ` · ${secondaryValueLabel} ${secondary.label}`
                  : ''}
              </span>
              <div
                role={value === null ? undefined : 'img'}
                tabIndex={value === null ? undefined : 0}
                aria-label={value === null
                  ? undefined
                  : secondary
                    ? `${datumLabel} — ${series.label}: ${valueLabel}, ${secondary.label}: ${secondaryValueLabel}`
                    : `${datumLabel} — ${series.label}: ${valueLabel}`}
                className="col-span-2 h-bakin-3 overflow-hidden rounded-bakin-control bg-bakin-surface-subtle outline-none focus-visible:ring-2 focus-visible:ring-bakin-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bakin-surface-default"
              >
                {value !== null && value > 0 ? (
                  secondary ? (
                    <div
                      data-series={series.key}
                      className="relative h-full min-w-px overflow-hidden rounded-bakin-control"
                      style={{ width: `${width}%` }}
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-bakin-control"
                        style={{
                          backgroundColor: chartSeriesColor(series, 0),
                          opacity: MUTED_TOTAL_OPACITY,
                        }}
                      />
                      {secondaryValue !== null && secondaryValue > 0 ? (
                        <span
                          data-series-secondary={secondary.key}
                          aria-hidden="true"
                          className="absolute inset-y-0 right-0 min-w-px rounded-r-bakin-control"
                          style={{
                            backgroundColor: chartSeriesColor(secondary, 1),
                            width: `${secondaryWidth}%`,
                          }}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <div
                      data-series={series.key}
                      className="h-full min-w-px rounded-bakin-control"
                      style={{
                        backgroundColor: chartSeriesColor(series, 0),
                        width: `${width}%`,
                      }}
                    />
                  )
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
      {secondary ? (
        <ul className="mt-bakin-2 flex flex-wrap gap-x-bakin-3 gap-y-bakin-1" aria-label={`${label} legend`}>
          <li className="flex items-center gap-bakin-2 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">
            <span
              data-slot="chart-legend-swatch"
              className="inline-block size-bakin-2 rounded-bakin-control"
              style={{ backgroundColor: chartSeriesColor(series, 0), opacity: MUTED_TOTAL_OPACITY }}
              aria-hidden="true"
            />
            {series.label}
          </li>
          <li className="flex items-center gap-bakin-2 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">
            <span
              data-slot="chart-legend-swatch"
              className="inline-block size-bakin-2 rounded-bakin-control"
              style={{ backgroundColor: chartSeriesColor(secondary, 1) }}
              aria-hidden="true"
            />
            {secondary.label}
          </li>
        </ul>
      ) : null}
      {table}
    </div>
  )
}
