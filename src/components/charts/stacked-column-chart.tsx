/**
 * StackedColumnChart (#385) — hand-rolled div-based stacked columns for the
 * SDK chart kit. One column per x bucket, segments stacked by series with a
 * 2px surface gap between fills, legend with click-to-toggle when there are
 * ≥2 series (a single series needs no legend), and a per-column pointer and
 * keyboard tooltip carrying the full breakdown. Series beyond the palette
 * fold into a gray "Other" — a 9th hue is never generated.
 */
import { useId, useMemo, useState } from 'react'
import { ChartDataTable, type ChartSeries } from './chart-data-table'
import { CHART_SERIES_COLORS, CHART_OTHER_COLOR, CHART_MAX_SERIES } from './palette'

export interface StackedColumnDatum {
  /** Bucket key (e.g. a YYYY-MM-DD day). */
  x: string
  /** Short display label for the bucket; defaults to x. */
  xLabel?: string
  /** Per-series values for this bucket (missing series = 0). */
  values: Record<string, number>
}

export interface StackedColumnChartProps {
  data: StackedColumnDatum[]
  /** Accessible name for the plot. */
  label?: string
  /** Accessible name for the exact-values disclosure. */
  dataLabel?: string
  /** Bucket keys that are still accumulating data. */
  partialKeys?: readonly string[]
  /** Plot height in px (columns area, excluding legend). */
  height?: number
  formatValue?: (n: number) => string
  /** Shown when data is empty — honest empty state, never a fake chart. */
  emptyLabel?: string
}

const OTHER_KEY = 'other'

interface SeriesDef {
  key: string
  label: string
  color: string
}

/**
 * Top palette-size series by total (alphabetical within), remainder folded
 * into "Other". Color assignment is alphabetical over the KEPT set so a
 * window change that keeps the same entities never repaints them.
 */
function deriveSeries(data: StackedColumnDatum[]): SeriesDef[] {
  const totals = new Map<string, number>()
  for (const d of data) {
    for (const [key, value] of Object.entries(d.values)) {
      totals.set(key, (totals.get(key) ?? 0) + value)
    }
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key)
  const kept = ranked.slice(0, ranked.length > CHART_MAX_SERIES ? CHART_MAX_SERIES - 1 : CHART_MAX_SERIES).sort()
  const series: SeriesDef[] = kept.map((key, i) => ({
    key,
    label: key,
    color: CHART_SERIES_COLORS[i]!,
  }))
  if (ranked.length > CHART_MAX_SERIES) {
    series.push({ key: OTHER_KEY, label: `Other (${ranked.length - kept.length})`, color: CHART_OTHER_COLOR })
  }
  return series
}

function bucketValue(datum: StackedColumnDatum, series: SeriesDef, keptKeys: Set<string>): number {
  if (series.key !== OTHER_KEY) return datum.values[series.key] ?? 0
  return Object.entries(datum.values).reduce(
    (sum, [key, value]) => (keptKeys.has(key) ? sum : sum + value),
    0,
  )
}

