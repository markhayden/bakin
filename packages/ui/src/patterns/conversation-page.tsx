'use client'

import * as React from 'react'
import { PageShell, type PageShellProps } from '../layout/page-shell'
import { cn } from '../utils'

export type ConversationPageWidth = 'content' | 'wide'
export type ConversationPageMode = 'document' | 'contained'

export type ConversationPageProps = Omit<PageShellProps, 'children' | 'gap' | 'padding' | 'width'> & {
  children: React.ReactNode
  width?: ConversationPageWidth
}

/** Page canvas for a routed conversation; message behavior remains in the conversation kit. */
export function ConversationPage({ children, width = 'content', ...props }: ConversationPageProps) {
  return (
    <PageShell {...props} data-archetype="conversation" width={width}>
      {children}
    </PageShell>
  )
}

const ConversationModeContext = React.createContext<ConversationPageMode>('document')

export type ConversationPageBodyProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'aria-busy' | 'children'> & {
  busy?: boolean
  children?: React.ReactNode
  feedback?: React.ReactNode
  /** Document uses host page scroll; contained gives only the named timeline an internal scroller. */
  mode?: ConversationPageMode
  state?: React.ReactNode
}

export function ConversationPageBody({
  busy = false,
  children,
  className,
  feedback,
  mode = 'document',
  state,
  ...props
}: ConversationPageBodyProps) {
  const hasState = state !== undefined && state !== null
  return (
    <ConversationModeContext.Provider value={mode}>
      <div
        {...props}
        aria-busy={busy || undefined}
        data-content-state={hasState ? 'replaced' : 'ready'}
        data-mode={mode}
        data-slot="conversation-page-body"
        className={cn(
          'flex min-w-0 flex-col gap-bakin-4',
          mode === 'contained' && 'min-h-0 flex-1 overflow-hidden',
          className,
        )}
      >
        {feedback ? <div data-slot="conversation-page-feedback">{feedback}</div> : null}
        {hasState ? <div data-slot="conversation-page-state">{state}</div> : children}
      </div>
    </ConversationModeContext.Provider>
  )
}

type AccessibleRegionName =
  | { label: string; labelledBy?: never }
  | { label?: never; labelledBy: string }

type NativeTimelineProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'aria-label' | 'aria-labelledby' | 'aria-live'
>

export type ConversationPageTimelineProps = NativeTimelineProps & AccessibleRegionName & {
  live?: 'off' | 'polite'
}

/** Named conversation log; contained mode is the only recipe-owned vertical scroller. */
export function ConversationPageTimeline({
  className,
  label,
  labelledBy,
  live = 'polite',
  ...props
}: ConversationPageTimelineProps) {
  const mode = React.useContext(ConversationModeContext)
  return (
    <div
      {...props}
      role="log"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-live={live}
      data-slot="conversation-page-timeline"
      className={cn(
        'flex min-w-0 flex-col gap-bakin-4',
        mode === 'contained'
          && 'min-h-0 flex-1 overflow-y-auto overscroll-contain pr-bakin-2',
        className,
      )}
    />
  )
}

export type ConversationPageComposerProps = React.ComponentPropsWithoutRef<'div'>

/** Stable composer boundary outside the timeline scroller. */
export function ConversationPageComposer({ className, ...props }: ConversationPageComposerProps) {
  return (
    <div
      {...props}
      data-slot="conversation-page-composer"
      className={cn(
        'min-w-0 shrink-0 border-t border-bakin-border-subtle pt-bakin-4',
        className,
      )}
    />
  )
}
