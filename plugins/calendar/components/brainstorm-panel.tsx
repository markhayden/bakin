'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { AgentAvatar } from '@/components/agent-avatar'
import { Send, Check, X, Loader2 } from 'lucide-react'
import type { ContentAgent } from '../types'
import { AGENT_INFO, DISCORD_GENERAL } from '../types'

const CONTENT_AGENTS = Object.keys(AGENT_INFO) as ContentAgent[]

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  suggestions?: SuggestedItem[]
}

interface SuggestedItem {
  title: string
  scheduledAt: string
  contentType: string
  tone: string
  brief: string
  accepted?: boolean
  rejected?: boolean
}

interface Props {
  onItemCreated: () => void
}

export function BrainstormPanel({ onItemCreated }: Props) {
  const [agent, setAgent] = useState<ContentAgent>('chef')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    try {
      const res = await fetch('/api/plugins/calendar/brainstorm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agent,
          message: userMessage,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.response,
            suggestions: data.suggestions || [],
          },
        ])
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: 'Sorry, something went wrong. Try again.' },
        ])
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Connection error. Please try again.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleAcceptSuggestion = async (msgIdx: number, sugIdx: number) => {
    const msg = messages[msgIdx]
    if (!msg.suggestions) return

    const suggestion = msg.suggestions[sugIdx]

    const res = await fetch('/api/plugins/calendar/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: suggestion.title,
        agent,
        contentType: suggestion.contentType,
        tone: suggestion.tone,
        scheduledAt: suggestion.scheduledAt,
        brief: suggestion.brief,
        channel: 'discord',
        channelTarget: DISCORD_GENERAL,
        status: 'draft',
      }),
    })

    if (res.ok) {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === msgIdx
            ? {
                ...m,
                suggestions: m.suggestions?.map((s, j) =>
                  j === sugIdx ? { ...s, accepted: true } : s
                ),
              }
            : m
        )
      )
      onItemCreated()
    }
  }

  const handleRejectSuggestion = (msgIdx: number, sugIdx: number) => {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === msgIdx
          ? {
              ...m,
              suggestions: m.suggestions?.map((s, j) =>
                j === sugIdx ? { ...s, rejected: true } : s
              ),
            }
          : m
      )
    )
  }

  const agentInfo = AGENT_INFO[agent]

  return (
    <div className="flex flex-col h-full">
      {/* Agent selector — avatar pills */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <span className="text-sm text-muted-foreground">Brainstorming with:</span>
        <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
          {CONTENT_AGENTS.map((a) => (
            <button
              key={a}
              onClick={() => setAgent(a)}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium transition-all ${
                agent === a
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100'
              }`}
            >
              <AgentAvatar agentId={a} size="xs" />
              {AGENT_INFO[a].name}
            </button>
          ))}
        </div>
      </div>

      {/* Chat history */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center text-muted-foreground py-16 gap-4">
            <AgentAvatar agentId={agent} size="xl" />
            <div className="space-y-2 max-w-md">
              <p className="text-base font-medium text-foreground">
                Brainstorm with {agentInfo.name}
              </p>
              <p className="text-sm">
                Describe the kind of content you&apos;re looking for — topics, themes, dates, or audience.
                {' '}{agentInfo.name} will suggest calendar items you can accept and schedule.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, msgIdx) => (
          <div key={msgIdx}>
            {msg.role === 'user' ? (
              <div className="flex justify-end">
                <div className="rounded-lg p-2.5 bg-accent/20 max-w-[75%]">
                  <p className="text-xs whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2.5">
                <AgentAvatar agentId={agent} size="sm" className="mt-0.5 shrink-0" />
                <div className="rounded-lg p-2.5 bg-surface max-w-[85%]">
                  <p className="text-xs whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            )}

            {/* Suggestion cards */}
            {msg.suggestions && msg.suggestions.length > 0 && (
              <div className="mt-3 space-y-2 ml-[34px]">
                {msg.suggestions.map((sug, sugIdx) => (
                  <div
                    key={sugIdx}
                    className={`border rounded-lg p-3 ${
                      sug.accepted
                        ? 'border-emerald-500/50 bg-emerald-500/10'
                        : sug.rejected
                        ? 'border-red-500/30 bg-red-500/5 opacity-50'
                        : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <h4 className="font-medium text-xs">{sug.title}</h4>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                          <span>{new Date(sug.scheduledAt).toLocaleDateString()}</span>
                          <Badge variant="outline" className="text-xs py-0">
                            {sug.contentType}
                          </Badge>
                          <Badge variant="outline" className="text-xs py-0">
                            {sug.tone}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                          {sug.brief}
                        </p>
                      </div>

                      {!sug.accepted && !sug.rejected && (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-emerald-400 hover:text-emerald-300"
                            onClick={() => handleAcceptSuggestion(msgIdx, sugIdx)}
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-red-400 hover:text-red-300"
                            onClick={() => handleRejectSuggestion(msgIdx, sugIdx)}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      )}

                      {sug.accepted && (
                        <Badge className="bg-emerald-500/20 text-emerald-400">
                          Added
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2.5 text-muted-foreground">
            <AgentAvatar agentId={agent} size="sm" className="shrink-0" />
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="text-xs">{agentInfo.name} is thinking...</span>
          </div>
        )}

        <div ref={scrollRef} />
      </div>

      {/* Input — taller textarea for multi-line */}
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
            disabled={loading}
          />
          <Button type="submit" disabled={loading || !input.trim()} className="shrink-0">
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}