export function StackedColumnChart({
  data,
  label = 'Stacked column chart',
  dataLabel,
  partialKeys = [],
  height = 160,
  formatValue = (n) => n.toLocaleString(),
  emptyLabel = 'No data in this window.',
}: StackedColumnChartProps) {
  const tooltipId = useId()
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hovered, setHovered] = useState<number | null>(null)

  const series = useMemo(() => deriveSeries(data), [data])
  const partialKeySet = useMemo(() => new Set(partialKeys), [partialKeys])
  const exactSeries = useMemo<ChartSeries[]>(() => (
    [...new Set(data.flatMap((datum) => Object.keys(datum.values)))]
      .sort()
      .map((key) => ({ key, label: key }))
  ), [data])
  const keptKeys = useMemo(
    () => new Set(series.filter((s) => s.key !== OTHER_KEY).map((s) => s.key)),
    [series],
  )
  const visible = series.filter((s) => !hidden.has(s.key))

  const columnTotals = data.map((d) =>
    visible.reduce((sum, s) => sum + bucketValue(d, s, keptKeys), 0),
  )
  const max = Math.max(...columnTotals, 1)
  const activeDatum = hovered === null ? null : data[hovered] ?? null
  const activeDetail = activeDatum
    ? visible
      .map((item) => ({ item, value: bucketValue(activeDatum, item, keptKeys) }))
      .filter(({ value }) => value > 0)
    : []
  const activeTotal = hovered === null ? 0 : columnTotals[hovered] ?? 0

  if (data.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</div>
  }

  const toggle = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else if (next.size < series.length - 1) next.add(key) // never hide the last one
      return next
    })
  }

  return (
    <div>
      <div className="relative">
        <div className="flex items-end gap-1" style={{ height }} role="group" aria-label={label}>
          {data.map((datum, i) => {
            const total = columnTotals[i]!
            const isPartial = partialKeySet.has(datum.x)
            const detail = visible
              .map((item) => ({ item, value: bucketValue(datum, item, keptKeys) }))
              .filter(({ value }) => value > 0)
            const accessibleLabel = [
              `${datum.xLabel ?? datum.x}${isPartial ? ' (in progress)' : ''}:`,
              ...detail.map(({ item, value }) => `${item.label} ${formatValue(value)},`),
              `total ${formatValue(total)}`,
            ].join(' ')
            return (
              <div
                key={datum.x}
                className="group relative flex min-w-0 flex-1 flex-col-reverse justify-start rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                style={{ height }}
                role="img"
                tabIndex={0}
                data-partial={isPartial || undefined}
                aria-label={accessibleLabel}
                aria-describedby={hovered === i ? tooltipId : undefined}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered((h) => (h === i ? null : h))}
              >
                {visible.map((s, si) => {
                  const value = bucketValue(datum, s, keptKeys)
                  if (value <= 0) return null
                  const px = Math.max(2, (value / max) * (height - 8))
                  const isTop = visible.slice(si + 1).every((up) => bucketValue(datum, up, keptKeys) <= 0)
                  return (
                    <div
                      key={s.key}
                      className={isTop ? 'rounded-t' : undefined}
                      style={{ height: px, backgroundColor: s.color, marginTop: 2 }}
                    />
                  )
                })}
                {isPartial && total > 0 && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 rounded-sm border border-dashed border-foreground/70"
                    style={{ height: Math.max(4, (total / max) * (height - 8)) }}
                  />
                )}
              </div>
            )
          })}
        </div>
        {activeDatum && hovered !== null && (
          <div
            id={tooltipId}
            role="tooltip"
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: `${((hovered + 0.5) / data.length) * 100}%` }}
          >
            <div className="mb-1 font-medium text-foreground">{activeDatum.xLabel ?? activeDatum.x}</div>
            {activeDetail.map(({ item, value }) => (
              <div key={item.key} className="flex items-center gap-1.5 text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: item.color }} />
                <span>{item.label}</span>
                <span className="ml-auto pl-3 tabular-nums text-foreground">{formatValue(value)}</span>
              </div>
            ))}
            <div className="mt-1 border-t border-border pt-1 text-muted-foreground">
              Total <span className="tabular-nums text-foreground">{formatValue(activeTotal)}</span>
            </div>
          </div>
        )}
        <div className="mt-1 flex gap-1 text-[10px] text-muted-foreground">
          {data.map((d) => (
            <div key={d.x} className="min-w-0 flex-1 truncate text-center" title={d.x}>
              {d.xLabel ?? d.x}
            </div>
          ))}
        </div>
      </div>
      {series.length >= 2 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {series.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s.key)}
              className={`flex items-center gap-1.5 rounded-sm text-xs transition-opacity motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${hidden.has(s.key) ? 'opacity-40' : ''}`}
              aria-pressed={!hidden.has(s.key)}
            >
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
              <span className="text-muted-foreground">{s.label}</span>
            </button>
          ))}
        </div>
      )}
      <ChartDataTable
        data={data}
        series={exactSeries}
        caption={dataLabel ?? `${label} data`}
        formatValue={formatValue}
      />
    </div>
  )
}
