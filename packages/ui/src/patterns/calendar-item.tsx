import * as React from 'react'

import { cn } from '../utils'

export type CalendarItemTone = 'neutral' | 'accent' | 'danger' | 'attention'
export type CalendarItemDensity = 'compact' | 'expanded'

type NativeCalendarItemProps = Omit<
  React.ComponentPropsWithoutRef<'button'>,
  'children' | 'title'
>

export interface CalendarItemProps extends NativeCalendarItemProps {
  /** One-line identity, truncated. */
  title: React.ReactNode
  /** Right-aligned mono time label ("11:05pm"). */
  time?: React.ReactNode
  /** Second line under the title — description, disposition counts, owner meta. */
  detail?: React.ReactNode
  /** Expanded-only third line, set in mono — schedule expressions and the like. */
  meta?: React.ReactNode
  /** Compact identity slot — agent avatar, kind icon. */
  leading?: React.ReactNode
  /** Status marker beside the time — disposition dot, attention icon. */
  marker?: React.ReactNode
  /**
   * `accent`/`danger` tint the surface and time for domain events and
   * deadlines; `attention` is reserved for entries needing a human look.
   */
  tone?: CalendarItemTone
  /** `compact` for dense grid cells, `expanded` for agenda timelines. */
  density?: CalendarItemDensity
  /** Dims an entry whose instant has already passed. */
  past?: boolean
}

const TONE_SURFACE: Record<CalendarItemTone, string> = {
  neutral:
    'border-bakin-border-subtle bg-bakin-canvas-default hover:bg-bakin-surface-default',
  accent:
    'border-bakin-signal-accent/60 bg-bakin-signal-accent/10 hover:bg-bakin-signal-accent/15',
  danger:
    'border-bakin-signal-danger/60 bg-bakin-signal-danger/10 hover:bg-bakin-signal-danger/15',
  attention:
    'border-bakin-signal-highlight/60 bg-bakin-signal-highlight/10 hover:bg-bakin-signal-highlight/15',
}

const TONE_TIME: Record<CalendarItemTone, string> = {
  neutral: 'text-bakin-text-muted',
  accent: 'text-bakin-signal-accent',
  danger: 'text-bakin-signal-danger',
  attention: 'text-bakin-text-muted',
}

/**
 * One interactive calendar entry — job occurrences, domain events, recurring
 * rollups — shared by every calendar surface so tone, density, and past-state
 * treatment stay identical across views.
 *
 * The item owns its whole-surface button affordance and text hierarchy;
 * consumers own the slots (identity, marker, popovers around the item) and
 * the cell layout it sits in — the item never carries its own margins.
 */
export const CalendarItem = React.forwardRef<HTMLButtonElement, CalendarItemProps>(
  function CalendarItem(
    {
      title,
      time,
      detail,
      meta,
      leading,
      marker,
      tone = 'neutral',
      density = 'compact',
      past = false,
      className,
      type = 'button',
      ...props
    },
    ref,
  ) {
    const expanded = density === 'expanded'
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        data-slot="calendar-item"
        data-tone={tone}
        data-density={density}
        data-past={past ? '' : undefined}
        className={cn(
          'flex w-full min-w-0 items-start gap-x-bakin-2 overflow-hidden rounded-bakin-control border text-left font-bakin-typography-family-ui outline-none transition-colors focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring',
          expanded ? 'px-bakin-3 py-bakin-2' : 'px-bakin-2 py-bakin-2',
          TONE_SURFACE[tone],
          past && 'opacity-50 hover:opacity-70',
          className,
        )}
      >
        {leading ? (
          <span data-slot="calendar-item-leading" className="shrink-0 self-start">
            {leading}
          </span>
        ) : null}
        <span className={cn('flex min-w-0 flex-1 flex-col', expanded && 'gap-y-bakin-1')}>
          <span className="flex min-w-0 items-start gap-x-bakin-2">
            <span
              data-slot="calendar-item-title"
              className={cn(
                'min-w-0 flex-1 truncate font-bakin-typography-weight-medium leading-tight',
                expanded
                  ? 'text-bakin-typography-size-body'
                  : 'text-bakin-typography-size-meta',
                past ? 'text-bakin-text-muted' : 'text-bakin-text-primary',
              )}
            >
              {title}
            </span>
            {marker || time ? (
              <span className="flex shrink-0 items-center justify-end gap-bakin-1 text-right">
                {marker}
                {time ? (
                  <span
                    data-slot="calendar-item-time"
                    className={cn(
                      'text-right font-bakin-typography-family-mono text-bakin-typography-size-meta tabular-nums',
                      TONE_TIME[tone],
                    )}
                  >
                    {time}
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
          {detail ? (
            <span
              data-slot="calendar-item-detail"
              className={cn(
                'min-w-0 leading-tight text-bakin-text-muted text-bakin-typography-size-meta',
                expanded ? 'line-clamp-3' : 'line-clamp-1',
              )}
            >
              {detail}
            </span>
          ) : null}
          {expanded && meta ? (
            <span
              data-slot="calendar-item-meta"
              className="mt-bakin-1 block min-w-0 font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted"
            >
              {meta}
            </span>
          ) : null}
        </span>
      </button>
    )
  },
)
