import * as React from 'react'

import { cn } from '../utils'

export type PageComposerProps = React.ComponentPropsWithoutRef<'div'>

/** Stable, borderless composer boundary outside the timeline scroller. */
export function PageComposer({ className, ...props }: PageComposerProps) {
  return (
    <div
      data-slot="page-composer"
      {...props}
      className={cn('min-w-0 shrink-0 pt-bakin-4', className)}
    />
  )
}
