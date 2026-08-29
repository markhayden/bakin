'use client'

import { useId, useState, type ReactNode } from 'react'

import { StatusBadge, type StatusTone } from '../patterns/status-badge'
import { Spinner } from '../primitives/spinner'

import { cn } from '../utils'
import type { ConversationToolCall } from './fold'

/** Format a tool-call duration for compact conversation metadata. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return ''
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

const TOOL_VERBS: Readonly<Record<string, string>> = {
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

/** Human-readable group label derived from the tools that ran. */
export function humanizeActivity(calls: readonly ConversationToolCall[]): string {
  const names = [...new Set(calls.map((call) => call.toolName))]
  if (names.length === 0) return 'No tool activity'
  if (names.length > 1) return `Used ${names.length} tools`
  const name = names[0]!
  return TOOL_VERBS[name] ?? `Used ${name}`
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={cn(
        'size-bakin-3 shrink-0 fill-none stroke-current stroke-[1.75] transition-transform',
        'duration-[var(--bakin-motion-duration-feedback)] motion-reduce:transition-none',
        expanded && 'rotate-90',
      )}
    >
      <path d="m6 3.5 4.5 4.5L6 12.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SpinnerIcon() {
  return <Spinner size="sm" className="shrink-0" />
}

function ToolIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 shrink-0 fill-none stroke-current stroke-[1.5]">
      <path d="M9.5 3.1a3.2 3.2 0 0 0-3.9 4.2l-3 3a1.4 1.4 0 0 0 2 2l3-3a3.2 3.2 0 0 0 4.2-3.9L10 7.2 8.8 6l.7-2.9Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FailedGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 shrink-0 fill-none stroke-current stroke-2">
      <path d="m5 5 6 6m0-6-6 6" strokeLinecap="round" />
    </svg>
  )
}

function CompletedGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 shrink-0 fill-none stroke-current stroke-2">
      <path d="m3.5 8 3 3 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function statusLabel(status: ConversationToolCall['status']): 'running' | 'failed' | 'completed' {
  if (status === 'running') return 'running'
  if (status === 'failed') return 'failed'
  return 'completed'
}

function CallStatus({ status }: { status: ConversationToolCall['status'] }) {
  const tone: StatusTone = status === 'failed' ? 'danger' : status === 'running' ? 'attention' : 'neutral'
  const Glyph = status === 'running' ? SpinnerIcon : status === 'failed' ? FailedGlyph : CompletedGlyph
  return (
    <StatusBadge tone={tone} variant="soft" icon={Glyph} data-call-status={status}>
      {statusLabel(status)}
    </StatusBadge>
  )
}

/** Props for one exact tool call row inside an activity group. */
export interface ToolCallRowProps {
  call: ConversationToolCall
  onOpen?: (call: ConversationToolCall) => void
  /** Optional compatibility formatter for runtime-specific summary envelopes. */
  formatSummary?: (summary: string) => string
}

/** Exact status, tool name, summary, and duration for one tool call. */
export function ToolCallRow({ call, onOpen, formatSummary }: ToolCallRowProps) {
  const clean = call.summary
    ? (formatSummary?.(call.summary) ?? call.summary.trim().replace(/\s+/g, ' '))
    : ''
  const content: ReactNode = (
    <>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-bakin-2 gap-y-bakin-1">
        <span className="shrink-0 font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] text-bakin-text-primary">
          {call.toolName}
        </span>
        {clean ? (
          <span className="min-w-24 flex-1 truncate text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted" title={clean}>
            {clean}
          </span>
        ) : null}
      </span>
      {call.durationMs !== undefined ? (
        <span className="shrink-0 font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] tabular-nums text-bakin-text-muted">
          {formatDuration(call.durationMs)}
        </span>
      ) : null}
      <CallStatus status={call.status} />
    </>
  )
  const classes = [
    'flex min-h-bakin-8 w-full min-w-0 items-center gap-bakin-2 px-bakin-3 py-bakin-2 text-left',
    'font-bakin-typography-family-ui outline-none',
  ].join(' ')

  if (onOpen) {
    return (
      <button
        type="button"
        data-conv-call={call.key}
        onClick={() => onOpen(call)}
        className={cn(
          classes,
          'transition-colors duration-[var(--bakin-motion-duration-feedback)] hover:bg-bakin-surface-default',
          'focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-bakin-focus-ring motion-reduce:transition-none',
        )}
      >
        {content}
      </button>
    )
  }

  return <div data-conv-call={call.key} className={classes}>{content}</div>
}

/** Props for a collapsible group of consecutive tool activity. */
export interface ActivityGroupProps {
  calls: readonly ConversationToolCall[]
  /** Row click-through to a consumer-owned exact-detail surface. */
  onOpenCall?: (call: ConversationToolCall) => void
  /** Start expanded; defaults to collapsed so the conversation stays readable. */
  defaultExpanded?: boolean
  /** Optional compatibility formatter for runtime-specific summary envelopes. */
  formatSummary?: (summary: string) => string
  className?: string
}

/** Compact activity summary with a keyboard-operable exact-call disclosure. */
export function ActivityGroup({
  calls,
  onOpenCall,
  defaultExpanded = false,
  formatSummary,
  className,
}: ActivityGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const contentId = useId()

  if (calls.length === 0) {
    return (
      <div
        data-conv-activity=""
        data-empty="true"
        className={cn(
          'rounded-bakin-surface border border-dashed border-bakin-border-subtle px-bakin-3 py-bakin-2',
          'font-bakin-typography-family-ui text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted',
          className,
        )}
      >
        No tool activity
      </div>
    )
  }

  const running = calls.some((call) => call.status === 'running')
  const failed = calls.filter((call) => call.status === 'failed').length
  const totalMs = calls.reduce<number | undefined>(
    (total, call) => call.durationMs === undefined ? total : (total ?? 0) + call.durationMs,
    undefined,
  )

  return (
    <div
      data-conv-activity=""
      className={cn(
        'min-w-0 overflow-hidden rounded-bakin-surface border border-bakin-border-subtle bg-bakin-canvas-default',
        'font-bakin-typography-family-ui text-bakin-text-primary',
        className,
      )}
    >
      <button
        type="button"
        data-conv-activity-header=""
        aria-controls={contentId}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          'flex min-h-[var(--bakin-layout-size-control)] w-full min-w-0 items-center gap-bakin-2 px-bakin-3 py-bakin-2 text-left',
          'text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted outline-none',
          'transition-colors duration-[var(--bakin-motion-duration-feedback)] hover:bg-bakin-surface-default',
          'focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-bakin-focus-ring motion-reduce:transition-none',
        )}
      >
        <ChevronIcon expanded={expanded} />
        {running ? <SpinnerIcon /> : <ToolIcon />}
        <span className="min-w-0 truncate font-bakin-typography-weight-medium text-bakin-text-primary">
          {humanizeActivity(calls)}
        </span>
        {calls.length > 1 ? <span className="shrink-0">· {calls.length} calls</span> : null}
        {running ? <span className="shrink-0 text-bakin-text-primary">· Running</span> : null}
        {failed ? <span className="shrink-0 text-bakin-signal-danger">· {failed} failed</span> : null}
        {!running && totalMs !== undefined ? (
          <span className="ml-auto shrink-0 font-bakin-typography-family-mono tabular-nums">
            {formatDuration(totalMs)}
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div id={contentId} data-conv-activity-calls="" className="divide-y divide-bakin-border-subtle border-t border-bakin-border-subtle">
          {calls.map((call) => (
            <ToolCallRow
              key={call.key}
              call={call}
              onOpen={onOpenCall}
              formatSummary={formatSummary}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
