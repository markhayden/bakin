import * as React from 'react'
import type { ComponentProps } from 'react'

import { cn } from '../utils'
import {
  interactiveOverlay,
  interactiveSurfaceClasses,
  type InteractiveAction,
} from './interactive-surface'

export type CardSize = 'sm' | 'md'
export type LegacyCardSize = 'default'
export type CardTone = 'neutral' | 'success' | 'attention' | 'danger' | 'accent'
export type CardOrientation = 'column' | 'row'

export type CardInteractive = InteractiveAction

export type CardProps = ComponentProps<'div'> & {
  size?: CardSize | LegacyCardSize
  /** Status rail along the card's start edge. Omit for no rail. */
  tone?: CardTone
  /** Canonical selected treatment; consumers manage the state. */
  selected?: boolean
  /** Row places media and content side by side (reference-media cards). */
  orientation?: CardOrientation
  /**
   * Whole-card activation. Emits one absolutely-positioned overlay control
   * (button, or `render` for links) with a real focus ring; content stays
   * visible above it and nested controls keep their own behavior.
   */
  interactive?: CardInteractive
}

function canonicalSize(size: CardProps['size']): CardSize {
  return size === 'default' || size == null ? 'md' : size
}

// Rail colors mirror KanbanCardSignal — the semantic success/attention hues
// are action-primary-background and signal-highlight in this token set.
const toneRailClasses: Record<CardTone, string> = {
  neutral: 'before:bg-bakin-border-subtle',
  success: 'before:bg-bakin-action-primary-background',
  attention: 'before:bg-bakin-signal-highlight',
  danger: 'before:bg-bakin-signal-danger',
  accent: 'before:bg-bakin-signal-accent',
}

/** A bounded object surface; page and section layout belongs to layout primitives. */
export function Card({
  className,
  size = 'md',
  tone,
  selected = false,
  orientation = 'column',
  interactive,
  children,
  ...props
}: CardProps) {
  const resolvedSize = canonicalSize(size)
  const overlay = interactive ? interactiveOverlay(interactive) : null
  return (
    <div
      data-slot="card"
      data-size={resolvedSize}
      data-orientation={orientation === 'row' ? 'row' : undefined}
      data-tone={tone}
      data-selected={selected ? '' : undefined}
      data-interactive={interactive ? '' : undefined}
      className={cn(
        [
          'group/card relative flex min-w-0 flex-col overflow-hidden rounded-bakin-surface border border-bakin-border-subtle',
          'bg-bakin-surface-default font-bakin-typography-family-ui text-[length:var(--bakin-typography-size-body)] text-bakin-text-primary',
          'gap-bakin-4 py-bakin-4 data-[size=sm]:gap-bakin-3 data-[size=sm]:py-bakin-3',
          'has-data-[slot=card-footer]:pb-0! has-[>img:first-child]:pt-0',
          '*:[img:first-child]:rounded-t-bakin-surface *:[img:last-child]:rounded-b-bakin-surface',
          // Full-bleed media: drop the padding facing a leading/trailing CardMedia
          // (the overlay, when present, is the first DOM child — hence the sibling form).
          'has-[>[data-slot=card-media]:first-child]:pt-0 has-[>[data-slot=surface-overlay]+[data-slot=card-media]]:pt-0',
          'has-[>[data-slot=card-media]:last-child]:pb-0',
          // Row orientation: media and content side by side; the content column
          // owns its vertical rhythm (see the RowMedia story for the recipe).
          'data-[orientation=row]:flex-row data-[orientation=row]:items-stretch data-[orientation=row]:gap-0 data-[orientation=row]:py-0',
          // Selected: the one canonical treatment (assets-grid consensus).
          'data-[selected]:border-bakin-action-primary-background data-[selected]:ring-1 data-[selected]:ring-bakin-action-primary-background',
          // Tone rail along the start edge.
          tone
            ? `before:absolute before:inset-y-0 before:start-0 before:w-bakin-1 before:content-[''] ${toneRailClasses[tone]}`
            : '',
          // Interactive: shared overlay contract (see interactive-surface).
          interactiveSurfaceClasses,
        ].join(' '),
        className,
      )}
      {...props}
    >
      {overlay}
      {children}
    </div>
  )
}

/**
 * Full-bleed media region (cover image, tinted logo area, thumbnail collage).
 * As the first or last child it runs edge to edge; in a row card it stretches
 * to the card's height and the consumer sets its width.
 */
export function CardMedia({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-media"
      className={cn(
        'relative min-w-0 shrink-0 overflow-hidden group-data-[orientation=row]/card:self-stretch',
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

export type CardActionReveal = 'always' | 'hover'

export function CardAction({
  className,
  reveal = 'always',
  ...props
}: ComponentProps<'div'> & {
  /**
   * `hover` keeps the action invisible on pointer-hover devices until the
   * card is hovered or the action is focused — the Card mirror of
   * ListRowActions reveal. Touch/mobile always shows it.
   */
  reveal?: CardActionReveal
}) {
  return (
    <div
      data-slot="card-action"
      data-reveal={reveal}
      className={cn(
        'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
        reveal === 'hover' &&
          'md:opacity-0 md:transition-opacity md:focus-within:opacity-100 md:group-hover/card:opacity-100',
        className,
      )}
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

export type CardFooterVariant = 'default' | 'meta'

export function CardFooter({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'div'> & { variant?: CardFooterVariant }) {
  return (
    <div
      data-slot="card-footer"
      data-variant={variant}
      className={cn(
        variant === 'meta'
          ? [
              'mt-auto flex min-w-0 flex-wrap items-center justify-between gap-bakin-3 border-t border-bakin-border-subtle',
              'px-bakin-4 pt-bakin-3 pb-bakin-4 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted',
              'group-data-[size=sm]/card:px-bakin-3 group-data-[size=sm]/card:pb-bakin-3',
            ].join(' ')
          : 'flex min-w-0 items-center border-t border-bakin-border-subtle bg-bakin-canvas-default/35 p-bakin-4 group-data-[size=sm]/card:p-bakin-3',
        className,
      )}
      {...props}
    />
  )
}
