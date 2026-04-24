'use client'

import type { ReactNode } from 'react'
import { AgentAvatar, MarkdownContent } from '@bakin/sdk/components'
import { useAgentColor } from '@bakin/sdk/hooks'
import type { AssistantTransformed, BrainstormMessage } from './types'

interface MessageListProps {
  messages: BrainstormMessage[]
  defaultAgentId: string
  transform?: (raw: string) => AssistantTransformed
}

export function MessageList({ messages, defaultAgentId, transform }: MessageListProps) {
  return (
    <div
      data-testid="brainstorm-message-list"
      className="space-y-2"
    >
      {messages.map((msg, idx) => {
        if (msg.role === 'user') {
          return <UserBubble key={msg.id} content={msg.content} />
        }
        const prev = idx > 0 ? messages[idx - 1] : null
        const isConsecutive = prev?.role === 'assistant'
        const transformed = transform ? transform(msg.content) : { text: msg.content }
        return (
          <AssistantBubble
            key={msg.id}
            content={transformed.text}
            extras={transformed.extras}
            agentId={msg.agentId ?? defaultAgentId}
            isConsecutive={isConsecutive}
          />
        )
      })}
    </div>
  )
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end" data-testid="user-bubble">
      <div className="max-w-[85%] px-3 py-1.5 rounded-lg bg-[#5e6ad2]/15 border border-[#5e6ad2]/20 text-sm text-zinc-200 whitespace-pre-wrap">
        {content}
      </div>
    </div>
  )
}

interface AssistantBubbleProps {
  content: string
  extras?: ReactNode
  agentId: string
  isConsecutive: boolean
}

function AssistantBubble({ content, extras, agentId, isConsecutive }: AssistantBubbleProps) {
  const color = useAgentColor(agentId)
  return (
    <div
      data-testid="assistant-bubble"
      data-consecutive={isConsecutive ? 'true' : 'false'}
      className={`flex items-start gap-2 ${isConsecutive ? '-mt-2' : ''}`}
    >
      {isConsecutive ? (
        <div className="w-6 shrink-0" aria-hidden="true" />
      ) : (
        <AgentAvatar agentId={agentId} size="sm" className="mt-0.5 shrink-0" />
      )}
      <div
        className="max-w-[90%] px-3 py-2 rounded-lg border-l-2 bg-[rgba(255,255,255,0.03)] text-sm [&_p]:!my-0 [&_p+p]:!mt-2 [&_*:first-child]:!mt-0 [&_*:last-child]:!mb-0"
        style={{ borderLeftColor: `${color}80` }}
      >
        {content && <MarkdownContent content={content} />}
        {extras && <div data-testid="assistant-extras">{extras}</div>}
      </div>
    </div>
  )
}
