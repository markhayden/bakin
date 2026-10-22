'use client'

/**
 * ConversationReplyToast — the public reply-landed toast (#703): binds the
 * registered agent's identity and the router around the kit's pure
 * `ReplyToastBody`. Props and behaviour are unchanged from the former
 * src/components adapter: the avatar shows the display-name override, the
 * headline keeps the raw agent name (`agent?.name ?? agentId`), and a click
 * dismisses then navigates with the router (never a reload).
 */
import { ReplyToastBody } from '@bakin/ui/conversation'

import { useAgent, useAgentIdentity } from '../hooks'
import { useRouter } from '../navigation'

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
  const avatarAgent = useAgentIdentity(agentId)
  const router = useRouter()
  return (
    <ReplyToastBody
      avatarAgent={avatarAgent}
      headline={`${agent?.name ?? agentId} ${title}`}
      preview={preview}
      onSelect={() => {
        onNavigate?.()
        router.push(to)
      }}
      testId={testId}
    />
  )
}
