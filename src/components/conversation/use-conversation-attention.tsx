'use client'

/**
 * useConversationAttention — the provider building block behind every
 * conversational surface's `nav-badge-providers` slot component (#703).
 * Mount the consumer's provider outside the router (the host renders the
 * slot on every page) and call this hook with the surface's wiring; it
 * keeps the nav badge (unread count / working dot), the optional `(N)`
 * tab-title prefix, and fires toast + chime + OS notification when a
 * reply lands while the user is elsewhere — rules in ./attention.ts,
 * mechanics generalized from chat's ChatBadgeProvider (which now
 * composes this hook).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

import { usePluginEvent, type PluginEventPayload } from '@/hooks/use-plugin-event'
import { useNavBadge } from '@/hooks/use-nav-badge'
import { toast, useToastStore } from '@/hooks/use-toast'
import { sendBrowserNotification } from '@/lib/browser-notify'

import { attentionForDone, badgeFor, withUnreadPrefix, type ConversationDonePayload } from './attention'
import { playReplyChime } from './notification-sound'

export interface ConversationAttentionTotals {
  unreadTotal: number
  /** Threads with a server-seeded in-flight turn (kept live by chunk/done events). */
  inflightKeys: string[]
}

export interface ConversationAttentionConfig {
  pluginId: string
  navItemId: string
  /** The surface's bus event names; `refresh` lists extra total-bumping events. */
  events: { chunk: string; done: string; error: string; refresh?: string[] }
  keyOf: (payload: PluginEventPayload) => string
  /** The thread key currently on screen ('' = none) — read at event time. */
  visibleKey: () => string
  /** Fetch unread + in-flight totals; null keeps the previous totals. */
  refreshTotals: () => Promise<ConversationAttentionTotals | null>
  /** Attention settings at event time. Default: sound + toasts on. */
  settings?: () => { sound: boolean; toasts: boolean }
  /** Reply toast content; `dismiss` closes it (call before in-app navigation). */
  renderToast: (payload: ConversationDonePayload, dismiss: () => void) => ReactNode | string
  /**
   * OS notification for a reply that landed while the user was elsewhere;
   * null skips it. Runs only when the done carries a preview (matching
   * chat: silent settles never notify).
   */
  osNotification: (payload: ConversationDonePayload) => { title: string; body: string; href: string } | null
  /** Error toast content when a turn fails off-screen; null skips. */
  errorToast?: (payload: PluginEventPayload) => string | null
  /** Maintain the `(N)` tab-title prefix (chat does; embedded surfaces may skip). */
  titlePrefix?: boolean
  /** Injectable chime (tests); defaults to the kit reply chime. */
  chime?: () => void
}

export function useConversationAttention(config: ConversationAttentionConfig): void {
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [inflight, setInflight] = useState<ReadonlySet<string>>(new Set())
  const baseTitleRef = useRef<string | null>(null)
  const configRef = useRef(config)
  configRef.current = config

  const refreshTotals = useCallback(async () => {
    try {
      const totals = await configRef.current.refreshTotals()
      if (!totals) return
      setUnreadTotal(totals.unreadTotal)
      setInflight(new Set(totals.inflightKeys))
    } catch {
      // Server hiccups never break the shell; the next event refreshes.
    }
  }, [])

  useEffect(() => {
    void refreshTotals()
  }, [refreshTotals])

  usePluginEvent(config.events.chunk, (payload) => {
    const key = configRef.current.keyOf(payload)
    setInflight((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
  })

  usePluginEvent(config.events.done, (payload) => {
    const cfg = configRef.current
    const key = cfg.keyOf(payload)
    setInflight((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    const done: ConversationDonePayload = {
      key,
      agentId: String(payload.agentId ?? ''),
      ...(typeof payload.preview === 'string' ? { preview: payload.preview } : {}),
      ...(payload.aborted ? { aborted: true } : {}),
    }
    const actions = attentionForDone(done, {
      visibleKey: cfg.visibleKey(),
      settings: cfg.settings?.() ?? { sound: true, toasts: true },
    })
    if (actions.toast) {
      // The closure reads `id` only on click, after toast() has returned it —
      // navigating in-app dismisses the toast instead of leaving it to expire.
      const id: string = toast(cfg.renderToast(done, () => useToastStore.getState().dismiss(id)), 'info')
    }
    if (actions.sound) (cfg.chime ?? playReplyChime)()
    if (actions.browserNotification && done.preview) {
      const desc = cfg.osNotification(done)
      // browser-notify self-suppresses while the tab is focused.
      if (desc) sendBrowserNotification(desc.title, desc.body, desc.href)
    }
    void refreshTotals()
  })

  usePluginEvent(config.events.error, (payload) => {
    const cfg = configRef.current
    const key = cfg.keyOf(payload)
    setInflight((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    const settings = cfg.settings?.() ?? { sound: true, toasts: true }
    if (cfg.visibleKey() !== key && settings.toasts) {
      const message = cfg.errorToast?.(payload)
      if (message) toast(message, 'error')
    }
    void refreshTotals()
  })

  // Extra total-bumping events (e.g. chat.titled, chat.seen) — a fixed hook
  // count per render is required, so consumers get up to two slots.
  const refreshEvents = config.events.refresh ?? []
  usePluginEvent(refreshEvents[0] ?? `${config.pluginId}.__attention_noop_0`, () => { void refreshTotals() })
  usePluginEvent(refreshEvents[1] ?? `${config.pluginId}.__attention_noop_1`, () => { void refreshTotals() })

  // Nav badge: unread count (attention) or a working dot (info).
  useNavBadge(config.pluginId, config.navItemId, badgeFor(unreadTotal, inflight.size))

  // `(N)` tab-title prefix.
  const titlePrefix = config.titlePrefix ?? false
  useEffect(() => {
    if (!titlePrefix) return
    baseTitleRef.current ??= document.title
    document.title = withUnreadPrefix(baseTitleRef.current, unreadTotal)
  }, [titlePrefix, unreadTotal])
}
