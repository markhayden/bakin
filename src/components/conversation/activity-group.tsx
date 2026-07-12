'use client'

/**
 * ActivityGroup — one turn's consecutive tool calls rendered as a single
 * activity block: a collapsed human-readable header ("Searched the web ·
 * 3 calls · 12s", spinner while live), inline expand to per-call rows,
 * and row click-through to the ToolCallDrawer. THE tool-call interaction
 * pattern for every conversational surface.
 */
import { useState } from 'react'
import { Check, ChevronRight, Loader2, Wrench, X } from 'lucide-react'
import { summarizeStructured, unwrapToolResult } from '@bakin/core/format'

import type { ConversationToolCall } from './fold'

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return ''
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

/** Human verb phrases for common tools; everything else reads "Used <tool>". */
const TOOL_VERBS: Record<string, string> = {
  web_search: 'Searched the web',
  web_fetch: 'Fetched a page',
  bash: 'Ran commands',
  shell: 'Ran commands',
  read: 'Read files',
  read_file: 'Read files',
  write: 'Wrote files',
  write_file: 'Wrote files',
  edit: 'Edited files',
  grep: 'Searched the codebase',
  glob: 'Listed files',
}

export function humanizeActivity(calls: ConversationToolCall[]): string {
  const names = [...new Set(calls.map((c) => c.toolName))]
  if (names.length > 1) return `Used ${names.length} tools`
  const name = names[0] ?? 'tool'
  return TOOL_VERBS[name] ?? `Used ${name}`
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
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-accent/50"
      >
        {body}
      </button>
    )
  }
  return (
    <div data-conv-call={call.key} className="flex items-center gap-1.5 px-2 py-1 text-xs">
      {body}
    </div>
  )
}

export interface ActivityGroupProps {
  calls: ConversationToolCall[]
  /** Row click-through to the detail surface (ToolCallDrawer). */
  onOpenCall?: (call: ConversationToolCall) => void
  /** Start expanded (default collapsed). */
  defaultExpanded?: boolean
}

export function ActivityGroup({ calls, onOpenCall, defaultExpanded = false }: ActivityGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const running = calls.some((c) => c.status === 'running')
  const failed = calls.filter((c) => c.status === 'failed').length
  const totalMs = calls.reduce<number | undefined>(
    (acc, c) => (c.durationMs === undefined ? acc : (acc ?? 0) + c.durationMs),
    undefined,
  )

  return (
    <div data-conv-activity className="overflow-hidden rounded-md border border-border/60 bg-muted/20">
      <button
        type="button"
        data-conv-activity-header
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent/40"
      >
        <ChevronRight className={`size-3 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        {running ? (
          <Loader2 className="size-3 shrink-0 animate-spin" />
        ) : (
          <Wrench className={`size-3 shrink-0 ${failed ? 'text-destructive' : ''}`} />
        )}
        <span className="text-foreground/90">{humanizeActivity(calls)}</span>
        {calls.length > 1 ? <span>· {calls.length} calls</span> : null}
        {failed ? <span className="text-destructive">· {failed} failed</span> : null}
        {!running && totalMs !== undefined ? <span>· {formatDuration(totalMs)}</span> : null}
      </button>
      {expanded ? (
        <div className="border-t border-border/60 py-0.5">
          {calls.map((call) => (
            <ToolCallRow key={call.key} call={call} onOpen={onOpenCall} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
