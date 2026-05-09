'use client'

import { AlertTriangle, CheckCircle2, CircleDot, Clock3, Wrench, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { AgentAvatar, MarkdownContent } from '@bakin/sdk/components'
import { useAgentColor } from '@bakin/sdk/hooks'
import type { AssistantTransformed, BrainstormMessage } from './types'

interface MessageListProps {
  messages: BrainstormMessage[]
  defaultAgentId: string
  transform?: (raw: string) => AssistantTransformed
}

export function MessageList({ messages, defaultAgentId, transform }: MessageListProps) {
  const items = groupActivityMessages(messages)
  return (
    <div
      data-testid="brainstorm-message-list"
      className="space-y-2"
    >
      {items.map((item, idx) => {
        const msg = item.message
        if (msg.role === 'user') {
          return <UserBubble key={msg.id} content={msg.content} />
        }
        if (msg.role === 'activity') {
          return (
            <ActivityBubble
              key={item.key}
              group={item}
              agentId={defaultAgentId}
            />
          )
        }
        const prev = idx > 0 ? items[idx - 1]?.message : null
        const isConsecutive = prev?.role === 'assistant'
        const transformed = transform ? transform(msg.content) : { text: msg.content }
        return (
          <AssistantBubble
            key={msg.id}
            content={transformed.text}
            extras={transformed.extras}
            agentId={msg.agentId ?? defaultAgentId}
            isConsecutive={isConsecutive}
          />
        )
      })}
    </div>
  )
}

interface MessageItem {
  key: string
  message: BrainstormMessage
  result?: BrainstormMessage
}

interface ToolActivityView {
  kind: 'tool'
  toolName: string
  status: string
  phase: 'call' | 'result'
  callId?: string
  summary: string
  inputPreview?: string
  outputPreview?: string
  durationMs?: number
  exitCode?: number
  metadata: Record<string, unknown>
}

interface GenericActivityView {
  kind: 'status' | 'error'
  label: string
  summary: string
  data?: unknown
}

type ActivityView = ToolActivityView | GenericActivityView

const TOOL_DATA_KEYS = new Set([
  'phase',
  'callId',
  'toolCallId',
  'toolName',
  'name',
  'tool',
  'status',
  'summary',
  'purpose',
  'displayLabel',
  'inputPreview',
  'argumentsPreview',
  'outputPreview',
  'resultPreview',
  'durationMs',
  'exitCode',
])

function groupActivityMessages(messages: BrainstormMessage[]): MessageItem[] {
  const items: MessageItem[] = []
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (message.role === 'activity') {
      const next = messages[i + 1]
      if (next?.role === 'activity' && shouldGroupToolActivities(message, next)) {
        items.push({ key: `${message.id}:${next.id}`, message, result: next })
        i++
        continue
      }
    }
    items.push({ key: message.id, message })
  }
  return items
}

function shouldGroupToolActivities(call: BrainstormMessage, result: BrainstormMessage): boolean {
  const callView = toolActivityView(call)
  const resultView = toolActivityView(result)
  return Boolean(
    callView &&
      resultView &&
      callView.phase === 'call' &&
      resultView.phase === 'result' &&
      callView.callId &&
      callView.callId === resultView.callId,
  )
}

function ActivityBubble({ group, agentId }: { group: MessageItem; agentId: string }) {
  const color = useAgentColor(agentId)
  const view = activityView(group)
  const isError = view.kind === 'error' || (view.kind === 'tool' && isFailedTool(view))
  const Icon = view.kind === 'tool'
    ? isFailedTool(view) ? XCircle : view.phase === 'result' ? CheckCircle2 : Wrench
    : view.kind === 'error'
      ? AlertTriangle
      : CircleDot

  return (
    <div
      data-testid="activity-bubble"
      className="flex items-start gap-2"
    >
      <AgentAvatar agentId={agentId} size="sm" className="mt-0.5 shrink-0 opacity-85" />
      <div
        className="max-w-[90%] rounded-lg border-l-2 bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm"
        style={{ borderLeftColor: isError ? 'rgba(248, 113, 113, 0.8)' : `${color}80` }}
      >
        {view.kind === 'tool' ? (
          <ToolActivityContent view={view} icon={<Icon className="size-3.5 shrink-0" aria-hidden="true" />} />
        ) : (
          <GenericActivityContent view={view} icon={<Icon className="size-3.5 shrink-0" aria-hidden="true" />} />
        )}
      </div>
    </div>
  )
}

