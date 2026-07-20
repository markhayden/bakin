import * as React from 'react'

import { cn } from '../utils'

export type ToastTone = 'info' | 'success' | 'error'

type NativeToastProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'aria-describedby' | 'aria-labelledby' | 'aria-live' | 'children' | 'role' | 'title'
>

export interface ToastProps extends NativeToastProps {
  action?: React.ReactNode
  description: React.ReactNode
  dismissLabel?: string
  onDismiss?: () => void
  title?: React.ReactNode
  tone?: ToastTone
}

export interface ToastRegionProps extends Omit<
  React.ComponentPropsWithoutRef<'section'>,
  'aria-label' | 'aria-live' | 'aria-relevant' | 'role'
> {
  label?: string
}

const defaultTitles: Record<ToastTone, string> = {
  info: 'Update',
  success: 'Completed',
  error: 'Action failed',
}

const toneClasses: Record<ToastTone, string> = {
  info: 'border-bakin-border-subtle bg-bakin-surface-default',
  success: 'border-bakin-action-primary-background/60 bg-bakin-surface-default',
  error: 'border-bakin-signal-danger/60 bg-bakin-surface-default',
}

const signalClasses: Record<ToastTone, string> = {
  info: 'bg-bakin-text-muted',
  success: 'bg-bakin-action-primary-background',
  error: 'bg-bakin-signal-danger',
}

/** Owning collection for shell-rendered notifications. Placement and portal ownership stay with the host. */
export function ToastRegion({ children, className, label = 'Notifications', ...props }: ToastRegionProps) {
  return (
    <section
      {...props}
      aria-label={label}
      aria-relevant="additions removals"
      role="region"
      data-slot="toast-region"
      className={cn('flex w-full max-w-sm flex-col gap-bakin-2 font-bakin-typography-family-ui', className)}
    >
      {children}
    </section>
  )
}

/** Structured toast presentation. Use the SDK toast hook; only the shell mounts a ToastRegion. */
export function Toast({
  action,
  className,
  description,
  dismissLabel = 'Dismiss notification',
  onDismiss,
  title,
  tone = 'info',
  ...props
}: ToastProps) {
  const titleId = React.useId()
  const descriptionId = React.useId()
  const urgent = tone === 'error'

  return (
    <div
      {...props}
      aria-atomic="true"
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-live={urgent ? 'assertive' : 'polite'}
      role={urgent ? 'alert' : 'status'}
      data-slot="toast"
      data-tone={tone}
      className={cn(
        '@container/toast pointer-events-auto grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-bakin-3 gap-y-bakin-2 rounded-bakin-surface border px-bakin-4 py-bakin-3 text-left text-bakin-text-primary shadow-bakin-elevation-overlay animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none',
        toneClasses[tone],
        className,
      )}
    >
      <span
        aria-hidden="true"
        data-slot="toast-signal"
        className={cn('mt-bakin-1 size-bakin-3 shrink-0 rounded-bakin-pill', signalClasses[tone])}
      />
      <div data-slot="toast-copy" className="min-w-0">
        <div
          id={titleId}
          data-slot="toast-title"
          className="m-0 text-[length:var(--bakin-typography-size-body)] font-bakin-typography-weight-semibold leading-snug"
        >
          {title ?? defaultTitles[tone]}
        </div>
        <div
          id={descriptionId}
          data-slot="toast-description"
          className="mt-bakin-1 text-[length:var(--bakin-typography-size-body)] leading-relaxed text-bakin-text-muted"
        >
          {description}
        </div>
      </div>
      {onDismiss ? (
        <button
          type="button"
          aria-label={dismissLabel}
          data-slot="toast-close"
          onClick={onDismiss}
          className="inline-flex size-bakin-8 shrink-0 items-center justify-center rounded-bakin-control border border-transparent text-bakin-text-muted transition-colors hover:bg-bakin-border-subtle/20 hover:text-bakin-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring"
        >
          <span aria-hidden="true" className="text-lg leading-none">×</span>
        </button>
      ) : <span aria-hidden="true" />}
      {action ? (
        <div data-slot="toast-actions" className="col-start-2 flex min-w-0 flex-wrap items-center gap-bakin-2">
          {action}
        </div>
      ) : null}
    </div>
  )
}
