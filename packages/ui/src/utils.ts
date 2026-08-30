import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Merge internal styles without dropping Base UI's state-aware class callback. */
export function mergeClassName<State>(
  base: string,
  className?: string | ((state: State) => string | undefined),
): string | ((state: State) => string) {
  if (typeof className === 'function') return (state) => cn(base, className(state))
  return cn(base, className)
}

/**
 * Canonical focus-visible ring recipe. The kit audit found three hand-typed
 * spellings of the ring offset: `focus-visible:outline-offset-2` (this outset
 * recipe), `focus-visible:-outline-offset-2` (the inset recipe below), and the
 * arbitrary-value `focus-visible:outline-offset-[-2px]` (resize handles and
 * tabs, left as written). Compose these constants instead of retyping the ring.
 */
export const focusRing = 'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring'

/** Inset variant for edge-to-edge cells where an outset ring would be clipped. */
export const focusRingInset = 'outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-bakin-focus-ring'
