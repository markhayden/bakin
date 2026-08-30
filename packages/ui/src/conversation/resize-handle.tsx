'use client'

import type { PersistedResizeHandleProps } from '../behaviors/use-persisted-leading-edge-resize'
import { cn } from '../utils'

/** Props for the shared grab-bar chrome over `usePersistedLeadingEdgeResize`. */
export interface ResizeHandleProps {
  /** Direction of the grab bar itself: `horizontal` resizes height, `vertical` resizes width. */
  orientation: 'horizontal' | 'vertical'
  handleProps: PersistedResizeHandleProps
  /** Accessible name for the separator, e.g. "Resize message input". */
  label: string
  /** Site-owned layout, positioning, and cursor classes. */
  className?: string
}

/** One resize grab bar; every consumer keeps its own positioning and cursor rules. */
export function ResizeHandle({ orientation, handleProps, label, className }: ResizeHandleProps) {
  return (
    <div
      {...handleProps}
      aria-label={label}
      className={cn(
        'group/handle touch-none items-center justify-center outline-none',
        'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[-2px] focus-visible:outline-bakin-focus-ring',
        className,
      )}
    >
      <span
        className={cn(
          orientation === 'horizontal' ? 'h-px w-bakin-8' : 'h-bakin-8 w-px',
          'rounded-bakin-pill bg-bakin-border-subtle opacity-0 transition-opacity group-hover/handle:opacity-100 group-focus-visible/handle:opacity-100',
        )}
      />
    </div>
  )
}
