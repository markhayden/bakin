'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { Button } from '../primitives/button'
import { cn } from '../utils'
import {
  AgentTurn,
  type AgentTurnProps,
  type ConversationAgent,
  type ConversationAvatarRenderer,
  type ConversationTextRenderer,
} from './agent-turn'
import type { ConversationToolCall, ConversationTurn } from './fold'
import { dayKey, formatAbsoluteTime, formatDayLabel } from './relative-time'
import type { ConversationTurnUsage } from './turn-usage'
import {
  UserMessage,
  type ConversationAttachmentRenderer,
} from './user-message'

const PIN_THRESHOLD_PX = 48

export type ConversationMode = 'document' | 'contained'

/** Props for an ordered, render-ready conversation timeline. */
export interface ConversationProps {
  turns: readonly ConversationTurn[]
  /** Document scroll is the product default; contained is for an explicitly bounded standalone surface. */
  mode?: ConversationMode
  /** Fallback identity for agent turns. */
  agent?: ConversationAgent
  /** Resolve identity when a turn carries its own agent id. */
  resolveAgent?: (agentId?: string) => ConversationAgent | undefined
  emptyState?: ReactNode
  onRetry?: () => void
  onOpenCall?: (call: ConversationToolCall) => void
  renderAvatar?: ConversationAvatarRenderer
  renderText?: ConversationTextRenderer
  renderAttachment?: ConversationAttachmentRenderer
  transformText?: AgentTurnProps['transformText']
  formatToolSummary?: AgentTurnProps['formatToolSummary']
  /** Recorded usage keyed by the durable turn id. */
  turnUsage?: Record<string, ConversationTurnUsage>
  /** Approximate output tokens for the active streaming turn. */
  liveOutEstimate?: number
  className?: string
}

function fallbackAgent(
  agentId: string | undefined,
  agent: ConversationAgent | undefined,
  resolveAgent: ConversationProps['resolveAgent'],
): ConversationAgent {
  const resolved = resolveAgent?.(agentId)
  if (resolved) return resolved
  if (agent && (!agentId || !agent.id || agent.id === agentId)) return agent
  return {
    ...(agentId ? { id: agentId } : {}),
    name: agentId ?? agent?.name ?? 'Agent',
  }
}

function ArrowDownIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-none stroke-current stroke-[1.5]">
      <path d="M8 2.5v10M4 8.5l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Ordered conversation content with consistent turns and day separators.
 * It owns scrolling only in explicit `contained` mode; page recipes should
 * keep this in document mode and let `PageTimeline` own the log.
 */
export function Conversation({
  turns,
  mode = 'document',
  agent,
  resolveAgent,
  emptyState,
  onRetry,
  onOpenCall,
  renderAvatar,
  renderText,
  renderAttachment,
  transformText,
  formatToolSummary,
  turnUsage,
  liveOutEstimate,
  className,
}: ConversationProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)
  const [showJump, setShowJump] = useState(false)
  const contained = mode === 'contained'

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (!contained) return
    const element = scrollRef.current
    if (!element) return
    const reducedMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const resolvedBehavior = reducedMotion ? 'auto' : behavior
    if (typeof element.scrollTo === 'function') {
      element.scrollTo({ top: element.scrollHeight, behavior: resolvedBehavior })
    } else {
      element.scrollTop = element.scrollHeight
    }
    pinnedRef.current = true
    setShowJump(false)
  }, [contained])

  const handleScroll = useCallback(() => {
    if (!contained) return
    const element = scrollRef.current
    if (!element) return
    const pinned = element.scrollHeight - element.scrollTop - element.clientHeight < PIN_THRESHOLD_PX
    pinnedRef.current = pinned
    setShowJump(!pinned)
  }, [contained])

  useEffect(() => {
    if (contained && pinnedRef.current) scrollToBottom()
  }, [contained, scrollToBottom, turns])

  let previousDay = ''

  return (
    <div
      data-conv-timeline=""
      data-mode={mode}
      className={cn('relative min-h-0 min-w-0', contained && 'h-full', className)}
    >
      <div
        ref={scrollRef}
        data-conv-scroller=""
        onScroll={contained ? handleScroll : undefined}
        className={cn(contained && 'h-full overflow-y-auto overscroll-contain')}
      >
        {turns.length === 0 && emptyState ? (
          <div className={cn('flex items-center justify-center p-bakin-6', contained && 'min-h-full')}>
            {emptyState}
          </div>
        ) : (
          <div className="grid min-w-0 gap-bakin-5 px-bakin-4 py-bakin-4">
            {turns.map((turn, index) => {
              const day = dayKey(turn.ts)
              const followsAgent = turn.kind === 'user' && turns[index - 1]?.kind === 'agent'
              const separator = day && day !== previousDay ? (
                <div
                  key={`day-${day}`}
                  data-conv-day=""
                  className="flex min-w-0 items-center gap-bakin-3 py-bakin-2"
                >
                  <span aria-hidden="true" className="h-px flex-1 bg-bakin-border-subtle/60" />
                  <time
                    dateTime={turn.ts}
                    title={formatAbsoluteTime(turn.ts!)}
                    className="shrink-0 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted"
                  >
                    {formatDayLabel(turn.ts!)}
                  </time>
                  <span aria-hidden="true" className="h-px flex-1 bg-bakin-border-subtle/60" />
                </div>
              ) : null
              if (day) previousDay = day

              return (
                <div
                  key={turn.key}
                  data-conv-turn-group=""
                  data-kind={turn.kind}
                  className={cn('grid min-w-0 gap-bakin-5', followsAgent && 'pt-bakin-4')}
                >
                  {separator}
                  {turn.kind === 'user' ? (
                    <UserMessage turn={turn} renderAttachment={renderAttachment} />
                  ) : (
                    <AgentTurn
                      turn={turn}
                      agent={fallbackAgent(turn.agentId, agent, resolveAgent)}
                      onRetry={
                        turn.status === 'error' && index === turns.length - 1
                          ? onRetry
                          : undefined
                      }
                      onOpenCall={onOpenCall}
                      renderAvatar={renderAvatar}
                      renderText={renderText}
                      transformText={transformText}
                      formatToolSummary={formatToolSummary}
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
      {contained && showJump ? (
        <Button
          type="button"
          data-conv-jump=""
          variant="secondary"
          size="sm"
          onClick={() => scrollToBottom('smooth')}
          aria-label="Jump to latest"
          className="absolute bottom-bakin-4 left-1/2 -translate-x-1/2 rounded-bakin-pill shadow-lg"
        >
          <ArrowDownIcon /> New messages
        </Button>
      ) : null}
    </div>
  )
}
