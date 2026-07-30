'use client'

import * as React from 'react'

import { cn } from '../utils'
import { PageScrollContext } from './page'

type AccessibleRegionName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }

type NativeTimelineProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'aria-label' | 'aria-labelledby' | 'aria-live'
>

export type PageTimelineProps = NativeTimelineProps & AccessibleRegionName & {
  live?: 'off' | 'polite'
}

/**
 * Named conversation log; inside a contained Page it is the one page-owned
 * vertical scroller. Renamed from ConversationPageTimeline; the legacy export
 * wraps this component and overrides `data-slot` (placed before the spread
 * for exactly that reason) until the migration slice removes it.
 */
export function PageTimeline({
  className,
  label,
  labelledBy,
  live = 'polite',
  ...props
}: PageTimelineProps) {
  const scroll = React.useContext(PageScrollContext)
  return (
    <div
      data-slot="page-timeline"
      {...props}
      role="log"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-live={live}
      className={cn(
        'flex min-w-0 flex-col gap-bakin-4',
        scroll === 'contained'
          && 'min-h-0 flex-1 overflow-y-auto overscroll-contain pr-bakin-2',
        className,
      )}
    />
  )
}
