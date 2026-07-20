import * as React from 'react'

import { PageShell, type PageShellProps } from '../layout/page-shell'
import { cn } from '../utils'

export type ListPageWidth = 'wide' | 'full'

export type ListPageProps = Omit<PageShellProps, 'children' | 'gap' | 'padding' | 'width'> & {
  children: React.ReactNode
  /** Wide is the routine index canvas; full is reserved for intrinsically wide domain content. */
  width?: ListPageWidth
}

/** Page canvas for searchable, filterable, or repeated-object indexes. */
export function ListPage({ children, width = 'wide', ...props }: ListPageProps) {
  return (
    <PageShell {...props} data-archetype="list" width={width}>
      {children}
    </PageShell>
  )
}

type AccessibleRegionName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }

type NativeControlsProps = Omit<
  React.ComponentPropsWithoutRef<'section'>,
  'aria-label' | 'aria-labelledby' | 'children'
>

export type ListPageControlsProps = NativeControlsProps & AccessibleRegionName & {
  /** Search, filters, view controls, and sorting supplied by the consumer. */
  children: React.ReactNode
  /** Optional peer actions such as clearing every active filter. */
  actions?: React.ReactNode
}

/** Named, wrapping control region. URL state remains owned by the consuming page. */
export function ListPageControls({
  actions,
  children,
  className,
  label,
  labelledBy,
  ...props
}: ListPageControlsProps) {
  return (
    <section
      {...props}
      aria-label={label}
      aria-labelledby={labelledBy}
      data-slot="list-page-controls"
      className={cn(
        '@container/list-page-controls flex min-w-0 flex-col items-stretch gap-bakin-3 border-t border-bakin-border-subtle pt-bakin-4 @lg/list-page-controls:flex-row @lg/list-page-controls:items-center',
        className,
      )}
    >
      <div
        data-slot="list-page-control-set"
        className="flex min-w-0 flex-1 flex-wrap items-center gap-bakin-3"
      >
        {children}
      </div>
      {actions ? (
        <div
          data-slot="list-page-control-actions"
          className="flex min-w-0 flex-wrap items-center gap-bakin-2 @lg/list-page-controls:ml-auto"
        >
          {actions}
        </div>
      ) : null}
    </section>
  )
}

type NativeContentProps = Omit<
  React.ComponentPropsWithoutRef<'section'>,
  'aria-busy' | 'aria-label' | 'aria-labelledby' | 'children'
>

export type ListPageContentProps = NativeContentProps & AccessibleRegionName & {
  /** Marks a refresh while retained content remains usable. */
  busy?: boolean
  children?: React.ReactNode
  /** Persistent or inline feedback that remains visible with usable content. */
  feedback?: React.ReactNode
  /** Initial loading, empty, error, or permission state that replaces only this region. */
  state?: React.ReactNode
}

/** Named result region with explicit replacement-state and retained-feedback slots. */
export function ListPageContent({
  busy = false,
  children,
  className,
  feedback,
  label,
  labelledBy,
  state,
  ...props
}: ListPageContentProps) {
  const hasState = state !== undefined && state !== null

  return (
    <section
      {...props}
      aria-busy={busy || undefined}
      aria-label={label}
      aria-labelledby={labelledBy}
      data-content-state={hasState ? 'replaced' : 'ready'}
      data-slot="list-page-content"
      className={cn('flex min-w-0 flex-col gap-bakin-6', className)}
    >
      {feedback ? <div data-slot="list-page-feedback">{feedback}</div> : null}
      {hasState ? <div data-slot="list-page-state">{state}</div> : children}
    </section>
  )
}
