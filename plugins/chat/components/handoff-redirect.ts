/**
 * Where an open chat goes when its reply is handed off.
 *
 * Only on the live event, only for the chat on screen, and only when the
 * reply created exactly ONE hand-off target and that target took the
 * history. Two created (even if one failed) is ambiguous: the cards in the
 * reply link to both. Loading a chat that was handed off earlier never
 * redirects — nothing calls this on load.
 */
import { entityHref } from '@makinbakin/sdk/navigation'

export interface ChatHandoffPayload {
  chatId?: unknown
  created?: unknown
  targets?: unknown
}

export function handoffRedirect(payload: ChatHandoffPayload, openChatId: string | null | undefined): string | null {
  if (!openChatId || payload.chatId !== openChatId) return null
  if (payload.created !== 1 || !Array.isArray(payload.targets) || payload.targets.length !== 1) return null
  const target = payload.targets[0] as { entity?: unknown; id?: unknown } | null
  if (typeof target?.entity !== 'string' || typeof target.id !== 'string') return null
  return entityHref(target.entity, target.id)
}
