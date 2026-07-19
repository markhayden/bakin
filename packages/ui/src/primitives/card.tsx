import type { ComponentProps } from 'react'

import { cn } from '../utils'

export type CardSize = 'sm' | 'md'
export type LegacyCardSize = 'default'
export type CardProps = ComponentProps<'div'> & { size?: CardSize | LegacyCardSize }

function canonicalSize(size: CardProps['size']): CardSize {
  return size === 'default' || size == null ? 'md' : size
}

/** A bounded object surface; page and section layout belongs to layout primitives. */
export function Card({ className, size = 'md', ...props }: CardProps) {
  const resolvedSize = canonicalSize(size)
  return (
    <div
      data-slot="card"
      data-size={resolvedSize}
      className={cn(
        [
          'group/card flex min-w-0 flex-col overflow-hidden rounded-bakin-surface border border-bakin-border-subtle',
          'bg-bakin-surface-default font-bakin-typography-family-ui text-[length:var(--bakin-typography-size-body)] text-bakin-text-primary',
          'gap-bakin-4 py-bakin-4 data-[size=sm]:gap-bakin-3 data-[size=sm]:py-bakin-3',
          'has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0',
          '*:[img:first-child]:rounded-t-bakin-surface *:[img:last-child]:rounded-b-bakin-surface',
        ].join(' '),
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        [
          'group/card-header @container/card-header grid min-w-0 auto-rows-min items-start gap-bakin-1 px-bakin-4',
          'group-data-[size=sm]/card:px-bakin-3 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]',
          'has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-bakin-4 group-data-[size=sm]/card:[.border-b]:pb-bakin-3',
        ].join(' '),
        className,
      )}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        'min-w-0 [overflow-wrap:anywhere] text-[length:var(--bakin-typography-size-section-title)] font-bakin-typography-weight-semibold leading-snug group-data-[size=sm]/card:text-[length:var(--bakin-typography-size-body)]',
        className,
      )}
      {...props}
    />
  )
}

export function CardDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('min-w-0 [overflow-wrap:anywhere] leading-relaxed text-bakin-text-muted', className)}
      {...props}
    />
  )
}

export function CardAction({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn('min-w-0 px-bakin-4 group-data-[size=sm]/card:px-bakin-3', className)}
      {...props}
    />
  )
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'flex min-w-0 items-center border-t border-bakin-border-subtle bg-bakin-canvas-default/35 p-bakin-4 group-data-[size=sm]/card:p-bakin-3',
        className,
      )}
      {...props}
    />
  )
}
