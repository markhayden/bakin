'use client'

/**
 * TurnOutputView — THE single client renderer for normalized turn chunks
 * (the ChatChunk taxonomy: text with format hints, structured tool
 * activity, status, done, error).
 *
 * Presentation policy for turn output lives here, behind the two-seam rule
 * (adapters normalize into chunks; this component turns chunks into
 * pixels). New turn-output surfaces MUST consume it rather than hand-roll
 * format heuristics; beautification passes restyle this one component.
 *
 * Works for both streaming accumulation (feed the growing chunk list with
 * `live` while the turn is in flight) and static replay (feed the recorded
 * list). Chat-style chrome (avatars, bubbles, indentation) stays with the
 * caller via `textFrame` / `rowClassName` — layout is the caller's, the
 * rendering of the chunks themselves is not.
 */
import type { ReactNode } from 'react'
import { AlertTriangle, Loader2, Wrench } from 'lucide-react'
import type { RuntimeChatChunk, RuntimeChatTextFormat } from '@makinbakin/sdk/types'
import { summarizeStructured, unwrapToolResult } from '@bakin/core/format'

import { MarkdownContent } from './markdown-content'

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
 * Fold a chunk list into renderable state: consecutive same-format text
 * chunks merge into segments, tool call/result pairs collapse into one chip
 * keyed by callId (a summary-less result keeps the call's summary), the
 * newest status wins, `done`/`error` mark the terminal state.
 */
export function foldTurnChunks(chunks: readonly RuntimeChatChunk[]): FoldedTurnOutput {
  const segments: TurnTextSegment[] = []
  const tools: TurnToolChipState[] = []
  let status: string | null = null
  let error: FoldedTurnOutput['error'] = null
  let done = false

  for (const chunk of chunks) {
    switch (chunk.type) {
      case 'text': {
        if (!chunk.content) break
        const format = chunk.format ?? 'markdown'
        const last = segments[segments.length - 1]
        if (last && last.format === format) last.text += chunk.content
        else segments.push({ format, text: chunk.content })
        break
      }
      case 'tool': {
        const data = chunk.data
        if (!data?.toolName) break
        const chipStatus: TurnToolChipState['status'] =
          data.phase === 'result' ? (data.status === 'failed' ? 'failed' : 'completed') : 'running'
        // Pair call/result chips by callId when present. Adapters can omit
        // callId (OpenClaw forwards toolCallId ?? undefined) — a callId-less
        // RESULT then closes the most recent RUNNING chip for the same tool;
        // generating a fresh key here would leave that chip spinning forever
        // next to a duplicate completed one.
        let existing = -1
        if (data.callId) {
          existing = tools.findIndex((c) => c.key === data.callId)
        } else if (data.phase === 'result') {
          for (let i = tools.length - 1; i >= 0; i--) {
            if (tools[i].toolName === data.toolName && tools[i].status === 'running') {
              existing = i
              break
            }
          }
        }
        const key = data.callId ?? (existing >= 0 ? tools[existing].key : `${data.toolName}-${tools.length}`)
        const summary = data.summary ?? (existing >= 0 ? tools[existing].summary : undefined)
        const chip: TurnToolChipState = { key, toolName: data.toolName, summary, status: chipStatus }
        if (existing >= 0) tools[existing] = chip
        else tools.push(chip)
        break
      }
      case 'status':
        if (chunk.content) status = chunk.content
        break
      case 'error':
        error = {
          message: chunk.content || 'turn failed',
          ...(typeof chunk.data?.kind === 'string' ? { kind: chunk.data.kind } : {}),
        }
        break
      case 'done':
        done = true
        break
    }
  }
  return { segments, tools, status, error, done }
}

/** One tool-activity chip: spinner while running, wrench when settled. */
export function TurnToolChip({ toolName, summary, status }: Omit<TurnToolChipState, 'key'>) {
  // Defensive across runtimes: peel any tool-result envelope + JSON blob to
  // a clean one-line summary (adapters normally do this at source).
  const clean = summary ? summarizeStructured(unwrapToolResult(summary)) : ''
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {status === 'running'
        ? <Loader2 className="size-3 animate-spin" />
        : <Wrench className={`size-3 ${status === 'failed' ? 'text-destructive' : ''}`} />}
      <span className="font-mono">{toolName}</span>
      {status === 'failed' ? <span className="text-destructive">failed</span> : null}
      {clean ? <span className="truncate">— {clean}</span> : null}
    </div>
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
