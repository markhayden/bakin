/**
 * Chat view — transcript rows + live streaming overlay + composer.
 *
 * All turn output (assistant text, tool chips, thinking status, errors)
 * renders through the SDK's TurnOutputView — the single chunk renderer.
 * This file owns only chat chrome: avatars, bubbles, indentation, composer.
 */
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { AgentAvatar, EmptyState, TurnOutputView } from '@makinbakin/sdk/components'
import type { RuntimeChatChunk } from '@makinbakin/sdk/types'

import { Composer } from './composer'
import { useChatStream, type TranscriptRowDto } from './use-chat-data'

/** Chat's assistant-bubble frame: avatar beside a bordered text block. */
function assistantFrame(agentId: string) {
  return function frame(text: ReactNode) {
    return (
      <div className="flex items-start gap-2">
        <AgentAvatar agentId={agentId} size="xs" />
        <div className="min-w-0 max-w-[85%] rounded-lg border px-3 py-2 text-sm">{text}</div>
      </div>
    )
  }
}

/** Map a durable transcript row to its normalized chunk form. */
function rowToChunk(row: TranscriptRowDto): RuntimeChatChunk | null {
  if (row.kind === 'assistant') return { type: 'text', content: row.content }
  if (row.kind === 'tool') {
    // Durable tool rows persist as "name: summary" strings.
    const [toolName, ...rest] = row.summary.split(': ')
    return {
      type: 'tool',
      data: { phase: 'result', toolName, status: 'completed', summary: rest.join(': ') || undefined },
    }
  }
  if (row.kind === 'error') return { type: 'error', content: row.message }
  return null
}

function TranscriptRow({ row, agentId }: { row: TranscriptRowDto; agentId: string }) {
  if (row.kind === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-primary/10 px-3 py-2 text-sm">
          {row.content}
        </div>
      </div>
    )
  }
  const chunk = rowToChunk(row)
  if (!chunk) return null
  return <TurnOutputView chunks={[chunk]} textFrame={assistantFrame(agentId)} rowClassName="pl-8" />
}

export function ChatView({ chatId }: { chatId: string }) {
  const { chat, rows, liveChunks, streaming, sendError, send } = useChatStream(chatId)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [rows.length, liveChunks])

  if (!chat) {
    return <EmptyState title="Chat not found" description="It may have been deleted." />
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {rows.length === 0 && !streaming ? (
          <EmptyState
            title={`Chat with ${chat.agentId}`}
            description="Say hello — the agent keeps its Bakin tools and can create tasks mid-chat."
          />
        ) : (
          rows.map((row, i) => <TranscriptRow key={`${row.ts}-${i}`} row={row} agentId={chat.agentId} />)
        )}

        {streaming || liveChunks.length > 0 ? (
          <TurnOutputView
            chunks={liveChunks}
            live={streaming}
            textFrame={assistantFrame(chat.agentId)}
            rowClassName="pl-8"
          />
        ) : null}

        {sendError ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="size-4" /> {sendError}
          </div>
        ) : null}
      </div>

      <Composer disabled={streaming} onSend={(content) => { void send(content) }} />
    </div>
  )
}
