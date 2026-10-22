'use client'

/**
 * ReplyToastBody — THE reply-landed toast body for every conversational
 * surface's attention provider (#703 consolidation), as pure presentation:
 * avatar + headline + preview, one click target. The SDK's
 * `ConversationReplyToast` binds the agent identity, the headline and the
 * router around it; chat, projects and messaging render that wrapper from
 * their `renderToast` config.
 *
 * Two name sources are deliberate: the avatar shows the agent's display-name
 * override (what the kit avatar shows everywhere), the headline the raw
 * agent name the toast always carried. Keep them separate props.
 */
import type { ReactNode } from 'react'

import { AgentAvatar, type AgentIdentity } from '../patterns/agent-patterns'

export interface ReplyToastBodyProps {
  /** Identity for the avatar (display-name override applied by the caller). */
  avatarAgent: AgentIdentity
  /** The full headline, e.g. "Pixel replied in a project brainstorm". */
  headline: ReactNode
  preview?: string
  /** Called on click; the caller dismisses and navigates. */
  onSelect: () => void
  /** data-* marker attribute value for tests (e.g. chat sets data-chat-toast). */
  testId?: { attr: string; value: string }
}

export function ReplyToastBody({ avatarAgent, headline, preview, onSelect, testId }: ReplyToastBodyProps) {
  return (
    <button
      type="button"
      {...(testId ? { [testId.attr]: testId.value } : {})}
      onClick={onSelect}
      className="flex max-w-sm items-start gap-2 text-left"
    >
      <AgentAvatar agent={avatarAgent} size="xs" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{headline}</span>
        {preview ? <span className="block truncate text-xs text-bakin-text-muted">{preview}</span> : null}
      </span>
    </button>
  )
}
