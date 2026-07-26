'use client'

import type { ReactNode } from 'react'
import {
  Conversation as FocusedConversation,
  type AgentTurnProps,
  type ConversationAgent,
  type ConversationProps as FocusedConversationProps,
  type ConversationTurn,
} from '@makinbakin/sdk/conversation'
import { useAgentStore } from '@makinbakin/sdk/hooks'

import { formatLegacySummary, LegacyAvatar, renderLegacyText } from './agent-turn'
import type { ConversationTurnUsage } from '@makinbakin/sdk/conversation'

export interface ConversationProps {
  turns: readonly ConversationTurn[]
  /** Fallback author for agent turns that don't carry their own agentId. */
  agentId?: string
  /** Rendered centered when there are no turns (use ConversationEmptyState). */
  emptyState?: ReactNode
  onRetry?: FocusedConversationProps['onRetry']
  onOpenCall?: FocusedConversationProps['onOpenCall']
  transformText?: AgentTurnProps['transformText']
  /** Per-turn recorded usage keyed by turnId (#733) — opt-in footers. */
  turnUsage?: Record<string, ConversationTurnUsage>
  /** ~tokens streamed so far — handed only to the streaming turn. */
  liveOutEstimate?: number
  className?: string
}

/** @deprecated Import `Conversation` from `@makinbakin/sdk/conversation`. */
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
  const agentMap = useAgentStore((state) => state.agentMap)
  const displaySettings = useAgentStore((state) => state.displaySettings)

  const resolveAgent = (turnAgentId?: string): ConversationAgent | undefined => {
    const id = turnAgentId ?? agentId
    if (!id) return undefined
    const resolved = agentMap[id]
    return {
      id,
      name: displaySettings[id]?.displayName ?? resolved?.name ?? id,
      ...(resolved?.headshot ? { avatarUrl: resolved.headshot } : {}),
    }
  }

  return (
    <FocusedConversation
      turns={turns}
      mode="contained"
      agent={resolveAgent(agentId)}
      resolveAgent={resolveAgent}
      emptyState={emptyState}
      onRetry={onRetry}
      onOpenCall={onOpenCall}
      transformText={transformText}
      renderText={renderLegacyText}
      renderAvatar={LegacyAvatar}
      formatToolSummary={formatLegacySummary}
      turnUsage={turnUsage}
      liveOutEstimate={liveOutEstimate}
      className={`flex-1 ${className ?? ''}`}
    />
  )
}
