'use client'

/**
 * AgentTurn — one agent turn: avatar + name header (the avatar is ALWAYS
 * present, including the thinking state — a floating spinner with no author
 * was the exact pre-kit bug), items in arrival order (text/activity/error),
 * streaming shimmer, and error/aborted footers.
 */
import { useCallback, useState } from 'react'
import { AlertTriangle, Check, CircleSlash, Copy, Loader2, RotateCcw } from 'lucide-react'
import { useAgent } from '@makinbakin/sdk/hooks'

import { AgentAvatar } from '../agent-avatar'
import { MarkdownContent } from '../markdown-content'
import { ActivityGroup } from './activity-group'
import type { ConversationToolCall, ConversationTurn, TurnItem } from './fold'
import { formatAbsoluteTime, formatRelativeTime } from './relative-time'

export function TurnTimestamp({ ts }: { ts?: string }) {
  if (!ts) return null
  return (
    <time
      dateTime={ts}
      title={formatAbsoluteTime(ts)}
      className="text-[11px] text-muted-foreground/70 opacity-0 transition-opacity group-hover/turn:opacity-100"
    >
      {formatRelativeTime(ts)}
    </time>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      },
      () => {},
    )
  }, [text])
  return (
    <button
      type="button"
      data-conv-copy
      onClick={copy}
      aria-label={label}
      className="inline-flex items-center rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/turn:opacity-100"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  )
}

/** Streaming shimmer label ('thinking…', custom verbs via `label`). */
function ShimmerLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="size-3 animate-spin" />
      <span className="animate-pulse">{label}…</span>
    </div>
  )
}

/**
 * Standalone avatar + shimmer row for surfaces that render the indicator
 * outside an AgentTurn. Inside a turn the shimmer renders under the header.
 */
export function ThinkingIndicator({ agentId, label = 'thinking' }: { agentId?: string; label?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span data-conv-avatar className="pt-0.5">
        <AgentAvatar agentId={agentId ?? ''} size="sm" />
      </span>
      <ShimmerLabel label={label} />
    </div>
  )
}

function turnText(items: TurnItem[]): string {
  return items
    .filter((i): i is Extract<TurnItem, { type: 'text' }> => i.type === 'text')
    .map((i) => i.content)
    .join('\n\n')
}

export interface AgentTurnProps {
  turn: Extract<ConversationTurn, { kind: 'agent' }>
  /** Fallback author when the turn doesn't carry its own agentId. */
  agentId?: string
  /** Re-send the last user message; renders "Try again" on error turns. */
  onRetry?: () => void
  /** Tool-call row click-through (detail drawer). */
  onOpenCall?: (call: ConversationToolCall) => void
  /**
   * Hook for surfaces that post-process assistant text (e.g. the brainstorm
   * proposal stripper). Returns the text to render plus optional extra nodes.
   */
  transformText?: (text: string) => { text: string; extras?: React.ReactNode }
}

export function AgentTurn({ turn, agentId, onRetry, onOpenCall, transformText }: AgentTurnProps) {
  const author = turn.agentId ?? agentId
  const agent = useAgent(author ?? '')
  const name = agent?.name ?? author ?? 'Agent'
  const streaming = turn.status === 'streaming'
  const copyText = turnText(turn.items)

  return (
    <div className="group/turn flex items-start gap-3" data-conv-turn>
      <span data-conv-avatar className="pt-0.5">
        <AgentAvatar agentId={author ?? ''} size="sm" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{name}</span>
          <TurnTimestamp ts={turn.ts} />
          {copyText ? <CopyButton text={copyText} label="Copy reply" /> : null}
        </div>

        {turn.items.map((item, i) => {
          if (item.type === 'text') {
            if (item.format !== 'markdown') {
              return (
                <pre key={i} className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                  {item.content}
                </pre>
              )
            }
            const transformed = transformText ? transformText(item.content) : { text: item.content }
            return (
              <div key={i}>
                <MarkdownContent content={transformed.text} />
                {transformed.extras ?? null}
              </div>
            )
          }
          if (item.type === 'activity') {
            return <ActivityGroup key={i} calls={item.calls} onOpenCall={onOpenCall} />
          }
          return (
            <div key={i} className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{item.message}</span>
              {item.errorKind ? (
                <span className="rounded bg-destructive/10 px-1 font-mono text-xs">{item.errorKind}</span>
              ) : null}
            </div>
          )
        })}

        {streaming ? <ShimmerLabel label={turn.statusLabel ?? 'thinking'} /> : null}

        {turn.status === 'aborted' ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CircleSlash className="size-3" /> Stopped
          </div>
        ) : null}

        {turn.status === 'error' && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent"
          >
            <RotateCcw className="size-3" /> Try again
          </button>
        ) : null}
      </div>
    </div>
  )
}
