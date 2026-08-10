'use client'

import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva } from 'class-variance-authority'

import { cn } from '../utils'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'warning'
  | 'info'
  | 'accent'
  | 'link'

/** Compatibility aliases retained while owned consumers move to semantic names. */
export type LegacyButtonVariant = 'default' | 'destructive'

export type ButtonSize =
  | 'xs'
  | 'sm'
  | 'md'
  | 'lg'
  | 'inline'
  | 'icon-xs'
  | 'icon-sm'
  | 'icon-md'
  | 'icon-lg'

/** Compatibility aliases retained while owned consumers move to canonical sizes. */
export type LegacyButtonSize = 'default' | 'icon'

export interface ButtonVariantOptions {
  variant?: ButtonVariant | LegacyButtonVariant | null
  size?: ButtonSize | LegacyButtonSize | null
  className?: string
}

export type ButtonProps = Omit<ButtonPrimitive.Props, 'className'> & {
  className?: ButtonPrimitive.Props['className']
  variant?: ButtonVariant | LegacyButtonVariant
  size?: ButtonSize | LegacyButtonSize
}

const buttonStyles = cva(
  [
    'group/button inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap',
    'rounded-bakin-control border font-bakin-typography-family-ui font-bakin-typography-weight-semibold',
    'text-[length:var(--bakin-typography-size-body)] leading-none',
    'transition-[background-color,border-color,color,filter,transform] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard',
    'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring',
    'active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-[var(--bakin-state-opacity-disabled)]',
    'aria-invalid:border-bakin-signal-danger',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-bakin-4',
  ],
  {
    variants: {
      variant: {
        primary:
          'border-bakin-action-primary-background bg-bakin-action-primary-background text-bakin-action-primary-foreground hover:brightness-110',
        secondary:
          'border-bakin-border-subtle/60 bg-bakin-surface-default text-bakin-text-primary hover:border-bakin-border-subtle hover:bg-bakin-border-subtle/20',
        outline:
          'border-bakin-border-subtle bg-transparent text-bakin-text-primary hover:bg-bakin-surface-default',
        ghost:
          'border-transparent bg-transparent text-bakin-text-primary hover:bg-bakin-surface-default',
        danger:
          'border-bakin-signal-danger bg-bakin-signal-danger/15 text-bakin-text-primary hover:bg-bakin-signal-danger/25',
        warning:
          'border-bakin-signal-highlight bg-bakin-signal-highlight/15 text-bakin-text-primary hover:bg-bakin-signal-highlight/25',
        info:
          'border-bakin-border-subtle bg-bakin-surface-default text-bakin-text-muted hover:text-bakin-text-primary',
        accent:
          'border-bakin-signal-accent bg-bakin-signal-accent/15 text-bakin-text-primary hover:bg-bakin-signal-accent/25',
        link:
          'border-transparent bg-transparent px-bakin-1 text-bakin-signal-accent underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-bakin-6 gap-bakin-1 px-bakin-2 text-[length:var(--bakin-typography-size-meta)] [&_svg:not([class*="size-"])]:size-bakin-3',
        sm: 'h-bakin-8 gap-bakin-2 px-bakin-3',
        md: 'h-[var(--bakin-layout-size-control)] gap-bakin-2 px-bakin-4',
        lg: 'h-[calc(var(--bakin-layout-size-control)+var(--bakin-layout-space-1))] gap-bakin-2 px-bakin-4',
        // Text-flow button: sits inside prose/cells at the surrounding text
        // size with no control box — the sanctioned form of the
        // `!h-auto !justify-start !p-0` fights it replaces.
        inline:
          'h-auto justify-start gap-bakin-1 whitespace-normal p-0 text-left text-[length:inherit] leading-[inherit] [&_svg:not([class*="size-"])]:size-[1em]',
        'icon-xs': 'size-bakin-6 min-h-bakin-6 min-w-bakin-6 [&_svg:not([class*="size-"])]:size-bakin-3',
        'icon-sm': 'size-bakin-8 min-h-bakin-8 min-w-bakin-8',
        'icon-md': 'size-[var(--bakin-layout-size-control)] min-h-[var(--bakin-layout-size-control)] min-w-[var(--bakin-layout-size-control)]',
        'icon-lg': 'size-[calc(var(--bakin-layout-size-control)+var(--bakin-layout-space-1))] min-h-[calc(var(--bakin-layout-size-control)+var(--bakin-layout-space-1))] min-w-[calc(var(--bakin-layout-size-control)+var(--bakin-layout-space-1))]',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

function canonicalVariant(variant: ButtonVariant | LegacyButtonVariant | null | undefined): ButtonVariant {
  if (variant === 'default' || variant == null) return 'primary'
  if (variant === 'destructive') return 'danger'
  return variant
}

function canonicalSize(size: ButtonSize | LegacyButtonSize | null | undefined): ButtonSize {
  if (size === 'default' || size == null) return 'md'
  if (size === 'icon') return 'icon-md'
  return size
}

/**
 * Supported class helper for links and render-prop integrations that need to
 * look like a Button without changing their native element semantics.
 */
export function buttonVariants(options: ButtonVariantOptions = {}): string {
  return cn(buttonStyles({
    variant: canonicalVariant(options.variant),
    size: canonicalSize(options.size),
  }), options.className)
}

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  ...props
}: ButtonProps) {
  const resolvedVariant = canonicalVariant(variant)
  const resolvedSize = canonicalSize(size)
  const resolvedClassName: ButtonPrimitive.Props['className'] = typeof className === 'function'
    ? (state) => buttonVariants({ variant: resolvedVariant, size: resolvedSize, className: className(state) })
    : buttonVariants({ variant: resolvedVariant, size: resolvedSize, className })

  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={resolvedVariant}
      data-size={resolvedSize}
      className={resolvedClassName}
      {...props}
    />
  )
}
