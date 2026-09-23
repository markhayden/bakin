'use client'

import type { PersistedResizeHandleProps } from './use-persisted-leading-edge-resize'
import { cn } from '../utils'

/** Props for the shared grab-bar chrome over `usePersistedLeadingEdgeResize`. */
export interface ResizeHandleProps {
  /** Direction of the grab bar itself: `horizontal` resizes height, `vertical` resizes width. */
  orientation: 'horizontal' | 'vertical'
  handleProps: PersistedResizeHandleProps
  /** Accessible name for the separator, e.g. "Resize message input". */
  label: string
  /** Keep a quiet grab bar visible for panel and drawer boundaries. */
  visibleAtRest?: boolean
  /** Site-owned layout, positioning, and cursor classes. */
  className?: string
}

/** One resize grab bar; every consumer keeps its own positioning and cursor rules. */
export function ResizeHandle({ orientation, handleProps, label, visibleAtRest = false, className }: ResizeHandleProps) {
  return (
    <div
      {...handleProps}
      aria-label={label}
      className={cn(
        'group/handle touch-none items-center justify-center outline-none',
        'transition-colors hover:bg-bakin-signal-accent/50 focus-visible:bg-bakin-signal-accent/50 active:bg-bakin-signal-accent data-[resizing=true]:bg-bakin-signal-accent motion-reduce:transition-none',
        'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[-2px] focus-visible:outline-bakin-focus-ring',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          orientation === 'horizontal' ? 'h-px w-bakin-8' : 'h-bakin-8 w-px',
          'rounded-bakin-pill bg-bakin-border-subtle transition-[background-color,opacity] motion-reduce:transition-none',
          'group-hover/handle:bg-bakin-signal-accent group-focus-visible/handle:bg-bakin-signal-accent group-data-[resizing=true]/handle:bg-bakin-signal-accent',
          'group-hover/handle:opacity-100 group-focus-visible/handle:opacity-100 group-data-[resizing=true]/handle:opacity-100',
          visibleAtRest ? 'opacity-60' : 'opacity-0',
        )}
      />
    </div>
  )
}
