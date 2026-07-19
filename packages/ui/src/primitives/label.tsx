'use client'

import type { ComponentProps } from 'react'

import { cn } from '../utils'

export type LabelProps = ComponentProps<'label'>

export function Label({ className, ...props }: LabelProps) {
  return (
    <label
      data-slot="label"
      className={cn(
        [
          'inline-flex min-w-0 items-center gap-bakin-2 font-bakin-typography-family-ui',
          'text-[length:var(--bakin-typography-size-body)] font-bakin-typography-weight-semibold leading-snug text-bakin-text-primary',
          'select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-[var(--bakin-state-opacity-disabled)]',
          'peer-disabled:cursor-not-allowed peer-disabled:opacity-[var(--bakin-state-opacity-disabled)]',
        ].join(' '),
        className,
      )}
      {...props}
    />
  )
}
