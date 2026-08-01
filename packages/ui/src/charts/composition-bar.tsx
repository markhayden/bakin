'use client'

import { useId, useMemo, useState } from 'react'

import { ChartTooltip } from './chart-tooltip'
import { assignSeriesColors, chartToneColor, type ChartTone } from './palette'

export interface CompositionBarSegment {
  /** Stable entity key; palette slots are assigned against the sorted full key set. */
  key: string
  label: string
  /** Non-negative share of the whole. Non-finite or negative values count as zero. */
  value: number
  /** CSS color. Defaults to the fixed categorical slot for `key`. */
  color?: string
}

export interface CompositionBarProps {
  data: readonly CompositionBarSegment[]
  /** Accessible name for the strip and basis for its legend name. */
  label: string
  /** `inline` fits inside a metric row; `default` leaves room for the legend. */
  size?: 'inline' | 'default'
  /**
   * List legend with exact values below the strip. Defaults to true at size
   * `default`; forced off at size `inline`, where the accessible summary
   * carries the exact values instead.
   */
  legend?: boolean
  formatValue?: (value: number) => string
  /** Accessible description when `data` is empty. */
  emptyLabel?: string
  /**
   * Opt-in status mode for outcome strips: maps segment key → tone, and every
   * segment wears the validated status chart-fill step for its tone (a tone
   * entry outranks the segment's `color`; an unmapped segment falls back
   * explicitly to its `color`, then `neutral` — never a categorical slot).
   * Omit for categorical strips; behavior without `tones` is unchanged.
   */
  tones?: Readonly<Record<string, ChartTone>>
}

const STRIP_HEIGHT: Record<'inline' | 'default', number> = { inline: 6, default: 10 }
const SEGMENT_GAP = 2

interface ResolvedSegment extends CompositionBarSegment {
  /** Clamped non-negative value actually plotted. */
  plotted: number
  percent: number
  color: string
}

function resolveSegments(
  data: readonly CompositionBarSegment[],
  tones?: Readonly<Record<string, ChartTone>>,
): { segments: ResolvedSegment[]; total: number } {
  const assigned = tones ? null : assignSeriesColors(data.map((segment) => segment.key))
  const segmentColor = (segment: CompositionBarSegment): string => {
    if (assigned) return segment.color ?? assigned.get(segment.key)!
    const tone = tones?.[segment.key]
    return tone ? chartToneColor(tone) : segment.color ?? chartToneColor('neutral')
  }
  const clamped = data.map((segment) => ({
    ...segment,
    plotted: Number.isFinite(segment.value) && segment.value > 0 ? segment.value : 0,
  }))
  const total = clamped.reduce((sum, segment) => sum + segment.plotted, 0)
  return {
    segments: clamped.map((segment) => ({
      ...segment,
      percent: total > 0 ? (segment.plotted / total) * 100 : 0,
      color: segmentColor(segment),
    })),
    total,
  }
}

/**
 * Single horizontal 100%-stacked strip for part-to-whole composition only.
 * Zero-value segments are omitted from the strip but stay in the accessible
 * summary and legend; the legend IS the exact data at this scale, so there is
 * no separate exact-data table.
 */
export function CompositionBar({
  data,
  label,
  size = 'default',
  legend = true,
  formatValue = (value) => value.toLocaleString(),
  emptyLabel = 'No reported values.',
  tones,
}: CompositionBarProps) {
  const tooltipId = useId()
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const { segments, total } = useMemo(() => resolveSegments(data, tones), [data, tones])
  const interactive = size === 'default' && total > 0
  const showLegend = size === 'default' && legend && segments.length > 0
  const visible = segments.filter((segment) => segment.plotted > 0)
  const lastVisibleKey = visible[visible.length - 1]?.key

  const summary = segments.length === 0
    ? `${label}: ${emptyLabel}`
    : `${label}: ${segments
      .map((segment) => `${segment.label} ${formatValue(segment.plotted)} (${Math.round(segment.percent)}%)`)
      .join(', ')}`

  const segmentText = (segment: ResolvedSegment): string =>
    `${segment.label} ${formatValue(segment.plotted)} (${Math.round(segment.percent)}%)`

  let cursor = 0
  const active = activeKey === null ? null : visible.find((segment) => segment.key === activeKey) ?? null
  let activeCenter = 0
  for (const segment of visible) {
    if (active && segment.key === active.key) activeCenter = cursor + segment.percent / 2
    cursor += segment.percent
  }

  return (
    <div className="min-w-0" data-slot="composition-bar" data-size={size}>
      <div className="relative">
        <div
          role="img"
          aria-label={summary}
          className={total > 0 ? 'flex w-full' : 'flex w-full rounded-bakin-pill bg-bakin-border-subtle/35'}
          style={{ height: STRIP_HEIGHT[size], gap: SEGMENT_GAP }}
        >
          {visible.map((segment, index) => {
            const isFirst = index === 0
            const isLast = segment.key === lastVisibleKey
            const rounded = `${isFirst ? 'rounded-l-bakin-pill ' : ''}${isLast ? 'rounded-r-bakin-pill' : ''}`.trim()
            const activate = () => setActiveKey(segment.key)
            const deactivate = () => setActiveKey((current) => (current === segment.key ? null : current))
            return (
              <span
                key={segment.key}
                data-slot="composition-bar-segment"
                data-segment-key={segment.key}
                className={`block h-full min-w-px ${rounded}${interactive ? ' focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring' : ''}`}
                style={{ flexGrow: segment.plotted, flexBasis: 0, backgroundColor: segment.color }}
                {...(interactive
                  ? {
                      role: 'img' as const,
                      tabIndex: 0,
                      'aria-label': segmentText(segment),
                      'aria-describedby': activeKey === segment.key ? tooltipId : undefined,
                      onMouseEnter: activate,
                      onMouseLeave: deactivate,
                      onFocus: activate,
                      onBlur: deactivate,
                    }
                  : { 'aria-hidden': true as const })}
              />
            )
          })}
        </div>
        {interactive && active ? (
          <ChartTooltip
            id={tooltipId}
            text={segmentText(active)}
            xPercent={activeCenter}
            yPercent={0}
          />
        ) : null}
      </div>

      {size === 'default' && segments.length === 0 ? (
        <p className="mt-bakin-1 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">{emptyLabel}</p>
      ) : null}

      {showLegend ? (
        <ul className="mt-bakin-2 flex flex-wrap gap-x-bakin-3 gap-y-bakin-1" aria-label={`${label} legend`}>
          {segments.map((segment) => (
            <li
              key={segment.key}
              className="flex items-center gap-bakin-2 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted"
            >
              <span
                data-slot="chart-legend-swatch"
                className="inline-block size-bakin-2 rounded-bakin-control"
                style={{ backgroundColor: segment.color }}
                aria-hidden="true"
              />
              <span>{segment.label}</span>
              <span className="font-bakin-typography-family-mono tabular-nums text-bakin-text-primary">
                {formatValue(segment.plotted)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
