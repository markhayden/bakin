import * as React from 'react'

import { cn } from '../utils'

export type PageComposerPadding = 'default' | 'flush'

export type PageComposerProps = React.ComponentPropsWithoutRef<'div'> & {
  /** `flush` removes the top inset when the scroller above owns the spacing. */
  padding?: PageComposerPadding
}

/** Stable, borderless composer boundary outside the timeline scroller. */
export function PageComposer({ className, padding = 'default', ...props }: PageComposerProps) {
  return (
    <div
      data-slot="page-composer"
      data-padding={padding}
      {...props}
      className={cn('min-w-0 shrink-0', padding === 'default' && 'pt-bakin-4', className)}
    />
  )
}
