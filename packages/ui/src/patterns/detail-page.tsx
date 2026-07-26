import * as React from 'react'

import { Grid } from '../layout/grid'
import { PageShell, type PageShellProps } from '../layout/page-shell'
import { cn } from '../utils'

export type DetailPageWidth = 'content' | 'wide' | 'full'
export type DetailPageLayout = 'single' | 'aside'

export type DetailPageProps = Omit<PageShellProps, 'children' | 'gap' | 'padding' | 'width'> & {
  children: React.ReactNode
  /** Content suits focused records; wide is routine; full supports media and editor workspaces. */
  width?: DetailPageWidth
}

/** Page canvas for one identifiable record, resource, or configuration object. */
export function DetailPage({ children, width = 'wide', ...props }: DetailPageProps) {
  return (
    <PageShell {...props} data-archetype="detail" width={width}>
      {children}
    </PageShell>
  )
}

export type DetailPageBodyProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'aria-busy' | 'children'
> & {
  /** Marks an in-place refresh while retained detail content remains usable. */
  busy?: boolean
  children?: React.ReactNode
  /** Persistent or inline feedback that remains visible with usable content. */
  feedback?: React.ReactNode
  /** Single-column detail flow or primary content with a responsive context aside. */
  layout?: DetailPageLayout
  /** Initial loading, error, or permission state that replaces only the body. */
  state?: React.ReactNode
}

/** State-aware detail body; the host continues to own the page's main landmark and scroll. */
export function DetailPageBody({
  busy = false,
  children,
  className,
  feedback,
  layout = 'single',
  state,
  ...props
}: DetailPageBodyProps) {
  const hasState = state !== undefined && state !== null

  return (
    <div
      {...props}
      aria-busy={busy || undefined}
      data-content-state={hasState ? 'replaced' : 'ready'}
      data-layout={layout}
      data-slot="detail-page-body"
      className={cn('flex min-w-0 flex-1 flex-col gap-bakin-6', className)}
    >
      {feedback ? <div data-slot="detail-page-feedback">{feedback}</div> : null}
      {hasState ? (
        <div
          data-slot="detail-page-state"
          className="flex min-h-0 min-w-0 flex-1 flex-col [&>[data-slot=system-state]]:flex-1"
        >
          {state}
        </div>
      ) : (
        <div
          data-slot="detail-page-grid"
          data-layout={layout === 'aside' ? 'main-aside' : 'single'}
          className="flex min-h-0 min-w-0 flex-1 flex-col [&>[data-slot=grid-container]]:flex [&>[data-slot=grid-container]]:min-h-0 [&>[data-slot=grid-container]]:flex-1 [&>[data-slot=grid-container]]:flex-col [&>[data-slot=grid-container]>[data-slot=grid]]:min-h-0 [&>[data-slot=grid-container]>[data-slot=grid]]:flex-1"
        >
          <Grid
            layout={layout === 'aside' ? 'main-aside' : 'single'}
            gap="section"
            align={layout === 'aside' ? 'start' : 'stretch'}
          >
            {children}
          </Grid>
        </div>
      )}
    </div>
  )
}

export type DetailPageMainProps = React.ComponentPropsWithoutRef<'div'>

/** Primary detail flow. Compose semantic sections inside this wrapper. */
export function DetailPageMain({ className, ...props }: DetailPageMainProps) {
  return (
    <div
      {...props}
      data-slot="detail-page-main"
      className={cn('flex min-w-0 flex-1 flex-col gap-bakin-6', className)}
    />
  )
}

type AccessibleAsideName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }

type NativeAsideProps = Omit<
  React.ComponentPropsWithoutRef<'aside'>,
  'aria-label' | 'aria-labelledby'
>

export type DetailPageAsideProps = NativeAsideProps & AccessibleAsideName

/** Named supporting context that reflows below the primary detail content. */
export function DetailPageAside({
  className,
  label,
  labelledBy,
  ...props
}: DetailPageAsideProps) {
  return (
    <aside
      {...props}
      aria-label={label}
      aria-labelledby={labelledBy}
      data-slot="detail-page-aside"
      className={cn(
        'flex min-w-0 flex-col gap-bakin-4 border-t border-bakin-border-subtle pt-bakin-6 @3xl/layout-grid:border-l @3xl/layout-grid:border-t-0 @3xl/layout-grid:pl-bakin-6 @3xl/layout-grid:pt-bakin-0',
        className,
      )}
    />
  )
}
