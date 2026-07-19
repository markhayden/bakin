import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva } from 'class-variance-authority'

import { cn } from '../utils'

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'attention' | 'danger' | 'accent'
export type BadgeVariant = 'soft' | 'solid' | 'outline' | 'ghost' | 'link'
export type BadgeSize = 'sm' | 'md'

/** Compatibility aliases retained while owned consumers move to tone + variant. */
export type LegacyBadgeVariant = 'default' | 'secondary' | 'destructive'

export interface BadgeVariantOptions {
  tone?: BadgeTone | null
  variant?: BadgeVariant | LegacyBadgeVariant | null
  size?: BadgeSize | null
  className?: string
}

type BadgeState = Record<string, unknown> & {
  slot: 'badge'
  tone: BadgeTone
  variant: BadgeVariant
  size: BadgeSize
}

interface ResolvedBadgeOptions {
  tone: BadgeTone
  variant: BadgeVariant
  size: BadgeSize
}

export type BadgeProps = useRender.ComponentProps<'span', BadgeState> & {
  tone?: BadgeTone
  variant?: BadgeVariant | LegacyBadgeVariant
  size?: BadgeSize
}

const badgeStyles = cva(
  [
    'group/badge inline-flex w-fit shrink-0 items-center justify-center whitespace-nowrap',
    'overflow-hidden rounded-bakin-pill border font-bakin-typography-family-ui font-bakin-typography-weight-semibold',
    'transition-[background-color,border-color,color] duration-[var(--bakin-motion-duration-feedback)] ease-bakin-standard',
    'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring',
    'aria-invalid:border-bakin-signal-danger [&>svg]:pointer-events-none [&>svg]:shrink-0',
  ],
  {
    variants: {
      tone: {
        neutral: '',
        primary: '',
        success: '',
        attention: '',
        danger: '',
        accent: '',
      },
      variant: {
        soft: '',
        solid: '',
        outline: 'bg-transparent',
        ghost: 'border-transparent bg-transparent',
        link: 'border-transparent bg-transparent underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-bakin-6 gap-bakin-1 px-bakin-2 text-[length:var(--bakin-typography-size-meta)] [&>svg]:size-bakin-3',
        md: 'h-bakin-8 gap-bakin-2 px-bakin-3 text-[length:var(--bakin-typography-size-body)] [&>svg]:size-bakin-4',
      },
    },
    compoundVariants: [
      { tone: 'neutral', variant: 'soft', className: 'border-bakin-border-subtle/40 bg-bakin-surface-default text-bakin-text-muted' },
      { tone: 'neutral', variant: 'solid', className: 'border-bakin-border-subtle bg-bakin-border-subtle text-bakin-text-primary' },
      { tone: 'neutral', variant: ['outline', 'ghost', 'link'], className: 'border-bakin-border-subtle text-bakin-text-muted' },
      { tone: 'primary', variant: 'soft', className: 'border-bakin-action-primary-background/50 bg-bakin-action-primary-background/15 text-bakin-text-primary' },
      { tone: 'primary', variant: 'solid', className: 'border-bakin-action-primary-background bg-bakin-action-primary-background text-bakin-action-primary-foreground' },
      { tone: 'primary', variant: ['outline', 'ghost', 'link'], className: 'border-bakin-action-primary-background text-bakin-action-primary-background' },
      { tone: 'success', variant: 'soft', className: 'border-bakin-action-primary-background/50 bg-bakin-action-primary-background/15 text-bakin-text-primary' },
      { tone: 'success', variant: 'solid', className: 'border-bakin-action-primary-background bg-bakin-action-primary-background text-bakin-action-primary-foreground' },
      { tone: 'success', variant: ['outline', 'ghost', 'link'], className: 'border-bakin-action-primary-background text-bakin-action-primary-background' },
      { tone: 'attention', variant: 'soft', className: 'border-bakin-signal-highlight/60 bg-bakin-signal-highlight/15 text-bakin-text-primary' },
      { tone: 'attention', variant: 'solid', className: 'border-bakin-signal-highlight bg-bakin-signal-highlight text-bakin-canvas-default' },
      { tone: 'attention', variant: ['outline', 'ghost', 'link'], className: 'border-bakin-signal-highlight text-bakin-text-primary' },
      { tone: 'danger', variant: 'soft', className: 'border-bakin-signal-danger/60 bg-bakin-signal-danger/15 text-bakin-text-primary' },
      { tone: 'danger', variant: 'solid', className: 'border-bakin-signal-danger bg-bakin-signal-danger text-bakin-canvas-default' },
      { tone: 'danger', variant: ['outline', 'ghost', 'link'], className: 'border-bakin-signal-danger text-bakin-text-primary' },
      { tone: 'accent', variant: 'soft', className: 'border-bakin-signal-accent/60 bg-bakin-signal-accent/15 text-bakin-text-primary' },
      { tone: 'accent', variant: 'solid', className: 'border-bakin-signal-accent bg-bakin-signal-accent text-bakin-canvas-default' },
      { tone: 'accent', variant: ['outline', 'ghost', 'link'], className: 'border-bakin-signal-accent text-bakin-text-primary' },
    ],
    defaultVariants: {
      tone: 'neutral',
      variant: 'soft',
      size: 'sm',
    },
  },
)

function canonicalBadgeOptions(options: BadgeVariantOptions): ResolvedBadgeOptions {
  if (options.variant === 'default') return { tone: options.tone ?? 'primary', variant: 'solid', size: options.size ?? 'sm' }
  if (options.variant === 'secondary') return { tone: options.tone ?? 'neutral', variant: 'soft', size: options.size ?? 'sm' }
  if (options.variant === 'destructive') return { tone: options.tone ?? 'danger', variant: 'soft', size: options.size ?? 'sm' }
  return {
    tone: options.tone ?? 'neutral',
    variant: options.variant ?? 'soft',
    size: options.size ?? 'sm',
  }
}

/** Supported class helper for render-prop and compact metadata integrations. */
export function badgeVariants(options: BadgeVariantOptions = {}): string {
  const resolved = canonicalBadgeOptions(options)
  return cn(badgeStyles(resolved), options.className)
}

export function Badge({
  className,
  tone,
  variant,
  size,
  render,
  ...props
}: BadgeProps) {
  const resolved = canonicalBadgeOptions({ tone, variant, size })
  const state: BadgeState = { slot: 'badge', ...resolved }

  return useRender<BadgeState, HTMLSpanElement>({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: badgeVariants({ ...resolved, className }),
      },
      props,
    ),
    render,
    state,
  })
}
