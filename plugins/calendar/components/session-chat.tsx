'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { AgentAvatar } from '@/components/agent-avatar'
import { Send, Loader2 } from 'lucide-react'
import { MarkdownContent } from '@/components/markdown-content'
import type { ContentAgent, PlanningSession, ProposedItem, SessionMessage } from '../types'
import { AGENT_INFO } from '../types'

const QUICK_REPLIES = [
  { label: 'More like this', prompt: 'Give me more ideas like the last ones' },
  { label: 'Different tone', prompt: 'Try a different tone for these suggestions' },
  { label: 'Next week instead', prompt: 'Reschedule these to next week instead' },
  { label: 'More variety', prompt: 'Add more variety in content types' },
]

interface Props {
  sessionId: string
  agentId: ContentAgent
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
  const agentInfo = AGENT_INFO[agentId]

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
      const res = await fetch(`/api/plugins/calendar/sessions/${sessionId}/messages`, {
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

                case 'proposals':
                  if (data.proposals && onProposalsReceived) {
                    onProposalsReceived(data.proposals)
                  }
                  break

                case 'done': {
                  // Replace streamed text with final message
                  const finalMsg: SessionMessage = {
                    id: data.messageId || `msg-${Date.now()}`,
                    role: 'assistant',
                    content: data.content || accumulated,
                    timestamp: new Date().toISOString(),
                  }
                  setMessages((prev) => [...prev, finalMsg])
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
                Plan with {agentInfo.name}
              </p>
              <p className="text-sm">
                Describe the content you want to plan — topics, themes, dates, or audience.
                {' '}{agentInfo.name} will suggest calendar items you can review and approve.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              <div className="flex justify-end">
                <div className="rounded-lg p-2.5 bg-accent/20 max-w-[75%]">
                  <p className="text-xs whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5">
                <AgentAvatar agentId={agentId} size="sm" className="mt-0.5 shrink-0" />
                <div className="rounded-lg p-2.5 bg-surface max-w-[85%] text-xs [&_.prose-invert]:text-xs [&_.prose-invert]:leading-relaxed">
                  <MarkdownContent content={msg.content} />
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Streaming message bubble — plain text while streaming, markdown applied on completion */}
        {streaming.isStreaming && streaming.streamedText && (
          <div className="flex items-start gap-2.5">
            <AgentAvatar agentId={agentId} size="sm" className="mt-0.5 shrink-0 animate-pulse" />
            <div className="rounded-lg p-2.5 bg-surface max-w-[85%]">
              <p className="text-xs whitespace-pre-wrap">{streaming.streamedText}</p>
            </div>
          </div>
        )}

        {/* Thinking indicator when streaming but no text yet */}
        {streaming.isStreaming && !streaming.streamedText && (
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <AgentAvatar agentId={agentId} size="sm" className="shrink-0 animate-pulse" />
            <div className="flex items-center gap-1.5">
              <span className="flex gap-0.5">
                <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
                <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
                <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
              </span>
              <span className="text-xs">{agentInfo.name} is thinking...</span>
            </div>
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      {/* Quick-reply chips */}
      {!isCompleted && messages.length > 0 && !streaming.isStreaming && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-t border-border/50 overflow-x-auto">
          {QUICK_REPLIES.map((chip) => (
            <button
              key={chip.label}
              onClick={() => {
                setInput(chip.prompt)
              }}
              className="shrink-0 text-[11px] px-2.5 py-1 rounded-full border border-border bg-surface text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              data-testid={`quick-reply-${chip.label.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

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
              placeholder={`Ask ${agentInfo.name} for content ideas...`}
              className="bg-surface min-h-[80px] resize-none"
              disabled={streaming.isStreaming}
            />
            <Button type="submit" disabled={streaming.isStreaming || !input.trim()} className="shrink-0">
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
