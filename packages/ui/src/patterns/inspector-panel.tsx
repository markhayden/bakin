import * as React from 'react'
import { cn } from '../utils'

type AccessibleRegionName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }

type NativePanelProps = Omit<
  React.ComponentPropsWithoutRef<'section'>,
  'aria-label' | 'aria-labelledby'
>

const InspectorPanelContext = React.createContext<{ side: boolean }>({ side: false })

export type InspectorPanelProps = NativePanelProps &
  AccessibleRegionName & {
    /**
     * The beside-canvas posture: one standard panel width, left border,
     * raised surface, and kit-owned insets on header/content/footer — the
     * content column owns the panel's internal scroll. Consumers add zero
     * layout classes.
     */
    side?: boolean
  }

/** Named contextual inspector usable beside a canvas or inside the supported drawer. */
export function InspectorPanel({ className, label, labelledBy, side = false, ...props }: InspectorPanelProps) {
  const context = React.useMemo(() => ({ side }), [side])
  return (
    <InspectorPanelContext.Provider value={context}>
      <section
        {...props}
        aria-label={label}
        aria-labelledby={labelledBy}
        data-slot="inspector-panel"
        data-side={side ? '' : undefined}
        className={cn(
          'flex min-h-0 min-w-0 flex-col gap-5 font-bakin-typography-family-ui text-bakin-text-primary',
          side && 'w-112 shrink-0 gap-0 border-l border-bakin-border-subtle bg-bakin-surface-default',
          className,
        )}
      />
    </InspectorPanelContext.Provider>
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
  const { side } = React.useContext(InspectorPanelContext)
  return (
    <header
      {...props}
      data-slot="inspector-panel-header"
      className={cn(
        'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-bakin-3 border-b border-bakin-border-subtle pb-bakin-4',
        side && 'px-bakin-4 pt-bakin-4',
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
  const { side } = React.useContext(InspectorPanelContext)
  const hasState = state !== undefined && state !== null
  return (
    <div
      {...props}
      aria-busy={busy || undefined}
      data-content-state={hasState ? 'replaced' : 'ready'}
      data-slot="inspector-panel-content"
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-5',
        // Side panels own their internal scroll here — the ONE scroll
        // column between the pinned header and footer.
        side && 'min-h-0 overflow-y-auto p-bakin-4',
        className,
      )}
    >
      {feedback ? <div data-slot="inspector-panel-feedback">{feedback}</div> : null}
      {hasState ? <div data-slot="inspector-panel-state">{state}</div> : children}
    </div>
  )
}

export type InspectorPanelFooterProps = React.ComponentPropsWithoutRef<'footer'>
export function InspectorPanelFooter({ className, ...props }: InspectorPanelFooterProps) {
  const { side } = React.useContext(InspectorPanelContext)
  return (
    <footer
      {...props}
      data-slot="inspector-panel-footer"
      className={cn(
        'flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-bakin-2 border-t border-bakin-border-subtle pt-bakin-4',
        side && 'p-bakin-4',
        className,
      )}
    />
  )
}
