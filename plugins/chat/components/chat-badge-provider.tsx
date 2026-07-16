/**
 * ChatBadgeProvider — the attention system's global brain. Mounted in the
 * host's `nav-badge-providers` slot (outside the router), so it runs on
 * every page: it keeps the Chat nav badge (unread count / working dot),
 * the `(N)` tab-title prefix, and fires toast + chime + OS notification
 * when a reply lands while the user is elsewhere (rules in attention.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AgentAvatar } from '@makinbakin/sdk/components'
import { useAgent, useNavBadge, usePluginEvent, useRouter, toast, useToastStore } from '@makinbakin/sdk/hooks'
import { pluginFetch } from '@makinbakin/sdk/utils'

import { sendBrowserNotification } from '../../../src/lib/browser-notify'
import {
  attentionForDone,
  badgeFor,
  visibleChatIdFromLocation,
  withUnreadPrefix,
  type ChatDonePayload,
} from './attention'
import { playReplyChime } from './notification-sound'
import type { ChatSummaryDto } from './use-chat-data'

interface ChatAttentionSettings {
  sound: boolean
  toasts: boolean
}

const DEFAULT_ATTENTION_SETTINGS: ChatAttentionSettings = { sound: true, toasts: true }

function ReplyToast({ chatId, agentId, preview, onNavigate }: { chatId: string; agentId: string; preview?: string; onNavigate?: () => void }) {
  const agent = useAgent(agentId)
  const router = useRouter()
  return (
    <button
      type="button"
      data-chat-toast={chatId}
      onClick={() => {
        onNavigate?.()
        router.push(`/chat/${encodeURIComponent(chatId)}`)
      }}
      className="flex max-w-sm items-start gap-2 text-left"
    >
      <AgentAvatar agentId={agentId} size="xs" />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{agent?.name ?? agentId} replied</span>
        {preview ? <span className="block truncate text-xs text-muted-foreground">{preview}</span> : null}
      </span>
    </button>
  )
}

export function ChatBadgeProvider() {
  const [unreadTotal, setUnreadTotal] = useState(0)
  const [inflight, setInflight] = useState<ReadonlySet<string>>(new Set())
  const settingsRef = useRef<ChatAttentionSettings>(DEFAULT_ATTENTION_SETTINGS)
  const baseTitleRef = useRef<string | null>(null)

  const refreshUnread = useCallback(async () => {
    try {
      const res = await pluginFetch('chat', 'chats')
      if (!res.ok) return
      const { chats } = (await res.json()) as { chats: ChatSummaryDto[] }
      setUnreadTotal(chats.reduce((acc, c) => acc + (c.unreadCount ?? 0), 0))
      setInflight(new Set(chats.filter((c) => c.streaming).map((c) => c.id)))
    } catch {
      // Server hiccups never break the shell; the next event refreshes.
    }
  }, [])

  useEffect(() => {
    void refreshUnread()
    void fetch('/api/plugin-settings/chat')
      .then(async (res) => {
        if (!res.ok) return
        const values = (await res.json()) as Partial<ChatAttentionSettings>
        settingsRef.current = { ...DEFAULT_ATTENTION_SETTINGS, ...values }
      })
      .catch(() => {})
  }, [refreshUnread])

  usePluginEvent('chat.chunk', (payload) => {
    const id = payload.chatId as string
    setInflight((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  })

  usePluginEvent('chat.done', (payload) => {
    const done = payload as unknown as ChatDonePayload
    setInflight((prev) => {
      const next = new Set(prev)
      next.delete(done.chatId)
      return next
    })
    const actions = attentionForDone(done, {
      visibleChatId: visibleChatIdFromLocation(window.location.pathname),
      settings: settingsRef.current,
    })
    if (actions.toast) {
      // The closure reads `id` only on click, after toast() has returned it —
      // navigating in-app dismisses the toast instead of leaving it to expire.
      const id: string = toast(
        <ReplyToast
          chatId={done.chatId}
          agentId={done.agentId}
          preview={done.preview}
          onNavigate={() => useToastStore.getState().dismiss(id)}
        />,
        'info',
      )
    }
    if (actions.sound) playReplyChime()
    if (actions.browserNotification && done.preview) {
      // browser-notify self-suppresses while the tab is focused.
      sendBrowserNotification(`${done.agentId} replied`, done.preview, `/chat/${encodeURIComponent(done.chatId)}`)
    }
    void refreshUnread()
  })

  usePluginEvent('chat.error', (payload) => {
    const id = payload.chatId as string
    setInflight((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    const visible = visibleChatIdFromLocation(window.location.pathname)
    if (visible !== id && settingsRef.current.toasts) {
      toast(`Chat reply failed: ${String(payload.message ?? 'unknown error')}`, 'error')
    }
    void refreshUnread()
  })

  usePluginEvent('chat.titled', () => { void refreshUnread() })
  // Fires after a seen write lands (view opened / reply seen in place) —
  // the authoritative moment to drop the unread count.
  usePluginEvent('chat.seen', () => { void refreshUnread() })

  // Nav badge: unread count (attention) or a working dot (info).
  useNavBadge('chat', 'chat', badgeFor(unreadTotal, inflight.size))

  // `(N)` tab-title prefix.
  useEffect(() => {
    baseTitleRef.current ??= document.title
    document.title = withUnreadPrefix(baseTitleRef.current, unreadTotal)
  }, [unreadTotal])

  return null
}
