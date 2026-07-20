import type { ComponentPropsWithoutRef } from 'react'

import { layoutClassName } from './utils'

type BoundedOverflowName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }

type BoundedOverflowBaseProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'aria-label' | 'aria-labelledby' | 'role' | 'tabIndex'
>

export type BoundedOverflowProps = BoundedOverflowBaseProps & BoundedOverflowName

/** Labelled keyboard-scrollable boundary for wide tables, charts, and canvases. */
export function BoundedOverflow({
  children,
  className,
  label,
  labelledBy,
  ...props
}: BoundedOverflowProps) {
  return (
    <div
      {...props}
      data-slot="bounded-overflow"
      role="region"
      aria-label={label}
      aria-labelledby={labelledBy}
      tabIndex={0}
      className={layoutClassName(
        'max-w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain',
        'focus-visible:rounded-bakin-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring',
        className,
      )}
    >
      {children}
    </div>
  )
}
