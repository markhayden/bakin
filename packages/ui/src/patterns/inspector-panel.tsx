import * as React from 'react'
import { cn } from '../utils'

type AccessibleRegionName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }

type NativePanelProps = Omit<
  React.ComponentPropsWithoutRef<'section'>,
  'aria-label' | 'aria-labelledby'
>

export type InspectorPanelProps = NativePanelProps & AccessibleRegionName

/** Named contextual inspector usable beside a canvas or inside the supported drawer. */
export function InspectorPanel({ className, label, labelledBy, ...props }: InspectorPanelProps) {
  return (
    <section
      {...props}
      aria-label={label}
      aria-labelledby={labelledBy}
      data-slot="inspector-panel"
      className={cn(
        'flex min-h-0 min-w-0 flex-col gap-bakin-5 font-bakin-typography-family-ui text-bakin-text-primary',
        className,
      )}
    />
  )
}

type NativeHeaderProps = Omit<React.ComponentPropsWithoutRef<'header'>, 'children' | 'title'>
export interface InspectorPanelHeaderProps extends NativeHeaderProps {
  actions?: React.ReactNode
  actionsLabel?: string
  description?: React.ReactNode
  eyebrow?: React.ReactNode
  title: React.ReactNode
}

export function InspectorPanelHeader({
  actions,
  actionsLabel = 'Inspector actions',
  className,
  description,
  eyebrow,
  title,
  ...props
}: InspectorPanelHeaderProps) {
  return (
    <header
      {...props}
      data-slot="inspector-panel-header"
      className={cn(
        'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-bakin-3 border-b border-bakin-border-subtle pb-bakin-4',
        className,
      )}
    >
      <div className="grid min-w-0 gap-bakin-2">
        {eyebrow ? (
          <p className="m-0 text-[length:var(--bakin-typography-size-meta)] font-bakin-typography-weight-bold uppercase tracking-[.12em] text-bakin-signal-accent">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="m-0 [overflow-wrap:anywhere] text-[length:var(--bakin-typography-size-title)] font-bakin-typography-weight-semibold leading-tight">
          {title}
        </h2>
        {description ? (
          <p className="m-0 [overflow-wrap:anywhere] leading-relaxed text-bakin-text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div
          role="group"
          aria-label={actionsLabel}
          className="flex min-w-0 flex-wrap items-start gap-bakin-2"
        >
          {actions}
        </div>
      ) : null}
    </header>
  )
}

export type InspectorPanelContentProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'aria-busy' | 'children'
> & {
  busy?: boolean
  children?: React.ReactNode
  feedback?: React.ReactNode
  state?: React.ReactNode
}

export function InspectorPanelContent({
  busy = false,
  children,
  className,
  feedback,
  state,
  ...props
}: InspectorPanelContentProps) {
  const hasState = state !== undefined && state !== null
  return (
    <div
      {...props}
      aria-busy={busy || undefined}
      data-content-state={hasState ? 'replaced' : 'ready'}
      data-slot="inspector-panel-content"
      className={cn('flex min-w-0 flex-1 flex-col gap-bakin-5', className)}
    >
      {feedback ? <div data-slot="inspector-panel-feedback">{feedback}</div> : null}
      {hasState ? <div data-slot="inspector-panel-state">{state}</div> : children}
    </div>
  )
}

export type InspectorPanelFooterProps = React.ComponentPropsWithoutRef<'footer'>
export function InspectorPanelFooter({ className, ...props }: InspectorPanelFooterProps) {
  return (
    <footer
      {...props}
      data-slot="inspector-panel-footer"
      className={cn(
        'flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-bakin-2 border-t border-bakin-border-subtle pt-bakin-4',
        className,
      )}
    />
  )
}
