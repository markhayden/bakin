import * as React from 'react'

import { PageShell, type PageShellProps } from '../layout/page-shell'
import { cn } from '../utils'

export type DashboardPageWidth = 'wide' | 'full'

export type DashboardPageProps = Omit<PageShellProps, 'children' | 'gap' | 'padding' | 'width'> & {
  children: React.ReactNode
  /** Wide suits routine overviews; full is reserved for evidence-backed operational breadth. */
  width?: DashboardPageWidth
}

/** Page canvas for prioritized operational summaries and diagnostic overviews. */
export function DashboardPage({ children, width = 'wide', ...props }: DashboardPageProps) {
  return (
    <PageShell {...props} data-archetype="dashboard" width={width}>
      {children}
    </PageShell>
  )
}

type AccessibleRegionName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }

type NativeContentProps = Omit<
  React.ComponentPropsWithoutRef<'section'>,
  'aria-busy' | 'aria-label' | 'aria-labelledby' | 'children'
>

export type DashboardPageContentProps = NativeContentProps & AccessibleRegionName & {
  /** Marks a refresh while the last usable overview remains available. */
  busy?: boolean
  children?: React.ReactNode
  /** Persistent degraded or stale-data context retained with usable dashboard sections. */
  feedback?: React.ReactNode
  /** Initial loading, error, or permission state that replaces the overview. */
  state?: React.ReactNode
}

/** Named overview canvas; compose priority with Section and Grid rather than equal card walls. */
export function DashboardPageContent({
  busy = false,
  children,
  className,
  feedback,
  label,
  labelledBy,
  state,
  ...props
}: DashboardPageContentProps) {
  const hasState = state !== undefined && state !== null

  return (
    <section
      {...props}
      aria-busy={busy || undefined}
      aria-label={label}
      aria-labelledby={labelledBy}
      data-content-state={hasState ? 'replaced' : 'ready'}
      data-slot="dashboard-page-content"
      className={cn('flex min-w-0 flex-col gap-bakin-8', className)}
    >
      {feedback ? <div data-slot="dashboard-page-feedback">{feedback}</div> : null}
      {hasState ? <div data-slot="dashboard-page-state">{state}</div> : children}
    </section>
  )
}