function ToolActivityContent({ view, icon }: { view: ToolActivityView; icon: ReactNode }) {
  const details = toolDetailSections(view)
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className={isFailedTool(view) ? 'text-red-400' : 'text-zinc-500'}>{icon}</span>
        <span className="font-medium uppercase tracking-wide text-zinc-500">Tool</span>
        <span className="font-medium text-zinc-300">{view.toolName}</span>
        <span className={statusClassName(view)}>
          {statusLabel(view)}
        </span>
        {view.durationMs !== undefined && (
          <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
            <Clock3 className="size-3" aria-hidden="true" />
            {formatDuration(view.durationMs)}
          </span>
        )}
      </div>
      {view.summary && (
        <div data-testid="tool-activity-summary" className="mt-1 break-words text-xs leading-5 text-zinc-400">
          {view.summary}
        </div>
      )}
      {details.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-[11px] text-zinc-500 hover:text-zinc-300">
            Details
          </summary>
          <div className="mt-2 space-y-2">
            {details.map((section) => (
              <ActivityDetailSection key={section.label} label={section.label} value={section.value} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function GenericActivityContent({ view, icon }: { view: GenericActivityView; icon: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className={view.kind === 'error' ? 'text-red-400' : 'text-zinc-500'}>{icon}</span>
        <span className="font-medium uppercase tracking-wide text-zinc-500">{view.label}</span>
        <span className="break-words text-zinc-400">{view.summary}</span>
      </div>
      {view.data !== undefined && (
        <details className="mt-2">
          <summary className="cursor-pointer select-none text-[11px] text-zinc-500 hover:text-zinc-300">
            Details
          </summary>
          <ActivityDetailSection label="Data" value={view.data} />
        </details>
      )}
    </div>
  )
}

function ActivityDetailSection({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded border border-[rgba(255,255,255,0.06)] bg-zinc-950/60 p-2 text-[10px] leading-4 text-zinc-400">
        {formatDetailValue(value)}
      </pre>
    </div>
  )
}

function activityView(group: MessageItem): ActivityView {
  const resultTool = group.result ? toolActivityView(group.result) : null
  const callTool = toolActivityView(group.message)
  if (resultTool || callTool) {
    const active = resultTool ?? callTool!
    return {
      ...active,
      summary: callTool?.summary || active.summary,
      inputPreview: callTool?.inputPreview ?? active.inputPreview,
      metadata: { ...(callTool?.metadata ?? {}), ...active.metadata },
    }
  }

  const kind = group.message.kind === 'error' ? 'error' : 'status'
  return {
    kind,
    label: kind === 'error' ? 'Error' : 'Status',
    summary: group.message.content,
    data: group.message.data,
  }
}

function toolActivityView(message: BrainstormMessage): ToolActivityView | null {
  if (message.kind !== 'tool_call' && !looksLikeToolData(message.data)) return null
  const data = isRecord(message.data) ? message.data : {}
  const phase = data.phase === 'result' ? 'result' : 'call'
  const toolName = stringField(data.toolName) ?? stringField(data.name) ?? stringField(data.tool) ?? inferToolName(message.content)
  if (!toolName) return null
  const status = stringField(data.status) ?? (phase === 'call' ? 'running' : 'completed')
  return {
    kind: 'tool',
    phase,
    callId: stringField(data.callId) ?? stringField(data.toolCallId) ?? stringField(data.id),
    toolName,
    status,
    summary: stringField(data.summary) ?? stringField(data.purpose) ?? stringField(data.displayLabel) ?? message.content,
    inputPreview: stringField(data.inputPreview) ?? stringField(data.argumentsPreview),
    outputPreview: stringField(data.outputPreview) ?? stringField(data.resultPreview),
    durationMs: numberField(data.durationMs),
    exitCode: numberField(data.exitCode),
    metadata: activityMetadata(data),
  }
}

function looksLikeToolData(data: unknown): boolean {
  if (!isRecord(data)) return false
  return Boolean(data.toolName || data.name || data.tool || data.phase === 'call' || data.phase === 'result')
}

function activityMetadata(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!TOOL_DATA_KEYS.has(key)) out[key] = value
  }
  if (typeof data.exitCode === 'number') out.exitCode = data.exitCode
  if (typeof data.callId === 'string') out.callId = data.callId
  if (typeof data.toolCallId === 'string') out.callId = data.toolCallId
  return out
}

function toolDetailSections(view: ToolActivityView): Array<{ label: string; value: unknown }> {
  const sections: Array<{ label: string; value: unknown }> = []
  if (view.inputPreview) sections.push({ label: 'Input', value: view.inputPreview })
  if (view.outputPreview) sections.push({ label: 'Output', value: view.outputPreview })
  if (Object.keys(view.metadata).length > 0) sections.push({ label: 'Metadata', value: view.metadata })
  return sections
}

function statusLabel(view: ToolActivityView): string {
  if (isFailedTool(view)) return 'failed'
  return view.status || (view.phase === 'call' ? 'running' : 'completed')
}

function statusClassName(view: ToolActivityView): string {
  const base = 'rounded-full px-1.5 py-0.5 text-[10px] font-medium'
  if (isFailedTool(view)) return `${base} bg-red-500/10 text-red-300`
  if (view.phase === 'call') return `${base} bg-yellow-400/10 text-yellow-300`
  return `${base} bg-emerald-500/10 text-emerald-300`
}

function isFailedTool(view: ToolActivityView): boolean {
  const status = view.status.toLowerCase()
  return status.includes('fail') || status.includes('error') || (view.exitCode !== undefined && view.exitCode !== 0)
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

function formatDetailValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function inferToolName(content: string): string | undefined {
  const match = content.match(/^([a-zA-Z0-9_.-]+)(?::|\s)/)
  return match?.[1]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end" data-testid="user-bubble">
      <div className="max-w-[85%] px-3 py-1.5 rounded-lg bg-[#5e6ad2]/15 border border-[#5e6ad2]/20 text-sm text-zinc-200 whitespace-pre-wrap">
        {content}
      </div>
    </div>
  )
}

interface AssistantBubbleProps {
  content: string
  extras?: ReactNode
  agentId: string
  isConsecutive: boolean
}

function AssistantBubble({ content, extras, agentId, isConsecutive }: AssistantBubbleProps) {
  const color = useAgentColor(agentId)
  return (
    <div
      data-testid="assistant-bubble"
      data-consecutive={isConsecutive ? 'true' : 'false'}
      className={`flex items-start gap-2 ${isConsecutive ? '-mt-2' : ''}`}
    >
      {isConsecutive ? (
        <div className="w-6 shrink-0" aria-hidden="true" />
      ) : (
        <AgentAvatar agentId={agentId} size="sm" className="mt-0.5 shrink-0" />
      )}
      <div
        className="max-w-[90%] px-3 py-2 rounded-lg border-l-2 bg-[rgba(255,255,255,0.03)] text-sm [&_p]:!my-0 [&_p+p]:!mt-2 [&_*:first-child]:!mt-0 [&_*:last-child]:!mb-0"
        style={{ borderLeftColor: `${color}80` }}
      >
        {content && <MarkdownContent content={content} />}
        {extras && <div data-testid="assistant-extras">{extras}</div>}
      </div>
    </div>
  )
}
