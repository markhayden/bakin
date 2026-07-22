import * as React from 'react'

import { cn } from '../utils'

export type BakinDrawerSectionHeadingLevel = 2 | 3 | 4

export interface BakinDrawerSectionProps extends Omit<React.ComponentPropsWithoutRef<'section'>, 'title'> {
  title: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
  contentClassName?: string
  headingLevel?: BakinDrawerSectionHeadingLevel
}

/** Canonical drawer hierarchy: aligned section title with a slightly inset content body. */
export function BakinDrawerSection({
  actions,
  children,
  className,
  contentClassName,
  headingLevel = 3,
  title,
  ...props
}: BakinDrawerSectionProps) {
  const headingId = React.useId()
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'

  return (
    <section
      {...props}
      aria-labelledby={headingId}
      data-slot="bakin-drawer-section"
      className={cn('flex min-w-0 flex-col gap-bakin-2', className)}
    >
      <div className="flex min-w-0 items-center gap-bakin-2">
        <Heading
          id={headingId}
          className="m-0 min-w-0 flex-1 text-[length:var(--bakin-typography-size-meta)] font-bakin-typography-weight-semibold uppercase tracking-[.12em] text-bakin-text-muted"
        >
          {title}
        </Heading>
        {actions ? <div className="flex shrink-0 items-center gap-bakin-1">{actions}</div> : null}
      </div>
      <div
        data-slot="bakin-drawer-section-content"
        className={cn('min-w-0 px-bakin-2', contentClassName)}
      >
        {children}
      </div>
    </section>
  )
}
