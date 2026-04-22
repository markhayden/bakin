'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Button } from "@bakin/sdk/ui"
import { Textarea } from "@bakin/sdk/ui"
import { Badge } from "@bakin/sdk/ui"
import { AgentAvatar } from "@bakin/sdk/components"
import { Send, Loader2 } from 'lucide-react'
import type { PlanningSession, ProposedItem, SessionMessage } from '../types'
import { useAgent, useAgentColor } from "@bakin/sdk/hooks"

/**
 * Strip ```json proposal blocks from text so users don't see raw JSON.
 * Handles both complete blocks and partial blocks still streaming in.
 */
/**
 * Strip ```json proposal blocks from text and split into segments.
 * Each segment is a piece of text between JSON blocks.
 * Also counts how many proposals were found (complete + partial).
 */
function stripAndSplit(text: string): { segments: string[]; proposalCount: number; hasPartialBlock: boolean } {
  let proposalCount = 0

  // Count complete blocks
  const completeBlocks = text.match(/```json\s*\n[\s\S]*?```/g)
  if (completeBlocks) {
    for (const block of completeBlocks) {
      try {
        const jsonStr = block.replace(/^```json\s*\n/, '').replace(/```$/, '').trim()
        const parsed = JSON.parse(jsonStr)
        proposalCount += Array.isArray(parsed) ? parsed.length : 1
      } catch {
        proposalCount += 1
      }
    }
  }

  // Split at complete JSON blocks
  const parts = text.split(/```json\s*\n[\s\S]*?```/)

  // Check if the last part has a partial ```json block still streaming
  let hasPartialBlock = false
  const lastPart = parts[parts.length - 1] || ''
  const partialMatch = lastPart.match(/```json\s*\n[\s\S]*$/)
  if (partialMatch) {
    const titleMatches = partialMatch[0].match(/"title"\s*:/g)
    proposalCount += titleMatches ? titleMatches.length : 0
    parts[parts.length - 1] = lastPart.slice(0, lastPart.length - partialMatch[0].length)
    hasPartialBlock = true
  }

  const segments = parts.map(s => s.trim()).filter(s => s.length > 0)
  return { segments, proposalCount, hasPartialBlock }
}

interface Props {
  sessionId: string
  agentId: string
  initialMessages?: SessionMessage[]
  initialProposals?: ProposedItem[]
  isCompleted?: boolean
  onProposalsReceived?: (proposals: ProposedItem[]) => void
}

interface StreamingState {
  isStreaming: boolean
  streamedText: string
}

export function SessionChat({
  sessionId,
  agentId,
  initialMessages = [],
  initialProposals = [],
  isCompleted = false,
  onProposalsReceived,
}: Props) {
  const [messages, setMessages] = useState<SessionMessage[]>(initialMessages)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState<StreamingState>({
    isStreaming: false,
    streamedText: '',
  })
  const scrollRef = useRef<HTMLDivElement>(null)
  const agent = useAgent(agentId)
  const agentColor = useAgentColor(agentId)
  const agentName = agent?.name ?? agentId
  const agentBorderStyle = useMemo(() => ({ borderLeftColor: `${agentColor}80` }), [agentColor])

  useEffect(() => {
    if (scrollRef.current && typeof scrollRef.current.scrollIntoView === 'function') {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, streaming.streamedText])

  // Update messages when session is reloaded externally
  useEffect(() => {
    setMessages(initialMessages)
  }, [initialMessages])

  const handleSend = useCallback(async () => {
    if (!input.trim() || streaming.isStreaming || isCompleted) return

    const userMessage = input.trim()
    setInput('')

    // Optimistic: add user message
    const tempUserMsg: SessionMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUserMsg])
    setStreaming({ isStreaming: true, streamedText: '' })

    try {
      const res = await fetch(`/api/plugins/messaging/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage }),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: 'Unknown error' }))
        setMessages((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: `Error: ${error.error || 'Something went wrong'}`,
            timestamp: new Date().toISOString(),
          },
        ])
        setStreaming({ isStreaming: false, streamedText: '' })
        return
      }

      // Parse SSE stream
      const reader = res.body?.getReader()
      if (!reader) {
        throw new Error('No response body')
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let currentEvent = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6))

              switch (currentEvent) {
                case 'token':
                  accumulated += data.text || ''
                  setStreaming({ isStreaming: true, streamedText: accumulated })
                  break

                case 'proposal':
                  // Single proposal arrived incrementally during streaming
                  if (data.proposal && onProposalsReceived) {
                    onProposalsReceived([data.proposal])
                  }
                  break

                case 'proposals':
                  // Legacy: batch of proposals (non-streaming fallback)
                  if (data.proposals && onProposalsReceived) {
                    onProposalsReceived(data.proposals)
                  }
                  break

                case 'done': {
                  // Replace streamed text with final messages (one per segment)
                  const segments = data.segments as Array<{ id: string; content: string }> | undefined
                  if (segments && segments.length > 0) {
                    const newMsgs: SessionMessage[] = segments
                      .filter(s => s.content) // skip empty segments
                      .map(s => ({
                        id: s.id,
                        role: 'assistant' as const,
                        content: s.content,
                        timestamp: new Date().toISOString(),
                      }))
                    setMessages((prev) => [...prev, ...newMsgs])
                  } else {
                    // Fallback: single message
                    const finalMsg: SessionMessage = {
                      id: data.messageId || `msg-${Date.now()}`,
                      role: 'assistant',
                      content: data.content || accumulated,
                      timestamp: new Date().toISOString(),
                    }
                    setMessages((prev) => [...prev, finalMsg])
                  }
                  setStreaming({ isStreaming: false, streamedText: '' })
                  break
                }

                case 'error':
                  setMessages((prev) => [
                    ...prev,
                    {
                      id: `error-${Date.now()}`,
                      role: 'assistant',
                      content: `Error: ${data.message || 'Unknown error'}`,
                      timestamp: new Date().toISOString(),
                    },
                  ])
                  setStreaming({ isStreaming: false, streamedText: '' })
                  break
              }
            } catch {
              // Skip malformed data
            }
            currentEvent = ''
          }
        }
      }

      // If stream ended without a done event
      if (streaming.isStreaming) {
        setStreaming({ isStreaming: false, streamedText: '' })
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'Connection error. Please try again.',
          timestamp: new Date().toISOString(),
        },
      ])
      setStreaming({ isStreaming: false, streamedText: '' })
    }
  }, [input, streaming.isStreaming, isCompleted, sessionId, onProposalsReceived])

  return (
    <div className="flex flex-col h-full">
      {/* Chat history */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !streaming.isStreaming && (
          <div className="flex flex-col items-center justify-center text-center text-muted-foreground py-16 gap-4">
            <AgentAvatar agentId={agentId} size="xl" />
            <div className="space-y-2 max-w-md">
              <p className="text-base font-medium text-foreground">
                Plan with {agentName}
              </p>
              <p className="text-sm">
                Describe the content you want to plan — topics, themes, dates, or audience.
                {' '}{agentName} will suggest calendar items you can review and approve.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, idx) => {
          // Check if previous message was also from the same role (assistant grouping)
          const prevMsg = idx > 0 ? messages[idx - 1] : null
          const isConsecutiveAssistant = msg.role === 'assistant' && prevMsg?.role === 'assistant'

          if (msg.role === 'user') {
            return (
              <div key={msg.id}>
                <div className="flex justify-end">
                  <div className="rounded-lg p-2.5 bg-accent/20 max-w-[75%]">
                    <p className="text-xs whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              </div>
            )
          }

          // Assistant message — strip JSON blocks, show planning indicator
          const { segments, proposalCount } = stripAndSplit(msg.content)

          // Nothing to show (pure JSON message with no text)
          if (segments.length === 0 && proposalCount === 0) return null

          return (
            <div key={msg.id} className={`space-y-2 ${isConsecutiveAssistant ? '-mt-2' : ''}`}>
              {segments.map((segment, si) => {
                const showAvatar = si === 0 && !isConsecutiveAssistant
                return (
                  <div key={si} className="flex items-start gap-2.5">
                    {showAvatar ? (
                      <AgentAvatar agentId={agentId} size="sm" className="mt-0.5 shrink-0" />
                    ) : (
                      <div className="w-6 shrink-0" />
                    )}
                    <div className="rounded-lg p-2.5 max-w-[85%] border-l-2 bg-[rgba(255,255,255,0.03)]" style={agentBorderStyle}>
                      <p className="text-xs whitespace-pre-wrap">{segment}</p>
                    </div>
                  </div>
                )
              })}
              {proposalCount > 0 && (
                <div className="flex items-start gap-2.5">
                  <div className="w-6 shrink-0" />
                  <Badge variant="outline" className="text-[10px]">
                    {proposalCount} {proposalCount === 1 ? 'item' : 'items'} proposed
                  </Badge>
                </div>
              )}
            </div>
          )
        })}

        {/* Streaming message bubbles — one per segment between JSON blocks */}
        {streaming.isStreaming && streaming.streamedText && (() => {
          const { segments, proposalCount, hasPartialBlock } = stripAndSplit(streaming.streamedText)
          const lastMsg = messages[messages.length - 1]
          const isConsecutive = lastMsg?.role === 'assistant'

          if (segments.length === 0 && proposalCount === 0) {
            // No visible text yet
            return null
          }

          return (
            <div className={`space-y-2 ${isConsecutive ? '-mt-2' : ''}`}>
              {segments.map((segment, si) => {
                const showAvatar = si === 0 && !isConsecutive
                return (
                  <div key={si} className="flex items-start gap-2.5">
                    {showAvatar ? (
                      <AgentAvatar agentId={agentId} size="sm" className="mt-0.5 shrink-0" />
                    ) : (
                      <div className="w-6 shrink-0" />
                    )}
                    <div className="rounded-lg p-2.5 max-w-[85%] border-l-2 bg-[rgba(255,255,255,0.03)]" style={agentBorderStyle}>
                      <p className="text-xs whitespace-pre-wrap">{segment}</p>
                    </div>
                  </div>
                )
              })}
              {(hasPartialBlock || proposalCount > 0) && (
                <div className="flex items-start gap-2.5">
                  <div className="w-6 shrink-0" />
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>
                      {proposalCount > 0
                        ? `Planning ${proposalCount} ${proposalCount === 1 ? 'item' : 'items'}...`
                        : 'Preparing proposal...'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {/* Thinking indicator when streaming but no text yet */}
        {streaming.isStreaming && !streaming.streamedText && (
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <AgentAvatar agentId={agentId} size="sm" className="shrink-0" />
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="text-xs">{agentName} is thinking...</span>
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      {/* Input */}
      {!isCompleted && (
        <div className="p-4 border-t border-border">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSend()
            }}
            className="flex gap-2 items-start"
          >
            <Textarea
              value={input}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={`Ask ${agentName} for content ideas...`}
              className="bg-surface min-h-[80px] resize-none"
              disabled={streaming.isStreaming}
            />
            <Button type="submit" disabled={streaming.isStreaming || !input.trim()} className="shrink-0 cursor-pointer disabled:cursor-not-allowed">
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      )}

      {isCompleted && (
        <div className="p-4 border-t border-border text-center">
          <Badge variant="outline" className="text-muted-foreground">
            Session completed — read-only
          </Badge>
        </div>
      )}
    </div>
  )
}
