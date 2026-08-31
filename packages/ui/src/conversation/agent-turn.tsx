'use client'

import type { ReactNode } from 'react'

import { Alert, AlertDescription } from '../primitives/alert'
import { Button } from '../primitives/button'
import { cn } from '../utils'
import { ActivityGroup } from './activity-group'
import type {
  ConversationTextFormat,
  ConversationToolCall,
  ConversationTurn,
  TurnItem,
} from './fold'
import { AlertIcon, DefaultAvatar, DefaultText, SpinnerIcon } from './glyphs'
import { CopyButton, TurnTimestamp } from './turn-controls'
import {
  formatTokenCount,
  usageFooterLines,
  type ConversationTurnUsage,
} from './turn-usage'

/** Presentation-ready identity for a conversation author. */
export interface ConversationAgent {
  id?: string
  name: string
  avatarUrl?: string
}

export type ConversationAvatarRenderer = (agent: ConversationAgent) => ReactNode
export type ConversationTextRenderer = (content: string, format: ConversationTextFormat) => ReactNode
export type ConversationTextTransform = (text: string) => { text: string; extras?: ReactNode }

function StopCircleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 shrink-0 fill-none stroke-current stroke-[1.5]">
      <circle cx="8" cy="8" r="5.5" />
      <path d="m4.25 11.75 7.5-7.5" />
    </svg>
  )
}

function RetryIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-3 fill-none stroke-current stroke-[1.5]">
      <path d="M12.25 5.25V2.5m0 2.75H9.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 5a5 5 0 1 0 .2 5.75" strokeLinecap="round" />
    </svg>
  )
}

function ThinkingStatus({ label }: { label: string }) {
  return (
    <div
      aria-live="polite"
      className="flex min-h-bakin-6 items-center gap-bakin-2 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted"
    >
      <SpinnerIcon />
      <span className="min-w-0 break-words">{label}…</span>
    </div>
  )
}

function turnText(items: readonly TurnItem[]): string {
  return items
    .filter((item): item is Extract<TurnItem, { type: 'text' }> => item.type === 'text')
    .map((item) => item.content)
    .join('\n\n')
}

/** Props for a standalone author-bound streaming indicator. */
export interface ThinkingIndicatorProps {
  agent: ConversationAgent
  label?: string
  renderAvatar?: ConversationAvatarRenderer
  className?: string
}

/** Author identity plus a reduced-motion-safe visible streaming label. */
export function ThinkingIndicator({
  agent,
  label = 'thinking',
  renderAvatar,
  className,
}: ThinkingIndicatorProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-bakin-3', className)}>
      <span data-conv-avatar="" className="shrink-0" aria-hidden="true">
        {renderAvatar ? renderAvatar(agent) : <DefaultAvatar agent={agent} size="sm" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[length:var(--bakin-typography-size-meta)] font-bakin-typography-weight-semibold text-bakin-text-primary">
          {agent.name}
        </span>
        <ThinkingStatus label={label} />
      </span>
    </div>
  )
}

/** Props for one render-ready agent turn. */
export interface AgentTurnProps {
  turn: Extract<ConversationTurn, { kind: 'agent' }>
  agent: ConversationAgent
  onRetry?: () => void
  onOpenCall?: (call: ConversationToolCall) => void
  renderAvatar?: ConversationAvatarRenderer
  /** Render text formats; markdown falls back to safe pre-wrapped text. */
  renderText?: ConversationTextRenderer
  /** Optional domain post-processing performed before `renderText`. */
  transformText?: ConversationTextTransform
  /** Optional compatibility formatter for runtime-specific tool summaries. */
  formatToolSummary?: (summary: string) => string
  /** Recorded usage for this settled turn. Unknown values remain absent. */
  usage?: ConversationTurnUsage
  /** Approximate output tokens while this turn is streaming. */
  liveOutEstimate?: number
  className?: string
}

