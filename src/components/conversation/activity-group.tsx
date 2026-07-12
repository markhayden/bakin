'use client'

/**
 * ActivityGroup — one turn's consecutive tool calls rendered as a single
 * activity block. T3.1 ships the expanded per-call rows; the collapsed
 * summary header + detail drawer land in T3.2 on top of this.
 */
import { Check, Loader2, X } from 'lucide-react'
import { summarizeStructured, unwrapToolResult } from '@bakin/core/format'

import type { ConversationToolCall } from './fold'

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return ''
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

function StatusGlyph({ status }: { status: ConversationToolCall['status'] }) {
  if (status === 'running') return <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
  if (status === 'failed') return <X className="size-3 shrink-0 text-destructive" />
  return <Check className="size-3 shrink-0 text-muted-foreground" />
}

export function ToolCallRow({
  call,
  onOpen,
}: {
  call: ConversationToolCall
  onOpen?: (call: ConversationToolCall) => void
}) {
  // Defensive across runtimes: peel any tool-result envelope + JSON blob to
  // a clean one-line summary (adapters normally do this at source).
  const clean = call.summary ? summarizeStructured(unwrapToolResult(call.summary)) : ''
  const body = (
    <>
      <StatusGlyph status={call.status} />
      <span className="shrink-0 font-mono">{call.toolName}</span>
      {call.status === 'failed' ? <span className="shrink-0 text-destructive">failed</span> : null}
      {clean ? <span className="truncate text-muted-foreground">{clean}</span> : null}
      {call.durationMs !== undefined ? (
        <span className="ml-auto shrink-0 pl-2 font-mono text-[10px] text-muted-foreground/70">
          {formatDuration(call.durationMs)}
        </span>
      ) : null}
    </>
  )
  if (onOpen) {
    return (
      <button
        type="button"
        data-conv-call={call.key}
        onClick={() => onOpen(call)}
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-accent/50"
      >
        {body}
      </button>
    )
  }
  return (
    <div data-conv-call={call.key} className="flex items-center gap-1.5 px-1.5 py-1 text-xs">
      {body}
    </div>
  )
}

export interface ActivityGroupProps {
  calls: ConversationToolCall[]
  /** Row click-through to the detail surface (drawer); rows are static without it. */
  onOpenCall?: (call: ConversationToolCall) => void
}

export function ActivityGroup({ calls, onOpenCall }: ActivityGroupProps) {
  return (
    <div data-conv-activity className="rounded-md border border-border/60 bg-muted/20 py-0.5">
      {calls.map((call) => (
        <ToolCallRow key={call.key} call={call} onOpen={onOpenCall} />
      ))}
    </div>
  )
}
