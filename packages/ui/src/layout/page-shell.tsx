import * as React from 'react'

import { layoutClassName } from './utils'

export type PageShellWidth = 'content' | 'wide' | 'full'
export type PageShellPadding = 'default' | 'compact' | 'none'
export type PageShellGap = 'none' | 'content' | 'section' | 'page'

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
  default: 'px-bakin-4 pt-bakin-4 pb-bakin-8 @md/page-shell:px-bakin-6 @md/page-shell:pt-bakin-6 @xl/page-shell:px-bakin-8 @xl/page-shell:pt-bakin-8 @xl/page-shell:pb-[calc(var(--bakin-layout-space-8)*2)]',
  compact: 'px-bakin-3 pt-bakin-3 pb-bakin-8 @md/page-shell:px-bakin-4 @md/page-shell:pt-bakin-4 @xl/page-shell:px-bakin-6 @xl/page-shell:pt-bakin-6 @xl/page-shell:pb-[calc(var(--bakin-layout-space-8)*2)]',
  none: '',
}

const gapClasses: Record<PageShellGap, string> = {
  none: 'gap-bakin-0',
  content: 'gap-bakin-4',
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
      className={layoutClassName('@container/page-shell flex min-h-full w-full min-w-0 flex-1 flex-col', className)}
    >
      <div
        data-slot="page-shell-content"
        className={layoutClassName(
          'mx-auto flex min-h-full w-full min-w-0 shrink-0 flex-col',
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
