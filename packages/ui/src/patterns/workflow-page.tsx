import * as React from 'react'

import { PageShell, type PageShellProps } from '../layout/page-shell'
import { cn } from '../utils'
import { PageCanvas, type PageCanvasOrientation, type PageCanvasProps } from './page-canvas'

export type WorkflowPageWidth = 'wide' | 'full'
export type WorkflowPageLayout = 'canvas' | 'inspector'
export type WorkflowPageMode = 'document' | 'contained'
export type WorkflowOrientation = PageCanvasOrientation

export type WorkflowPageProps = Omit<
  PageShellProps,
  'children' | 'gap' | 'padding' | 'width'
> & {
  children: React.ReactNode
  width?: WorkflowPageWidth
}

/** Wide page canvas for workflow graphs, boards, and action workspaces. */
export function WorkflowPage({ children, width = 'full', ...props }: WorkflowPageProps) {
  return (
    <PageShell
      {...props}
      data-archetype="workflow"
      gap="content"
      padding="compact"
      width={width}
    >
      {children}
    </PageShell>
  )
}

export type WorkflowPageBodyProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'aria-busy' | 'children'
> & {
  busy?: boolean
  children?: React.ReactNode
  feedback?: React.ReactNode
  layout?: WorkflowPageLayout
  /** Document uses host page scroll; contained is for an explicitly bounded workbench. */
  mode?: WorkflowPageMode
  state?: React.ReactNode
}

/** State-aware workflow body with optional responsive canvas/inspector composition. */
export function WorkflowPageBody({
  busy = false,
  children,
  className,
  feedback,
  layout = 'canvas',
  mode = 'document',
  state,
  ...props
}: WorkflowPageBodyProps) {
  const hasState = state !== undefined && state !== null

  return (
    <div
      {...props}
      aria-busy={busy || undefined}
      data-content-state={hasState ? 'replaced' : 'ready'}
      data-layout={layout}
      data-mode={mode}
      data-slot="workflow-page-body"
      className={cn(
        'flex min-w-0 flex-col gap-bakin-4',
        mode === 'contained' && 'min-h-0 flex-1 overflow-hidden',
        className,
      )}
    >
      {feedback ? <div data-slot="workflow-page-feedback">{feedback}</div> : null}
      {hasState ? (
        <div data-slot="workflow-page-state">{state}</div>
      ) : (
        <div
          data-slot="workflow-page-container"
          className={cn(
            '@container/workflow-page min-w-0',
            mode === 'contained' && 'flex min-h-0 flex-1',
          )}
        >
          <div
            data-layout={layout}
            data-slot="workflow-page-grid"
            className={cn(
              'grid min-w-0 gap-bakin-4',
              mode === 'document' ? 'items-start' : 'h-full min-h-0 flex-1 items-stretch',
              '[&>[data-slot=workflow-page-actions]]:col-span-full [&>[data-slot=workflow-page-toolbar]]:col-span-full',
              layout === 'inspector'
                && '@4xl/workflow-page:grid-cols-[minmax(0,1.72fr)_minmax(18rem,.72fr)]',
            )}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

type AccessibleRegionName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }

type NativeToolbarProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'aria-label' | 'aria-labelledby' | 'role'
>

export type WorkflowPageToolbarProps = NativeToolbarProps & AccessibleRegionName

/** Named graph tools; domain commands and orientation state remain consumer-owned. */
export function WorkflowPageToolbar({
  className,
  label,
  labelledBy,
  ...props
}: WorkflowPageToolbarProps) {
  return (
    <div
      {...props}
      role="toolbar"
      aria-label={label}
      aria-labelledby={labelledBy}
      data-slot="workflow-page-toolbar"
      className={cn(
        'flex min-w-0 flex-wrap items-center justify-between gap-bakin-3 border-b border-bakin-border-subtle pb-bakin-4',
        className,
      )}
    />
  )
}

export type WorkflowPageCanvasProps = PageCanvasProps

/**
 * Named bounded region around a consumer-owned graph, board, or action canvas.
 * Legacy alias for PageCanvas; deleted with the archetype migration slice.
 */
export function WorkflowPageCanvas(props: WorkflowPageCanvasProps) {
  return <PageCanvas data-workflow-canvas="" {...props} />
}

type NativeActionsProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'aria-label' | 'aria-labelledby' | 'role'
>

export type WorkflowPageActionsProps = NativeActionsProps & AccessibleRegionName

/** Stable page-level commit and recovery actions outside the canvas interaction model. */
export function WorkflowPageActions({
  className,
  label,
  labelledBy,
  ...props
}: WorkflowPageActionsProps) {
  return (
    <div
      {...props}
      role="group"
      aria-label={label}
      aria-labelledby={labelledBy}
      data-slot="workflow-page-actions"
      className={cn(
        'flex min-w-0 flex-wrap items-center justify-end gap-bakin-2 border-t border-bakin-border-subtle pt-bakin-4',
        className,
      )}
    />
  )
}
