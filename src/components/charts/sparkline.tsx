/**
 * Sparkline (#385) — a tiny inline SVG trend line (2px stroke, no axes, no
 * grid) for embedding next to a stat. Not a replacement for a real chart:
 * it shows shape, the neighboring text shows the number.
 */
import { useId, useState } from 'react'
import { ChartDataTable } from './chart-data-table'
import { ChartTooltip } from './chart-tooltip'

export interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  stroke?: string
  /** Accessible description, e.g. "input tokens over the last 10 runs". */
  label: string
  /** Optional human-readable labels for each value. */
  labels?: string[]
  formatValue?: (value: number) => string
}

interface ActivePoint {
  index: number
  text: string
  x: number
  y: number
}

export function Sparkline({
  values,
  width = 120,
  height = 28,
  stroke = 'var(--chart-1)',
  label,
  labels = [],
  formatValue = (value) => value.toLocaleString(),
}: SparklineProps) {
  const tooltipId = useId()
  const [active, setActive] = useState<ActivePoint | null>(null)
  const data = values.map((value, index) => ({
    x: String(index),
    xLabel: labels[index] ?? `Point ${index + 1}`,
    values: { value },
  }))
  const table = (
    <ChartDataTable
      data={data}
      series={[{ key: 'value', label: 'Value' }]}
      caption={`${label} data`}
      formatValue={formatValue}
      visuallyHidden
    />
  )

  if (values.length < 2) {
    return (
      <div className="inline-flex" data-slot="sparkline">
        <span className="text-xs text-muted-foreground" aria-hidden="true">—</span>
        {table}
      </div>
    )
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 2
  const points = values
    .map((value, index) => {
      const x = pad + (index / (values.length - 1)) * (width - pad * 2)
      const y = pad + (1 - (value - min) / span) * (height - pad * 2)
      return { x, y, value, index }
    })
  const polylinePoints = points.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')

  return (
    <div className="relative inline-flex shrink-0" data-slot="sparkline">
      <svg width={width} height={height} role="group" aria-label={label} className="overflow-visible">
        <title>{label}</title>
        <polyline
          points={polylinePoints}
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        />
        {points.map((point) => {
          const pointLabel = labels[point.index] ?? `Point ${point.index + 1}`
          const text = `${pointLabel}: ${formatValue(point.value)}`
          const selected = active?.index === point.index
          return (
            <g key={point.index}>
              {selected && (
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="5"
                  fill="none"
                  stroke="var(--ring)"
                  strokeWidth="1.5"
                  aria-hidden="true"
                />
              )}
              <circle
                cx={point.x}
                cy={point.y}
                r="3"
                fill={stroke}
                stroke="var(--card)"
                strokeWidth="1"
                role="img"
                tabIndex={0}
                aria-label={text}
                aria-describedby={selected ? tooltipId : undefined}
                className="outline-none"
                onMouseEnter={() => setActive({ index: point.index, text, x: point.x, y: point.y })}
                onMouseLeave={() => setActive((current) => current?.index === point.index ? null : current)}
                onFocus={() => setActive({ index: point.index, text, x: point.x, y: point.y })}
                onBlur={() => setActive((current) => current?.index === point.index ? null : current)}
              />
            </g>
          )
        })}
      </svg>
      {active && (
        <ChartTooltip
          id={tooltipId}
          text={active.text}
          xPercent={(active.x / width) * 100}
          yPercent={(active.y / height) * 100}
        />
      )}
      {table}
    </div>
  )
}
