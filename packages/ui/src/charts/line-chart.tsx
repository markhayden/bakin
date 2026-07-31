'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { BoundedOverflow } from '../layout/bounded-overflow'
import { ChartDataTable, chartSeriesColor, type ChartDatum, type ChartSeries } from './chart-data-table'
import { ChartTooltip } from './chart-tooltip'
import { monotonePathD } from './monotone-curve'

export interface LineChartProps {
  data: readonly ChartDatum[]
  series: readonly ChartSeries[]
  /** Accessible name for the plot and basis for its exact-data caption. */
  label: string
  description?: string
  height?: number
  formatValue?: (value: number) => string
  emptyLabel?: string
  /** Collapse the exact-data table behind its disclosure for space-tight contexts. */
  compactData?: boolean
  /**
   * Draw each contiguous segment as a monotone cubic (Fritsch–Carlson)
   * instead of straight lines. The curve passes exactly through every data
   * point and never overshoots, so it cannot imply values outside the data.
   * Marks, tooltips, and the exact-data table are unaffected.
   */
  smooth?: boolean
}

interface Point {
  index: number
  value: number
  x: number
  y: number
}

interface ActiveMark extends Point {
  key: string
  text: string
}

const DEFAULT_WIDTH = 640
const MIN_WIDTH = 512
const LEFT = 48
const RIGHT = 16
const TOP = 12
const BOTTOM = 28

function reportedValue(value: number | undefined): number | null {
  return Number.isFinite(value) ? value! : null
}

function xPosition(index: number, count: number, width: number): number {
  const plotWidth = width - LEFT - RIGHT
  return count <= 1 ? LEFT + plotWidth / 2 : LEFT + (index / (count - 1)) * plotWidth
}

function shouldRenderXLabel(index: number, count: number): boolean {
  if (count <= 6) return true
  return index === count - 1 || index % Math.ceil(count / 6) === 0
}

function axisLabel(label: string): string {
  return label.length <= 14 ? label : `${label.slice(0, 13)}…`
}

function xLabelAnchor(index: number, count: number): 'start' | 'middle' | 'end' {
  if (index === 0) return 'start'
  if (index === count - 1) return 'end'
  return 'middle'
}

function contiguousSegments(points: readonly (Point | null)[]): Point[][] {
  const segments: Point[][] = []
  let current: Point[] = []
  for (const point of points) {
    if (point) current.push(point)
    else if (current.length > 0) {
      segments.push(current)
      current = []
    }
  }
  if (current.length > 0) segments.push(current)
  return segments
}

