'use client'

import * as React from 'react'
import {
  PageShell,
  type PageShellProps,
  type PageShellWidth,
} from '../layout/page-shell'
import { cn } from '../utils'
import { PageScrollContext } from './page'
import { PageComposer, type PageComposerProps } from './page-composer'
import { PageTimeline, type PageTimelineProps } from './page-timeline'

export type ConversationPageWidth = PageShellWidth
export type ConversationPageMode = 'document' | 'contained'

export type ConversationPageProps = Omit<PageShellProps, 'children' | 'gap' | 'padding' | 'width'> & {
  children: React.ReactNode
  /** Contained conversations fill their owning application pane instead of extending document flow. */
  mode?: ConversationPageMode
  width?: ConversationPageWidth
}

/** Page canvas for a routed conversation; message behavior remains in the conversation kit. */
export function ConversationPage({
  children,
  className,
  mode = 'document',
  width = 'full',
  ...props
}: ConversationPageProps) {
  return (
    <PageShell
      {...props}
      className={cn(
        mode === 'contained'
          && 'h-full [&>[data-slot=page-shell-content]]:h-full [&>[data-slot=page-shell-content]]:shrink',
        className,
      )}
      data-archetype="conversation"
      data-mode={mode}
      width={width}
    >
      {children}
    </PageShell>
  )
}

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
    <PageScrollContext.Provider value={mode === 'contained' ? 'contained' : 'page'}>
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
    </PageScrollContext.Provider>
  )
}

export type ConversationPageTimelineProps = PageTimelineProps

/**
 * Named conversation log; contained mode is the only recipe-owned vertical scroller.
 * Legacy alias for PageTimeline; deleted with the archetype migration slice.
 */
export function ConversationPageTimeline(props: ConversationPageTimelineProps) {
  return <PageTimeline data-slot="conversation-page-timeline" {...props} />
}

export type ConversationPageComposerProps = PageComposerProps

/**
 * Stable, borderless composer boundary outside the timeline scroller.
 * Legacy alias for PageComposer; deleted with the archetype migration slice.
 */
export function ConversationPageComposer(props: ConversationPageComposerProps) {
  return <PageComposer data-slot="conversation-page-composer" {...props} />
}
