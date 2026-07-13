'use client'

import type { ComponentType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SegmentedControlOption<T extends string> {
  value: T
  label: ReactNode
  icon?: ComponentType<{ className?: string }>
  /** Icon-only segment — the label stays for screen readers + the hover title. */
  hideLabel?: boolean
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedControlOption<T>>
  value: T
  onValueChange: (value: T) => void
  /** `sm` (default) for toolbars, `md` for page-level view switchers. */
  size?: 'sm' | 'md'
  /** Accessible name for the group — always pass one. */
  ariaLabel: string
  className?: string
}

/**
 * THE segmented control / mode toggle (Edit|Preview, Board|Log, 5m|1h|24h...).
 * Five plugins hand-rolled this in two drifted dialects with almost no a11y —
 * this is the one implementation: neutral track, card-colored active segment
 * (selection is never accent — accent is signal only), proper tablist
 * semantics.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  size = 'sm',
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('flex w-fit items-center gap-0.5 rounded-lg bg-foreground/5 p-0.5', className)}
      data-segmented-control
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          className={cn(
            'flex items-center gap-1.5 rounded-md font-medium capitalize transition-colors',
            size === 'sm' ? 'px-3 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
            value === o.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => onValueChange(o.value)}
          data-segment={o.value}
          title={o.hideLabel && typeof o.label === 'string' ? o.label : undefined}
        >
          {o.icon && <o.icon className="size-3.5" />}
          {o.hideLabel ? <span className="sr-only">{o.label}</span> : o.label}
        </button>
      ))}
    </div>
  )
}
