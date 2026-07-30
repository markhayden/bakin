import * as React from 'react'

import { cn } from '../utils'

type AccessibleAsideName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }

type NativeAsideProps = Omit<
  React.ComponentPropsWithoutRef<'aside'>,
  'aria-label' | 'aria-labelledby'
>

export type PageAsideProps = NativeAsideProps & AccessibleAsideName

/**
 * Named supporting context that reflows below the primary page content.
 * Renamed from DetailPageAside; the legacy export wraps this component and
 * overrides `data-slot` (placed before the spread for exactly that reason)
 * until the migration slice removes it.
 */
export function PageAside({
  className,
  label,
  labelledBy,
  ...props
}: PageAsideProps) {
  return (
    <aside
      data-slot="page-aside"
      {...props}
      aria-label={label}
      aria-labelledby={labelledBy}
      className={cn(
        'flex min-w-0 flex-col gap-bakin-4 border-t border-bakin-border-subtle pt-bakin-6 @3xl/layout-grid:border-l @3xl/layout-grid:border-t-0 @3xl/layout-grid:pl-bakin-6 @3xl/layout-grid:pt-bakin-0',
        className,
      )}
    />
  )
}
