import type { ReactNode } from 'react'

export interface ChartDatum {
  /** Stable x-axis key. */
  x: string
  /** Human-readable x-axis label; defaults to `x`. */
  xLabel?: string
  /** Values keyed by `ChartSeries.key`. */
  values: Record<string, number>
  /** Per-series labels for intentionally absent cells. */
  missingLabels?: Record<string, string>
}

export interface ChartSeries {
  key: string
  label: string
  /** CSS color. Defaults to the matching semantic `--chart-*` token. */
  color?: string
}

export interface ChartDataTableProps {
  data: ChartDatum[]
  series: ChartSeries[]
  caption: string
  formatValue?: (value: number) => ReactNode
  /** Rendered when a series has no value for a bucket; defaults to formatted zero. */
  missingValue?: ReactNode
  /** Visually hide the exact table when the chart is intentionally compact. */
  visuallyHidden?: boolean
}

export const CHART_TOKEN_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const

export function chartSeriesColor(series: ChartSeries, index: number): string {
  return series.color ?? CHART_TOKEN_COLORS[index % CHART_TOKEN_COLORS.length]!
}

/** Exact values for charts whose visual marks intentionally summarize data. */
export function ChartDataTable({
  data,
  series,
  caption,
  formatValue = (value) => value.toLocaleString(),
  missingValue,
  visuallyHidden = false,
}: ChartDataTableProps) {
  const table = (
    <table className="w-full border-collapse text-left text-xs" aria-label={caption}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border text-muted-foreground">
          <th scope="col" className="px-2 py-1.5 font-medium">Label</th>
          {series.map((item) => (
            <th key={item.key} scope="col" className="px-2 py-1.5 text-right font-medium">
              {item.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((datum) => (
          <tr key={datum.x} className="border-b border-border/60 last:border-0">
            <th scope="row" className="px-2 py-1.5 font-medium text-foreground">
              {datum.xLabel ?? datum.x}
            </th>
            {series.map((item) => (
              <td key={item.key} className="px-2 py-1.5 text-right tabular-nums text-foreground">
                {Number.isFinite(datum.values[item.key])
                  ? formatValue(datum.values[item.key]!)
                  : datum.missingLabels?.[item.key]
                    ?? (missingValue === undefined ? formatValue(0) : missingValue)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )

  if (visuallyHidden) {
    return <div className="sr-only" data-slot="chart-data-table">{table}</div>
  }

  return (
    <details className="mt-3 text-xs text-muted-foreground" data-slot="chart-data-table">
      <summary className="w-fit rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        View {caption}
      </summary>
      <div className="mt-2 max-w-full overflow-x-auto rounded-lg ring-1 ring-foreground/10">
        {table}
      </div>
    </details>
  )
}
