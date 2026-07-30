import * as React from 'react'

import { cn } from '../utils'

export type PageComposerProps = React.ComponentPropsWithoutRef<'div'>

/**
 * Stable, borderless composer boundary outside the timeline scroller.
 * Renamed from ConversationPageComposer; the legacy export wraps this
 * component and overrides `data-slot` (placed before the spread for exactly
 * that reason) until the migration slice removes it.
 */
export function PageComposer({ className, ...props }: PageComposerProps) {
  return (
    <div
      data-slot="page-composer"
      {...props}
      className={cn('min-w-0 shrink-0 pt-bakin-4', className)}
    />
  )
}
