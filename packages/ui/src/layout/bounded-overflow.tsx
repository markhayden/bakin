'use client'

import * as React from 'react'

import { StickyOverflowScrollbar } from './sticky-overflow-scrollbar'
import { layoutClassName } from './utils'

type BoundedOverflowName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }

type BoundedOverflowBaseProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'aria-label' | 'aria-labelledby' | 'role' | 'tabIndex'
>

export type BoundedOverflowProps = BoundedOverflowBaseProps & BoundedOverflowName & {
  /**
   * Pin an always-visible horizontal scrollbar to the visible bottom edge.
   * For tall regions whose own bottom edge can sit below the fold
   * (workspace boards), the native bar is unreachable without scrolling
   * the page first — the pinned bar keeps sideways scrolling one gesture
   * away at all times. Rendered as a kit-owned track + thumb (native
   * scrollbar painting is overlay-dependent and can be invisible); the
   * region keeps keyboard scrolling and its accessible name.
   *
   * Constraints: geometry re-reads ride ResizeObserver on the region's
   * DIRECT children at mount — keep those stable (a single track div).
   * One sticky-scrollbar region per visible page: multiple instances
   * would contend for the same viewport-bottom band.
   */
  stickyScrollbar?: boolean
}

/**
 * Labelled keyboard-scrollable boundary for wide tables, charts, and canvases.
 *
 * HORIZONTAL ONLY, and deliberately so — the name is broader than the
 * behaviour. Vertical is pinned to `hidden` because the page owns the one
 * vertical scroll; a component that bounded height here would make nested
 * vertical scrolling easy to reach for, which is the thing the scroll doctrine
 * forbids. A genuinely panel-scoped vertical region belongs to `Panel scroll`,
 * which pairs the height bound with its own labelling.
 *
 * Consumed by the kit patterns that need it (DataTable, the charts, Kanban,
 * calendar grid, page canvas) rather than by product code directly — reach for
 * the pattern, not this.
 */
export function BoundedOverflow({
  children,
  className,
  label,
  labelledBy,
  stickyScrollbar = false,
  ...props
}: BoundedOverflowProps) {
  const regionRef = React.useRef<HTMLDivElement>(null)

  const region = (
    <div
      {...props}
      ref={regionRef}
      data-slot="bounded-overflow"
      role="region"
      aria-label={label}
      aria-labelledby={labelledBy}
      tabIndex={0}
      className={layoutClassName(
        'max-w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain',
        'focus-visible:rounded-bakin-control focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring',
        stickyScrollbar && '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {children}
    </div>
  )

  if (!stickyScrollbar) return region

  return (
    <>
      {region}
      <StickyOverflowScrollbar regionRef={regionRef} />
    </>
  )
}
