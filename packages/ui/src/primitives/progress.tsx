'use client'

import { Progress as ProgressPrimitive } from '@base-ui/react/progress'

import { cn } from '../utils'

export type ProgressTone = 'primary' | 'accent' | 'attention' | 'danger'
export type ProgressSize = 'sm' | 'md' | 'lg'

/**
 * A reference point on the track in the value domain (e.g. a threshold at
 * which the system acts). Purely presentational — put the meaning in visible
 * text (label/value/tooltip); the tick only marks where.
 */
export interface ProgressMarker {
  /** Position in the same domain as `value` (clamped to 0..max). */
  value: number
  /** Optional tooltip naming what the marker is. */
  label?: string
}

export type ProgressProps = Omit<ProgressPrimitive.Root.Props, 'className'> & {
  className?: ProgressPrimitive.Root.Props['className']
  tone?: ProgressTone
  size?: ProgressSize
  /** Reference ticks rendered inside the track (thresholds, budgets). */
  markers?: readonly ProgressMarker[]
}

/** Track-space marker: percent along the track, already scale-resolved. */
export interface ProgressTrackMarker {
  percent: number
  label?: string
}

export type ProgressTrackProps = ProgressPrimitive.Track.Props & {
  size?: ProgressSize
  markers?: readonly ProgressTrackMarker[]
}

export type ProgressIndicatorProps = ProgressPrimitive.Indicator.Props & {
  tone?: ProgressTone
}

function progressStatus(value: number | null, max: number): 'indeterminate' | 'progressing' | 'complete' {
  if (!Number.isFinite(value)) return 'indeterminate'
  return value === max ? 'complete' : 'progressing'
}

export function Progress({
  className,
  children,
  value,
  max = 100,
  tone = 'primary',
  size = 'sm',
  markers,
  ...props
}: ProgressProps) {
  const status = progressStatus(value, max)
  const trackMarkers = markers?.map((marker) => ({
    percent: max > 0 ? Math.min(100, Math.max(0, (marker.value / max) * 100)) : 0,
    label: marker.label,
  }))
  const rootClasses = 'group/progress flex min-w-0 flex-wrap items-center gap-bakin-3 font-bakin-typography-family-ui'
  const resolvedClassName: ProgressPrimitive.Root.Props['className'] = typeof className === 'function'
    ? (state) => cn(rootClasses, className(state))
    : cn(rootClasses, className)

  return (
    <ProgressPrimitive.Root
      value={value}
      max={max}
      data-slot="progress"
      data-tone={tone}
      data-size={size}
      data-status={status}
      className={resolvedClassName}
      {...props}
    >
      {children}
      <ProgressTrack size={size} markers={trackMarkers}>
        <ProgressIndicator tone={tone} />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  )
}

export function ProgressTrack({
  className,
  size = 'sm',
  markers,
  children,
  ...props
}: ProgressTrackProps) {
  return (
    <ProgressPrimitive.Track
      className={cn(
        'relative flex w-full items-center overflow-x-hidden rounded-bakin-pill bg-bakin-border-subtle/30',
        size === 'sm' && 'h-bakin-1',
        size === 'md' && 'h-bakin-2',
        size === 'lg' && 'h-bakin-3',
        className,
      )}
      data-slot="progress-track"
      data-size={size}
      {...props}
    >
      {children}
      {markers?.map((marker, index) => (
        <span
          key={index}
          aria-hidden="true"
          data-slot="progress-marker"
          title={marker.label}
          className="absolute inset-y-0 w-px bg-bakin-text-muted"
          style={{ insetInlineStart: `${Math.min(100, Math.max(0, marker.percent))}%` }}
        />
      ))}
    </ProgressPrimitive.Track>
  )
}

export function ProgressIndicator({
  className,
  tone = 'primary',
  ...props
}: ProgressIndicatorProps) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      data-tone={tone}
      className={cn(
        'h-full rounded-bakin-pill transition-[width] duration-[var(--bakin-motion-duration-transition)] ease-bakin-standard',
        'data-[indeterminate]:w-1/3 data-[indeterminate]:animate-pulse data-[indeterminate]:motion-reduce:animate-none',
        tone === 'primary' && 'bg-bakin-action-primary-background',
        tone === 'accent' && 'bg-bakin-signal-accent',
        tone === 'attention' && 'bg-bakin-signal-highlight',
        tone === 'danger' && 'bg-bakin-signal-danger',
        className,
      )}
      {...props}
    />
  )
}

export function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      className={cn(
        'text-[length:var(--bakin-typography-size-body)] font-bakin-typography-weight-semibold text-bakin-text-primary',
        className,
      )}
      data-slot="progress-label"
      {...props}
    />
  )
}

export function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return (
    <ProgressPrimitive.Value
      className={cn(
        'ml-auto font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted tabular-nums',
        className,
      )}
      data-slot="progress-value"
      {...props}
    />
  )
}
