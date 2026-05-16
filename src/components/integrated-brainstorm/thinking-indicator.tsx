'use client'

import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { AgentAvatar } from '@makinbakin/sdk/components'
import { useAgent } from '@makinbakin/sdk/hooks'

export const THINKING_VERBS = [
  'sizzling', 'crackling', 'brewing', 'steeping', 'curing', 'thawing', 'smoking',
  'flipping', 'rendering', 'marinating', 'scrambling', 'poaching', 'preheating',
  'microwaving', 'baking', 'wafting', 'simmering', 'searing', 'whisking', 'roasting',
  'crisping', 'churning', 'seasoning', 'scorching', 'folding', 'charring', 'toasting',
] as const

interface ThinkingIndicatorProps {
  agentId: string
  verb: string
}

export function ThinkingIndicator({ agentId, verb }: ThinkingIndicatorProps) {
  const agent = useAgent(agentId)
  const name = agent?.name ?? agentId
  return (
    <div
      data-testid="thinking-indicator"
      className="mt-[5px] flex items-center gap-2.5 text-muted-foreground"
      aria-live="polite"
    >
      <AgentAvatar agentId={agentId} size="sm" className="shrink-0" />
      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
      <span className="text-xs">
        {name} is {verb}…
      </span>
    </div>
  )
}

interface StreamingBubbleProps {
  agentId: string
  content: string
  extras?: ReactNode
}

export function StreamingBubble({ agentId, content, extras }: StreamingBubbleProps) {
  return (
    <div data-testid="streaming-bubble" className="flex items-start gap-2">
      <AgentAvatar agentId={agentId} size="sm" className="mt-0.5 shrink-0" />
      <div className="max-w-[90%] px-3 py-2 rounded-lg border-l-2 border-l-muted bg-[rgba(255,255,255,0.03)] text-sm whitespace-pre-wrap [&_p]:!my-0 [&_p+p]:!mt-2 [&_*:first-child]:!mt-0 [&_*:last-child]:!mb-0">
        {content}
        {extras}
      </div>
    </div>
  )
}

interface ErrorBubbleProps {
  message: string
}

export function ErrorBubble({ message }: ErrorBubbleProps) {
  return (
    <div
      data-testid="error-bubble"
      role="alert"
      className="flex items-start gap-2 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-300"
    >
      {message}
    </div>
  )
}

export function AbortedNotice() {
  return (
    <div
      data-testid="aborted-notice"
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 px-3 py-1.5 mt-2 text-[11px] text-zinc-500 italic"
    >
      <span className="size-1.5 rounded-full bg-zinc-600" aria-hidden="true" />
      Stopped — send a new message to continue
    </div>
  )
}
