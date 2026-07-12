'use client'

/**
 * ToolCallDrawer — full detail for one tool call, in the shared BakinDrawer:
 * status, duration, callId, pretty-printed input/output (copyable), and
 * metadata. The "two clicks deep" end of the tool-call pattern.
 */
import { BakinDrawer } from '../bakin-drawer'
import type { ConversationToolCall } from './fold'
import { formatDuration } from './activity-group'
import { CopyButton } from './agent-turn'

/** Pretty-print JSON-looking payloads; pass everything else through. */
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
  return (
    <div className="group/turn space-y-1">
      <div className="flex items-center gap-1">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <CopyButton text={value} label={`Copy ${label.toLowerCase()}`} />
      </div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
        {prettify(value)}
      </pre>
    </div>
  )
}

function MetaCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-xs">{value}</div>
    </div>
  )
}

export interface ToolCallDrawerProps {
  call: ConversationToolCall | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ToolCallDrawer({ call, open, onOpenChange }: ToolCallDrawerProps) {
  if (!call) return null
  const metadata = call.metadata && Object.keys(call.metadata).length ? JSON.stringify(call.metadata, null, 2) : null
  return (
    <BakinDrawer
      open={open}
      onOpenChange={onOpenChange}
      storageKey="tool-call"
      title={<span className="font-mono">{call.toolName}</span>}
      description="Tool call detail"
    >
      <div className="space-y-5 p-1">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetaCell
            label="Status"
            value={
              <span className={call.status === 'failed' ? 'text-destructive' : ''}>{call.status}</span>
            }
          />
          {call.durationMs !== undefined ? <MetaCell label="Duration" value={formatDuration(call.durationMs)} /> : null}
          {call.callId ? <MetaCell label="Call ID" value={call.callId} /> : null}
        </div>
        {call.summary ? <DetailSection label="Summary" value={call.summary} /> : null}
        {call.inputPreview ? <DetailSection label="Input" value={call.inputPreview} /> : null}
        {call.outputPreview ? <DetailSection label="Output" value={call.outputPreview} /> : null}
        {metadata ? <DetailSection label="Metadata" value={metadata} /> : null}
        {!call.summary && !call.inputPreview && !call.outputPreview ? (
          <div className="text-sm text-muted-foreground">
            No payload was captured for this call — the runtime reported only its name and status.
          </div>
        ) : null}
      </div>
    </BakinDrawer>
  )
}
