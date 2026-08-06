/**
 * Chat page — session-manager layout: padded header (search + start), the
 * grouped rail, and the conversation pane (launcher when nothing is
 * selected, draft mode before first send).
 *
 * URL surface (routing overhaul PR2, spec D2 — path = page identity):
 *   /chat                  — list / launcher; ?agent= is the rail filter
 *   /chat/$chatId          — active conversation (chatId arrives as a prop
 *                            from the host route); ?agent= filter carries
 *   /chat/new?agent=<id>   — draft composer; here ?agent= is the DRAFT
 *                            agent, so the rail renders unfiltered
 *
 * Keyboard shortcuts (page-scoped): ⌘⇧O new chat (launcher), ⌥↑/⌥↓
 * previous/next chat, ⇧Esc focus the composer.
 */
import { useRef, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { writeComposerDraft, type ComposerHandle } from '@makinbakin/sdk/conversation'
import { toast, usePluginEvent } from '@makinbakin/sdk/hooks'
import { useQueryState, useRouter } from '@makinbakin/sdk/navigation'
import {
  PageBody,
  PageHeader,
  SearchInput,
  WorkspacePage,
  WorkspacePageBody,
  WorkspacePageHeader,
} from '@makinbakin/sdk/patterns'
import { Badge, Button, SystemState } from '@makinbakin/sdk/ui'
import { pluginFetch } from '@makinbakin/sdk/utils'

import { AgentPicker } from './agent-picker'
import { ChatRail, useRailCollapsed } from './chat-rail'
import { ChatView, DraftChatView } from './chat-view'
import { Launcher } from './launcher'
import { createChatRequest, uploadAttachmentRequest, useChats, type UploadedAttachment } from './use-chat-data'

export interface CreateAndSendResult {
  /** Null only when chat creation itself failed. */
  chatId: string | null
  /** The first message actually reached the server. */
  sent: boolean
}

/**
 * Create the chat and fire the first message (draft mode's first send).
 * Draft-staged files upload AFTER creation (#730, spec D5 client
 * orchestration): create → upload each → send with the uploaded refs.
 * Late-step failures are NEVER silent (review finding — the old path
 * navigated into an empty chat with the text gone): a failed upload
 * toasts (parity with the existing-chat path), and a failed message POST
 * toasts AND preserves the text as the NEW chat's composer draft, so the
 * operator lands in the chat with their words intact.
 */
export async function createAndSend(agentId: string, content: string, files?: File[]): Promise<CreateAndSendResult> {
  const chat = await createChatRequest(agentId)
  if (!chat) return { chatId: null, sent: false }
  const attachments: UploadedAttachment[] = []
  for (const file of files ?? []) {
    const uploaded = await uploadAttachmentRequest(chat.id, file)
    if (uploaded) attachments.push(uploaded)
    else toast(`Couldn't attach ${file.name} — upload failed`, 'error')
  }
  let sent = false
  try {
    const res = await pluginFetch('chat', `chats/${chat.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, ...(attachments.length ? { attachments } : {}) }),
    })
    sent = res.ok
  } catch {
    sent = false
  }
  if (!sent) {
    writeComposerDraft(`chat:${chat.id}`, content)
    toast("Message didn't send — your text is waiting in the composer", 'error')
  }
  return { chatId: chat.id, sent }
}

interface ChatPageProps {
  /** Active conversation id — threaded in by the /chat/$chatId host route. */
  chatId?: string
  /** Draft mode — set by the /chat/new registration; agent rides ?agent=. */
  draft?: boolean
}

function ChatPageInner({ chatId = '', draft = false }: ChatPageProps) {
  const [agentParam, setAgentParam] = useQueryState('agent', '')
  // On /chat/new the agent param IS the draft agent (spec D2); on the list
  // and conversation routes it's the rail filter. Never both.
  const draftAgent = draft ? agentParam : ''
  const agentFilter = draft ? '' : agentParam
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useRailCollapsed()
  const { chats, allChats, loading, refresh } = useChats(agentFilter)
  const router = useRouter()
  const composerRef = useRef<ComposerHandle | null>(null)

  /** Carry the active rail filter across page-identity navigations. */
  const withFilter = useCallback(
    (path: string) => (agentFilter ? `${path}?agent=${encodeURIComponent(agentFilter)}` : path),
    [agentFilter],
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

  // push — conversations are places; back/forward walks between them.
  const openChat = useCallback(
    (id: string) => router.push(withFilter(`/chat/${encodeURIComponent(id)}`)),
    [router, withFilter],
  )

  const startDraft = useCallback(
    (agentId: string) => router.push(`/chat/new?agent=${encodeURIComponent(agentId)}`),
    [router],
  )

  // Page-scoped keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘⇧O — new chat (back to the launcher)
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        router.push(withFilter('/chat'))
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
        e.preventDefault()
        composerRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chatId, visibleChats, openChat, router, withFilter])

  return (
    <WorkspacePage
      data-chat-pane
      data-chat-contained-page
    >
      <WorkspacePageHeader className={chatId || draft ? 'hidden md:block' : undefined}>
        <PageHeader
          title="Chat"
          description="Talk with any agent, revisit recent conversations, and keep tool activity and attachments with the thread."
          meta={loading ? undefined : (
            <Badge size="xs" variant="outline">{visibleChats.length} shown</Badge>
          )}
          controlsLabel="Chat search"
          controls={(
            <SearchInput
              align="end"
              label="Chat search"
              value={search}
              onValueChange={setSearch}
              placeholder="Search chats…"
              busy={loading}
              mobileFullWidth
            className="@3xl/page-header:w-[22rem] @3xl/page-header:shrink-0"
            />
          )}
          actionsLabel="Chat actions"
          actions={<AgentPicker onPick={startDraft} />}
        />
      </WorkspacePageHeader>
      <WorkspacePageBody>
        <PageBody
          gap="content"
          className="bg-bakin-canvas-default"
        >
          <div className="flex min-h-0 flex-1 overflow-hidden" data-chat-workspace>
            <div className="hidden min-h-0 md:flex">
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
                onAgentFilter={(v) => {
                  // On /chat/new the agent param is the draft agent — a rail
                  // filter click there navigates back to the (filtered) list.
                  if (draft) router.push(v ? `/chat?agent=${encodeURIComponent(v)}` : '/chat')
                  else setAgentParam(v)
                }}
                onChanged={() => { void refresh() }}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              {chatId || draftAgent ? (
                <div className="relative z-10 shrink-0 border-b border-bakin-border-subtle p-bakin-2 md:hidden">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-chat-mobile-back
                    onClick={() => router.push(withFilter('/chat'))}
                  >
                    <ArrowLeft /> Chats
                  </Button>
                </div>
              ) : null}
              {chatId ? (
                <ChatView key={chatId} chatId={chatId} onChanged={() => { void refresh() }} composerHandleRef={composerRef} />
              ) : draftAgent ? (
                <DraftChatView
                  key={draftAgent}
                  agentId={draftAgent}
                  createAndSend={createAndSend}
                  composerHandleRef={composerRef}
                  onCreated={(id) => {
                    // replace — the dead draft URL shouldn't survive in history.
                    router.replace(`/chat/${encodeURIComponent(id)}`)
                    void refresh()
                  }}
                />
              ) : (
                <Launcher chats={chats} loading={loading} onStartChat={startDraft} onOpenChat={openChat} />
              )}
            </div>
          </div>
        </PageBody>
      </WorkspacePageBody>
    </WorkspacePage>
  )
}

export function ChatPage(props: ChatPageProps) {
  return (
    <Suspense fallback={<SystemState kind="loading" scope="page" title="Loading chat" />}>
      <ChatPageInner {...props} />
    </Suspense>
  )
}
