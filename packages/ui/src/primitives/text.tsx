import * as React from 'react'

import { cn } from '../utils'

export type TextSize = 'body' | 'meta'
export type TextTone = 'default' | 'muted'
export type TextWeight = 'regular' | 'medium' | 'semibold'

export interface TextOwnProps {
  /** `meta` is the small supporting size; `body` is the reading size. */
  size?: TextSize
  /** `muted` de-emphasises by COLOR — never by opacity, which fails contrast. */
  tone?: TextTone
  weight?: TextWeight
  /** Tabular identifiers: ids, hashes, paths, model names. */
  mono?: boolean
  /** Render as a different element — `p`, `span`, `div`, `dd`, … */
  as?: React.ElementType
}

export type TextProps = TextOwnProps & Omit<React.HTMLAttributes<HTMLElement>, 'color'>

/**
 * Written as arbitrary-length rather than `text-bakin-typography-size-*`
 * because BOTH the size and the tone are `text-*` utilities: tailwind-merge
 * treats them as one group and silently drops whichever comes first, so the
 * shorthand form loses its size the moment a colour is applied. The
 * `[length:…]` form lands in the font-size group, survives the merge, and
 * still lets a caller override size and colour independently.
 *
 * This is a KIT-internal escape hatch — plugin files must keep using the
 * `text-bakin-typography-size-*` shorthand, which is why `Text` exists.
 */
const sizeClasses: Record<TextSize, string> = {
  body: 'text-[length:var(--bakin-typography-size-body)]',
  meta: 'text-[length:var(--bakin-typography-size-meta)]',
}

const toneClasses: Record<TextTone, string> = {
  default: 'text-bakin-text-primary',
  muted: 'text-bakin-text-muted',
}

const weightClasses: Record<TextWeight, string> = {
  regular: 'font-bakin-typography-weight-regular',
  medium: 'font-bakin-typography-weight-medium',
  semibold: 'font-bakin-typography-weight-semibold',
}

/**
 * Supporting copy at a system size and tone.
 *
 * This exists because the same three-class recipe
 * (`text-…-size-meta` + `text-…-text-muted`, sometimes + mono) was hand-written
 * ~126 times across the fleet, which is how drift starts. Reach for `Text`
 * whenever the words are supporting rather than structural; headings stay real
 * heading elements, which `globals.css` already styles.
 *
 * `as="p"` resets the browser margin, so callers no longer pair every paragraph
 * with `m-0`.
 */
export function Text({
  size = 'body',
  tone = 'default',
  weight = 'regular',
  mono = false,
  as,
  className,
  ...props
}: TextProps) {
  const Component = (as ?? 'span') as React.ElementType
  return (
    <Component
      {...props}
      data-slot="text"
      data-size={size}
      data-tone={tone}
      className={cn(
        sizeClasses[size],
        toneClasses[tone],
        weightClasses[weight],
        mono && 'font-bakin-typography-family-mono',
        // Paragraphs and description lists carry a UA margin the layout owns.
        (Component === 'p' || Component === 'dd' || Component === 'dl') && 'm-0',
        className,
      )}
    />
  )
}

export interface OverlineProps extends Omit<React.HTMLAttributes<HTMLElement>, 'color'> {
  /** Render as a different element — defaults to `span`. */
  as?: React.ElementType
}

/**
 * The small uppercase label that titles a group of fields or a card region.
 *
 * One canonical treatment on purpose: the audit found this same intent written
 * 14 different ways (three weights, three tracking steps, an arbitrary
 * `tracking-[0.12em]`, and one opacity fade that failed contrast). An overline
 * is a label, not a heading — when the group needs to appear in the document
 * outline, use a real heading instead.
 */
export function Overline({ as, className, ...props }: OverlineProps) {
  const Component = (as ?? 'span') as React.ElementType
  return (
    <Component
      {...props}
      data-slot="overline"
      className={cn(
        // Same merge hazard as Text: the size must be arbitrary-length or the
        // trailing colour utility drops it.
        'text-[length:var(--bakin-typography-size-meta)]',
        'font-bakin-typography-weight-semibold uppercase tracking-wider text-bakin-text-muted',
        (Component === 'p' || Component === 'dt') && 'm-0',
        className,
      )}
    />
  )
}
