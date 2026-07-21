'use client'

import { AlertTriangle } from 'lucide-react'
import { formatStructured, summarizeStructured, unwrapToolResult } from '@bakin/core/format'
import {
  AgentTurn as FocusedAgentTurn,
  ThinkingIndicator as FocusedThinkingIndicator,
  CopyButton,
  TurnTimestamp,
  type AgentTurnProps as FocusedAgentTurnProps,
  type ConversationAgent,
  type ConversationTextFormat,
  type ConversationToolCall,
  type ConversationTurn,
} from '@makinbakin/sdk/conversation'
import { useAgent } from '@makinbakin/sdk/hooks'

import { AgentAvatar } from '../agent-avatar'
import { MarkdownContent } from '../markdown-content'

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
      data-conv-json=""
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

export function renderLegacyText(content: string, format: ConversationTextFormat) {
  if (format !== 'markdown') {
    return <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{content}</pre>
  }
  const json = parseWholeJson(content)
  return json !== undefined ? <JsonReply parsed={json} /> : <MarkdownContent content={content} />
}

export function formatLegacySummary(summary: string): string {
  return summarizeStructured(unwrapToolResult(summary))
}

export function LegacyAvatar(agent: ConversationAgent) {
  return <AgentAvatar agentId={agent.id ?? ''} size="sm" />
}

export interface AgentTurnProps {
  turn: Extract<ConversationTurn, { kind: 'agent' }>
  /** Fallback author when the turn doesn't carry its own agentId. */
  agentId?: string
  /** Re-send the last user message; renders "Try again" on error turns. */
  onRetry?: () => void
  /** Tool-call row click-through (detail drawer). */
  onOpenCall?: (call: ConversationToolCall) => void
  /** Preserve established host post-processing before markdown rendering. */
  transformText?: FocusedAgentTurnProps['transformText']
}

/** @deprecated Import `AgentTurn` from `@makinbakin/sdk/conversation`. */
export function AgentTurn({ turn, agentId, onRetry, onOpenCall, transformText }: AgentTurnProps) {
  const author = turn.agentId ?? agentId
  const resolved = useAgent(author ?? '')
  const agent: ConversationAgent = {
    ...(author ? { id: author } : {}),
    name: resolved?.name ?? author ?? 'Agent',
    ...(resolved?.headshot ? { avatarUrl: resolved.headshot } : {}),
  }

  return (
    <FocusedAgentTurn
      turn={turn}
      agent={agent}
      onRetry={onRetry}
      onOpenCall={onOpenCall}
      transformText={transformText}
      renderText={renderLegacyText}
      renderAvatar={LegacyAvatar}
      formatToolSummary={formatLegacySummary}
    />
  )
}

/** @deprecated Import `ThinkingIndicator` from `@makinbakin/sdk/conversation`. */
export function ThinkingIndicator({ agentId, label = 'thinking' }: { agentId?: string; label?: string }) {
  const resolved = useAgent(agentId ?? '')
  const agent: ConversationAgent = {
    ...(agentId ? { id: agentId } : {}),
    name: resolved?.name ?? agentId ?? 'Agent',
    ...(resolved?.headshot ? { avatarUrl: resolved.headshot } : {}),
  }
  return <FocusedThinkingIndicator agent={agent} label={label} renderAvatar={LegacyAvatar} />
}

export { CopyButton, TurnTimestamp }
