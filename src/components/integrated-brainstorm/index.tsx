'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useAgent, useVerticalResize } from '@bakin/sdk/hooks'
import { CollapsedHeader, DEFAULT_ICON, DEFAULT_LABEL } from './collapsed-header'
import { DefaultEmptyState } from './empty-state'
import { InputRow, type InputRowHandle } from './input-row'
import { MessageList } from './message-list'
import { AbortedNotice, ErrorBubble, StreamingBubble, ThinkingIndicator } from './thinking-indicator'
import { useBrainstormState } from './use-brainstorm-state'
import type { IntegratedBrainstormProps } from './types'

export type {
  BrainstormMessage,
  IntegratedBrainstormProps,
  BrainstormOnSend,
  SendContext,
  AssistantTransformed,
} from './types'

export function IntegratedBrainstorm({
  messages,
  onMessagesChange,
  onSend,
  agentId,
  onAgentChange,
  label = DEFAULT_LABEL,
  icon = DEFAULT_ICON,
  placeholder,
  emptyState,
  collapsible = true,
  defaultOpen = true,
  conversationStartHeight = 400,
  minHeight = 100,
  maxHeight = 720,
  maxInputHeight = 200,
  storageKey,
  fitParent = false,
  showHeader = true,
  readOnly = false,
  readOnlyNotice,
  transformAssistantMessage,
}: IntegratedBrainstormProps) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<InputRowHandle | null>(null)
  const wasOpenRef = useRef(defaultOpen)

  const agent = useAgent(agentId)
  const agentName = agent?.name ?? agentId

  const { height, setHeight, handleProps } = useVerticalResize({
    defaultHeight: minHeight,
    minHeight,
    maxHeight,
    storageKey: fitParent ? undefined : storageKey,
  })
  const didAutoExpandRef = useRef(fitParent || height > minHeight + 10 || messages.length > 0)

  const { status, streamingContent, thinkingVerb, errorMessage, wasAborted, send, abort } = useBrainstormState({
    messages,
    onMessagesChange,
    onSend,
    defaultAgentId: agentId,
  })

  const handleSend = useCallback(
    (prompt: string) => {
      if (!didAutoExpandRef.current) {
        didAutoExpandRef.current = true
        setHeight(conversationStartHeight)
      }
      return send(prompt)
    },
    [send, setHeight, conversationStartHeight],
  )

  const replyCount = messages.filter((m) => m.role === 'assistant').length
  const isOpen = collapsible ? open : true
  const resolvedPlaceholder = placeholder ?? `Ask ${agentName}…`

  // Auto-scroll history on new messages / tokens.
  useEffect(() => {
    if (!isOpen) return
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingContent, isOpen])

  // Focus the textarea when the panel transitions from collapsed to open.
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      inputRef.current?.focus()
    }
    wasOpenRef.current = isOpen
  }, [isOpen])

  // Refocus the textarea after a send resolves or aborts.
  const prevStatusRef = useRef(status)
  useEffect(() => {
    if (prevStatusRef.current !== 'idle' && status === 'idle' && isOpen && !readOnly) {
      // Only refocus if the user hasn't moved focus elsewhere.
      const active = document.activeElement
      if (!active || active === document.body) {
        inputRef.current?.focus()
      }
    }
    prevStatusRef.current = status
  }, [status, isOpen, readOnly])

  // Transform streaming text (e.g. strip inline JSON proposal blocks).
  const streamTransformed = transformAssistantMessage
    ? transformAssistantMessage(streamingContent)
    : { text: streamingContent }

  return (
    <div
      data-testid="integrated-brainstorm"
      className={
        fitParent
          ? 'relative flex flex-col h-full min-h-0 pb-1 overflow-hidden'
          : 'relative shrink-0 border-t border-[rgba(255,255,255,0.06)] pt-2 pb-1 flex flex-col overflow-hidden'
      }
      style={!fitParent && isOpen ? { height } : undefined}
    >
      {isOpen && !fitParent && (
        <div
          {...handleProps}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize brainstorm panel"
          className="absolute inset-x-0 top-0 h-1.5 -translate-y-1/2 cursor-row-resize hover:bg-accent/50 active:bg-accent transition-colors z-10"
          data-testid="resize-handle"
        />
      )}
      {showHeader && (
        <CollapsedHeader
          open={isOpen}
          collapsible={collapsible}
          onToggle={() => setOpen((prev) => !prev)}
          label={label}
          icon={icon}
          replyCount={replyCount}
          bodyId={bodyId}
        />
      )}
      {isOpen && (
        <div id={bodyId} className="flex flex-col flex-1 min-h-0 justify-end">
          {messages.length === 0 && status === 'idle' && !errorMessage ? (
            <div className="flex-1 min-h-0 overflow-y-auto flex items-center justify-center pb-[10%]">
              {emptyState ?? <DefaultEmptyState agentId={agentId} />}
            </div>
          ) : (
            <div
              data-testid="brainstorm-history"
              className="flex-1 min-h-0 overflow-y-auto mb-2 pr-1"
              style={{ scrollbarGutter: 'stable' }}
            >
              {messages.length > 0 && (
                <MessageList
                  messages={messages}
                  defaultAgentId={agentId}
                  transform={transformAssistantMessage}
                />
              )}
              {status === 'sending' && (
                <ThinkingIndicator agentId={agentId} verb={thinkingVerb} />
              )}
              {status === 'streaming' && streamTransformed.text && (
                <StreamingBubble
                  agentId={agentId}
                  content={streamTransformed.text}
                  extras={streamTransformed.extras}
                />
              )}
              {errorMessage && <ErrorBubble message={errorMessage} />}
              {wasAborted && status === 'idle' && !errorMessage && <AbortedNotice />}
              <div ref={endRef} />
            </div>
          )}
          {readOnly ? (
            <div
              data-testid="readonly-notice"
              className="shrink-0 px-3 py-2 rounded-lg border border-[rgba(255,255,255,0.06)] bg-zinc-900/40 text-xs text-zinc-400 text-center"
            >
              {readOnlyNotice ?? 'Chat is read-only.'}
            </div>
          ) : (
            <InputRow
              ref={inputRef}
              placeholder={resolvedPlaceholder}
              disabled={false}
              status={status}
              maxInputHeight={maxInputHeight}
              agentId={agentId}
              onAgentChange={onAgentChange}
              onSubmit={(text) => {
                void handleSend(text)
              }}
              onAbort={abort}
            />
          )}
        </div>
      )}
    </div>
  )
}
