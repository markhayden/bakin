'use client'

import * as React from 'react'

import { cn } from '../utils'

export type SortDir = 'asc' | 'desc'

export type SortableHeadProps<F extends string> = Omit<React.ComponentPropsWithoutRef<'th'>, 'children'> & {
  field: F
  current: F
  dir: SortDir
  onSort: (field: F) => void
  disabled?: boolean
  buttonClassName?: string
  children: React.ReactNode
}

function SortIcon({ active, direction }: { active: boolean; direction: SortDir }) {
  if (active) {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-none stroke-current stroke-[1.75]">
        {direction === 'asc'
          ? <path d="m4.5 9.5 3.5-3.5 3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
          : <path d="m4.5 6.5 3.5 3.5 3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-none stroke-current stroke-[1.5] opacity-50">
      <path d="m5 6 3-3 3 3M11 10l-3 3-3-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Sortable table column header with native aria-sort state on the header cell. */
export function SortableHead<F extends string>({
  field,
  current,
  dir,
  onSort,
  disabled = false,
  buttonClassName,
  children,
  className,
  scope = 'col',
  ...props
}: SortableHeadProps<F>) {
  const active = current === field && !disabled
  return (
    <th
      {...props}
      scope={scope}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
      data-slot="table-head"
      data-sort-field={field}
      className={cn('h-bakin-10 whitespace-nowrap px-bakin-2 text-left align-middle font-bakin-typography-weight-semibold text-bakin-text-primary', className)}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSort(field)}
        className={cn(
          'inline-flex min-h-bakin-8 max-w-full items-center gap-bakin-1 rounded-bakin-control text-left text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted outline-none transition-colors hover:text-bakin-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring disabled:cursor-default disabled:opacity-[var(--bakin-state-opacity-disabled)]',
          active && 'text-bakin-text-primary',
          buttonClassName,
        )}
      >
        <span className="truncate">{children}</span>
        {!disabled ? <SortIcon active={active} direction={dir} /> : null}
      </button>
    </th>
  )
}
