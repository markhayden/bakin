'use client'

/**
 * Conversation — the scroll container every conversational surface renders
 * turns into: stick-to-bottom while pinned, a "new messages" jump pill when
 * scrolled up, day separators, and the shared turn renderers.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'

import { AgentTurn, type AgentTurnProps } from './agent-turn'
import type { ConversationTurnUsage } from './turn-usage'
import { UserMessage } from './user-message'
import type { ConversationTurn } from './fold'
import { dayKey, formatDayLabel } from './relative-time'

const PIN_THRESHOLD_PX = 48

export interface ConversationProps {
  turns: ConversationTurn[]
  /** Fallback author for agent turns that don't carry their own agentId. */
  agentId?: string
  /** Rendered centered when there are no turns (use ConversationEmptyState). */
  emptyState?: React.ReactNode
  onRetry?: AgentTurnProps['onRetry']
  onOpenCall?: AgentTurnProps['onOpenCall']
  transformText?: AgentTurnProps['transformText']
  /** Per-turn recorded usage keyed by turnId (#733) — opt-in footers. */
  turnUsage?: Record<string, ConversationTurnUsage>
  /** ~tokens streamed so far — handed only to the streaming turn. */
  liveOutEstimate?: number
  className?: string
}

export function Conversation({
  turns,
  agentId,
  emptyState,
  onRetry,
  onOpenCall,
  transformText,
  turnUsage,
  liveOutEstimate,
  className,
}: ConversationProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)
  const [showJump, setShowJump] = useState(false)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    pinnedRef.current = true
    setShowJump(false)
  }, [])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const pinned = fromBottom < PIN_THRESHOLD_PX
    pinnedRef.current = pinned
    setShowJump(!pinned)
  }, [])

  // Follow new content while pinned (streaming, new turns).
  useEffect(() => {
    if (pinnedRef.current) scrollToBottom()
  }, [turns, scrollToBottom])

  let prevDay = ''
  return (
    <div className={`relative min-h-0 flex-1 ${className ?? ''}`}>
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
        {turns.length === 0 && emptyState ? (
          <div className="flex h-full items-center justify-center p-6">{emptyState}</div>
        ) : (
          <div className="w-full space-y-5 px-4 py-4">
            {turns.map((turn) => {
              const day = dayKey(turn.ts)
              const separator = day && day !== prevDay ? (
                <div data-conv-day className="flex items-center gap-3 py-2" key={`day-${day}`}>
                  <div className="h-px flex-1 bg-border/60" />
                  <span className="text-[11px] text-muted-foreground">{formatDayLabel(turn.ts!)}</span>
                  <div className="h-px flex-1 bg-border/60" />
                </div>
              ) : null
              if (day) prevDay = day
              return (
                <div key={turn.key}>
                  {separator}
                  {turn.kind === 'user' ? (
                    <UserMessage turn={turn} />
                  ) : (
                    <AgentTurn
                      turn={turn}
                      agentId={agentId}
                      onRetry={turn.status === 'error' ? onRetry : undefined}
                      onOpenCall={onOpenCall}
                      transformText={transformText}
                      usage={turn.turnId ? turnUsage?.[turn.turnId] : undefined}
                      liveOutEstimate={turn.status === 'streaming' ? liveOutEstimate : undefined}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {showJump ? (
        <button
          type="button"
          data-conv-jump
          onClick={() => scrollToBottom('smooth')}
          aria-label="Jump to latest"
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1.5 text-xs shadow-md hover:bg-foreground/10"
        >
          <ArrowDown className="size-3" /> New messages
        </button>
      ) : null}
    </div>
  )
}
