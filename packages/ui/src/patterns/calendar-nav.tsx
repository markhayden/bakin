import * as React from 'react'

import { Button } from '../primitives/button'
import { cn } from '../utils'

export interface CalendarNavProps extends React.ComponentPropsWithoutRef<'div'> {
  /** Current range identity — "August 2026", "Aug 9 — Aug 15, 2026". */
  label: React.ReactNode
  /** Accessible name for the whole navigation cluster. */
  navLabel: string
  onPrevious: () => void
  onNext: () => void
  /** Accessible names for the chevrons ("Previous week", "Next week"). */
  previousLabel: string
  nextLabel: string
  /** Renders the Today jump when provided. */
  onToday?: () => void
}

function Chevron({ direction }: { direction: 'previous' | 'next' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cn(
        'size-bakin-4 shrink-0 fill-none stroke-current stroke-[1.75]',
        direction === 'previous' && 'rotate-180',
      )}
    >
      <path d="m6 4.5 3.5 3.5L6 11.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Range navigation for calendar surfaces: previous/next chevrons around the
 * current range label, plus the Today jump. One geometry for every view —
 * the label box holds a shared minimum width so the chevrons never shift as
 * the label changes with navigation.
 */
export function CalendarNav({
  label,
  navLabel,
  onPrevious,
  onNext,
  previousLabel,
  nextLabel,
  onToday,
  className,
  ...props
}: CalendarNavProps) {
  return (
    <div
      {...props}
      role="group"
      aria-label={navLabel}
      data-slot="calendar-nav"
      className={cn('flex min-w-0 items-center gap-bakin-2', className)}
    >
      <Button variant="ghost" size="icon-sm" onClick={onPrevious} aria-label={previousLabel}>
        <Chevron direction="previous" />
      </Button>
      <span
        data-slot="calendar-nav-label"
        className="min-w-48 text-center text-bakin-typography-size-body font-bakin-typography-weight-medium tabular-nums text-bakin-text-primary"
      >
        {label}
      </span>
      <Button variant="ghost" size="icon-sm" onClick={onNext} aria-label={nextLabel}>
        <Chevron direction="next" />
      </Button>
      {onToday ? (
        <Button variant="outline" size="xs" className="ml-bakin-2" onClick={onToday}>
          Today
        </Button>
      ) : null}
    </div>
  )
}
