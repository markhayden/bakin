'use client'

/**
 * Active Context tab — read-only render of the agent's most recent
 * session JSONL parsed into a message stream. Shows what was actually
 * sent to and produced by the model.
 *
 * Per-message: role-colored badge + content. Plain text bodies render as
 * markdown; tool calls (object payloads stringified into JSON by the
 * server-side parser) render as a <pre> code block.
 *
 * Truncation banner appears when the underlying transcript was capped
 * (default 200 messages on the server).
 */
import { Loader2, MessageCircle } from 'lucide-react'
import { Badge } from '@makinbakin/sdk/ui'
import { MarkdownContent, EmptyState } from '@makinbakin/sdk/components'
import { useJsonFetch } from '@makinbakin/sdk/hooks'
import type { SessionMessage, SessionTranscript } from '../types'

export interface ActiveContextTabProps {
  agentId: string
}

const ROLE_STYLES: Record<SessionMessage['role'], string> = {
  system: 'bg-zinc-700 text-zinc-200',
  user: 'bg-blue-600/30 text-blue-200',
  assistant: 'bg-emerald-600/30 text-emerald-200',
  tool: 'bg-amber-600/30 text-amber-200',
}

function isJsonLike(content: string): boolean {
  const trimmed = content.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function MessageRow({ message }: { message: SessionMessage }) {
  return (
    <article className="rounded-lg border border-border bg-muted/20 p-4">
      <header className="flex items-center gap-2 mb-2">
        <Badge className={`${ROLE_STYLES[message.role]} text-[10px] uppercase tracking-wider`} variant="secondary">
          {message.role}
        </Badge>
        {message.toolName && (
          <span className="text-xs font-mono text-muted-foreground">{message.toolName}</span>
        )}
        {message.model && (
          <span className="text-[10px] text-muted-foreground">{message.model}</span>
        )}
        {message.ts && (
          <span className="text-[10px] text-muted-foreground ml-auto font-mono">
            {new Date(message.ts).toLocaleTimeString()}
          </span>
        )}
      </header>
      <div className="text-sm">
        {message.role === 'tool' || isJsonLike(message.content) ? (
          <pre className="bg-muted/40 rounded p-3 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap break-words">
            {message.content}
          </pre>
        ) : (
          <MarkdownContent content={message.content} />
        )}
      </div>
    </article>
  )
}

export function ActiveContextTab({ agentId }: ActiveContextTabProps) {
  const { data, loading, error: fetchError } = useJsonFetch<{ ok: boolean; transcript: SessionTranscript | null; error?: string }>(
    `/api/plugins/team/${agentId}/active-context`,
  )
  const transcript = data?.ok ? data.transcript : null
  const error = fetchError ?? (data && !data.ok ? (data.error ?? 'Failed to load active context') : null)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="size-4 animate-spin mr-2" />
        Loading session context...
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-sm text-destructive py-12 text-center">{error}</div>
    )
  }

  if (!transcript || transcript.messages.length === 0) {
    return (
      <EmptyState
        variant="panel"
        icon={MessageCircle}
        title="No session context yet"
        description="The most recent dispatch's full message stream appears here — the system prompt, every user/assistant turn, and every tool call. Run a task with this agent to populate it."
      />
    )
  }

  return (
    <div className="w-full space-y-3">
      {transcript.truncated && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          Showing latest {transcript.messages.length} of {transcript.totalMessages} messages.
          Older messages omitted for performance.
        </div>
      )}
      <div className="text-xs text-muted-foreground font-mono">
        Session: {transcript.sessionId || 'unknown'}
        {transcript.sessionStarted && ` · started ${new Date(transcript.sessionStarted).toLocaleString()}`}
      </div>
      <div className="space-y-2">
        {transcript.messages.map((msg, i) => (
          <MessageRow key={`${msg.ts ?? i}-${i}`} message={msg} />
        ))}
      </div>
    </div>
  )
}
