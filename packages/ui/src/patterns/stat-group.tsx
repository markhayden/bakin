import type { ComponentPropsWithoutRef, ReactNode } from 'react'

import { cn } from '../utils'

export interface StatGroupProps extends Omit<ComponentPropsWithoutRef<'div'>, 'aria-label' | 'children' | 'role'> {
  /** Durable accessible name for the related metric set. */
  label: string
  children: ReactNode
}

/** Start-aligned, wrapping group for compact peer metrics that should not stretch across a page. */
export function StatGroup({ label, className, children, ...props }: StatGroupProps) {
  return (
    <div
      {...props}
      role="group"
      aria-label={label}
      data-stat-group=""
      className={cn(
        'flex min-w-0 flex-wrap items-stretch justify-start gap-bakin-2',
        className,
      )}
    >
      {children}
    </div>
  )
}
