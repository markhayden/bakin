'use client'

import { useId, useMemo, useState } from 'react'

import { BoundedOverflow } from '../layout/bounded-overflow'
import { ChartDataTable, type ChartDatum, type ChartSeries } from './chart-data-table'
import { ChartTooltip } from './chart-tooltip'
import { assignSeriesColors, CHART_OTHER_COLOR } from './palette'

export interface PieChartDatum {
  /** Stable entity key; the palette slot follows this key, never the value. */
  key: string
  label: string
  value: number
}

export interface PieChartProps {
  data: readonly PieChartDatum[]
  /** Accessible name for the plot and basis for its exact-data caption. */
  label: string
  description?: string
  /** Ring variant with a generous inner radius. */
  donut?: boolean
  formatValue?: (value: number) => string
  emptyLabel?: string
  /** Disable only when an equivalent exact table is rendered beside the chart. */
  showDataTable?: boolean
}

/** A pie renders at most this many slices; later entities fold into Other. */
export const PIE_MAX_SLICES = 5

/** Slices below this share rely on the legend and exact table instead of a direct label. */
export const PIE_DIRECT_LABEL_MIN_FRACTION = 0.12

export interface PieSliceModel {
  key: string
  label: string
  value: number
  color: string
  /** Share of the rendered whole, 0..1. */
  fraction: number
  /** Turn fraction from 12 o'clock, clockwise. */
  start: number
  end: number
  isOther: boolean
  /** Present on the Other slice: how many entities were folded. */
  foldedCount?: number
}

export interface PieModel {
  slices: PieSliceModel[]
  /** Sum of every rendered value, including the Other fold. */
  total: number
  /** Negative input is a programming error; nothing renders. */
  hasNegative: boolean
}

const WIDTH = 440
const HEIGHT = 220
const CX = WIDTH / 2
const CY = HEIGHT / 2
const OUTER_RADIUS = 80
/** Generous donut hole keeps the ring an honest part-to-whole band. */
const DONUT_INNER_RADIUS = 48
const LABEL_RADIUS = OUTER_RADIUS + 12
const PIE_OTHER_KEY = '__bakin_pie_other__'
const NEGATIVE_LABEL = 'Negative values cannot be shown as parts of a whole.'
const TABLE_SERIES: readonly ChartSeries[] = [{ key: 'value', label: 'Value' }]

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Point on a circle at a clockwise turn fraction starting from 12 o'clock. */
export function polarPoint(cx: number, cy: number, radius: number, fraction: number): { x: number; y: number } {
  const angle = fraction * 2 * Math.PI - Math.PI / 2
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) }
}

/** Closed slice path; `innerRadius` 0 draws a pie wedge, greater an annulus segment. */
export function pieSlicePath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  start: number,
  end: number,
): string {
  const largeArc = end - start > 0.5 ? 1 : 0
  const outerStart = polarPoint(cx, cy, outerRadius, start)
  const outerEnd = polarPoint(cx, cy, outerRadius, end)
  if (innerRadius <= 0) {
    return [
      `M ${cx} ${cy}`,
      `L ${round2(outerStart.x)} ${round2(outerStart.y)}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${round2(outerEnd.x)} ${round2(outerEnd.y)}`,
      'Z',
    ].join(' ')
  }
  const innerStart = polarPoint(cx, cy, innerRadius, start)
  const innerEnd = polarPoint(cx, cy, innerRadius, end)
  return [
    `M ${round2(outerStart.x)} ${round2(outerStart.y)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${round2(outerEnd.x)} ${round2(outerEnd.y)}`,
    `L ${round2(innerEnd.x)} ${round2(innerEnd.y)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${round2(innerStart.x)} ${round2(innerStart.y)}`,
    'Z',
  ].join(' ')
}

/** Whole-percent share label that never rounds a real part to nothing or everything. */
export function formatPieShare(fraction: number): string {
  const pct = fraction * 100
  const rounded = Math.round(pct)
  if (rounded === 0 && pct > 0) return '<1%'
  if (rounded === 100 && pct < 100) return '>99%'
  return `${rounded}%`
}

