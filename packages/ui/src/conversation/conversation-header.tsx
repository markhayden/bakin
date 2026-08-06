'use client'

import type { ComponentProps, ReactNode } from 'react'

import { cn } from '../utils'

export interface ConversationHeaderProps extends Omit<ComponentProps<'header'>, 'title'> {
  /** Consumer-owned identity visual (an AgentAvatar, initials avatar, …). */
  avatar?: ReactNode
  /** The conversation's name; plain strings get the one title treatment. */
  title: ReactNode
  /**
   * Element for the title slot. Embedded panels use `h2`; page surfaces
   * whose heading lives elsewhere keep the non-heading default.
   */
  titleAs?: 'h2' | 'h3' | 'div'
  /** Trailing controls on the title row (pin, overflow menu, …). */
  actions?: ReactNode
  /**
   * Second stable line under the title (ContextMeter, usage totals). The
   * slot owns the meta typography; render nothing to keep a single row.
   */
  meta?: ReactNode
}

/**
 * The one header treatment for chat-like surfaces: identity avatar, title
 * row with trailing actions, and an optional stable meta line. Chat's page
 * view and the embedded ConversationPanel both compose this — new
 * conversation surfaces must too, never a hand-rolled header.
 */
export function ConversationHeader({
  avatar,
  title,
  titleAs = 'div',
  actions,
  meta,
  className,
  ...props
}: ConversationHeaderProps) {
  const TitleTag = titleAs
  return (
    <header
      data-slot="conversation-header"
      {...props}
      className={cn(
        'flex min-w-0 shrink-0 items-center gap-x-bakin-2 border-b border-bakin-border-subtle px-bakin-4 py-bakin-3',
        'font-bakin-typography-family-ui text-bakin-text-primary',
        className,
      )}
    >
      {avatar ? <span className="flex shrink-0 items-center">{avatar}</span> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-y-bakin-1">
        <div className="flex min-w-0 items-center gap-x-bakin-2">
          <TitleTag
            data-slot="conversation-header-title"
            className="flex min-w-0 flex-1 items-center gap-bakin-1 text-bakin-typography-size-body font-bakin-typography-weight-medium"
          >
            {typeof title === 'string' ? <span className="truncate">{title}</span> : title}
          </TitleTag>
          {actions ? (
            <span data-slot="conversation-header-actions" className="flex shrink-0 items-center gap-bakin-1">
              {actions}
            </span>
          ) : null}
        </div>
        {meta ? (
          <div
            data-slot="conversation-header-meta"
            className="flex min-w-0 items-center gap-bakin-2 text-bakin-typography-size-meta text-bakin-text-muted"
          >
            {meta}
          </div>
        ) : null}
      </div>
    </header>
  )
}
