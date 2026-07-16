'use client'

import { useId, useMemo, useState } from 'react'
import {
  ChartDataTable,
  chartSeriesColor,
  type ChartDatum,
  type ChartSeries,
} from './chart-data-table'
import { ChartTooltip } from './chart-tooltip'

export interface LineChartProps {
  data: ChartDatum[]
  series: ChartSeries[]
  label: string
  description?: string
  height?: number
  formatValue?: (value: number) => string
  emptyLabel?: string
}

interface ActiveMark {
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

function finiteValue(value: number | undefined): number {
  return Number.isFinite(value) ? value! : 0
}

function xPosition(index: number, count: number): number {
  const plotWidth = WIDTH - LEFT - RIGHT
  return count <= 1 ? LEFT + plotWidth / 2 : LEFT + (index / (count - 1)) * plotWidth
}

function shouldRenderXLabel(index: number, count: number): boolean {
  if (count <= 6) return true
  return index === count - 1 || index % Math.ceil(count / 6) === 0
}

/** Dependency-free multi-series line chart with keyboard-equivalent marks. */
export function LineChart({
  data,
  series,
  label,
  description,
  height = 200,
  formatValue = (value) => value.toLocaleString(),
  emptyLabel = 'No data in this window.',
}: LineChartProps) {
  const tooltipId = useId()
  const [active, setActive] = useState<ActiveMark | null>(null)
  const chartHeight = Math.max(120, height)
  const plotHeight = chartHeight - TOP - BOTTOM

  const domain = useMemo(() => {
    const values = data.flatMap((datum) => series.map((item) => finiteValue(datum.values[item.key])))
    const min = Math.min(0, ...values)
    const max = Math.max(0, ...values)
    return { min, max: max === min ? min + 1 : max }
  }, [data, series])

  if (data.length === 0 || series.length === 0) {
    return <div role="status" className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</div>
  }

  const yPosition = (value: number) => (
    TOP + (1 - (value - domain.min) / (domain.max - domain.min)) * plotHeight
  )

  return (
    <div data-slot="line-chart">
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
              const value = domain.max - ratio * (domain.max - domain.min)
              return (
                <g key={index}>
                  <line x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} stroke="var(--border)" />
                  <text x={LEFT - 6} y={y + 3} textAnchor="end" fill="var(--muted-foreground)" fontSize="10">
                    {formatValue(value)}
                  </text>
                </g>
              )
            })}
            {data.map((datum, index) => shouldRenderXLabel(index, data.length) && (
              <text
                key={datum.x}
                x={xPosition(index, data.length)}
                y={chartHeight - 6}
                textAnchor="middle"
                fill="var(--muted-foreground)"
                fontSize="10"
              >
                {datum.xLabel ?? datum.x}
              </text>
            ))}
          </g>

          {series.map((item, seriesIndex) => {
            const color = chartSeriesColor(item, seriesIndex)
            const points = data.map((datum, datumIndex) => ({
              x: xPosition(datumIndex, data.length),
              y: yPosition(finiteValue(datum.values[item.key])),
            }))
            const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')

            return (
              <g key={item.key}>
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={seriesIndex === 0 ? undefined : `${2 + seriesIndex * 2} ${2 + (seriesIndex % 2)}`}
                  data-series={item.key}
                  aria-hidden="true"
                />
                {points.map((point, datumIndex) => {
                  const datum = data[datumIndex]!
                  const value = finiteValue(datum.values[item.key])
                  const markKey = `${item.key}:${datum.x}`
                  const text = `${datum.xLabel ?? datum.x} — ${item.label}: ${formatValue(value)}`
                  const selected = active?.key === markKey
                  return (
                    <g key={markKey}>
                      {selected && (
                        <circle cx={point.x} cy={point.y} r="7" fill="none" stroke="var(--ring)" strokeWidth="2" aria-hidden="true" />
                      )}
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r="4"
                        fill={color}
                        stroke="var(--card)"
                        strokeWidth="2"
                        role="img"
                        tabIndex={0}
                        aria-label={text}
                        aria-describedby={selected ? tooltipId : undefined}
                        className="outline-none"
                        onMouseEnter={() => setActive({ key: markKey, text, x: point.x, y: point.y })}
                        onMouseLeave={() => setActive((current) => current?.key === markKey ? null : current)}
                        onFocus={() => setActive({ key: markKey, text, x: point.x, y: point.y })}
                        onBlur={() => setActive((current) => current?.key === markKey ? null : current)}
                      />
                    </g>
                  )
                })}
              </g>
            )
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
              <span
                className="w-4 border-t-2"
                style={{ borderColor: chartSeriesColor(item, index), borderStyle: index === 0 ? 'solid' : 'dashed' }}
                aria-hidden="true"
              />
              {item.label}
            </li>
          ))}
        </ul>
      )}

      <ChartDataTable data={data} series={series} caption={`${label} data`} formatValue={formatValue} />
    </div>
  )
}

export type { ChartDatum, ChartSeries } from './chart-data-table'
