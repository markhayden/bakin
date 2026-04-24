'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AgentAvatar, IntegratedBrainstorm } from "@bakin/sdk/components"
import type { BrainstormMessage } from "@bakin/sdk/components"
import { Badge } from "@bakin/sdk/ui"
import { useAgent } from "@bakin/sdk/hooks"
import type { ProposedItem, SessionMessage } from '../types'

interface Props {
  sessionId: string
  agentId: string
  initialMessages?: SessionMessage[]
  initialProposals?: ProposedItem[]
  isCompleted?: boolean
  onProposalsReceived?: (proposals: ProposedItem[]) => void
}

function toBrainstorm(agentId: string, sm: SessionMessage): BrainstormMessage {
  return {
    id: sm.id,
    role: sm.role,
    content: sm.content,
    agentId: sm.role === 'assistant' ? agentId : undefined,
    timestamp: sm.timestamp,
  }
}

/**
 * Strip complete ```json proposal blocks from an assistant reply, count how
 * many items are proposed (complete + partial), and return a text for
 * rendering + an optional extras badge. Partial blocks mid-stream show
 * "Planning..." to give the user feedback while the agent is still writing.
 */
function transformAssistantReply(raw: string): { text: string; extras?: ReactNode } {
  let proposalCount = 0
  const complete = raw.match(/```json\s*\n[\s\S]*?```/g)
  if (complete) {
    for (const block of complete) {
      try {
        const jsonStr = block.replace(/^```json\s*\n/, '').replace(/```$/, '').trim()
        const parsed = JSON.parse(jsonStr)
        proposalCount += Array.isArray(parsed) ? parsed.length : 1
      } catch {
        proposalCount += 1
      }
    }
  }
  const parts = raw.split(/```json\s*\n[\s\S]*?```/)
  let hasPartial = false
  const lastPart = parts[parts.length - 1] || ''
  const partialMatch = lastPart.match(/```json\s*\n[\s\S]*$/)
  if (partialMatch) {
    const titleMatches = partialMatch[0].match(/"title"\s*:/g)
    proposalCount += titleMatches ? titleMatches.length : 0
    parts[parts.length - 1] = lastPart.slice(0, lastPart.length - partialMatch[0].length)
    hasPartial = true
  }
  const text = parts
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join('\n\n')
  let extras: ReactNode = undefined
  if (hasPartial) {
    extras = (
      <Badge variant="outline" className="mt-2 text-[10px]">
        {proposalCount > 0 ? `Planning ${proposalCount} item${proposalCount === 1 ? '' : 's'}…` : 'Preparing proposal…'}
      </Badge>
    )
  } else if (proposalCount > 0) {
    extras = (
      <Badge variant="outline" className="mt-2 text-[10px]">
        {proposalCount} {proposalCount === 1 ? 'item' : 'items'} proposed
      </Badge>
    )
  }
  return { text, extras }
}

export function SessionChat({
  sessionId,
  agentId,
  initialMessages = [],
  isCompleted = false,
  onProposalsReceived,
}: Props) {
  const [messages, setMessages] = useState<BrainstormMessage[]>(() =>
    initialMessages.map((m) => toBrainstorm(agentId, m)),
  )
  const agent = useAgent(agentId)
  const agentName = agent?.name ?? agentId
  // Re-sync only when the session changes (not on every parent re-render;
  // the parent re-creates initialMessages each tick which would otherwise
  // reset our message state infinitely).
  const lastSyncedIdsRef = useRef(initialMessages.map((m) => m.id).join('|'))
  useEffect(() => {
    const idKey = initialMessages.map((m) => m.id).join('|')
    if (idKey === lastSyncedIdsRef.current) return
    lastSyncedIdsRef.current = idKey
    setMessages(initialMessages.map((m) => toBrainstorm(agentId, m)))
  }, [initialMessages, agentId])

  // Proposal forwarding + SSE parser bundled together — SessionChat is the
  // only caller so there's no value in splitting them into separate
  // wrappers. Component receives onCustom; we route 'proposal' and
  // 'proposals' events to the caller's onProposalsReceived callback.
  const onSend = useCallback(
    async (
      prompt: string,
      _history: BrainstormMessage[],
      ctx: {
        signal: AbortSignal
        onToken: (text: string) => void
        onCustom?: (name: string, data: unknown) => void
      },
    ): Promise<{ content: string }> => {
      const res = await fetch(`/api/plugins/messaging/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctx.signal,
        body: JSON.stringify({ message: prompt }),
      })
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Server returned ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''
      let accumulated = ''
      let finalContent = ''
      let errorMessage: string | null = null
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6))
              switch (currentEvent) {
                case 'token':
                  accumulated += data.text ?? ''
                  ctx.onToken(data.text ?? '')
                  break
                case 'proposal':
                  if (data.proposal) {
                    onProposalsReceived?.([data.proposal as ProposedItem])
                    ctx.onCustom?.('proposal', data.proposal)
                  }
                  break
                case 'proposals':
                  if (Array.isArray(data.proposals)) {
                    onProposalsReceived?.(data.proposals as ProposedItem[])
                    for (const p of data.proposals) ctx.onCustom?.('proposal', p)
                  }
                  break
                case 'done':
                  finalContent = data.content ?? accumulated
                  break
                case 'error':
                  errorMessage = data.message ?? 'Unknown error'
                  break
              }
            } catch { /* skip malformed chunks */ }
            currentEvent = ''
          }
        }
      }
      if (errorMessage) throw new Error(errorMessage)
      return { content: finalContent || accumulated }
    },
    [sessionId, onProposalsReceived],
  )

  const emptyState = (
    <div className="flex flex-col items-center text-center text-muted-foreground gap-4 px-4">
      <AgentAvatar agentId={agentId} size="xl" />
      <div className="space-y-2 max-w-xl">
        <p className="text-base font-medium text-foreground">Plan with {agentName}</p>
        <p className="text-sm">
          Describe the content you want to plan — topics, themes, dates, or audience. {agentName} will suggest calendar items you can review and approve.
        </p>
      </div>
    </div>
  )

  return (
    <IntegratedBrainstorm
      messages={messages}
      onMessagesChange={setMessages}
      onSend={onSend}
      agentId={agentId}
      placeholder={`Ask ${agentName} for content ideas…`}
      emptyState={emptyState}
      transformAssistantMessage={transformAssistantReply}
      readOnly={isCompleted}
      readOnlyNotice={
        <Badge variant="outline" className="text-muted-foreground">
          Session completed — read-only
        </Badge>
      }
      fitParent
      showHeader={false}
    />
  )
}
