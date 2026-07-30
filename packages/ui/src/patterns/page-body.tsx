import * as React from 'react'

import { Grid } from '../layout/grid'
import { cn } from '../utils'

export type PageBodyLayout = 'single' | 'aside'
export type PageBodyGap = 'content' | 'section' | 'page'

type AccessibleRegionName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }
  | { label?: never; labelledBy?: never }

type NativeBodyProps = Omit<
  React.ComponentPropsWithoutRef<'section'>,
  'aria-busy' | 'aria-label' | 'aria-labelledby' | 'children'
>

export type PageBodyProps = NativeBodyProps & AccessibleRegionName & {
  /** Marks a refresh while retained content remains usable. */
  busy?: boolean
  children?: React.ReactNode
  /** Persistent or inline feedback that remains visible with usable content. */
  feedback?: React.ReactNode
  /**
   * Section (bakin-6) is the archetype default; content (bakin-4) matches the
   * denser conversation/workflow rhythm; page (bakin-8) is the roomy overview
   * rhythm dashboards used.
   */
  gap?: PageBodyGap
  /** Single-column flow or primary content with a responsive trailing rail. */
  layout?: PageBodyLayout
  /** Initial loading, empty, error, or permission state that replaces only this region. */
  state?: React.ReactNode
}

const gapClasses: Record<PageBodyGap, string> = {
  content: 'gap-bakin-4',
  section: 'gap-bakin-6',
  page: 'gap-bakin-8',
}

/**
 * THE page content slot: one busy/feedback/replacement-state contract for
 * every Page. A supplied `state` replaces only this region — page identity and
 * navigation stay mounted — while `feedback` is always retained with usable
 * content.
 *
 * `layout="aside"` is the one primary-column+rail composition. It reuses the
 * layout kit's `main-aside` Grid recipe — `@3xl` container breakpoint with a
 * `minmax(0,1.6fr) / minmax(16rem,.8fr)` split — chosen over the two other
 * shipped rails it replaces: SettingsPageBody's navigation split is a
 * leading-nav layout (not a trailing rail) and WorkflowPageBody's `@4xl`
 * inspector breakpoint only existed to protect graph canvases, which now opt
 * into density/contained handling on Page instead. `@3xl` at a 2:1 ratio with
 * a 16rem rail floor is the split every detail page already ships, and it
 * keeps PageAside's `@3xl/layout-grid` reflow behavior byte-identical.
 */
export function PageBody({
  busy = false,
  children,
  className,
  feedback,
  gap = 'section',
  label,
  labelledBy,
  layout = 'single',
  state,
  ...props
}: PageBodyProps) {
  const hasState = state !== undefined && state !== null

  return (
    <section
      {...props}
      aria-busy={busy || undefined}
      aria-label={label}
      aria-labelledby={labelledBy}
      data-content-state={hasState ? 'replaced' : 'ready'}
      data-gap={gap}
      data-layout={layout}
      data-slot="page-body"
      className={cn('flex min-h-0 min-w-0 flex-1 flex-col', gapClasses[gap], className)}
    >
      {feedback ? <div data-slot="page-body-feedback">{feedback}</div> : null}
      {hasState ? (
        <div
          data-slot="page-body-state"
          className="flex min-h-0 min-w-0 flex-1 flex-col [&>[data-slot=system-state]]:flex-1"
        >
          {state}
        </div>
      ) : layout === 'aside' ? (
        <div
          data-slot="page-body-grid"
          data-layout="main-aside"
          className="flex min-h-0 min-w-0 flex-1 flex-col [&>[data-slot=grid-container]]:flex [&>[data-slot=grid-container]]:min-h-0 [&>[data-slot=grid-container]]:flex-1 [&>[data-slot=grid-container]]:flex-col [&>[data-slot=grid-container]>[data-slot=grid]]:min-h-0 [&>[data-slot=grid-container]>[data-slot=grid]]:flex-1"
        >
          <Grid layout="main-aside" gap="section" align="start">
            {children}
          </Grid>
        </div>
      ) : children}
    </section>
  )
}
