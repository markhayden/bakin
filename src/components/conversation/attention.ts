/**
 * Conversation attention rules — ONE set of pure decisions for every
 * conversational surface's badge provider (#703): what a turn's done/error
 * means given where the user is looking. Providers execute the returned
 * actions (toast/sound/OS notification/seen); this module never touches
 * the DOM so the rules stay unit-testable. Generalized verbatim from the
 * chat plugin's attention module (chat re-exports from here).
 *
 * Suppression rules (chat spec S6, now kit-wide):
 * - Reply lands while the user is VIEWING that thread → no toast, no
 *   sound, no OS notification (the conversation itself is the signal);
 *   unread is cleared (the view fires seen).
 * - Reply lands elsewhere in the app → toast + sound; the OS notification
 *   is also requested — sendBrowserNotification suppresses itself when
 *   the tab has focus, so it only fires when the user is in another app.
 * - Aborted turns notify nothing — the user stopped it themselves.
 */

export interface ConversationDonePayload {
  /** The thread key (chat: chatId; projects: projectId; …). */
  key: string
  agentId: string
  preview?: string
  aborted?: boolean
}

export interface ConversationAttentionContext {
  /** The thread currently open in the UI, '' when none. */
  visibleKey: string
  settings: { sound: boolean; toasts: boolean }
}

export interface AttentionActions {
  toast: boolean
  sound: boolean
  /** Ask browser-notify (it self-suppresses while the tab is focused). */
  browserNotification: boolean
  /** The user is looking at the thread — mark it seen instead of unread. */
  markSeen: boolean
}

export function attentionForDone(
  payload: ConversationDonePayload,
  ctx: ConversationAttentionContext,
): AttentionActions {
  if (payload.aborted) {
    return { toast: false, sound: false, browserNotification: false, markSeen: payload.key === ctx.visibleKey }
  }
  const viewing = payload.key === ctx.visibleKey
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
 * The entity id the user is currently viewing, derived from a
 * `<base>/<id>` URL path (list and excluded ids — e.g. a `/new` draft
 * route — view no conversation, so they never suppress attention).
 */
export function visibleIdFromLocation(
  pathname: string,
  base: string,
  opts?: { exclude?: readonly string[] },
): string {
  const match = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^/]+)/?$`).exec(pathname)
  if (!match) return ''
  const id = decodeURIComponent(match[1])
  return opts?.exclude?.includes(id) ? '' : id
}

/** Nav badge from unread totals + in-flight turns: count wins, dot while working. */
export function badgeFor(
  totalUnread: number,
  inflightCount: number,
): { count?: number; tone: 'attention' | 'info' } | null {
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
