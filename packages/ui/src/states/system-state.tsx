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
  /**
   * Horizontal alignment of the whole state (glyph, copy, actions).
   * Centered by default in every scope, including compact.
   */
  align?: SystemStateAlign
  /**
   * Custom glyph rendered above the text — the sanctioned path for richer
   * empty-state art. Rendered aria-hidden; the title carries the meaning.
   * When present it replaces the status dot entirely.
   */
  icon?: React.ReactNode
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

export type SystemStateAlign = 'center' | 'left' | 'right'

// Empty kinds carry no status dot: a gray circle adds nothing to "there is
// nothing here". Loading/error/permission dots stay until a richer glyph
// arrives via `icon`.
const DOTLESS_KINDS: ReadonlySet<string> = new Set(['initial-empty', 'no-results'])

const scopeClasses: Record<SystemStateScope, string> = {
  inline: 'flex flex-col gap-bakin-1 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default px-bakin-4 py-bakin-3',
  section: 'flex flex-col justify-center gap-bakin-3 rounded-bakin-surface bg-bakin-surface-default/55 px-bakin-6 py-bakin-8',
  page: 'flex min-h-[calc(var(--bakin-layout-space-8)*12)] flex-1 flex-col justify-center gap-bakin-3 px-bakin-6 py-bakin-8',
}

const alignClasses: Record<SystemStateAlign, string> = {
  center: 'items-center text-center',
  left: 'items-start text-left',
  right: 'items-end text-right',
}

const actionClasses: Record<SystemStateAlign, string> = {
  center: 'flex min-w-0 flex-wrap items-center justify-center gap-bakin-2',
  left: 'flex min-w-0 flex-wrap items-center justify-start gap-bakin-2',
  right: 'flex min-w-0 flex-wrap items-center justify-end gap-bakin-2',
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
  align = 'center',
  icon,
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
      data-presentation={scope === 'inline' ? 'compact' : 'full'}
      data-recovery={resolvedRecovery}
      data-align={align}
      data-scope={scope}
      data-slot="system-state"
      className={cn(
        // w-full, and no @container: container-type would zero the intrinsic
        // width, letting shrink-to-fit parents (flex rows, centered canvases)
        // collapse the surface to min-content.
        'w-full min-w-0 font-bakin-typography-family-ui text-bakin-text-primary',
        scopeClasses[scope],
        alignClasses[align],
        className,
      )}
    >
      {icon ? (
        <span aria-hidden="true" data-slot="system-state-icon" className="shrink-0">
          {icon}
        </span>
      ) : DOTLESS_KINDS.has(kind) ? null : (
        <span
          aria-hidden="true"
          data-slot="system-state-signal"
          className={cn('size-bakin-3 shrink-0 rounded-bakin-pill border-2', signalClasses[kind])}
        />
      )}
      <div data-slot="system-state-copy" className="min-w-0">
        <Heading
          id={titleId}
          data-slot="system-state-title"
          className="m-0 text-balance text-[length:var(--bakin-typography-size-body)] font-bakin-typography-weight-semibold leading-snug text-bakin-text-primary"
        >
          {title ?? copy.title}
        </Heading>
        <p
          id={descriptionId}
          data-slot="system-state-description"
          className={cn(
            // text-pretty kills widows; the centered scopes also cap the
            // measure so long copy wraps at a readable width.
            'm-0 mt-bakin-1 max-w-[52ch] text-pretty text-[length:var(--bakin-typography-size-body)] text-bakin-text-muted',
            scope === 'inline' ? 'leading-snug' : 'leading-relaxed',
            align === 'center' && 'mx-auto',
            align === 'right' && 'ml-auto',
          )}
        >
          {description ?? copy.description}
        </p>
      </div>
      {preview ? (
        <div
          data-slot="system-state-preview"
          className="w-full max-w-xl"
        >
          {preview}
        </div>
      ) : null}
      {action ? (
        <div data-slot="system-state-actions" className={actionClasses[align]}>
          {action}
        </div>
      ) : null}
    </section>
  )
}
