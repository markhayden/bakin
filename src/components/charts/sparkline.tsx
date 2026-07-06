/**
 * Sparkline (#385) — a tiny inline SVG trend line (2px stroke, no axes, no
 * grid) for embedding next to a stat. Not a replacement for a real chart:
 * it shows shape, the neighboring text shows the number.
 */
import { CHART_SERIES_COLORS } from './palette'

export interface SparklineProps {
  values: number[]
  width?: number
  height?: number
  stroke?: string
  /** Accessible description, e.g. "input tokens over the last 10 runs". */
  label: string
}

export function Sparkline({
  values,
  width = 120,
  height = 28,
  stroke = CHART_SERIES_COLORS[0],
  label,
}: SparklineProps) {
  if (values.length < 2) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pad = 2
  const points = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (width - pad * 2)
      const y = pad + (1 - (v - min) / span) * (height - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="shrink-0">
      <title>{label}</title>
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
