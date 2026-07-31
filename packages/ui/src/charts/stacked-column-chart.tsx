'use client'

import { useId, useMemo, useState, type ReactNode } from 'react'

import { BoundedOverflow } from '../layout/bounded-overflow'
import { ChartDataTable, type ChartDatum, type ChartSeries } from './chart-data-table'
import { ChartTooltip } from './chart-tooltip'
import { assignSeriesColors, CHART_MAX_SERIES, CHART_OTHER_COLOR } from './palette'

export type StackedColumnDatum = ChartDatum

export interface StackedColumnChartProps {
  data: readonly StackedColumnDatum[]
  /** Full stable entity set; labels and explicit colors override key defaults. */
  series?: readonly ChartSeries[]
  /** Compatibility shorthand for a full set whose labels equal their keys. */
  seriesKeys?: readonly string[]
  /** Accessible name for the plot. */
  label?: string
  /** Accessible name for the exact-values disclosure. */
  dataLabel?: string
  /** Bucket keys that are still accumulating data. */
  partialKeys?: readonly string[]
  /** Plot height in px, excluding legend and labels. */
  height?: number
  formatValue?: (value: number) => string
  /** Exact-table label for an absent series value. */
  missingValue?: ReactNode
  /** Plot/tooltip label for a bucket with no reported series values. */
  missingBucketLabel?: string
  /** Shown when no buckets exist. */
  emptyLabel?: string
  /** Disable only when an equivalent exact table is rendered beside the chart. */
  showDataTable?: boolean
  /** Collapse the exact-data table behind its disclosure for space-tight contexts. */
  compactData?: boolean
  /** When false, the exact-data table renders statically with no disclosure. */
  dataTableExpandable?: boolean
}

const OTHER_KEY = '__bakin_other__'
const EMPTY_SERIES: readonly ChartSeries[] = []
const EMPTY_KEYS: readonly string[] = []

interface SeriesDef extends ChartSeries {
  color: string
}

function deriveSeries(
  data: readonly StackedColumnDatum[],
  declared: readonly ChartSeries[],
  seriesKeys: readonly string[],
): { exact: ChartSeries[]; visual: SeriesDef[] } {
  const declaredByKey = new Map(declared.map((item) => [item.key, item]))
  const keys = [...new Set([
    ...declared.map((item) => item.key),
    ...seriesKeys,
    ...data.flatMap((datum) => Object.keys(datum.values)),
  ])].sort()
  const assigned = assignSeriesColors(keys)
  const exact = keys.map((key) => ({
    key,
    label: declaredByKey.get(key)?.label ?? key,
    color: declaredByKey.get(key)?.color ?? assigned.get(key),
  }))
  const visual = exact.slice(0, CHART_MAX_SERIES).map((item) => ({
    ...item,
    color: item.color ?? assigned.get(item.key)!,
  }))
  if (exact.length > CHART_MAX_SERIES) {
    visual.push({
      key: OTHER_KEY,
      label: `Other (${exact.length - CHART_MAX_SERIES})`,
      color: CHART_OTHER_COLOR,
    })
  }
  return { exact, visual }
}

function bucketValue(datum: StackedColumnDatum, series: SeriesDef, keptKeys: ReadonlySet<string>): number {
  if (series.key !== OTHER_KEY) {
    const value = datum.values[series.key]
    return Number.isFinite(value) && value! >= 0 ? value! : 0
  }
  return Object.entries(datum.values).reduce(
    (sum, [key, value]) => (keptKeys.has(key) || !Number.isFinite(value) || value < 0 ? sum : sum + value),
    0,
  )
}

function bucketHasValues(datum: StackedColumnDatum): boolean {
  return Object.values(datum.values).some((value) => Number.isFinite(value) && value >= 0)
}