/**
 * Pure render model: zero and non-finite values are omitted from the ring
 * (the exact table keeps them), any finite negative value invalidates the
 * whole ring, colors come from the fixed palette assignment over the FULL
 * entity set, and slices beyond the cap — the smallest by value, plus any
 * entity beyond the palette's stable slots — fold into one Other slice.
 * Rendered slices keep the caller's data order; they are never reordered
 * by value.
 */
export function buildPieModel(data: readonly PieChartDatum[]): PieModel {
  if (data.some((datum) => Number.isFinite(datum.value) && datum.value < 0)) {
    return { slices: [], total: 0, hasNegative: true }
  }
  const colors = assignSeriesColors(data.map((datum) => datum.key))
  const visible = data.filter((datum) => Number.isFinite(datum.value) && datum.value > 0)
  const keptCount = visible.length > PIE_MAX_SLICES ? PIE_MAX_SLICES - 1 : visible.length
  const rankedKeys = new Set(
    visible
      .map((datum, index) => ({ datum, index }))
      .sort((a, b) => b.datum.value - a.datum.value || a.index - b.index)
      .slice(0, keptCount)
      .map(({ datum }) => datum.key),
  )
  const kept = visible.filter(
    (datum) => rankedKeys.has(datum.key) && colors.get(datum.key) !== CHART_OTHER_COLOR,
  )
  const folded = visible.filter(
    (datum) => !rankedKeys.has(datum.key) || colors.get(datum.key) === CHART_OTHER_COLOR,
  )
  const total = visible.reduce((sum, datum) => sum + datum.value, 0)

  const rendered: Array<Omit<PieSliceModel, 'fraction' | 'start' | 'end'>> = kept.map((datum) => ({
    key: datum.key,
    label: datum.label,
    value: datum.value,
    color: colors.get(datum.key)!,
    isOther: false,
  }))
  if (folded.length > 0) {
    rendered.push({
      key: PIE_OTHER_KEY,
      label: `Other (${folded.length})`,
      value: folded.reduce((sum, datum) => sum + datum.value, 0),
      color: CHART_OTHER_COLOR,
      isOther: true,
      foldedCount: folded.length,
    })
  }

  let cursor = 0
  const slices = rendered.map((slice) => {
    const fraction = total > 0 ? slice.value / total : 0
    const start = cursor
    cursor += fraction
    return { ...slice, fraction, start, end: cursor }
  })
  if (slices.length > 0) slices[slices.length - 1]!.end = 1

  return { slices, total, hasNegative: false }
}

function directLabel(label: string): string {
  return label.length <= 14 ? label : `${label.slice(0, 13)}…`
}

interface ActiveSlice {
  key: string
  text: string
  x: number
  y: number
}