/** Ordered agent reply with visible identity, evidence, lifecycle, and actions. */
export function AgentTurn({
  turn,
  agent,
  onRetry,
  onOpenCall,
  renderAvatar,
  renderText,
  transformText,
  formatToolSummary,
  usage,
  liveOutEstimate,
  className,
}: AgentTurnProps) {
  const copyText = turnText(turn.items)
  const streaming = turn.status === 'streaming'
  const toolCallCount = turn.items.reduce(
    (count, item) => count + (item.type === 'activity' ? item.calls.length : 0),
    0,
  )
  const usageLines = usage && !streaming ? usageFooterLines(usage, toolCallCount) : []
  const resolvedAgent: ConversationAgent = {
    ...agent,
    ...(turn.agentId ? { id: turn.agentId } : {}),
  }

  return (
    <article
      data-conv-turn=""
      aria-label={`${resolvedAgent.name} reply`}
      className={cn(
        'grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-bakin-3 gap-y-bakin-2',
        'font-bakin-typography-family-ui text-[length:var(--bakin-typography-size-body)]',
        className,
      )}
    >
      <span data-conv-avatar="" className="row-span-2 shrink-0" aria-hidden="true">
        {renderAvatar ? renderAvatar(resolvedAgent) : <DefaultAvatar agent={resolvedAgent} size="sm" />}
      </span>

      <header className="flex min-w-0 flex-wrap items-center gap-x-bakin-2 gap-y-bakin-1">
        <span className="min-w-0 truncate font-bakin-typography-weight-semibold text-bakin-text-primary">
          {resolvedAgent.name}
        </span>
        <TurnTimestamp ts={turn.ts} />
        {copyText ? <CopyButton text={copyText} label="Copy reply" className="ml-auto" /> : null}
      </header>

      <div className="grid min-w-0 gap-bakin-3">
        {turn.items.map((item, index) => {
          if (item.type === 'text') {
            const transformed = transformText ? transformText(item.content) : { text: item.content }
            return (
              <div key={index} className="min-w-0">
                {renderText
                  ? renderText(transformed.text, item.format)
                  : <DefaultText content={transformed.text} format={item.format} />}
                {transformed.extras ?? null}
              </div>
            )
          }
          if (item.type === 'activity') {
            return (
              <ActivityGroup
                key={index}
                calls={item.calls}
                onOpenCall={onOpenCall}
                formatSummary={formatToolSummary}
              />
            )
          }
          return (
            <Alert key={index} tone="danger" role="status" data-conv-error="">
              <AlertIcon />
              <AlertDescription className="flex min-w-0 flex-wrap items-center gap-bakin-2">
                <span className="min-w-0 break-words">{item.message}</span>
                {item.errorKind ? (
                  <span className="min-w-0 max-w-full break-all rounded-bakin-control bg-bakin-signal-danger/10 px-bakin-1 font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)]">
                    {item.errorKind}
                  </span>
                ) : null}
              </AlertDescription>
            </Alert>
          )
        })}

        {streaming ? (
          <div className="flex min-w-0 items-center justify-between gap-bakin-3">
            <ThinkingStatus label={turn.statusLabel ?? 'thinking'} />
            {(liveOutEstimate ?? 0) > 0 ? (
              <span
                data-conv-usage-live=""
                title="Estimated from text streamed so far; recorded counts arrive when the reply finishes"
                className="shrink-0 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted"
              >
                ~{formatTokenCount(liveOutEstimate!)} out…
              </span>
            ) : null}
          </div>
        ) : null}

        {turn.status === 'aborted' ? (
          <div className="flex items-center gap-bakin-2 text-[length:var(--bakin-typography-size-meta)] text-bakin-text-muted">
            <StopCircleIcon /> Stopped
          </div>
        ) : null}

        {turn.status === 'error' && onRetry ? (
          <Button type="button" variant="outline" size="xs" onClick={onRetry} className="justify-self-start">
            <RetryIcon /> Try again
          </Button>
        ) : null}

        {usageLines.length ? (
          <div
            data-conv-usage=""
            className="text-[length:var(--bakin-typography-size-meta)] leading-relaxed text-bakin-text-muted"
          >
            {usageLines.map((line) => <div key={line}>{line}</div>)}
          </div>
        ) : null}
      </div>
    </article>
  )
}
