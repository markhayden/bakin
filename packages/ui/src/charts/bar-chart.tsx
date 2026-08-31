'use client'

import { useId, useMemo, useState } from 'react'

import { BoundedOverflow } from '../layout/bounded-overflow'
import { axisLabel, reportedValue, shouldRenderXLabel } from './axis'
import { ChartDataTable, chartSeriesColor, type ChartDatum, type ChartSeries } from './chart-data-table'
import { ChartTooltip } from './chart-tooltip'

export interface BarChartProps {
  data: readonly ChartDatum[]
  series: readonly ChartSeries[]
  /** Accessible name for the plot and basis for its exact-data caption. */
  label: string
  description?: string
  height?: number
  /** Stack non-negative series within each x-axis bucket instead of grouping them. */
  stacked?: boolean
  formatValue?: (value: number) => string
  emptyLabel?: string
  /** Disable only when an equivalent exact table is rendered beside the chart. */
  showDataTable?: boolean
  /** Collapse the exact-data table behind its disclosure for space-tight contexts. */
  compactData?: boolean
  /** When false, the exact-data table renders statically with no disclosure. */
  dataTableExpandable?: boolean
}

interface ActiveBar {
  key: string
  text: string
  x: number
  y: number
}

const WIDTH = 640
const LEFT = 48
const RIGHT = 16
const TOP = 12
const BOTTOM = 28

/** Dependency-free grouped or stacked non-negative comparison chart with exact data. */
export function BarChart({
  data,
  series,
  label,
  description,
  height = 200,
  stacked = false,
  formatValue = (value) => value.toLocaleString(),
  emptyLabel = 'No reported data in this window.',
  showDataTable = true,
  compactData = false,
  dataTableExpandable = true,
}: BarChartProps) {
  const tooltipId = useId()
  const [active, setActive] = useState<ActiveBar | null>(null)
  const chartHeight = Math.max(120, height)
  const plotHeight = chartHeight - TOP - BOTTOM
  const plotWidth = WIDTH - LEFT - RIGHT
  const reportedValues = useMemo(
    () => data.flatMap((datum) => series.flatMap((item) => {
      const value = reportedValue(datum.values[item.key])
      return value === null ? [] : [value]
    })),
    [data, series],
  )
  const max = useMemo(() => {
    if (stacked) {
      return Math.max(1, ...data.map((datum) => series.reduce((sum, item) => {
        const value = reportedValue(datum.values[item.key])
        return sum + (value ?? 0)
      }, 0)))
    }
    return Math.max(1, ...reportedValues)
  }, [data, reportedValues, series, stacked])
  const table = showDataTable
    ? <ChartDataTable data={data} series={series} caption={`${label} data`} formatValue={formatValue} defaultOpen={!compactData} expandable={dataTableExpandable} />
    : null

  if (data.length === 0 || series.length === 0 || reportedValues.length === 0) {
    return (
      <div className="min-w-0" data-slot="bar-chart">
        <div role="status" className="py-bakin-6 text-center text-[length:var(--bakin-typography-size-body)] text-bakin-text-muted">
          {emptyLabel}
        </div>
        {table}
      </div>
    )
  }

  const groupWidth = plotWidth / data.length
  const baseline = TOP + plotHeight

  return (
    <div className="min-w-0" data-slot="bar-chart" data-stacked={stacked || undefined}>
      <BoundedOverflow label={`${label} plot`}>
        <div className="relative w-full" style={{ minWidth: 512 }}>
          <svg
            viewBox={`0 0 ${WIDTH} ${chartHeight}`}
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
              return (
                <g key={index}>
                  <line x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} stroke="var(--bakin-color-border-subtle)" />
                  <text
                    x={LEFT - 6}
                    y={y + 3}
                    textAnchor="end"
                    fill="var(--bakin-color-text-muted)"
                    fontSize="10"
                    fontFamily="var(--bakin-typography-family-mono)"
                  >
                    {formatValue(max * (1 - ratio))}
                  </text>
                </g>
              )
            })}
            {data.map((datum, index) => shouldRenderXLabel(index, data.length) ? (
              <text
                key={datum.x}
                x={LEFT + index * groupWidth + groupWidth / 2}
                y={chartHeight - 6}
                textAnchor="middle"
                fill="var(--bakin-color-text-muted)"
                fontSize="10"
                fontFamily="var(--bakin-typography-family-mono)"
              >
                {axisLabel(datum.xLabel ?? datum.x)}
              </text>
            ) : null)}
          </g>

          {data.flatMap((datum, datumIndex) => {
            const availableWidth = groupWidth * 0.72
            const groupedBarWidth = Math.max(2, Math.min(32, (availableWidth - (series.length - 1) * 2) / series.length))
            const stackedBarWidth = Math.max(4, Math.min(44, availableWidth))
            const groupedWidth = groupedBarWidth * series.length + (series.length - 1) * 2
            let stackedValue = 0

            return series.map((item, seriesIndex) => {
              const value = reportedValue(datum.values[item.key])
              if (value === null || value === 0) return null

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
              const activate = () => setActive({ key: markKey, text, x: x + width / 2, y })
              const deactivate = () => setActive((current) => current?.key === markKey ? null : current)

              return (
                <g key={markKey}>
                  {selected ? (
                    <rect
                      x={x - 2}
                      y={y - 2}
                      width={width + 4}
                      height={barHeight + 4}
                      rx="3"
                      fill="none"
                      stroke="var(--bakin-color-focus-ring)"
                      strokeWidth="2"
                      aria-hidden="true"
                    />
                  ) : null}
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
                    onMouseEnter={activate}
                    onMouseLeave={deactivate}
                    onFocus={activate}
                    onBlur={deactivate}
                  />
                </g>
              )
            })
          })}
          </svg>
          {active ? (
            <ChartTooltip
              id={tooltipId}
              text={active.text}
              xPercent={(active.x / WIDTH) * 100}
              yPercent={(active.y / chartHeight) * 100}
            />
          ) : null}
        </div>
      </BoundedOverflow>

      {series.length > 1 ? (
        <ul className="mt-bakin-2 flex flex-wrap gap-x-bakin-3 gap-y-bakin-1" aria-label={`${label} legend`}>
          {series.map((item, index) => (
            <li key={item.key} className="flex items-center gap-bakin-2 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">
              <span className="size-bakin-2 rounded-bakin-control" style={{ backgroundColor: chartSeriesColor(item, index) }} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}

      {table}
    </div>
  )
}
