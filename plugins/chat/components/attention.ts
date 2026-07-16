/**
 * Chat attention logic — pure decisions for the badge provider: what a
 * chat.done/chat.error means given where the user is looking. The provider
 * executes the returned actions (toast/sound/OS notification/seen); this
 * module never touches the DOM so the rules are unit-testable.
 *
 * Suppression rules (spec S6):
 * - Reply lands while the user is VIEWING that chat → no toast, no sound,
 *   no OS notification (the conversation itself is the signal); unread is
 *   cleared (the view fires seen).
 * - Reply lands elsewhere in the app → toast + sound; the OS notification
 *   is also requested — sendBrowserNotification suppresses itself when the
 *   tab has focus, so it only fires when the user is in another app.
 * - Aborted turns notify nothing — the user stopped it themselves.
 */

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

export interface AttentionActions {
  toast: boolean
  sound: boolean
  /** Ask browser-notify (it self-suppresses while the tab is focused). */
  browserNotification: boolean
  /** The user is looking at the chat — mark it seen instead of unread. */
  markSeen: boolean
}

export function attentionForDone(payload: ChatDonePayload, ctx: AttentionContext): AttentionActions {
  if (payload.aborted) {
    return { toast: false, sound: false, browserNotification: false, markSeen: payload.chatId === ctx.visibleChatId }
  }
  const viewing = payload.chatId === ctx.visibleChatId
  if (viewing) {
    return { toast: false, sound: false, browserNotification: false, markSeen: true }
  }
  return {
    toast: ctx.settings.toasts,
    sound: ctx.settings.sound,
    browserNotification: true,
    markSeen: false,
  }
}

/**
 * The chat the user is currently viewing, derived from the URL path
 * (/chat/$chatId since the PR2 path migration). /chat (list) and /chat/new
 * (draft) view no conversation, so they never suppress attention.
 */
export function visibleChatIdFromLocation(pathname: string): string {
  const match = /^\/chat\/([^/]+)\/?$/.exec(pathname)
  if (!match) return ''
  const id = decodeURIComponent(match[1])
  return id === 'new' ? '' : id
}

/** Nav badge from unread totals + in-flight turns: count wins, dot while working. */
export function badgeFor(totalUnread: number, inflightCount: number): { count?: number; tone: 'attention' | 'info' } | null {
  if (totalUnread > 0) return { count: totalUnread, tone: 'attention' }
  if (inflightCount > 0) return { tone: 'info' } // dot: agents are working
  return null
}

/** `(N) ` tab-title prefix management (idempotent). */
export function withUnreadPrefix(title: string, totalUnread: number): string {
  const base = title.replace(/^\(\d+\+?\)\s+/, '')
  if (totalUnread <= 0) return base
  return `(${totalUnread > 99 ? '99+' : totalUnread}) ${base}`
}
