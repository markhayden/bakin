'use client'

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '../primitives/avatar'
import { cn } from '../utils'
import {
  type AgentTurnProps,
  type ConversationAgent,
  type ConversationAvatarRenderer,
  type ConversationTextRenderer,
} from './agent-turn'
import { Composer, type ComposerAttachments } from './composer'
import { Conversation, type ConversationProps } from './conversation'
import {
  foldConversation,
  type ConversationChunk,
  type ConversationMessage,
  type ConversationToolCall,
} from './fold'
import { ToolCallDrawer } from './tool-call-drawer'
import type { ConversationAttachmentRenderer } from './user-message'
import { usePersistedLeadingEdgeResize } from './use-persisted-leading-edge-resize'

const PANEL_DEFAULT_HEIGHT = 420
const PANEL_MIN_HEIGHT = 240
const PANEL_MAX_HEIGHT = 800

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase()
}

function DefaultHeaderAvatar({ agent }: { agent: ConversationAgent }) {
  return (
    <Avatar size="xs">
      {agent.avatarUrl ? <AvatarImage src={agent.avatarUrl} alt="" /> : null}
      <AvatarFallback>{initials(agent.name)}</AvatarFallback>
    </Avatar>
  )
}

/** Props for a bounded, single-session conversation embedded in a host surface. */
export interface ConversationPanelProps {
  messages: readonly ConversationMessage[]
  liveChunks?: readonly ConversationChunk[] | null
  streaming?: boolean
  /** Presentation-ready fallback identity; host stores stay outside this package. */
  agent?: ConversationAgent
  resolveAgent?: ConversationProps['resolveAgent']
  /** Optional consumer-owned selector or other control beside the composer. */
  agentControl?: ReactNode
  onSend: (content: string) => void | Promise<void>
  onAbort?: () => void
  onRetry?: ConversationProps['onRetry']
  renderAvatar?: ConversationAvatarRenderer
  renderText?: ConversationTextRenderer
  renderAttachment?: ConversationAttachmentRenderer
  transformText?: AgentTurnProps['transformText']
  formatToolSummary?: AgentTurnProps['formatToolSummary']
  storageKey: string
  title?: ReactNode
  showHeader?: boolean
  /** Fill an explicitly bounded parent instead of owning a persisted height. */
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

/**
 * Focused conversation composition for embedded sessions. The consumer owns
 * transport, persistence, routing, identity lookup, and attachment mutation.
 */
export function ConversationPanel({
  messages,
  liveChunks,
  streaming = false,
  agent,
  resolveAgent,
  agentControl,
  onSend,
  onAbort,
  onRetry,
  renderAvatar,
  renderText,
  renderAttachment,
  transformText,
  formatToolSummary,
  storageKey,
  title,
  showHeader = true,
  fitParent = false,
  readOnly = false,
  readOnlyNotice,
  placeholder = 'Send a message…',
  inputLabel,
  emptyState,
  maxLength,
  attachments,
  defaultHeight = PANEL_DEFAULT_HEIGHT,
  minHeight = PANEL_MIN_HEIGHT,
  maxHeight = PANEL_MAX_HEIGHT,
  className,
}: ConversationPanelProps) {
  const [openCall, setOpenCall] = useState<ConversationToolCall | null>(null)
  const { size: height, handleProps } = usePersistedLeadingEdgeResize({
    axis: 'y',
    defaultSize: defaultHeight,
    minSize: minHeight,
    maxSize: maxHeight,
    storageKey: `bakin-vresize:conv-panel:${storageKey}`,
    disabled: fitParent,
  })

  const turns = useMemo(
    () => foldConversation(
      messages,
      liveChunks != null ? { liveChunks, liveAgentId: agent?.id } : undefined,
    ),
    [agent?.id, liveChunks, messages],
  )

  const panelStyle = fitParent ? undefined : ({ height } as CSSProperties)

  return (
    <section
      data-conv-panel=""
      aria-label={typeof title === 'string' ? title : 'Conversation'}
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-bakin-overlay border border-bakin-border-subtle bg-bakin-canvas-default',
        'font-bakin-typography-family-ui text-[length:var(--bakin-typography-size-body)] text-bakin-text-primary',
        fitParent && 'h-full',
        className,
      )}
      style={panelStyle}
    >
      {!fitParent ? (
        <div
          {...handleProps}
          aria-label="Resize conversation panel"
          className="group/handle flex h-bakin-2 w-full shrink-0 touch-none cursor-row-resize items-center justify-center outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-bakin-focus-ring"
        >
          <span className="h-px w-bakin-8 rounded-bakin-pill bg-bakin-border-subtle opacity-0 transition-opacity group-hover/handle:opacity-100 group-focus-visible/handle:opacity-100" />
        </div>
      ) : null}

      {showHeader ? (
        <header
          data-conv-panel-header=""
          className="flex min-w-0 shrink-0 items-center gap-bakin-2 border-b border-bakin-border-subtle px-bakin-4 py-bakin-3"
        >
          {agent ? (
            <span aria-hidden="true" className="shrink-0">
              {renderAvatar ? renderAvatar(agent) : <DefaultHeaderAvatar agent={agent} />}
            </span>
          ) : null}
          <h2 className="min-w-0 truncate font-bakin-typography-weight-semibold text-bakin-text-primary">
            {title ?? 'Conversation'}
          </h2>
        </header>
      ) : null}

      <Conversation
        turns={turns}
        mode="contained"
        agent={agent}
        resolveAgent={resolveAgent}
        emptyState={emptyState}
        onRetry={onRetry}
        onOpenCall={setOpenCall}
        renderAvatar={renderAvatar}
        renderText={renderText}
        renderAttachment={renderAttachment}
        transformText={transformText}
        formatToolSummary={formatToolSummary}
        className="min-h-0 flex-1"
      />

      {readOnly ? (
        <div
          data-conv-readonly=""
          className="shrink-0 border-t border-bakin-border-subtle px-bakin-4 py-bakin-3 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted"
        >
          {readOnlyNotice ?? 'This conversation is read-only.'}
        </div>
      ) : (
        <Composer
          storageKey={storageKey}
          onSend={onSend}
          busy={streaming}
          onAbort={onAbort}
          placeholder={placeholder}
          inputLabel={inputLabel}
          maxLength={maxLength}
          attachments={attachments}
          leadingSlot={agentControl ? (
            <span data-conv-agent-control="" className="shrink-0 self-end">
              {agentControl}
            </span>
          ) : undefined}
        />
      )}

      <ToolCallDrawer
        call={openCall}
        open={openCall !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setOpenCall(null)
        }}
        storageKey={`${storageKey}:tool-call`}
      />
    </section>
  )
}
