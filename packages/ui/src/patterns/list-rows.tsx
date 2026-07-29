import { forwardRef } from 'react'
import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '../utils'

export type ListRowsVariant = 'bordered' | 'separated' | 'plain'

export interface ListRowsProps extends ComponentPropsWithoutRef<'ul'> {
  /**
   * `bordered` gives every row a distinct interactive/resource boundary.
   * `separated` groups dense peers with shared dividers.
   * `plain` provides semantic list structure without visual boundaries.
   */
  variant?: ListRowsVariant
}

const variantClasses: Record<ListRowsVariant, string> = {
  bordered: [
    'grid gap-bakin-2',
    '[&>[data-slot=list-row]]:rounded-bakin-surface',
    '[&>[data-slot=list-row]]:border',
    '[&>[data-slot=list-row]]:border-bakin-border-subtle',
    '[&>[data-slot=list-row]]:bg-bakin-surface-default',
  ].join(' '),
  separated: [
    'border-y border-bakin-border-subtle',
    '[&>[data-slot=list-row]:not(:last-child)]:border-b',
    '[&>[data-slot=list-row]:not(:last-child)]:border-bakin-border-subtle',
  ].join(' '),
  plain: 'grid',
}

/** Semantic list container that makes the relationship between repeated rows explicit. */
export function ListRows({
  variant = 'bordered',
  className,
  ...props
}: ListRowsProps) {
  return (
    <ul
      {...props}
      data-list-rows=""
      data-variant={variant}
      className={cn('m-0 min-w-0 list-none p-0', variantClasses[variant], className)}
    />
  )
}

export type ListRowProps = ComponentPropsWithoutRef<'li'>

/** Composition-friendly semantic row with canonical list spacing. */
export const ListRow = forwardRef<HTMLLIElement, ListRowProps>(function ListRow(
  { className, ...props },
  ref,
) {
  return (
    <li
      ref={ref}
      {...props}
      data-slot="list-row"
      className={cn('min-w-0 px-bakin-3 py-bakin-3', className)}
    />
  )
})
