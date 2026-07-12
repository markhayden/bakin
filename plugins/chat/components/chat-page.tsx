/**
 * Chat page — session-manager layout: padded header (search + start), the
 * grouped rail, and the conversation pane (launcher when nothing is
 * selected, draft mode before first send).
 *
 * URL state: ?chat=<chatId> (active chat), ?draft=<agentId> (draft
 * conversation), ?agents=a,b (rail facet filter).
 *
 * Keyboard shortcuts (page-scoped): ⌘⇧O new chat (launcher), ⌥↑/⌥↓
 * previous/next chat, ⇧Esc focus the composer.
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { PluginHeader } from '@makinbakin/sdk/components'
import { usePluginEvent, useQueryState, useRouter } from '@makinbakin/sdk/hooks'
import { pluginFetch } from '@makinbakin/sdk/utils'

import { AgentPicker } from './agent-picker'
import { ChatRail, useRailCollapsed } from './chat-rail'
import { ChatView, DraftChatView } from './chat-view'
import { Launcher } from './launcher'
import { createChatRequest, useChats } from './use-chat-data'

/** Create the chat and fire the first message (draft mode's first send). */
async function createAndSend(agentId: string, content: string): Promise<string | null> {
  const chat = await createChatRequest(agentId)
  if (!chat) return null
  const res = await pluginFetch('chat', `chats/${chat.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  return res.ok ? chat.id : chat.id // chat exists either way; errors surface in the view
}

function ChatPageInner() {
  const [chatId] = useQueryState('chat', '')
  const [draftAgent] = useQueryState('draft', '')
  const [agentFilter, setAgentFilter] = useQueryState('agent', '')
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useRailCollapsed()
  const { chats, allChats, loading, refresh } = useChats(agentFilter)
  const router = useRouter()

  // ONE navigation per transition. Two useQueryState setters in the same
  // tick lose updates (each builds from the pre-navigation params snapshot,
  // so the second clobbers the first — the "booted back to the launcher"
  // bug). Reads window.location.search at CALL time.
  const setParams = useCallback(
    (patch: Record<string, string>) => {
      const params = new URLSearchParams(window.location.search)
      for (const [key, value] of Object.entries(patch)) {
        if (value) params.set(key, value)
        else params.delete(key)
      }
      const qs = params.toString()
      router.replace(qs ? `/chat?${qs}` : '/chat')
    },
    [router],
  )

  // Live in-flight indicators: seed from the list, keep fresh via events.
  const [streamingIds, setStreamingIds] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    setStreamingIds(new Set(chats.filter((c) => c.streaming).map((c) => c.id)))
  }, [chats])
  usePluginEvent('chat.chunk', (payload) => {
    const id = payload.chatId as string
    setStreamingIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  })
  const clearStreaming = useCallback((id: string) => {
    setStreamingIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])
  usePluginEvent('chat.done', (payload) => clearStreaming(payload.chatId as string))
  usePluginEvent('chat.error', (payload) => clearStreaming(payload.chatId as string))

  const visibleChats = useMemo(() => {
    if (!search.trim()) return chats
    const q = search.toLowerCase()
    return chats.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.agentId.toLowerCase().includes(q) ||
        (c.lastMessagePreview ?? '').toLowerCase().includes(q),
    )
  }, [chats, search])

  const openChat = useCallback(
    (id: string) => setParams({ chat: id, draft: '' }),
    [setParams],
  )

  const startDraft = useCallback(
    (agentId: string) => setParams({ chat: '', draft: agentId }),
    [setParams],
  )

  // Page-scoped keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘⇧O — new chat (back to the launcher)
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        setParams({ chat: '', draft: '' })
        return
      }
      // ⌥↑ / ⌥↓ — previous/next chat in the visible list
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const ids = visibleChats.map((c) => c.id)
        if (!ids.length) return
        e.preventDefault()
        const idx = ids.indexOf(chatId)
        const next =
          e.key === 'ArrowUp'
            ? ids[Math.max(0, idx <= 0 ? 0 : idx - 1)]
            : ids[Math.min(ids.length - 1, idx + 1)]
        openChat(next)
        return
      }
      // ⇧Esc — focus the composer
      if (e.shiftKey && e.key === 'Escape') {
        const ta = document.querySelector<HTMLTextAreaElement>('[data-chat-pane] textarea')
        if (ta) {
          e.preventDefault()
          ta.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chatId, visibleChats, openChat, setParams])

  return (
    <div className="flex h-full flex-col" data-chat-pane>
      <div className="px-6 pb-2 pt-3 md:pt-4">
        <PluginHeader
          title="Chat"
          count={loading ? undefined : chats.length}
          search={{ value: search, onChange: setSearch, placeholder: 'Search chats…' }}
          actions={<AgentPicker onPick={startDraft} compact />}
        />
      </div>
      <div className="flex min-h-0 flex-1 border-t border-border">
        <ChatRail
          chats={visibleChats}
          agentIds={[...new Set(allChats.map((c) => c.agentId))]}
          loading={loading}
          selectedId={chatId}
          agentFilter={agentFilter}
          streamingIds={streamingIds}
          collapsed={collapsed}
          onCollapse={setCollapsed}
          onSelect={openChat}
          onStartChat={startDraft}
          onAgentFilter={setAgentFilter}
          onChanged={() => { void refresh() }}
        />
        {chatId ? (
          <ChatView key={chatId} chatId={chatId} onChanged={() => { void refresh() }} />
        ) : draftAgent ? (
          <DraftChatView
            key={draftAgent}
            agentId={draftAgent}
            createAndSend={createAndSend}
            onCreated={(id) => {
              openChat(id)
              void refresh()
            }}
          />
        ) : (
          <Launcher chats={chats} loading={loading} onStartChat={startDraft} onOpenChat={openChat} />
        )}
      </div>
    </div>
  )
}

export function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageInner />
    </Suspense>
  )
}
