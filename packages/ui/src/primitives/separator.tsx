import type { ComponentProps } from 'react'

import { cn } from '../utils'

export type SeparatorProps = Omit<ComponentProps<'div'>, 'role'> & {
  /** Visual-only by default. Set false when the boundary is meaningful content structure. */
  decorative?: boolean
  orientation?: 'horizontal' | 'vertical'
}

export function Separator({
  className,
  decorative = true,
  orientation = 'horizontal',
  ...props
}: SeparatorProps) {
  return (
    <div
      data-slot="separator"
      data-decorative={decorative ? '' : undefined}
      data-orientation={orientation}
      aria-hidden={decorative || undefined}
      aria-orientation={decorative ? undefined : orientation}
      role={decorative ? 'presentation' : 'separator'}
      className={cn(
        'shrink-0 bg-bakin-border-subtle data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch',
        className,
      )}
      {...props}
    />
  )
}
