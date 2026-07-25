'use client'

/**
 * ConversationPanel — the embedded single-session conversation surface:
 * one thread inside a host page (brainstorms, plan reviews), no session
 * navigation. Composes Conversation + Composer + an internal
 * ToolCallDrawer; `fitParent` fills the host, otherwise the panel is a
 * drag-resizable fixed-height block. Read-only surfaces swap the composer
 * for an honest notice.
 */
import { useMemo, useState } from 'react'
import type { ChatChunk as RuntimeChatChunk } from '@bakin/core/adapters/runtime'

import { useVerticalResize } from '@/hooks/use-vertical-resize'
import { AgentAvatar } from '../agent-avatar'
import { AgentSelect } from '../agent-select'
import { Conversation } from './conversation'
import { Composer, type ComposerAttachments } from './composer'
import { QueuedMessageList, type ConversationQueuedItem } from './queued-message-list'
import { ToolCallDrawer } from './tool-call-drawer'
import { foldConversation, type ConversationMessage, type ConversationToolCall } from './fold'
import type { AgentTurnProps } from './agent-turn'

const PANEL_DEFAULT_HEIGHT = 420
const PANEL_MIN_HEIGHT = 240
const PANEL_MAX_HEIGHT = 800

export interface ConversationPanelProps {
  /** Persisted rows (the caller owns storage; map local shapes onto ConversationMessage). */
  messages: ConversationMessage[]
  /** In-flight turn chunks (from useConversationThread); null/undefined when idle. */
  liveChunks?: RuntimeChatChunk[] | null
  streaming?: boolean
  agentId?: string
  /** Renders an agent switcher next to the composer. */
  onAgentChange?: (agentId: string) => void
  onSend: (content: string) => void | Promise<void>
  onAbort?: () => void
  onRetry?: AgentTurnProps['onRetry']
  transformText?: AgentTurnProps['transformText']
  /** Keys drafts/history/resize persistence. */
  storageKey: string
  title?: React.ReactNode
  /** Default true; embedded surfaces with their own chrome pass false. */
  showHeader?: boolean
  /** Fill the host container instead of a fixed resizable height. */
  fitParent?: boolean
  readOnly?: boolean
  readOnlyNotice?: React.ReactNode
  placeholder?: string
  emptyState?: React.ReactNode
  maxLength?: number
  attachments?: ComposerAttachments
  /** Queue-aware surface (#732): send-while-streaming queues (opt-in). */
  queueMode?: boolean
  /** Pending queued follow-ups, rendered between conversation and composer. */
  queuedItems?: ConversationQueuedItem[]
  onRemoveQueued?: (item: ConversationQueuedItem) => void
  className?: string
}

export function ConversationPanel({
  messages,
  liveChunks,
  streaming = false,
  agentId,
  onAgentChange,
  onSend,
  onAbort,
  onRetry,
  transformText,
  storageKey,
  title,
  showHeader = true,
  fitParent = false,
  readOnly = false,
  readOnlyNotice,
  placeholder = 'Send a message…',
  emptyState,
  maxLength,
  attachments,
  queueMode = false,
  queuedItems,
  onRemoveQueued,
  className,
}: ConversationPanelProps) {
  const [openCall, setOpenCall] = useState<ConversationToolCall | null>(null)
  const { height, handleProps } = useVerticalResize({
    defaultHeight: PANEL_DEFAULT_HEIGHT,
    minHeight: PANEL_MIN_HEIGHT,
    maxHeight: PANEL_MAX_HEIGHT,
    storageKey: `conv-panel:${storageKey}`,
  })

  const turns = useMemo(
    () =>
      foldConversation(
        messages,
        liveChunks != null ? { liveChunks, liveAgentId: agentId } : undefined,
      ),
    [messages, liveChunks, agentId],
  )

  return (
    <div
      data-conv-panel
      className={`flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background ${
        fitParent ? 'h-full' : ''
      } ${className ?? ''}`}
      style={fitParent ? undefined : { height }}
    >
      {!fitParent ? (
        <div
          {...handleProps}
          aria-label="Resize conversation panel"
          className="group/handle flex h-2 w-full shrink-0 cursor-row-resize items-center justify-center"
        >
          <div className="h-0.5 w-10 rounded-full bg-border opacity-0 transition-opacity group-hover/handle:opacity-100" />
        </div>
      ) : null}

      {showHeader ? (
        <div data-conv-panel-header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          {agentId ? <AgentAvatar agentId={agentId} size="xs" /> : null}
          <div className="min-w-0 truncate text-sm font-medium">{title ?? 'Conversation'}</div>
        </div>
      ) : null}

      <Conversation
        turns={turns}
        agentId={agentId}
        emptyState={emptyState}
        onRetry={onRetry}
        onOpenCall={setOpenCall}
        transformText={transformText}
      />

      {queuedItems?.length ? <QueuedMessageList items={queuedItems} onRemove={onRemoveQueued} /> : null}

      {readOnly ? (
        readOnlyNotice ? (
          <div data-conv-readonly className="shrink-0 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            {readOnlyNotice}
          </div>
        ) : null
      ) : (
        <Composer
          storageKey={storageKey}
          onSend={onSend}
          busy={streaming}
          onAbort={onAbort}
          queueMode={queueMode}
          placeholder={placeholder}
          maxLength={maxLength}
          attachments={attachments}
          leadingSlot={
            // Picker renders whenever switching is possible — an empty
            // agentId (no main agent resolved) must still offer a way to pick.
            onAgentChange ? (
              <span data-conv-agent-select className="shrink-0 self-end">
                <AgentSelect value={agentId ?? ''} onValueChange={onAgentChange} className="h-8 w-auto min-w-[130px] text-xs" />
              </span>
            ) : undefined
          }
        />
      )}

      <ToolCallDrawer call={openCall} open={openCall !== null} onOpenChange={(open) => !open && setOpenCall(null)} />
    </div>
  )
}