/** Dependency-free multi-series trend chart with exact data and focus-equivalent marks. */
export function LineChart({
  data,
  series,
  label,
  description,
  height = 200,
  formatValue = (value) => value.toLocaleString(),
  emptyLabel = 'No reported data in this window.',
  compactData = false,
  smooth = false,
}: LineChartProps) {
  const tooltipId = useId()
  const plotRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<ActiveMark | null>(null)
  const [chartWidth, setChartWidth] = useState(DEFAULT_WIDTH)
  const chartHeight = Math.max(120, height)
  const plotHeight = chartHeight - TOP - BOTTOM
  const reportedValues = useMemo(
    () => data.flatMap((datum) => series.flatMap((item) => {
      const value = reportedValue(datum.values[item.key])
      return value === null ? [] : [value]
    })),
    [data, series],
  )
  const domain = useMemo(() => {
    const min = Math.min(0, ...reportedValues)
    const max = Math.max(0, ...reportedValues)
    return { min, max: max === min ? min + 1 : max }
  }, [reportedValues])
  const hasRenderableData = data.length > 0 && series.length > 0 && reportedValues.length > 0

  useEffect(() => {
    if (!hasRenderableData) return
    const plot = plotRef.current
    if (!plot) return

    const updateWidth = () => {
      const width = Math.round(plot.getBoundingClientRect().width)
      if (width > 0) setChartWidth(Math.max(MIN_WIDTH, width))
    }

    updateWidth()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateWidth)
      observer.observe(plot)
      return () => observer.disconnect()
    }
  }, [hasRenderableData])

  const table = (
    <ChartDataTable data={data} series={series} caption={`${label} data`} formatValue={formatValue} defaultOpen={!compactData} />
  )

  if (!hasRenderableData) {
    return (
      <div className="min-w-0" data-slot="line-chart">
        <div role="status" className="py-bakin-6 text-center text-[length:var(--bakin-typography-size-body)] text-bakin-text-muted">
          {emptyLabel}
        </div>
        {table}
      </div>
    )
  }

  const yPosition = (value: number) => (
    TOP + (1 - (value - domain.min) / (domain.max - domain.min)) * plotHeight
  )

  return (
    <div className="min-w-0" data-slot="line-chart">
      <BoundedOverflow label={`${label} plot`}>
        <div ref={plotRef} className="relative w-full" style={{ minWidth: MIN_WIDTH }}>
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="group"
            aria-label={label}
            className="block h-auto w-full max-w-full"
          >
          <title>{label}</title>
          {description ? <desc>{description}</desc> : null}

          <g aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => {
              const ratio = index / 4
              const y = TOP + ratio * plotHeight
              const value = domain.max - ratio * (domain.max - domain.min)
              return (
                <g key={index}>
                  <line x1={LEFT} x2={chartWidth - RIGHT} y1={y} y2={y} stroke="var(--bakin-color-border-subtle)" />
                  <text
                    x={LEFT - 6}
                    y={y + 3}
                    textAnchor="end"
                    fill="var(--bakin-color-text-muted)"
                    fontSize="10"
                    fontFamily="var(--bakin-typography-family-mono)"
                  >
                    {formatValue(value)}
                  </text>
                </g>
              )
            })}
            {data.map((datum, index) => shouldRenderXLabel(index, data.length) ? (
              <text
                key={datum.x}
                x={xPosition(index, data.length, chartWidth)}
                y={chartHeight - 6}
                textAnchor={xLabelAnchor(index, data.length)}
                fill="var(--bakin-color-text-muted)"
                fontSize="10"
                fontFamily="var(--bakin-typography-family-mono)"
              >
                {axisLabel(datum.xLabel ?? datum.x)}
              </text>
            ) : null)}
          </g>

          {series.map((item, seriesIndex) => {
            const color = chartSeriesColor(item, seriesIndex)
            const points = data.map<Point | null>((datum, datumIndex) => {
              const value = reportedValue(datum.values[item.key])
              return value === null ? null : {
                index: datumIndex,
                value,
                x: xPosition(datumIndex, data.length, chartWidth),
                y: yPosition(value),
              }
            })
            const segments = contiguousSegments(points)

            return (
              <g key={item.key}>
                {segments.filter((segment) => segment.length > 1).map((segment) => (
                  <path
                    key={`${segment[0]!.index}-${segment.at(-1)!.index}`}
                    d={smooth
                      ? monotonePathD(segment)
                      : segment.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')}
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={seriesIndex === 0 ? undefined : `${2 + seriesIndex * 2} ${2 + (seriesIndex % 2)}`}
                    data-series={item.key}
                    aria-hidden="true"
                  />
                ))}
                {points.map((point, datumIndex) => {
                  if (!point) return null
                  const datum = data[datumIndex]!
                  const markKey = `${item.key}:${datum.x}`
                  const text = `${datum.xLabel ?? datum.x} — ${item.label}: ${formatValue(point.value)}`
                  const selected = active?.key === markKey
                  const activate = () => setActive({ ...point, key: markKey, text })
                  const deactivate = () => setActive((current) => current?.key === markKey ? null : current)
                  return (
                    <g key={markKey}>
                      {selected ? (
                        <circle cx={point.x} cy={point.y} r="7" fill="none" stroke="var(--bakin-color-focus-ring)" strokeWidth="2" aria-hidden="true" />
                      ) : null}
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r="4"
                        fill={color}
                        stroke="var(--bakin-color-surface-default)"
                        strokeWidth="2"
                        role="img"
                        tabIndex={0}
                        aria-label={text}
                        aria-describedby={selected ? tooltipId : undefined}
                        className="outline-none"
                        onMouseEnter={activate}
                        onMouseLeave={deactivate}
                        onFocus={activate}
                        onBlur={deactivate}
                      />
                    </g>
                  )
                })}
              </g>
            )
          })}
          </svg>
          {active ? (
            <ChartTooltip
              id={tooltipId}
              text={active.text}
              xPercent={(active.x / chartWidth) * 100}
              yPercent={(active.y / chartHeight) * 100}
            />
          ) : null}
        </div>
      </BoundedOverflow>

      {series.length > 1 ? (
        <ul className="mt-bakin-2 flex flex-wrap gap-x-bakin-3 gap-y-bakin-1" aria-label={`${label} legend`}>
          {series.map((item, index) => (
            <li key={item.key} className="flex items-center gap-bakin-2 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">
              <span
                className="w-bakin-4 border-t-2"
                style={{ borderColor: chartSeriesColor(item, index), borderStyle: index === 0 ? 'solid' : 'dashed' }}
                aria-hidden="true"
              />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}

      {table}
    </div>
  )
}
