'use client'

import type { ComponentType, ReactNode } from 'react'

import { cn } from '../utils'
import type { StatusTone } from './status-badge'

export type StatTileVariant = 'plain' | 'surface'
export type StatTileProgressTone = 'success' | 'attention' | 'danger' | 'accent'

export interface StatTileProgress {
  percent: number
  tone?: StatTileProgressTone
  /** Accessible meter name. Required when `label` is not plain text. */
  label?: string
}

export interface StatTileProps {
  icon?: ComponentType<{ className?: string }>
  label: ReactNode
  value: ReactNode
  valueTone?: StatusTone
  sub?: ReactNode
  progress?: StatTileProgress
  variant?: StatTileVariant
  onClick?: () => void
  className?: string
}

const VALUE_TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'text-bakin-text-primary',
  success: 'text-bakin-action-primary-background',
  attention: 'text-bakin-signal-highlight',
  danger: 'text-bakin-signal-danger',
  accent: 'text-bakin-signal-accent',
}

const PROGRESS_TONE_CLASSES: Record<StatTileProgressTone, string> = {
  success: 'bg-bakin-action-primary-background',
  attention: 'bg-bakin-signal-highlight',
  danger: 'bg-bakin-signal-danger',
  accent: 'bg-bakin-signal-accent',
}

function boundedPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, percent))
}

/** Compact technical metric with an optional labelled meter and native button behavior. */
export function StatTile({
  icon: Icon,
  label,
  value,
  valueTone = 'neutral',
  sub,
  progress,
  variant = 'plain',
  onClick,
  className,
}: StatTileProps) {
  const Component = onClick ? 'button' : 'div'
  const percent = progress ? boundedPercent(progress.percent) : undefined
  const progressLabel = progress?.label ?? (typeof label === 'string' ? `${label} progress` : 'Metric progress')

  return (
    <Component
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      data-stat-tile=""
      data-variant={variant}
      data-value-tone={valueTone}
      className={cn(
        // Explicit top-aligned column: button elements center their content by
        // default, which reads as janky vertical centering in stretched grid cells.
        'flex min-w-0 flex-col items-stretch justify-start font-bakin-typography-family-ui text-left text-bakin-text-primary',
        variant === 'plain' && 'border-s border-bakin-border-subtle py-bakin-2 ps-bakin-4',
        variant === 'surface' && 'rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-bakin-4',
        onClick && 'cursor-pointer outline-none transition-[background-color,border-color] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard hover:border-bakin-action-primary-background/60 hover:bg-bakin-canvas-default/50 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring',
        className,
      )}
    >
      <span data-slot="stat-tile-heading" className="flex min-w-0 items-center gap-bakin-2 text-bakin-text-muted">
        {Icon ? <span aria-hidden="true" className="inline-flex shrink-0"><Icon className="size-bakin-4" /></span> : null}
        <span data-slot="stat-tile-label" className="min-w-0 [overflow-wrap:anywhere] text-[length:var(--bakin-typography-size-meta)] font-bakin-typography-weight-semibold uppercase tracking-[.08em]">
          {label}
        </span>
      </span>
      <span
        data-slot="stat-tile-value"
        className={cn(
          'mt-bakin-1 block min-w-0 [overflow-wrap:anywhere] font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-section-title)] font-bakin-typography-weight-semibold leading-tight tabular-nums',
          VALUE_TONE_CLASSES[valueTone],
        )}
      >
        {value}
      </span>
      {progress && percent !== undefined ? (
        <span
          role="progressbar"
          aria-label={progressLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          data-slot="stat-tile-progress"
          data-tone={progress.tone ?? 'success'}
          className="mt-bakin-3 block h-bakin-1 overflow-hidden rounded-bakin-pill bg-bakin-border-subtle/30"
        >
          <span
            data-slot="stat-tile-progress-indicator"
            className={cn(
              'block h-full rounded-bakin-pill transition-[width] duration-[var(--bakin-motion-duration-transition)] ease-bakin-standard',
              PROGRESS_TONE_CLASSES[progress.tone ?? 'success'],
            )}
            style={{ width: `${percent}%` }}
          />
        </span>
      ) : null}
      {sub != null ? (
        <span data-slot="stat-tile-description" className="mt-bakin-2 block min-w-0 [overflow-wrap:anywhere] text-[length:var(--bakin-typography-size-meta)] leading-relaxed text-bakin-text-muted">
          {sub}
        </span>
      ) : null}
    </Component>
  )
}
