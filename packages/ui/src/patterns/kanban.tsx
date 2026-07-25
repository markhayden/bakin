import type {
  ComponentPropsWithoutRef,
  ComponentPropsWithRef,
  ComponentType,
  ReactNode,
} from 'react'

import { BoundedOverflow } from '../layout/bounded-overflow'
import { cn } from '../utils'
import type { StatusTone } from './status-badge'

type AccessibleName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }

type KanbanBoardBaseProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'aria-label' | 'aria-labelledby' | 'children' | 'role' | 'tabIndex'
> & {
  children: ReactNode
}

export type KanbanBoardProps = KanbanBoardBaseProps & AccessibleName

/** Labelled horizontal boundary for a set of low-chrome Kanban lanes. */
export function KanbanBoard({ label, labelledBy, className, children, ...props }: KanbanBoardProps) {
  const name = label !== undefined ? { label } : { labelledBy: labelledBy! }
  return (
    <BoundedOverflow {...name} {...props} className={cn('w-full', className)}>
      <div data-slot="kanban-board-track" className="flex min-w-max items-start gap-bakin-4 pb-bakin-2">
        {children}
      </div>
    </BoundedOverflow>
  )
}

type KanbanColumnBaseProps = Omit<
  ComponentPropsWithRef<'section'>,
  'aria-label' | 'aria-labelledby' | 'children' | 'role'
> & {
  children: ReactNode
}

export type KanbanColumnProps = KanbanColumnBaseProps & AccessibleName

/** Fixed-width structural lane; task objects inside it own their own Card boundaries. */
export function KanbanColumn({ label, labelledBy, className, children, ref, ...props }: KanbanColumnProps) {
  return (
    <section
      {...props}
      ref={ref}
      role="region"
      aria-label={label}
      aria-labelledby={labelledBy}
      data-slot="kanban-column"
      className={cn('flex w-72 shrink-0 flex-col gap-bakin-3', className)}
    >
      {children}
    </section>
  )
}

export type KanbanColumnHeaderProps = ComponentPropsWithoutRef<'header'>

/** Calm lane identity and actions above the lane's task objects. */
export function KanbanColumnHeader({ className, ...props }: KanbanColumnHeaderProps) {
  return (
    <header
      data-slot="kanban-column-header"
      className={cn(
        'flex min-h-[var(--bakin-layout-size-control)] min-w-0 items-center justify-between gap-bakin-2 border-b border-bakin-border-subtle pb-bakin-2 font-bakin-typography-family-ui text-bakin-text-primary',
        className,
      )}
      {...props}
    />
  )
}

export type KanbanColumnBodyProps = ComponentPropsWithRef<'div'>

/** Droppable task stack with enough stable height to remain a useful empty target. */
export function KanbanColumnBody({ className, ref, ...props }: KanbanColumnBodyProps) {
  return (
    <div
      ref={ref}
      data-slot="kanban-column-body"
      className={cn(
        'flex min-h-[calc(var(--bakin-layout-size-row)*3)] min-w-0 flex-1 flex-col gap-bakin-2',
        className,
      )}
      {...props}
    />
  )
}

const cardSignalToneClasses: Record<StatusTone, string> = {
  neutral: 'border-l-bakin-border-subtle bg-bakin-canvas-default/55',
  success: 'border-l-bakin-action-primary-background bg-bakin-action-primary-background/15',
  attention: 'border-l-bakin-signal-highlight bg-bakin-signal-highlight/15',
  danger: 'border-l-bakin-signal-danger bg-bakin-signal-danger/15',
  accent: 'border-l-bakin-signal-accent bg-bakin-signal-accent/15',
}

export interface KanbanCardSignalProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  tone?: StatusTone
  label: ReactNode
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  children?: ReactNode
}

/** Full-width operational feedback inside a Kanban card; use chips only for compact identity or state. */
export function KanbanCardSignal({
  tone = 'neutral',
  label,
  icon: Icon,
  children,
  className,
  ...props
}: KanbanCardSignalProps) {
  return (
    <div
      data-slot="kanban-card-signal"
      data-tone={tone}
      className={cn(
        'flex min-w-0 items-start gap-bakin-2 border-l-2 px-bakin-3 py-bakin-2 font-bakin-typography-family-ui text-[length:var(--bakin-typography-size-meta)] text-bakin-text-primary',
        cardSignalToneClasses[tone],
        className,
      )}
      {...props}
    >
      {Icon ? <Icon aria-hidden className="mt-px size-bakin-3 shrink-0" /> : null}
      <span className="grid min-w-0 flex-1 gap-px">
        <strong className="font-bakin-typography-weight-semibold">{label}</strong>
        {children ? <span className="min-w-0 truncate text-bakin-text-muted">{children}</span> : null}
      </span>
    </div>
  )
}
