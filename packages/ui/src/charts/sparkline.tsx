import { useId, useState } from 'react'

import { contiguousSegments } from './axis'
import { ChartDataTable } from './chart-data-table'
import { ChartTooltip } from './chart-tooltip'
import { CHART_SERIES_COLORS } from './palette'

export interface SparklineProps {
  /** Null and non-finite values are explicit gaps, never coerced to zero. */
  values: readonly (number | null)[]
  width?: number
  height?: number
  stroke?: string
  /** Accessible description, e.g. “input tokens over the last 10 runs”. */
  label: string
  /** Optional human-readable labels corresponding to `values`. */
  labels?: readonly string[]
  formatValue?: (value: number) => string
  /** Soft same-color fill under each reported segment; gaps break the fill exactly like the line. */
  area?: boolean
}

interface Point {
  index: number
  value: number
  x: number
  y: number
}

interface ActivePoint extends Point {
  text: string
}

/** Compact exact trend summary; pair it with visible current value and direction copy. */
export function Sparkline({
  values,
  width = 120,
  height = 28,
  stroke = CHART_SERIES_COLORS[0],
  label,
  labels = [],
  formatValue = (value) => value.toLocaleString(),
  area = false,
}: SparklineProps) {
  const tooltipId = useId()
  const [active, setActive] = useState<ActivePoint | null>(null)
  const safeWidth = Math.max(24, width)
  const safeHeight = Math.max(16, height)
  const finiteValues = values.filter((value): value is number => value !== null && Number.isFinite(value))
  const data = values.map((value, index) => {
    const reported = value !== null && Number.isFinite(value)
    const datumValues: Record<string, number> = reported ? { value } : {}
    return {
      x: String(index),
      xLabel: labels[index] ?? `Point ${index + 1}`,
      values: datumValues,
      missingLabels: reported ? undefined : { value: 'Not reported' },
    }
  })
  const table = (
    <ChartDataTable
      data={data}
      series={[{ key: 'value', label: 'Value' }]}
      caption={`${label} data`}
      formatValue={formatValue}
      visuallyHidden
    />
  )

  if (finiteValues.length < 2) {
    return (
      <span className="inline-flex" data-slot="sparkline" data-state="insufficient-data">
        <span className="text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted" aria-hidden="true">—</span>
        <span className="sr-only">Not enough data for a trend</span>
        {table}
      </span>
    )
  }

  const min = Math.min(...finiteValues)
  const max = Math.max(...finiteValues)
  const flat = max === min
  const span = max - min || 1
  const pad = 3
  const points = values.map<Point | null>((value, index) => {
    if (value === null || !Number.isFinite(value)) return null
    const denominator = Math.max(1, values.length - 1)
    return {
      index,
      value,
      x: pad + (index / denominator) * (safeWidth - pad * 2),
      y: flat ? safeHeight / 2 : pad + (1 - (value - min) / span) * (safeHeight - pad * 2),
    }
  })
  const segments = contiguousSegments(points)

  const activate = (point: Point, text: string) => {
    setActive({ ...point, text })
  }
  const deactivate = (index: number) => {
    setActive((current) => current?.index === index ? null : current)
  }

  return (
    <span className="relative inline-flex shrink-0" data-slot="sparkline" data-area={area || undefined}>
      <svg
        width={safeWidth}
        height={safeHeight}
        role="group"
        aria-label={label}
        className="overflow-visible"
      >
        <title>{label}</title>
        {area ? segments.filter((segment) => segment.length > 1).map((segment) => (
          <path
            key={`fill-${segment[0]!.index}-${segment.at(-1)!.index}`}
            data-series-fill="value"
            d={`${segment.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')} L ${segment.at(-1)!.x.toFixed(1)} ${(safeHeight - pad).toFixed(1)} L ${segment[0]!.x.toFixed(1)} ${(safeHeight - pad).toFixed(1)} Z`}
            fill={stroke}
            fillOpacity={0.2}
            stroke="none"
            aria-hidden="true"
          />
        )) : null}
        {segments.filter((segment) => segment.length > 1).map((segment) => (
          <polyline
            key={`${segment[0]!.index}-${segment.at(-1)!.index}`}
            data-series="value"
            points={segment.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          />
        ))}
        {points.map((point, index) => {
          if (!point) return null
          const pointLabel = labels[index] ?? `Point ${index + 1}`
          const text = `${pointLabel}: ${formatValue(point.value)}`
          const selected = active?.index === index
          return (
            <g key={index}>
              {selected ? (
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="5"
                  fill="none"
                  stroke="var(--bakin-color-focus-ring)"
                  strokeWidth="1.5"
                  aria-hidden="true"
                />
              ) : null}
              <circle
                cx={point.x}
                cy={point.y}
                r="3"
                fill={stroke}
                stroke="var(--bakin-color-surface-default)"
                strokeWidth="1"
                role="img"
                tabIndex={0}
                aria-label={text}
                aria-describedby={selected ? tooltipId : undefined}
                className="outline-none"
                onMouseEnter={() => activate(point, text)}
                onMouseLeave={() => deactivate(index)}
                onFocus={() => activate(point, text)}
                onBlur={() => deactivate(index)}
              />
            </g>
          )
        })}
      </svg>
      {active ? (
        <ChartTooltip
          id={tooltipId}
          text={active.text}
          xPercent={(active.x / safeWidth) * 100}
          yPercent={(active.y / safeHeight) * 100}
        />
      ) : null}
      {table}
    </span>
  )
}
