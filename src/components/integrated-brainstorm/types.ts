import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface BrainstormMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  agentId?: string
  timestamp?: string
}

export interface SendContext {
  signal: AbortSignal
  onToken: (text: string) => void
  onCustom?: (name: string, data: unknown) => void
}

/**
 * `history` contains the conversation PRIOR to this turn — the new user
 * message is `prompt`, not yet in `history`. When you're posting to an
 * OpenAI-shaped chat endpoint, append `{ role: 'user', content: prompt }`
 * to the mapped history to get the full messages array.
 */
export type BrainstormOnSend = (
  prompt: string,
  history: BrainstormMessage[],
  ctx: SendContext,
) => Promise<{ content: string }>

export interface AssistantTransformed {
  text: string
  extras?: ReactNode
}

export interface IntegratedBrainstormProps {
  messages: BrainstormMessage[]
  onMessagesChange: (next: BrainstormMessage[]) => void
  onSend: BrainstormOnSend
  agentId: string
  onAgentChange?: (agentId: string) => void

  label?: string
  icon?: LucideIcon
  placeholder?: string
  emptyState?: ReactNode

  position?: 'bottom'
  collapsible?: boolean
  defaultOpen?: boolean
  conversationStartHeight?: number
  minHeight?: number
  maxHeight?: number
  maxInputHeight?: number
  storageKey?: string
  /**
   * Fill parent height via flex-1/h-full instead of a fixed pixel height.
   * Drops the drag handle (nothing to drag against) and disables auto-expand
   * (already full-size). Use when the panel IS the pane — e.g. a dedicated
   * chat route — rather than a bottom sheet above other content.
   */
  fitParent?: boolean
  /**
   * Hide the icon + label + reply-count header entirely. Use when the parent
   * page already has its own title chrome. Default: true (header shown).
   */
  showHeader?: boolean

  readOnly?: boolean
  readOnlyNotice?: ReactNode

  transformAssistantMessage?: (raw: string) => AssistantTransformed
}
