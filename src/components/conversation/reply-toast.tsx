'use client'

/**
 * ConversationReplyToast — THE reply-landed toast body for every
 * conversational surface's attention provider (#703 consolidation).
 * Avatar + "<agent> replied…" + preview; clicking dismisses the toast and
 * navigates to the thread. Chat, projects, and messaging all render this
 * from their `renderToast` config.
 */
import { useAgent, useRouter } from '@makinbakin/sdk/hooks'

import { AgentAvatar } from '../agent-avatar'

export function ConversationReplyToast({ agentId, title, preview, to, onNavigate, testId }: {
  agentId: string
  /** e.g. "replied" / "replied in a project brainstorm" — prefixed with the agent's name. */
  title: string
  preview?: string
  /** Internal route to navigate to on click (router push, never a reload). */
  to: string
  /** Called before navigation (wire the attention hook's `dismiss` here). */
  onNavigate?: () => void
  /** data-* marker attribute value for tests (e.g. chat sets data-chat-toast). */
  testId?: { attr: string; value: string }
}) {
  const agent = useAgent(agentId)
  const router = useRouter()
  return (
    <button
      type="button"
      {...(testId ? { [testId.attr]: testId.value } : {})}
      onClick={() => {
        onNavigate?.()
        router.push(to)
      }}
      className="flex max-w-sm items-start gap-2 text-left"
    >
      <AgentAvatar agentId={agentId} size="xs" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{agent?.name ?? agentId} {title}</span>
        {preview ? <span className="block truncate text-xs text-muted-foreground">{preview}</span> : null}
      </span>
    </button>
  )
}
