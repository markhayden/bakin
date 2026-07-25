'use client'

import type { ReactNode } from 'react'
import type { ChatChunk as RuntimeChatChunk } from '@bakin/core/adapters/runtime'
import {
  ConversationPanel as FocusedConversationPanel,
  type AgentTurnProps,
  type ComposerAttachments,
  type ConversationAgent,
  type ConversationMessage,
  type ConversationPanelProps as FocusedConversationPanelProps,
} from '@makinbakin/sdk/conversation'
import { useAgentStore } from '@makinbakin/sdk/hooks'

import { AgentSelect } from '../agent-select'
import { formatLegacySummary, LegacyAvatar, renderLegacyText } from './agent-turn'

/** Compatibility props for product and existing plugin consumers. */
export interface ConversationPanelProps {
  messages: readonly ConversationMessage[]
  liveChunks?: readonly RuntimeChatChunk[] | null
  streaming?: boolean
  agentId?: string
  onAgentChange?: (agentId: string) => void
  onSend: (content: string) => void | Promise<void>
  onAbort?: () => void
  onRetry?: FocusedConversationPanelProps['onRetry']
  transformText?: AgentTurnProps['transformText']
  storageKey: string
  title?: ReactNode
  showHeader?: boolean
  fitParent?: boolean
  readOnly?: boolean
  readOnlyNotice?: ReactNode
  placeholder?: string
  inputLabel?: string
  emptyState?: ReactNode
  maxLength?: number
  attachments?: ComposerAttachments
  defaultHeight?: number
  minHeight?: number
  maxHeight?: number
  className?: string
}

/** @deprecated Import `ConversationPanel` from `@makinbakin/sdk/conversation`. */
export function ConversationPanel({
  messages,
  liveChunks,
  streaming,
  agentId,
  onAgentChange,
  onSend,
  onAbort,
  onRetry,
  transformText,
  storageKey,
  title,
  showHeader,
  fitParent,
  readOnly,
  readOnlyNotice,
  placeholder,
  inputLabel,
  emptyState,
  maxLength,
  attachments,
  defaultHeight,
  minHeight,
  maxHeight,
  className,
}: ConversationPanelProps) {
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
    <FocusedConversationPanel
      messages={messages}
      liveChunks={liveChunks}
      streaming={streaming}
      agent={resolveAgent(agentId)}
      resolveAgent={resolveAgent}
      agentControl={onAgentChange ? (
        <span data-conv-agent-select="">
          <AgentSelect
            value={agentId ?? ''}
            onValueChange={onAgentChange}
            className="h-8 w-auto min-w-[130px] text-xs"
          />
        </span>
      ) : undefined}
      onSend={onSend}
      onAbort={onAbort}
      onRetry={onRetry}
      transformText={transformText}
      renderText={renderLegacyText}
      renderAvatar={LegacyAvatar}
      formatToolSummary={formatLegacySummary}
      storageKey={storageKey}
      title={title}
      showHeader={showHeader}
      fitParent={fitParent}
      readOnly={readOnly}
      readOnlyNotice={readOnlyNotice}
      placeholder={placeholder}
      inputLabel={inputLabel}
      emptyState={emptyState}
      maxLength={maxLength}
      attachments={attachments}
      defaultHeight={defaultHeight}
      minHeight={minHeight}
      maxHeight={maxHeight}
      className={className}
    />
  )
}
