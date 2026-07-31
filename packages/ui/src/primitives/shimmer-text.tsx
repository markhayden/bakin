import type { ComponentPropsWithoutRef } from 'react'

import { cn } from '../utils'

export type ShimmerTextHighlight = 'ink' | 'accent'

export interface ShimmerTextProps extends ComponentPropsWithoutRef<'span'> {
  /** `false` renders a plain span with the same markup so toggling is stable. */
  active?: boolean
  /** Bright-band token: `ink` (text-primary) or `accent` (brand accent). */
  highlight?: ShimmerTextHighlight
}

/*
 * Left-to-right luminance sweep: the text paints a 300%-wide gradient
 * (muted base, bright band at 32%→50%→68%) through background-clip:text and
 * the kit's `shimmer-sweep` keyframe animates background-position. Reduced
 * motion drops the animation and the static `background-position: 50%` pins
 * the band mid-sweep, leaving the label slightly brighter than body copy —
 * the same distinction without motion.
 */
const sweepClasses = [
  'animate-shimmer-sweep motion-reduce:animate-none',
  'bg-clip-text text-transparent',
  '[background-image:linear-gradient(90deg,var(--bakin-color-text-muted)_32%,var(--shimmer-text-band)_50%,var(--bakin-color-text-muted)_68%)]',
  '[background-position:50%_50%] [background-size:300%_100%]',
  'data-[highlight=ink]:[--shimmer-text-band:var(--bakin-color-text-primary)]',
  'data-[highlight=accent]:[--shimmer-text-band:var(--bakin-color-signal-accent)]',
].join(' ')

/** Text-motion pattern for genuinely in-progress labels; adds no semantics. */
export function ShimmerText({
  active = true,
  highlight = 'ink',
  className,
  ...props
}: ShimmerTextProps) {
  return (
    <span
      data-slot="shimmer-text"
      data-active={active}
      data-highlight={highlight}
      className={active ? cn(sweepClasses, className) : className}
      {...props}
    />
  )
}
