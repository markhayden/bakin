'use client'

import { useId, useMemo, useState } from 'react'
import {
  ChartDataTable,
  chartSeriesColor,
  type ChartDatum,
  type ChartSeries,
} from './chart-data-table'
import { ChartTooltip } from './chart-tooltip'

export interface BarChartProps {
  data: ChartDatum[]
  series: ChartSeries[]
  label: string
  description?: string
  height?: number
  /** Stack series within each x-axis bucket instead of grouping them. */
  stacked?: boolean
  formatValue?: (value: number) => string
  emptyLabel?: string
  /** Hide the built-in collapsible table when the consumer renders equivalent data beside the chart. */
  showDataTable?: boolean
}

interface ActiveBar {
  key: string
  text: string
  x: number
  y: number
  width: number
  height: number
}

const WIDTH = 640
const LEFT = 48
const RIGHT = 16
const TOP = 12
const BOTTOM = 28

function valueFor(datum: ChartDatum, key: string): number {
  const value = datum.values[key]
  return Number.isFinite(value) ? Math.max(0, value!) : 0
}

function shouldRenderXLabel(index: number, count: number): boolean {
  if (count <= 6) return true
  return index === count - 1 || index % Math.ceil(count / 6) === 0
}

/** Dependency-free grouped/stacked bar chart with keyboard-equivalent marks. */
export function BarChart({
  data,
  series,
  label,
  description,
  height = 200,
  stacked = false,
  formatValue = (value) => value.toLocaleString(),
  emptyLabel = 'No data in this window.',
  showDataTable = true,
}: BarChartProps) {
  const tooltipId = useId()
  const [active, setActive] = useState<ActiveBar | null>(null)
  const chartHeight = Math.max(120, height)
  const plotHeight = chartHeight - TOP - BOTTOM
  const plotWidth = WIDTH - LEFT - RIGHT

  const max = useMemo(() => {
    if (stacked) {
      return Math.max(1, ...data.map((datum) => series.reduce((sum, item) => sum + valueFor(datum, item.key), 0)))
    }
    return Math.max(1, ...data.flatMap((datum) => series.map((item) => valueFor(datum, item.key))))
  }, [data, series, stacked])

  if (data.length === 0 || series.length === 0) {
    return <div role="status" className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</div>
  }

  const groupWidth = plotWidth / data.length
  const baseline = TOP + plotHeight

  return (
    <div data-slot="bar-chart">
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${chartHeight}`}
          role="group"
          aria-label={label}
          className="h-auto w-full overflow-visible"
        >
          <title>{label}</title>
          {description && <desc>{description}</desc>}

          <g aria-hidden="true">
            {Array.from({ length: 5 }, (_, index) => {
              const ratio = index / 4
              const y = TOP + ratio * plotHeight
              return (
                <g key={index}>
                  <line x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} stroke="var(--border)" />
                  <text x={LEFT - 6} y={y + 3} textAnchor="end" fill="var(--muted-foreground)" fontSize="10">
                    {formatValue(max * (1 - ratio))}
                  </text>
                </g>
              )
            })}
            {data.map((datum, index) => shouldRenderXLabel(index, data.length) && (
              <text
                key={datum.x}
                x={LEFT + index * groupWidth + groupWidth / 2}
                y={chartHeight - 6}
                textAnchor="middle"
                fill="var(--muted-foreground)"
                fontSize="10"
              >
                {datum.xLabel ?? datum.x}
              </text>
            ))}
          </g>

          {data.flatMap((datum, datumIndex) => {
            const availableWidth = groupWidth * 0.72
            const groupedBarWidth = Math.max(2, Math.min(32, (availableWidth - (series.length - 1) * 2) / series.length))
            const stackedBarWidth = Math.max(4, Math.min(44, availableWidth))
            const groupedWidth = groupedBarWidth * series.length + (series.length - 1) * 2
            let stackedValue = 0

            return series.map((item, seriesIndex) => {
              const value = valueFor(datum, item.key)
              if (value <= 0) return null

              const width = stacked ? stackedBarWidth : groupedBarWidth
              const barHeight = (value / max) * plotHeight
              const x = stacked
                ? LEFT + datumIndex * groupWidth + (groupWidth - width) / 2
                : LEFT + datumIndex * groupWidth + (groupWidth - groupedWidth) / 2 + seriesIndex * (groupedBarWidth + 2)
              const y = stacked
                ? baseline - ((stackedValue + value) / max) * plotHeight
                : baseline - barHeight
              if (stacked) stackedValue += value

              const markKey = `${item.key}:${datum.x}`
              const text = `${datum.xLabel ?? datum.x} — ${item.label}: ${formatValue(value)}`
              const selected = active?.key === markKey
              const color = chartSeriesColor(item, seriesIndex)

              return (
                <g key={markKey}>
                  {selected && (
                    <rect
                      x={x - 2}
                      y={y - 2}
                      width={width + 4}
                      height={barHeight + 4}
                      rx="3"
                      fill="none"
                      stroke="var(--ring)"
                      strokeWidth="2"
                      aria-hidden="true"
                    />
                  )}
                  <rect
                    x={x}
                    y={y}
                    width={width}
                    height={barHeight}
                    rx="2"
                    fill={color}
                    role="img"
                    tabIndex={0}
                    aria-label={text}
                    aria-describedby={selected ? tooltipId : undefined}
                    className="outline-none"
                    data-series={item.key}
                    onMouseEnter={() => setActive({ key: markKey, text, x: x + width / 2, y, width, height: barHeight })}
                    onMouseLeave={() => setActive((current) => current?.key === markKey ? null : current)}
                    onFocus={() => setActive({ key: markKey, text, x: x + width / 2, y, width, height: barHeight })}
                    onBlur={() => setActive((current) => current?.key === markKey ? null : current)}
                  />
                </g>
              )
            })
          })}
        </svg>
        {active && (
          <ChartTooltip
            id={tooltipId}
            text={active.text}
            xPercent={(active.x / WIDTH) * 100}
            yPercent={(active.y / chartHeight) * 100}
          />
        )}
      </div>

      {series.length > 1 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1" aria-label={`${label} legend`}>
          {series.map((item, index) => (
            <li key={item.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-sm" style={{ backgroundColor: chartSeriesColor(item, index) }} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      )}

      {showDataTable && (
        <ChartDataTable data={data} series={series} caption={`${label} data`} formatValue={formatValue} />
      )}
    </div>
  )
}
