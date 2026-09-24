/**
 * ChatBadgeProvider — the attention system's global brain. Mounted in the
 * host's `nav-badge-providers` slot (outside the router), so it runs on
 * every page: it keeps the Chat nav badge (unread replies),
 * the `(N)` tab-title prefix, and fires toast + chime + OS notification
 * when a reply lands while the user is elsewhere. The mechanics live in
 * the kit's useConversationAttention (#703); chat supplies its wiring —
 * totals from GET /chats, the reply toast, plugin-settings toggles.
 */
import { useEffect, useRef } from 'react'
import { ConversationReplyToast, useConversationAttention } from '@makinbakin/sdk/conversation'
import { pluginFetch } from '@makinbakin/sdk/utils'

import { visibleChatIdFromLocation } from './attention'
import type { ChatSummaryDto } from './use-chat-data'

interface ChatAttentionSettings {
  sound: boolean
  toasts: boolean
}

const DEFAULT_ATTENTION_SETTINGS: ChatAttentionSettings = { sound: true, toasts: true }

export function ChatBadgeProvider() {
  const settingsRef = useRef<ChatAttentionSettings>(DEFAULT_ATTENTION_SETTINGS)

  useEffect(() => {
    void fetch('/api/plugin-settings/chat')
      .then(async (res) => {
        if (!res.ok) return
        const values = (await res.json()) as Partial<ChatAttentionSettings>
        settingsRef.current = { ...DEFAULT_ATTENTION_SETTINGS, ...values }
      })
      .catch(() => {})
  }, [])

  useConversationAttention({
    pluginId: 'chat',
    navItemId: 'chat',
    events: {
      started: 'chat.started',
      done: 'chat.done',
      error: 'chat.error',
      // chat.changed covers deletion; chat.seen fires after a seen write
      // lands (view opened / reply seen in place) — the authoritative
      // moment to drop the unread count.
      refresh: ['chat.changed', 'chat.seen'],
    },
    keyOf: (payload) => String(payload.chatId ?? ''),
    visibleKey: () => visibleChatIdFromLocation(window.location.pathname),
    refreshTotals: async () => {
      const res = await pluginFetch('chat', 'chats')
      if (!res.ok) return null
      const { chats } = (await res.json()) as { chats: ChatSummaryDto[] }
      return {
        unreadTotal: chats.reduce((acc, c) => acc + (c.unreadCount ?? 0), 0),
      }
    },
    settings: () => settingsRef.current,
    renderToast: (done, dismiss) => (
      <ConversationReplyToast
        agentId={done.agentId}
        title="replied"
        preview={done.preview}
        to={`/chat/${encodeURIComponent(done.key)}`}
        onNavigate={dismiss}
        testId={{ attr: 'data-chat-toast', value: done.key }}
      />
    ),
    osNotification: (done) => ({
      title: `${done.agentId} replied`,
      body: done.preview ?? '',
      href: `/chat/${encodeURIComponent(done.key)}`,
    }),
    errorToast: (payload) => `Chat reply failed: ${String(payload.message ?? 'unknown error')}`,
    titlePrefix: true,
  })

  return null
}
