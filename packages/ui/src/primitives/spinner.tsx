import * as React from 'react'

import { cn } from '../utils'

export type SpinnerSize = 'sm' | 'md'

export interface SpinnerProps extends Omit<React.ComponentPropsWithoutRef<'svg'>, 'children'> {
  size?: SpinnerSize
  /**
   * What is loading. Supplied, the spinner announces itself as a live status;
   * omitted, it is decorative and hidden from assistive tech.
   *
   * There is no silent-and-unhidden third state on purpose: a busy indicator
   * that assistive tech can see but cannot describe is the worst of both.
   */
  label?: string
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: 'size-bakin-3',
  md: 'size-bakin-4',
}

/**
 * The indeterminate busy indicator.
 *
 * Exists because the fleet hand-rolled `<Loader2 className="animate-spin" />`
 * twenty-one times in six different spellings, and the copies were wrong in two
 * ways that a primitive fixes once: only one of them carried an accessible
 * name, and only three honoured `prefers-reduced-motion`. Both are guaranteed
 * here.
 *
 * Use `Skeleton` instead when the shape of the pending content is known —
 * a spinner says "wait", a skeleton says "this is what is coming".
 *
 * Drawn inline rather than pulled from an icon set: this is the only place the
 * kit would otherwise need `lucide-react`, and the kit stays free of an icon
 * dependency. The arc is `currentColor`, so callers tint it with a text colour
 * exactly as they did the icon it replaces.
 */
export function Spinner({ className, label, size = 'md', ...props }: SpinnerProps) {
  return (
    <svg
      {...props}
      data-slot="spinner"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className={cn(
        'shrink-0 animate-spin motion-reduce:animate-none',
        sizeClasses[size],
        className,
      )}
    >
      {/* A three-quarter arc: the gap is what makes rotation legible. */}
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}
