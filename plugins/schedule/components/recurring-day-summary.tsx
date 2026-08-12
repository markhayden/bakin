import { forwardRef } from 'react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { Repeat, TriangleAlert } from 'lucide-react'
import { CalendarItem } from '@makinbakin/sdk/patterns'

export type RecurringDaySummaryTone = 'neutral' | 'attention'

export interface RecurringDaySummaryProps
  extends Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'title'> {
  /** Human-readable name of the recurring series. */
  title: string
  /** Short daily rollup such as `13 done · 11 scheduled`. */
  detail: string
  /** Optional compact identity, such as an agent avatar. */
  leading?: ReactNode
  /** `attention` is reserved for a day containing skipped or pending occurrences. */
  tone?: RecurringDaySummaryTone
}

/**
 * Compact day-header entry for a series that would otherwise flood a calendar.
 *
 * A thin CalendarItem binding: consumers own occurrence grouping, exact
 * disposition counts, and navigation.
 */
export const RecurringDaySummary = forwardRef<HTMLButtonElement, RecurringDaySummaryProps>(
  function RecurringDaySummary(
    { title, detail, leading, tone = 'neutral', ...props },
    ref,
  ) {
    return (
      <CalendarItem
        {...props}
        ref={ref}
        tone={tone}
        title={title}
        detail={detail}
        leading={
          leading ?? (
            <Repeat aria-hidden="true" className="size-bakin-3 text-bakin-text-muted" />
          )
        }
        marker={
          tone === 'attention' ? (
            <>
              <TriangleAlert
                aria-hidden="true"
                className="size-bakin-3 shrink-0 text-bakin-signal-highlight"
              />
              <span className="sr-only">Needs attention</span>
            </>
          ) : undefined
        }
      />
    )
  },
)
