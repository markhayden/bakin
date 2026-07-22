'use client'

import type { CSSProperties, ReactNode } from 'react'

import { Badge, type BadgeTone } from '../primitives/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../primitives/sheet'
import { cn } from '../utils'
import { formatDuration } from './activity-group'
import type { ConversationToolCall } from './fold'
import { CopyButton } from './turn-controls'
import { usePersistedLeadingEdgeResize } from './use-persisted-leading-edge-resize'

const DRAWER_DEFAULT_WIDTH = 720
const DRAWER_MIN_WIDTH = 320
const DRAWER_MAX_WIDTH = 960

function prettify(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return raw
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return raw
  }
}

function DetailSection({ label, value }: { label: string; value: string }) {
  const displayValue = prettify(value)
  return (
    <section className="grid min-w-0 gap-bakin-2" aria-label={label}>
      <div className="flex min-w-0 items-center gap-bakin-1">
        <h3 className="text-[length:var(--bakin-typography-size-meta)] font-bakin-typography-weight-semibold uppercase tracking-wider text-bakin-text-muted">
          {label}
        </h3>
        <CopyButton text={value} label={`Copy ${label.toLowerCase()}`} />
      </div>
      <pre className="max-h-80 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-bakin-surface border border-bakin-border-subtle bg-bakin-canvas-default p-bakin-3 font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] leading-relaxed text-bakin-text-primary">
        {displayValue}
      </pre>
    </section>
  )
}

function MetaCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-bakin-1">
      <dt className="text-[length:var(--bakin-typography-size-meta)] uppercase tracking-wider text-bakin-text-muted">
        {label}
      </dt>
      <dd className="min-w-0 break-all font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] text-bakin-text-primary">
        {value}
      </dd>
    </div>
  )
}

function statusTone(status: ConversationToolCall['status']): BadgeTone {
  if (status === 'failed') return 'danger'
  if (status === 'running') return 'attention'
  return 'success'
}

/** Props for the exact-detail surface opened from a conversation tool row. */
export interface ToolCallDrawerProps {
  call: ConversationToolCall | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Preference namespace when a product hosts more than one drawer kind. */
  storageKey?: string
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
}

/** Resizable exact tool detail with copyable payloads and honest capture limits. */
export function ToolCallDrawer({
  call,
  open,
  onOpenChange,
  storageKey = 'tool-call',
  defaultWidth = DRAWER_DEFAULT_WIDTH,
  minWidth = DRAWER_MIN_WIDTH,
  maxWidth = DRAWER_MAX_WIDTH,
}: ToolCallDrawerProps) {
  const { size: width, handleProps } = usePersistedLeadingEdgeResize({
    axis: 'x',
    defaultSize: defaultWidth,
    minSize: minWidth,
    maxSize: maxWidth,
    storageKey: `bakin-drawer-width:${storageKey}`,
    disabled: !open,
  })

  if (!call) return null

  const metadata = call.metadata && Object.keys(call.metadata).length
    ? JSON.stringify(call.metadata, null, 2)
    : null
  const truncated = call.metadata?.truncated === true
  const style = { '--bakin-tool-drawer-width': `${width}px` } as CSSProperties

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => onOpenChange(nextOpen)}>
      <SheetContent
        side="right"
        style={style}
        className="gap-0 sm:w-[var(--bakin-tool-drawer-width)] sm:max-w-[calc(100vw-var(--bakin-layout-space-6))]"
      >
        <div
          {...handleProps}
          aria-label="Resize tool detail"
          className={cn(
            'group/handle absolute inset-y-0 left-0 z-10 hidden w-bakin-2 touch-none items-center justify-center outline-none sm:flex',
            open ? 'cursor-col-resize' : 'cursor-default',
            'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[-2px] focus-visible:outline-bakin-focus-ring',
          )}
        >
          <span className="h-bakin-8 w-px rounded-bakin-pill bg-bakin-border-subtle opacity-0 transition-opacity group-hover/handle:opacity-100 group-focus-visible/handle:opacity-100" />
        </div>

        <SheetHeader className="border-b border-bakin-border-subtle">
          <SheetTitle className="break-all font-bakin-typography-family-mono">
            {call.toolName}
          </SheetTitle>
          <SheetDescription>Exact inputs, output, and runtime details for this tool call.</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-bakin-6">
          <div className="grid min-w-0 gap-bakin-6">
            <dl className="grid min-w-0 grid-cols-2 gap-bakin-4 sm:grid-cols-3">
              <MetaCell
                label="Status"
                value={<Badge tone={statusTone(call.status)} variant="soft">{call.status}</Badge>}
              />
              {call.durationMs !== undefined ? (
                <MetaCell label="Duration" value={formatDuration(call.durationMs)} />
              ) : null}
              {call.callId ? <MetaCell label="Call ID" value={call.callId} /> : null}
            </dl>

            {truncated ? (
              <div
                role="note"
                className="rounded-bakin-surface border border-bakin-signal-highlight/60 bg-bakin-signal-highlight/10 px-bakin-3 py-bakin-2 text-[length:var(--bakin-typography-size-meta)] leading-relaxed text-bakin-text-primary"
              >
                Captured output was truncated. This detail reflects the stored preview, not the complete runtime payload.
              </div>
            ) : null}

            {call.summary ? <DetailSection label="Summary" value={call.summary} /> : null}
            {call.inputPreview ? <DetailSection label="Input" value={call.inputPreview} /> : null}
            {call.outputPreview ? <DetailSection label="Output" value={call.outputPreview} /> : null}
            {metadata ? <DetailSection label="Metadata" value={metadata} /> : null}
            {!call.summary && !call.inputPreview && !call.outputPreview ? (
              <p className="text-bakin-text-muted">
                No payload was captured for this call. The runtime reported only its name and status.
              </p>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
