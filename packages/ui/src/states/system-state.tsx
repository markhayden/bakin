import * as React from 'react'

import { cn } from '../utils'

export type FeedbackAnnouncement = 'off' | 'polite' | 'assertive'
export type SystemStateKind = 'initial-empty' | 'no-results' | 'loading' | 'error' | 'permission-denied'
export type SystemStateScope = 'inline' | 'section' | 'page'
export type SystemStateHeadingLevel = 2 | 3 | 4

export interface SystemStateContent {
  title: string
  description: string
}

export const systemStateDefaults = {
  'initial-empty': {
    title: 'Nothing here yet',
    description: 'Create the first item to get started.',
  },
  'no-results': {
    title: 'No results',
    description: 'Try adjusting your search or clearing filters.',
  },
  loading: {
    title: 'Loading',
    description: 'The latest information will appear here when it is ready.',
  },
  error: {
    title: 'Something went wrong',
    description: 'Try again. If the problem continues, check system health.',
  },
  'permission-denied': {
    title: 'Access restricted',
    description: 'You do not have permission to view this content.',
  },
} as const satisfies Record<SystemStateKind, SystemStateContent>

type NativeStateProps = Omit<
  React.ComponentPropsWithoutRef<'section'>,
  | 'aria-busy'
  | 'aria-describedby'
  | 'aria-labelledby'
  | 'aria-live'
  | 'children'
  | 'role'
  | 'title'
>

interface SystemStateBaseProps extends NativeStateProps {
  announce?: FeedbackAnnouncement
  description?: React.ReactNode
  headingLevel?: SystemStateHeadingLevel
  scope?: SystemStateScope
  title?: React.ReactNode
}

type PassiveSystemStateProps = SystemStateBaseProps & {
  action?: React.ReactNode
  kind: 'initial-empty' | 'permission-denied'
  preview?: never
  recovery?: never
}

type LoadingSystemStateProps = SystemStateBaseProps & {
  action?: React.ReactNode
  kind: 'loading'
  preview?: React.ReactNode
  recovery?: never
}

type NoResultsSystemStateProps = SystemStateBaseProps & {
  action: React.ReactNode
  kind: 'no-results'
  preview?: never
  recovery?: never
}

type RecoverableErrorSystemStateProps = SystemStateBaseProps & {
  action: React.ReactNode
  kind: 'error'
  preview?: never
  recovery?: 'available'
}

type TerminalErrorSystemStateProps = SystemStateBaseProps & {
  action?: never
  kind: 'error'
  preview?: never
  recovery: 'unavailable'
}

export type SystemStateProps =
  | PassiveSystemStateProps
  | LoadingSystemStateProps
  | NoResultsSystemStateProps
  | RecoverableErrorSystemStateProps
  | TerminalErrorSystemStateProps

const defaultAnnouncements: Record<SystemStateKind, FeedbackAnnouncement> = {
  'initial-empty': 'off',
  'no-results': 'polite',
  loading: 'polite',
  error: 'assertive',
  'permission-denied': 'off',
}

const signalClasses: Record<SystemStateKind, string> = {
  'initial-empty': 'border-bakin-border-subtle bg-bakin-text-muted',
  'no-results': 'border-bakin-signal-accent bg-bakin-signal-accent',
  loading: 'animate-pulse border-bakin-signal-accent bg-bakin-signal-accent motion-reduce:animate-none',
  error: 'border-bakin-signal-danger bg-bakin-signal-danger',
  'permission-denied': 'border-bakin-signal-highlight bg-bakin-signal-highlight',
}

const scopeClasses: Record<SystemStateScope, string> = {
  inline: 'grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-bakin-3 gap-y-bakin-2 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default px-bakin-4 py-bakin-3 text-left',
  section: 'flex flex-col items-center justify-center gap-bakin-3 rounded-bakin-surface bg-bakin-surface-default/55 px-bakin-6 py-bakin-8 text-center',
  page: 'flex min-h-full flex-1 flex-col items-center justify-center gap-bakin-3 px-bakin-6 py-bakin-8 text-center',
}

const actionClasses: Record<SystemStateScope, string> = {
  inline: 'col-start-2 flex min-w-0 flex-wrap items-center gap-bakin-2',
  section: 'flex min-w-0 flex-wrap items-center justify-center gap-bakin-2',
  page: 'flex min-w-0 flex-wrap items-center justify-center gap-bakin-2',
}

/**
 * One explicit contract for asynchronous and data-driven surface states.
 * No-results and recoverable errors require an action at the type boundary.
 */
export function SystemState({
  action,
  announce,
  className,
  description,
  headingLevel = 2,
  kind,
  preview,
  recovery,
  scope = 'section',
  title,
  ...props
}: SystemStateProps) {
  const titleId = React.useId()
  const descriptionId = React.useId()
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'
  const copy = systemStateDefaults[kind]
  const resolvedAnnouncement = announce ?? defaultAnnouncements[kind]
  const liveRole = resolvedAnnouncement === 'off'
    ? undefined
    : resolvedAnnouncement === 'assertive' ? 'alert' : 'status'
  const resolvedRecovery = kind === 'error' ? (recovery ?? 'available') : undefined

  return (
    <section
      {...props}
      role={liveRole}
      aria-atomic={liveRole ? true : undefined}
      aria-busy={kind === 'loading' ? true : undefined}
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-live={resolvedAnnouncement === 'off' ? undefined : resolvedAnnouncement}
      data-announcement={resolvedAnnouncement}
      data-kind={kind}
      data-recovery={resolvedRecovery}
      data-scope={scope}
      data-slot="system-state"
      className={cn(
        '@container/system-state min-w-0 font-bakin-typography-family-ui text-bakin-text-primary',
        scopeClasses[scope],
        className,
      )}
    >
      <span
        aria-hidden="true"
        data-slot="system-state-signal"
        className={cn('mt-bakin-1 size-bakin-3 shrink-0 rounded-bakin-pill border-2', signalClasses[kind])}
      />
      <div data-slot="system-state-copy" className={cn('min-w-0', scope === 'inline' && 'row-start-1')}>
        <Heading
          id={titleId}
          data-slot="system-state-title"
          className="m-0 text-[length:var(--bakin-typography-size-body)] font-bakin-typography-weight-semibold leading-snug text-bakin-text-primary"
        >
          {title ?? copy.title}
        </Heading>
        <p
          id={descriptionId}
          data-slot="system-state-description"
          className="m-0 mt-bakin-1 max-w-prose text-[length:var(--bakin-typography-size-body)] leading-relaxed text-bakin-text-muted"
        >
          {description ?? copy.description}
        </p>
      </div>
      {preview ? (
        <div
          data-slot="system-state-preview"
          className={cn('w-full max-w-xl', scope === 'inline' && 'col-span-2')}
        >
          {preview}
        </div>
      ) : null}
      {action ? (
        <div data-slot="system-state-actions" className={actionClasses[scope]}>
          {action}
        </div>
      ) : null}
    </section>
  )
}
