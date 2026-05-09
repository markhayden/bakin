'use client'

import { AlertTriangle, CircleDot, Wrench } from 'lucide-react'
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
        if (msg.role === 'activity') {
          return <ActivityBubble key={msg.id} message={msg} />
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

function formatActivityData(data: unknown): string | null {
  if (data === undefined || data === null) return null
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

function ActivityBubble({ message }: { message: BrainstormMessage }) {
  const data = formatActivityData(message.data)
  const kind = message.kind ?? 'runtime_status'
  const Icon = kind === 'tool_call' ? Wrench : kind === 'error' ? AlertTriangle : CircleDot
  const label = kind === 'tool_call' ? 'Tool' : kind === 'error' ? 'Error' : 'Status'

  return (
    <div
      data-testid="activity-bubble"
      className="ml-8 flex items-start gap-2 text-[11px] leading-5 text-zinc-500"
    >
      <Icon className="mt-0.5 size-3 shrink-0 text-zinc-600" aria-hidden="true" />
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="font-medium uppercase tracking-wide text-zinc-600">{label}</span>
          <span className="break-words text-zinc-400">{message.content}</span>
        </div>
        {data && (
          <details className="mt-1">
            <summary className="cursor-pointer select-none text-zinc-600 hover:text-zinc-400">
              Details
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto rounded border border-[rgba(255,255,255,0.06)] bg-zinc-950/60 p-2 text-[10px] leading-4 text-zinc-500">
              {data}
            </pre>
          </details>
        )}
      </div>
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