/** Part-to-whole share of at most five slices with fixed entity colors and an exact-data disclosure. */
export function PieChart({
  data,
  label,
  description,
  donut = false,
  formatValue = (value) => value.toLocaleString(),
  emptyLabel = 'No reported data in this window.',
  showDataTable = true,
}: PieChartProps) {
  const tooltipId = useId()
  const [active, setActive] = useState<ActiveSlice | null>(null)
  const model = useMemo(() => buildPieModel(data), [data])
  const tableData = useMemo<ChartDatum[]>(
    () => data.map((datum) => {
      const values: Record<string, number> = {}
      if (Number.isFinite(datum.value)) values.value = datum.value
      return { x: datum.key, xLabel: datum.label, values }
    }),
    [data],
  )
  const table = showDataTable
    ? <ChartDataTable data={tableData} series={TABLE_SERIES} caption={`${label} data`} formatValue={formatValue} />
    : null

  if (model.hasNegative) {
    return (
      <div className="min-w-0" data-slot="pie-chart" data-invalid="negative-values">
        <div role="status" className="py-bakin-6 text-center text-[length:var(--bakin-typography-size-body)] text-bakin-text-muted">
          {NEGATIVE_LABEL}
        </div>
        {table}
      </div>
    )
  }

  if (model.slices.length === 0) {
    return (
      <div className="min-w-0" data-slot="pie-chart">
        <div role="status" className="py-bakin-6 text-center text-[length:var(--bakin-typography-size-body)] text-bakin-text-muted">
          {emptyLabel}
        </div>
        {table}
      </div>
    )
  }

  const innerRadius = donut ? DONUT_INNER_RADIUS : 0

  return (
    <div className="min-w-0" data-slot="pie-chart" data-donut={donut || undefined}>
      <BoundedOverflow label={`${label} plot`}>
        <div className="relative w-full" style={{ minWidth: 320 }}>
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="group"
            aria-label={label}
            className="block h-auto w-full max-w-full"
          >
          <title>{label}</title>
          {description ? <desc>{description}</desc> : null}

          {model.slices.map((slice) => {
            const mid = (slice.start + slice.end) / 2
            const anchor = polarPoint(CX, CY, (OUTER_RADIUS + innerRadius) / 2, mid)
            const text = `${slice.label}: ${formatValue(slice.value)} (${formatPieShare(slice.fraction)})`
            const selected = active?.key === slice.key
            const activate = () => setActive({ key: slice.key, text, x: anchor.x, y: anchor.y })
            const deactivate = () => setActive((current) => current?.key === slice.key ? null : current)
            const shared = {
              role: 'img',
              tabIndex: 0,
              'aria-label': text,
              'aria-describedby': selected ? tooltipId : undefined,
              className: 'outline-none',
              'data-slice': slice.key,
              'data-other': slice.isOther || undefined,
              onMouseEnter: activate,
              onMouseLeave: deactivate,
              onFocus: activate,
              onBlur: deactivate,
            } as const

            if (model.slices.length === 1) {
              return (
                <g key={slice.key}>
                  {selected ? (
                    <circle cx={CX} cy={CY} r={OUTER_RADIUS + 3} fill="none" stroke="var(--bakin-color-focus-ring)" strokeWidth="2" aria-hidden="true" />
                  ) : null}
                  {donut ? (
                    <circle
                      cx={CX}
                      cy={CY}
                      r={(OUTER_RADIUS + innerRadius) / 2}
                      fill="none"
                      stroke={slice.color}
                      strokeWidth={OUTER_RADIUS - innerRadius}
                      {...shared}
                    />
                  ) : (
                    <circle cx={CX} cy={CY} r={OUTER_RADIUS} fill={slice.color} {...shared} />
                  )}
                </g>
              )
            }

            const d = pieSlicePath(CX, CY, OUTER_RADIUS, innerRadius, slice.start, slice.end)
            return (
              <g key={slice.key}>
                <path
                  d={d}
                  fill={slice.color}
                  stroke="var(--bakin-color-canvas-default)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  {...shared}
                />
                {selected ? (
                  <path d={d} fill="none" stroke="var(--bakin-color-focus-ring)" strokeWidth="2" pointerEvents="none" aria-hidden="true" />
                ) : null}
              </g>
            )
          })}

          <g aria-hidden="true">
            {model.slices.filter((slice) => slice.fraction >= PIE_DIRECT_LABEL_MIN_FRACTION).map((slice) => {
              const point = polarPoint(CX, CY, LABEL_RADIUS, (slice.start + slice.end) / 2)
              const anchor = Math.abs(point.x - CX) < 1 ? 'middle' : point.x > CX ? 'start' : 'end'
              return (
                <text
                  key={slice.key}
                  x={round2(point.x)}
                  y={round2(point.y) + 3}
                  textAnchor={anchor}
                  fill="var(--bakin-color-text-muted)"
                  fontSize="10"
                  fontFamily="var(--bakin-typography-family-mono)"
                >
                  {directLabel(slice.label)}
                </text>
              )
            })}
          </g>
          </svg>
          {active ? (
            <ChartTooltip
              id={tooltipId}
              text={active.text}
              xPercent={(active.x / WIDTH) * 100}
              yPercent={(active.y / HEIGHT) * 100}
            />
          ) : null}
        </div>
      </BoundedOverflow>

      <ul className="mt-bakin-2 flex flex-wrap gap-x-bakin-3 gap-y-bakin-1" aria-label={`${label} legend`}>
        {model.slices.map((slice) => (
          <li key={slice.key} className="flex items-center gap-bakin-2 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">
            <span
              data-slot="chart-legend-swatch"
              className="inline-block size-bakin-2 rounded-bakin-control"
              style={{ backgroundColor: slice.color }}
              aria-hidden="true"
            />
            <span>{slice.label}</span>
            <span className="font-bakin-typography-family-mono tabular-nums">
              {formatValue(slice.value)} ({formatPieShare(slice.fraction)})
            </span>
          </li>
        ))}
      </ul>

      {table}
    </div>
  )
}
