/**
 * Chat attention logic — chat's facade over the kit's conversation
 * attention rules (generalized out of this module in #703; the S6
 * suppression matrix lives in @makinbakin/sdk/components now). Chat keeps
 * its chatId-shaped signatures so provider code and tests read in chat
 * vocabulary; the decisions are the kit's, shared by every conversational
 * surface.
 */
import {
  attentionForDone as attentionForConversationDone,
  badgeFor,
  visibleIdFromLocation,
  withUnreadPrefix,
  type AttentionActions,
} from '@makinbakin/sdk/components'

export { badgeFor, withUnreadPrefix }

export interface ChatDonePayload {
  chatId: string
  agentId: string
  preview?: string
  aborted?: boolean
}

export interface AttentionContext {
  /** The chat currently open in the UI, '' when none (or not on /chat). */
  visibleChatId: string
  settings: { sound: boolean; toasts: boolean }
}

export function attentionForDone(payload: ChatDonePayload, ctx: AttentionContext): AttentionActions {
  return attentionForConversationDone(
    {
      key: payload.chatId,
      agentId: payload.agentId,
      ...(payload.preview !== undefined ? { preview: payload.preview } : {}),
      ...(payload.aborted !== undefined ? { aborted: payload.aborted } : {}),
    },
    { visibleKey: ctx.visibleChatId, settings: ctx.settings },
  )
}

/**
 * The chat the user is currently viewing, derived from the URL path
 * (/chat/$chatId since the PR2 path migration). /chat (list) and /chat/new
 * (draft) view no conversation, so they never suppress attention.
 */
export function visibleChatIdFromLocation(pathname: string): string {
  return visibleIdFromLocation(pathname, '/chat', { exclude: ['new'] })
}