/** Dense interactive stacked comparison with stable entities and an exact-data disclosure. */
export function StackedColumnChart({
  data,
  series: declaredSeries = EMPTY_SERIES,
  seriesKeys = EMPTY_KEYS,
  label = 'Stacked column chart',
  dataLabel,
  partialKeys = EMPTY_KEYS,
  height = 160,
  formatValue = (value) => value.toLocaleString(),
  missingValue = 'Not reported',
  missingBucketLabel = 'Not reported',
  emptyLabel = 'No reported data in this window.',
  compactData = false,
  showDataTable = true,
  dataTableExpandable = true,
}: StackedColumnChartProps) {
  const tooltipId = useId()
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const series = useMemo(
    () => deriveSeries(data, declaredSeries, seriesKeys),
    [data, declaredSeries, seriesKeys],
  )
  const partialKeySet = useMemo(() => new Set(partialKeys), [partialKeys])
  const keptKeys = useMemo(
    () => new Set(series.visual.filter((item) => item.key !== OTHER_KEY).map((item) => item.key)),
    [series],
  )
  const visible = series.visual.filter((item) => !hidden.has(item.key))
  const columnTotals = data.map((datum) => visible.reduce(
    (sum, item) => sum + bucketValue(datum, item, keptKeys),
    0,
  ))
  const max = Math.max(...columnTotals, 1)
  const activeDatum = activeIndex === null ? null : data[activeIndex] ?? null
  const activeDetail = activeDatum
    ? visible
      .map((item) => ({ item, value: bucketValue(activeDatum, item, keptKeys) }))
      .filter(({ value }) => value > 0)
    : []
  const activeTotal = activeIndex === null ? 0 : columnTotals[activeIndex] ?? 0
  const activeMissing = activeDatum !== null && !bucketHasValues(activeDatum)
  const table = showDataTable
    ? (
        <ChartDataTable
          data={data}
          series={series.exact}
          caption={dataLabel ?? `${label} data`}
          formatValue={formatValue}
          missingValue={missingValue}
          emptyLabel={emptyLabel}
          defaultOpen={!compactData}
          expandable={dataTableExpandable}
        />
      )
    : null

  if (data.length === 0 || series.exact.length === 0) {
    return (
      <div className="min-w-0" data-slot="stacked-column-chart">
        <div role="status" className="py-bakin-6 text-center text-[length:var(--bakin-typography-size-body)] text-bakin-text-muted">
          {emptyLabel}
        </div>
        {table}
      </div>
    )
  }

  const toggle = (key: string) => {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else if (next.size < series.visual.length - 1) next.add(key)
      return next
    })
  }

  return (
    <div className="min-w-0" data-slot="stacked-column-chart">
      <BoundedOverflow label={`${label} plot`}>
        <div className="relative w-full" style={{ minWidth: Math.max(320, data.length * 48) }}>
          <div className="flex items-end gap-bakin-1" style={{ height }} role="group" aria-label={label}>
          {data.map((datum, index) => {
            const total = columnTotals[index]!
            const isPartial = partialKeySet.has(datum.x)
            const isMissing = !bucketHasValues(datum)
            const detail = visible
              .map((item) => ({ item, value: bucketValue(datum, item, keptKeys) }))
              .filter(({ value }) => value > 0)
            const bucketLabel = `${datum.xLabel ?? datum.x}${isPartial ? ' (in progress)' : ''}`
            const accessibleLabel = isMissing
              ? `${bucketLabel}: ${missingBucketLabel}`
              : [
                  `${bucketLabel}:`,
                  ...detail.map(({ item, value }) => `${item.label} ${formatValue(value)},`),
                  `total ${formatValue(total)}`,
                ].join(' ')
            const activate = () => setActiveIndex(index)
            const deactivate = () => setActiveIndex((current) => current === index ? null : current)
            return (
              <div
                key={datum.x}
                className="relative flex min-w-0 flex-1 flex-col-reverse justify-start rounded-bakin-control focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring"
                style={{ height }}
                role="img"
                tabIndex={0}
                data-partial={isPartial || undefined}
                data-missing={isMissing || undefined}
                aria-label={accessibleLabel}
                aria-describedby={activeIndex === index ? tooltipId : undefined}
                onMouseEnter={activate}
                onMouseLeave={deactivate}
                onFocus={activate}
                onBlur={deactivate}
              >
                {visible.map((item, seriesIndex) => {
                  const value = bucketValue(datum, item, keptKeys)
                  if (value <= 0) return null
                  const segmentHeight = Math.max(2, (value / max) * (height - 8))
                  const isTop = visible.slice(seriesIndex + 1).every((next) => bucketValue(datum, next, keptKeys) <= 0)
                  return (
                    <div
                      key={item.key}
                      className={isTop ? 'rounded-t-bakin-control' : undefined}
                      style={{ height: segmentHeight, backgroundColor: item.color, marginTop: 2 }}
                      aria-hidden="true"
                    />
                  )
                })}
                {isPartial && total > 0 ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 rounded-bakin-control border border-dashed border-bakin-text-muted"
                    style={{ height: Math.max(4, (total / max) * (height - 8)) }}
                  />
                ) : null}
                {isMissing ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-bakin-1 bottom-bakin-2 flex h-bakin-row-dense items-center justify-center rounded-bakin-control border border-dashed border-bakin-text-muted text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted"
                  >
                    —
                  </span>
                ) : null}
              </div>
            )
          })}
          </div>
          {activeDatum && activeIndex !== null ? (
            <ChartTooltip
              id={tooltipId}
              xPercent={((activeIndex + 0.5) / data.length) * 100}
              yPercent={0}
              text={activeMissing ? `${activeDatum.xLabel ?? activeDatum.x}: ${missingBucketLabel}` : [
                activeDatum.xLabel ?? activeDatum.x,
                ...activeDetail.map(({ item, value }) => `${item.label} ${formatValue(value)}`),
                `Total ${formatValue(activeTotal)}`,
              ].join(' · ')}
            />
          ) : null}
          <div className="mt-bakin-1 flex gap-bakin-1 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted" aria-hidden="true">
            {data.map((datum) => (
              <div key={datum.x} className="min-w-0 flex-1 truncate text-center" title={datum.xLabel ?? datum.x}>
                {datum.xLabel ?? datum.x}
              </div>
            ))}
          </div>
        </div>
      </BoundedOverflow>

      {series.visual.length >= 2 ? (
        <div className="mt-bakin-2 flex flex-wrap gap-x-bakin-3 gap-y-bakin-1" aria-label={`${label} legend`}>
          {series.visual.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => toggle(item.key)}
              className="flex min-h-bakin-target items-center gap-bakin-2 rounded-bakin-control text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted transition-opacity motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring"
              data-hidden={hidden.has(item.key) || undefined}
              aria-pressed={!hidden.has(item.key)}
            >
              <span
                data-slot="chart-legend-swatch"
                className="inline-block size-bakin-2 rounded-bakin-control"
                style={{ backgroundColor: item.color, opacity: hidden.has(item.key) ? 0.35 : 1 }}
                aria-hidden="true"
              />
              <span>{item.label}{hidden.has(item.key) ? ' (hidden)' : ''}</span>
            </button>
          ))}
        </div>
      ) : null}
      {table}
    </div>
  )
}
