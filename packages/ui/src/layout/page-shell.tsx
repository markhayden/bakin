import * as React from 'react'

import { layoutClassName } from './utils'

export type PageShellWidth = 'content' | 'wide' | 'full'
export type PageShellPadding = 'default' | 'compact' | 'none'
export type PageShellGap = 'none' | 'section' | 'page'

export interface PageShellProps extends React.ComponentPropsWithoutRef<'div'> {
  gap?: PageShellGap
  padding?: PageShellPadding
  width?: PageShellWidth
}

const widthClasses: Record<PageShellWidth, string> = {
  content: 'max-w-3xl',
  wide: 'max-w-7xl',
  full: 'max-w-none',
}

const paddingClasses: Record<PageShellPadding, string> = {
  default: 'p-bakin-4 @md/page-shell:p-bakin-6 @xl/page-shell:p-bakin-8',
  compact: 'p-bakin-3 @md/page-shell:p-bakin-4 @xl/page-shell:p-bakin-6',
  none: '',
}

const gapClasses: Record<PageShellGap, string> = {
  none: 'gap-bakin-0',
  section: 'gap-bakin-6',
  page: 'gap-bakin-8',
}

/** Responsive page canvas for content rendered inside Bakin's owning main landmark. */
export function PageShell({
  children,
  className,
  gap = 'page',
  padding = 'default',
  width = 'wide',
  ...props
}: PageShellProps) {
  return (
    <div
      {...props}
      data-slot="page-shell"
      data-gap={gap}
      data-padding={padding}
      data-width={width}
      className={layoutClassName('@container/page-shell flex min-h-full w-full min-w-0 flex-1', className)}
    >
      <div
        data-slot="page-shell-content"
        className={layoutClassName(
          'mx-auto flex min-h-full w-full min-w-0 flex-1 flex-col',
          widthClasses[width],
          paddingClasses[padding],
          gapClasses[gap],
        )}
      >
        {children}
      </div>
    </div>
  )
}
