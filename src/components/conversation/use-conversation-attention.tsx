'use client'

/**
 * useConversationAttention — the provider building block behind every
 * conversational surface's `nav-badge-providers` slot component (#703).
 * Mount the consumer's provider outside the router (the host renders the
 * slot on every page) and call this hook with the surface's wiring; it
 * keeps the nav indicator (unread replies only), the optional `(N)`
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
}

export interface ConversationAttentionConfig {
  pluginId: string
  navItemId: string
  /**
   * The surface's bus event names; `refresh` lists extra total-bumping
   * events — AT MOST TWO (hook-count constraints; extras would be
   * silently dropped, so the type forbids them).
   */
  events: { done: string; error: string; started?: string; refresh?: [string] | [string, string] }
  keyOf: (payload: PluginEventPayload) => string
  /** The thread key currently on screen ('' = none) — read at event time. */
  visibleKey: () => string
  /** Fetch unread totals; null keeps the previous totals. */
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
  const baseTitleRef = useRef<string | null>(null)
  const configRef = useRef(config)
  configRef.current = config

  const refreshSeqRef = useRef(0)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryAttempt = useRef(0)
  const refreshTotals = useCallback(async function refreshTotals() {
    const seq = ++refreshSeqRef.current
    if (retryRef.current) clearTimeout(retryRef.current)
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      const totals = await Promise.race([
        configRef.current.refreshTotals(),
        new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Attention read timed out')), 15_000) }),
      ])
      if (seq !== refreshSeqRef.current) return
      if (!totals || !Number.isSafeInteger(totals.unreadTotal) || totals.unreadTotal < 0) {
        throw new Error('Attention totals unavailable')
      }
      retryAttempt.current = 0
      setUnreadTotal(totals.unreadTotal)
    } catch {
      if (seq !== refreshSeqRef.current) return
      retryRef.current = setTimeout(() => { void refreshTotals() }, Math.min(1000 * 2 ** retryAttempt.current++, 30_000))
    } finally {
      if (deadline) clearTimeout(deadline)
    }
  }, [])

  usePluginEvent('bakin.reconcile', () => { void refreshTotals() })
  // A new send may mark prior replies read before any reply arrives.
  usePluginEvent(config.events.started ?? `${config.pluginId}.__attention_noop_started`, () => { void refreshTotals() })

  usePluginEvent(config.events.done, (payload) => {
    const cfg = configRef.current
    const key = cfg.keyOf(payload)
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
      // `toastId` is assigned right after toast() returns; the dismiss
      // closure guards against a consumer invoking it synchronously during
      // renderToast (before the id exists).
      let toastId: string | null = null
      const dismiss = () => {
        if (toastId) useToastStore.getState().dismiss(toastId)
      }
      toastId = toast(cfg.renderToast(done, dismiss), 'info')
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

  useEffect(() => {
    void refreshTotals()
    return () => {
      // Invalidate every outstanding response when this subscription unmounts.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      refreshSeqRef.current++
      if (retryRef.current) clearTimeout(retryRef.current)
    }
  }, [refreshTotals])

  // Work in progress never competes with unread information in navigation.
  useNavBadge(config.pluginId, config.navItemId, badgeFor(unreadTotal))

  // `(N)` tab-title prefix.
  const titlePrefix = config.titlePrefix ?? false
  useEffect(() => {
    if (!titlePrefix) return
    baseTitleRef.current ??= document.title
    document.title = withUnreadPrefix(baseTitleRef.current, unreadTotal)
  }, [titlePrefix, unreadTotal])
}
