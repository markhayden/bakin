import type { ComponentProps } from 'react'

import { cn } from '../utils'

export type SkeletonShape = 'rectangle' | 'text' | 'circle'
export type SkeletonProps = ComponentProps<'div'> & { shape?: SkeletonShape }

export function Skeleton({
  'aria-hidden': ariaHidden = true,
  className,
  shape = 'rectangle',
  ...props
}: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      data-shape={shape}
      aria-hidden={ariaHidden}
      className={cn(
        [
          'block animate-pulse bg-bakin-border-subtle/35 motion-reduce:animate-none',
          'data-[shape=rectangle]:rounded-bakin-control data-[shape=text]:h-bakin-3 data-[shape=text]:rounded-bakin-pill',
          'data-[shape=circle]:aspect-square data-[shape=circle]:rounded-bakin-pill',
        ].join(' '),
        className,
      )}
      {...props}
    />
  )
}
