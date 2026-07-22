'use client'

import type { ReactNode } from 'react'

import { cn } from '../utils'
import { ToolCallRow } from './activity-group'
import {
  foldConversation,
  type ConversationChunk,
  type ConversationTextFormat,
} from './fold'
import type { ConversationTextRenderer } from './agent-turn'

export interface TurnTextSegment {
  format: ConversationTextFormat
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
  /** Latest status chunk content, when present. */
  status: string | null
  error: { message: string; kind?: string } | null
  done: boolean
}

/** Fold a normalized single-turn stream through the canonical conversation engine. */
export function foldTurnChunks(chunks: readonly ConversationChunk[]): FoldedTurnOutput {
  const turn = foldConversation([], { liveChunks: chunks })[0]
  const segments: TurnTextSegment[] = []
  const tools: TurnToolChipState[] = []
  let error: FoldedTurnOutput['error'] = null

  if (turn?.kind === 'agent') {
    for (const item of turn.items) {
      if (item.type === 'text') {
        const previous = segments[segments.length - 1]
        if (previous && previous.format === item.format) previous.text += item.content
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
        error = {
          message: item.message,
          ...(item.errorKind ? { kind: item.errorKind } : {}),
        }
      }
    }
  }

  return {
    segments,
    tools,
    status: turn?.kind === 'agent' ? turn.statusLabel ?? null : null,
    error,
    done: chunks.some((chunk) => chunk.type === 'done'),
  }
}

/** One exact tool-activity row retained under the single-turn compatibility name. */
export function TurnToolChip({ toolName, summary, status }: Omit<TurnToolChipState, 'key'>) {
  return (
    <ToolCallRow
      call={{ key: toolName, toolName, status, ...(summary !== undefined ? { summary } : {}) }}
    />
  )
}

export interface TurnOutputViewProps {
  chunks: readonly ConversationChunk[]
  /** Whether the turn is still in flight. */
  live?: boolean
  /** Rich-text rendering stays consumer-owned; Markdown defaults to safe wrapped text. */
  renderText?: ConversationTextRenderer
  /** Optional frame around the merged text block. */
  textFrame?: (text: ReactNode) => ReactNode
  /** Applied to each tool, status, and error row. */
  rowClassName?: string
  className?: string
}

function SpinnerIcon() {
  return (
    <span
      aria-hidden="true"
      className="size-bakin-3 shrink-0 animate-spin rounded-bakin-pill border-2 border-current border-r-transparent motion-reduce:animate-none"
    />
  )
}

function AlertIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 shrink-0 fill-none stroke-current stroke-[1.5]">
      <path d="M8 2 14 13H2L8 2Z" strokeLinejoin="round" />
      <path d="M8 6v3.5M8 11.75v.25" strokeLinecap="round" />
    </svg>
  )
}

function DefaultText({ content, format }: { content: string; format: ConversationTextFormat }) {
  if (format === 'code') {
    return (
      <pre
        role="region"
        tabIndex={0}
        aria-label="Code output"
        className="max-w-full overflow-x-auto rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-bakin-3 font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] leading-relaxed text-bakin-text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring"
      >
        {content}
      </pre>
    )
  }
  if (format === 'plain') {
    return (
      <pre className="whitespace-pre-wrap break-words font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] leading-relaxed text-bakin-text-primary">
        {content}
      </pre>
    )
  }
  return <div className="whitespace-pre-wrap break-words leading-relaxed text-bakin-text-primary">{content}</div>
}

/** Compact renderer for task and workflow embeds that contain one normalized turn. */
export function TurnOutputView({
  chunks,
  className,
  live = false,
  renderText,
  rowClassName,
  textFrame,
}: TurnOutputViewProps) {
  const { error, segments, status, tools } = foldTurnChunks(chunks)
  const hasText = segments.length > 0
  const text = hasText ? (
    <div data-turn-output-text="" className="grid min-w-0 gap-bakin-2">
      {segments.map((segment, index) => (
        <div key={index} className="min-w-0">
          {renderText
            ? renderText(segment.text, segment.format)
            : <DefaultText content={segment.text} format={segment.format} />}
        </div>
      ))}
    </div>
  ) : null

  return (
    <div
      data-turn-output=""
      className={cn(
        'grid min-w-0 gap-bakin-3 font-bakin-typography-family-ui text-[length:var(--bakin-typography-size-body)]',
        className,
      )}
    >
      {tools.map((tool) => (
        <div key={tool.key} className={cn('min-w-0 overflow-hidden rounded-bakin-surface border border-bakin-border-subtle', rowClassName)}>
          <TurnToolChip toolName={tool.toolName} summary={tool.summary} status={tool.status} />
        </div>
      ))}

      {text ? (textFrame ? textFrame(text) : text) : null}

      {!hasText && live ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'flex min-h-bakin-6 min-w-0 items-center gap-bakin-2 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted',
            rowClassName,
          )}
        >
          <SpinnerIcon />
          <span className="min-w-0 break-words">{status ?? 'thinking'}…</span>
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className={cn(
            'flex min-w-0 flex-wrap items-center gap-bakin-2 rounded-bakin-surface border border-bakin-signal-danger/40 bg-bakin-signal-danger/10 px-bakin-3 py-bakin-2 text-bakin-signal-danger',
            rowClassName,
          )}
        >
          <AlertIcon />
          <span className="min-w-0 break-words">{error.message}</span>
          {error.kind ? (
            <span className="min-w-0 max-w-full break-all rounded-bakin-control bg-bakin-signal-danger/10 px-bakin-1 font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)]">
              {error.kind}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
