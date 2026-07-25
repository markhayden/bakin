'use client'

/**
 * AgentTurn — one agent turn: avatar + name header (the avatar is ALWAYS
 * present, including the thinking state — a floating spinner with no author
 * was the exact pre-kit bug), items in arrival order (text/activity/error),
 * streaming shimmer, and error/aborted footers.
 */
import { useCallback, useState } from 'react'
import { AlertTriangle, Check, CircleSlash, Copy, Loader2, RotateCcw } from 'lucide-react'
import { formatStructured } from '@bakin/core/format'
import { useAgent } from '@makinbakin/sdk/hooks'

import { copyToClipboard } from '@/lib/copy-to-clipboard'
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
    void copyToClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])
  return (
    <button
      type="button"
      data-conv-copy
      onClick={copy}
      aria-label={label}
      className="inline-flex items-center rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground group-hover/turn:opacity-100"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  )
}

/** Streaming shimmer label ('thinking…', custom verbs via `label`). */
function ShimmerLabel({ label }: { label: string }) {
  return (
    // min-h matches the sm avatar (32px) so a bare 'thinking…' row centers
    // against it; rows with real content above are unaffected.
    <div className="flex min-h-8 items-center gap-2 text-xs text-muted-foreground">
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

/** Whole-message JSON detection: the parsed object, or undefined. */
function parseWholeJson(content: string): unknown {
  const trimmed = content.trim()
  const looksJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  if (!looksJson) return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Agents sometimes reply with BARE JSON — most users don't want to read
 * it. Render it human-first (humanized labels via formatStructured, an
 * error accent when the payload says so) with the raw JSON one disclosure
 * away for the advanced look. Shapes vary per agent — this is generic,
 * not a runtime contract.
 */
function JsonReply({ parsed }: { parsed: unknown }) {
  const prose = formatStructured(parsed, { markdown: true, cap: 4000 })
  const isError =
    !!parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    typeof (parsed as { error?: unknown }).error === 'string'
  const fenced = `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``

  if (!prose) return <MarkdownContent content={fenced} />
  return (
    <div
      data-conv-json
      className={`rounded-md border px-3 py-2 ${
        isError ? 'border-destructive/40 bg-destructive/5' : 'border-border/60 bg-muted/20'
      }`}
    >
      {isError ? (
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-destructive">
          <AlertTriangle className="size-3.5" /> The agent reported a problem
        </div>
      ) : null}
      <MarkdownContent content={prose} />
      <details className="mt-1.5">
        <summary className="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">
          Raw JSON
        </summary>
        <MarkdownContent content={fenced} />
      </details>
    </div>
  )
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
    <div className="group/turn relative flex items-start gap-3" data-conv-turn>
      {/* Avatar carries the identity (name in its tooltip) — no name line,
          so the reply text sits directly beside it. */}
      <span data-conv-avatar className="shrink-0" title={name}>
        <AgentAvatar agentId={author ?? ''} size="sm" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
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
            const json = parseWholeJson(transformed.text)
            return (
              <div key={i}>
                {json !== undefined ? <JsonReply parsed={json} /> : <MarkdownContent content={transformed.text} />}
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
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-foreground/10"
          >
            <RotateCcw className="size-3" /> Try again
          </button>
        ) : null}
      </div>

      {/* Dedicated controls gutter: the right edge of every agent turn is
          reserved for message controls (time, copy — menus later), so they
          never overlap content and always have a home. */}
      <div className="flex min-w-16 shrink-0 items-center justify-end gap-1 self-start pt-1">
        <TurnTimestamp ts={turn.ts} />
        {copyText ? <CopyButton text={copyText} label="Copy reply" /> : null}
      </div>
    </div>
  )
}
