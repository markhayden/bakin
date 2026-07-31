import type { ComponentProps } from 'react'
import { cva } from 'class-variance-authority'

import { cn } from '../utils'

export type AlertTone = 'neutral' | 'success' | 'attention' | 'danger' | 'accent'
export type LegacyAlertVariant = 'default' | 'destructive' | 'warning' | 'info'

export interface AlertVariantOptions {
  tone?: AlertTone | null
  variant?: LegacyAlertVariant | null
  className?: string
}

export type AlertProps = ComponentProps<'div'> & {
  tone?: AlertTone
  variant?: LegacyAlertVariant
}

const alertStyles = cva(
  [
    'group/alert relative grid w-full gap-bakin-1 rounded-bakin-surface border px-bakin-4 py-bakin-3',
    'font-bakin-typography-family-ui text-left text-[length:var(--bakin-typography-size-body)] text-bakin-text-primary',
    'has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-[calc(var(--bakin-layout-space-8)*3)]',
    'has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-bakin-3',
    '*:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*="size-"])]:size-bakin-4',
  ],
  {
    variants: {
      tone: {
        neutral: 'border-bakin-border-subtle bg-bakin-surface-default',
        success: 'border-bakin-action-primary-background bg-bakin-action-primary-background/10',
        attention: 'border-bakin-signal-highlight bg-bakin-signal-highlight/10',
        danger: 'border-bakin-signal-danger bg-bakin-signal-danger/10',
        accent: 'border-bakin-signal-accent bg-bakin-signal-accent/10',
      },
    },
    defaultVariants: {
      tone: 'neutral',
    },
  },
)

function canonicalTone(options: AlertVariantOptions): AlertTone {
  if (options.tone) return options.tone
  if (options.variant === 'destructive') return 'danger'
  if (options.variant === 'warning') return 'attention'
  if (options.variant === 'info') return 'neutral'
  return 'neutral'
}

export function alertVariants(options: AlertVariantOptions = {}): string {
  return cn(alertStyles({ tone: canonicalTone(options) }), options.className)
}

export function Alert({
  className,
  tone,
  variant,
  role,
  ...props
}: AlertProps) {
  const resolvedTone = canonicalTone({ tone, variant })
  return (
    <div
      data-slot="alert"
      data-tone={resolvedTone}
      role={role ?? (resolvedTone === 'danger' ? 'alert' : 'status')}
      className={alertVariants({ tone: resolvedTone, className })}
      {...props}
    />
  )
}

export function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        'font-bakin-typography-weight-semibold group-has-[>svg]/alert:col-start-2',
        '[&_a]:underline [&_a]:underline-offset-4 [&_a]:hover:text-bakin-action-primary-background',
        className,
      )}
      {...props}
    />
  )
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'text-balance text-[length:var(--bakin-typography-size-body)] leading-relaxed text-bakin-text-muted md:text-pretty',
        '[&_a]:underline [&_a]:underline-offset-4 [&_a]:hover:text-bakin-text-primary [&_p:not(:last-child)]:mb-bakin-4',
        className,
      )}
      {...props}
    />
  )
}

export function AlertAction({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-action"
      className={cn('absolute right-bakin-3 top-bakin-3', className)}
      {...props}
    />
  )
}
