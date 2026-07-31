import * as React from 'react'

import { BoundedOverflow, type BoundedOverflowProps } from '../layout/bounded-overflow'
import { cn } from '../utils'

export type PageCanvasOrientation = 'vertical' | 'horizontal'

type DistributiveOmit<Value, Keys extends PropertyKey> = Value extends unknown
  ? Omit<Value, Keys>
  : never

export type PageCanvasProps = DistributiveOmit<BoundedOverflowProps, 'children'> & {
  children: React.ReactNode
  /** Mirrors the consumer's graph layout; vertical is the product default. */
  orientation?: PageCanvasOrientation
}

/** Named bounded region around a consumer-owned graph, board, or action canvas. */
export function PageCanvas({
  children,
  className,
  orientation = 'vertical',
  ...props
}: PageCanvasProps) {
  return (
    <BoundedOverflow
      {...(props as BoundedOverflowProps)}
      data-orientation={orientation}
      data-page-canvas=""
      className={cn(
        'grid min-h-0 min-w-0 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-canvas-default',
        className,
      )}
    >
      {children}
    </BoundedOverflow>
  )
}
