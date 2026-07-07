/**
 * Chat view — transcript rows + live streaming overlay + composer.
 */
import { useEffect, useRef } from 'react'
import { AlertTriangle, Loader2, Wrench } from 'lucide-react'
import { AgentAvatar, EmptyState, MarkdownContent } from '@makinbakin/sdk/components'
import { summarizeStructured, unwrapToolResult } from '@makinbakin/sdk/utils'

import { Composer } from './composer'
import { useChatStream, type LiveToolChip, type TranscriptRowDto } from './use-chat-data'

function ToolChip(props: { toolName: string; summary?: string; status: LiveToolChip['status'] }) {
  const { toolName, summary, status } = props
  // Defensive across runtimes: peel any tool-result envelope + JSON blob to
  // a clean one-line summary (the Pi adapter already does this at source,
  // but OpenClaw or a future runtime may still hand us raw JSON).
  const clean = summary ? summarizeStructured(unwrapToolResult(summary)) : ''
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {status === 'running'
        ? <Loader2 className="size-3 animate-spin" />
        : <Wrench className={`size-3 ${status === 'failed' ? 'text-destructive' : ''}`} />}
      <span className="font-mono">{toolName}</span>
      {clean ? <span className="truncate">— {clean}</span> : null}
    </div>
  )
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
  if (row.kind === 'assistant') {
    return (
      <div className="flex items-start gap-2">
        <AgentAvatar agentId={agentId} size="xs" />
        <div className="min-w-0 max-w-[85%] rounded-lg border px-3 py-2 text-sm">
          <MarkdownContent content={row.content} />
        </div>
      </div>
    )
  }
  if (row.kind === 'tool') {
    // Durable tool rows persist as "name: summary" strings.
    const [toolName, ...rest] = row.summary.split(': ')
    return <div className="pl-8"><ToolChip toolName={toolName} summary={rest.join(': ') || undefined} status="completed" /></div>
  }
  return (
    <div className="flex items-center gap-2 pl-8 text-sm text-destructive">
      <AlertTriangle className="size-4 shrink-0" />
      <span>{row.message}</span>
    </div>
  )
}

export function ChatView({ chatId }: { chatId: string }) {
  const { chat, rows, liveText, liveTools, streaming, sendError, send } = useChatStream(chatId)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [rows.length, liveText, liveTools.length])

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

        {liveTools.map((chip) => (
          <div key={chip.key} className="pl-8"><ToolChip {...chip} /></div>
        ))}
        {liveText ? (
          <div className="flex items-start gap-2">
            <AgentAvatar agentId={chat.agentId} size="xs" />
            <div className="min-w-0 max-w-[85%] rounded-lg border px-3 py-2 text-sm">
              <MarkdownContent content={liveText} />
            </div>
          </div>
        ) : streaming ? (
          <div className="flex items-center gap-2 pl-8 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> thinking…
          </div>
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
