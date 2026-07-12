'use client'

/**
 * TurnOutputView — legacy-shaped renderer for normalized turn chunks,
 * now a thin wrapper over the conversation kit: foldTurnChunks delegates
 * to foldConversation (ONE folding engine) and flattens the turn model
 * back to the flat segments/tools shape existing consumers pin.
 *
 * New surfaces should compose the kit directly (Conversation/AgentTurn/
 * ActivityGroup); this stays for single-turn output embeds (task step
 * viewer, workflow step drawer).
 */
import type { ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type { RuntimeChatChunk, RuntimeChatTextFormat } from '@makinbakin/sdk/types'

import { MarkdownContent } from './markdown-content'
import { foldConversation } from './conversation/fold'
import { ToolCallRow } from './conversation/activity-group'

export interface TurnTextSegment {
  format: RuntimeChatTextFormat
  text: string
}

export interface TurnToolChipState {
  key: string
  toolName: string
  summary?: string
  status: 'running' | 'completed' | 'failed'
}

export interface FoldedTurnOutput {
  segments: TurnTextSegment[]
  tools: TurnToolChipState[]
  /** Latest status chunk content (e.g. 'thinking'), if any. */
  status: string | null
  error: { message: string; kind?: string } | null
  done: boolean
}

/**
 * Fold a chunk list into the flat renderable shape. Delegates to
 * foldConversation and flattens: text items → segments (consecutive
 * same-format segments re-merged across tool boundaries, preserving the
 * legacy contract), activity calls → chips, latest status label, first
 * error, done flag.
 */
export function foldTurnChunks(chunks: readonly RuntimeChatChunk[]): FoldedTurnOutput {
  const turns = foldConversation([], { liveChunks: chunks })
  const turn = turns[0]
  const segments: TurnTextSegment[] = []
  const tools: TurnToolChipState[] = []
  let error: FoldedTurnOutput['error'] = null

  if (turn?.kind === 'agent') {
    for (const item of turn.items) {
      if (item.type === 'text') {
        const last = segments[segments.length - 1]
        if (last && last.format === item.format) last.text += item.content
        else segments.push({ format: item.format, text: item.content })
      } else if (item.type === 'activity') {
        for (const call of item.calls) {
          tools.push({
            key: call.key,
            toolName: call.toolName,
            ...(call.summary !== undefined ? { summary: call.summary } : {}),
            status: call.status,
          })
        }
      } else if (!error) {
        error = { message: item.message, ...(item.errorKind ? { kind: item.errorKind } : {}) }
      }
    }
  }

  return {
    segments,
    tools,
    status: turn?.kind === 'agent' ? turn.statusLabel ?? null : null,
    error,
    done: chunks.some((c) => c.type === 'done'),
  }
}

/** One tool-activity chip (kit ToolCallRow under the legacy name/props). */
export function TurnToolChip({ toolName, summary, status }: Omit<TurnToolChipState, 'key'>) {
  return (
    <ToolCallRow
      call={{ key: toolName, toolName, status, ...(summary !== undefined ? { summary } : {}) }}
    />
  )
}

export interface TurnOutputViewProps {
  chunks: readonly RuntimeChatChunk[]
  /**
   * Turn still in flight: renders the latest status ('thinking…') until
   * text arrives, so the user sees life before the first token/tool.
   */
  live?: boolean
  /** Optional frame around the merged text block (e.g. chat's avatar bubble). */
  textFrame?: (text: ReactNode) => ReactNode
  /** Applied to each tool/status/error row (e.g. chat's `pl-8` indent). */
  rowClassName?: string
  className?: string
}

export function TurnOutputView({ chunks, live, textFrame, rowClassName, className }: TurnOutputViewProps) {
  const { segments, tools, status, error } = foldTurnChunks(chunks)
  const hasText = segments.length > 0

  const textNode = hasText ? (
    <div className="space-y-2">
      {segments.map((seg, i) =>
        seg.format === 'markdown'
          ? <MarkdownContent key={i} content={seg.text} />
          : <pre key={i} className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{seg.text}</pre>,
      )}
    </div>
  ) : null

  return (
    <div className={className ?? 'space-y-3'}>
      {tools.map((chip) => (
        <div key={chip.key} className={rowClassName}>
          <TurnToolChip toolName={chip.toolName} summary={chip.summary} status={chip.status} />
        </div>
      ))}
      {textNode ? (textFrame ? textFrame(textNode) : textNode) : null}
      {!hasText && live ? (
        <div className={`flex items-center gap-2 text-xs text-muted-foreground ${rowClassName ?? ''}`}>
          <Loader2 className="size-3 animate-spin" /> {status ?? 'thinking'}…
        </div>
      ) : null}
      {error ? (
        <div className={`flex items-center gap-2 text-sm text-destructive ${rowClassName ?? ''}`}>
          <AlertTriangle className="size-4 shrink-0" />
          <span>{error.message}</span>
          {error.kind ? <span className="rounded bg-destructive/10 px-1 font-mono text-xs">{error.kind}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
