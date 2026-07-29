import { forwardRef } from 'react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '../utils'

export type RecurringDaySummaryTone = 'neutral' | 'attention'

export interface RecurringDaySummaryProps
  extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  /** Human-readable name of the recurring series. */
  title: string
  /** Short daily rollup such as `13 done · 11 scheduled`. */
  detail: string
  /** Optional compact identity, such as an agent avatar. */
  leading?: ReactNode
  /** `attention` is reserved for a day containing skipped or pending occurrences. */
  tone?: RecurringDaySummaryTone
}

function RepeatIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-bakin-3"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m17 1 4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="m7 23-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  )
}

function AttentionIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-bakin-3 text-bakin-signal-highlight"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21.7 18 13.7 4a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  )
}

/**
 * Compact day-header action for a series that would otherwise flood a calendar.
 *
 * Consumers own occurrence grouping, exact disposition counts, and navigation.
 */
export const RecurringDaySummary = forwardRef<HTMLButtonElement, RecurringDaySummaryProps>(
  function RecurringDaySummary(
    {
      title,
      detail,
      leading,
      tone = 'neutral',
      className,
      type = 'button',
      ...props
    },
    ref,
  ) {
    const accessibleName = `${title}. ${detail}`

    return (
      <button
        ref={ref}
        type={type}
        aria-label={accessibleName}
        data-slot="recurring-day-summary"
        data-tone={tone}
        className={cn(
          [
            'group grid min-w-0 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-bakin-2',
            'rounded-bakin-control border px-bakin-2 py-bakin-1',
            'text-left transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bakin-focus-ring focus-visible:ring-offset-2',
            'focus-visible:ring-offset-bakin-canvas-default',
            tone === 'attention'
              ? 'border-bakin-signal-highlight/60 bg-bakin-signal-highlight/10 hover:bg-bakin-signal-highlight/15'
              : 'border-bakin-border-subtle bg-bakin-canvas-default hover:bg-bakin-surface-default',
          ],
          className,
        )}
        {...props}
      >
        <span className="inline-flex size-bakin-6 shrink-0 items-center justify-center text-bakin-text-muted">
          {leading ?? <RepeatIcon />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-bakin-typography-size-meta font-bakin-typography-weight-medium leading-tight text-bakin-text-primary">
            {title}
          </span>
          <span className="block truncate text-bakin-typography-size-meta leading-tight text-bakin-text-muted">
            {detail}
          </span>
        </span>
        {tone === 'attention' ? (
          <span title="Needs attention" className="shrink-0">
            <AttentionIcon />
          </span>
        ) : null}
      </button>
    )
  },
)
