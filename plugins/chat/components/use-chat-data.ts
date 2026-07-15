/**
 * Chat client data hooks — REST reads + live streaming assembly.
 *
 * The server streams a turn as `chat.chunk` / `chat.done` / `chat.error`
 * plugin-events over the shell's single SSE connection; these hooks fold
 * that into per-chat live state on top of the durable v2 transcript, which
 * maps 1:1 onto the conversation kit's ConversationMessage rows.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { emitPluginEvent, usePluginEvent } from '@makinbakin/sdk/hooks'
import type { ConversationMessage } from '@makinbakin/sdk/components'
import type { RuntimeChatChunk } from '@makinbakin/sdk/types'
import { pluginFetch } from '@makinbakin/sdk/utils'

export interface ChatSummaryDto {
  id: string
  agentId: string
  title: string
  titleSource: 'fallback' | 'llm' | 'user'
  pinned: boolean
  createdAt: string
  updatedAt: string
  messageCount: number
  unreadCount: number
  lastSeenAt?: string
  lastMessageAt?: string
  lastMessagePreview?: string
  /** Server-seeded in-flight flag (kept live by chat.chunk/done events). */
  streaming?: boolean
}

/** Server transcript row → kit row (attachment paths become served URLs). */
export type TranscriptRowDto =
  | { kind: 'user'; ts: string; content: string; attachments?: Array<{ name: string; mimeType: string; path: string }> }
  | { kind: 'assistant'; ts: string; turnId?: string; content: string }
  | {
      kind: 'tool'
      ts: string
      turnId?: string
      callId?: string
      toolName: string
      status: 'completed' | 'failed'
      summary?: string
      inputPreview?: string
      outputPreview?: string
      durationMs?: number
      metadata?: Record<string, unknown>
    }
  | { kind: 'error'; ts: string; turnId?: string; message: string; errorKind?: string }
  | { kind: 'aborted'; ts: string; turnId?: string }

export function attachmentUrl(chatId: string, name: string): string {
  return `/api/plugins/chat/chats/${chatId}/attachments/${encodeURIComponent(name)}`
}

function rowToMessage(chatId: string, row: TranscriptRowDto): ConversationMessage {
  if (row.kind === 'user' && row.attachments?.length) {
    return {
      ...row,
      attachments: row.attachments.map((a) => ({ name: a.name, mimeType: a.mimeType, url: attachmentUrl(chatId, a.name) })),
    }
  }
  return row as ConversationMessage
}

export function useChats(agentFilter: string) {
  const [chats, setChats] = useState<ChatSummaryDto[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await pluginFetch('chat', 'chats')
      if (res.ok) setChats(((await res.json()) as { chats: ChatSummaryDto[] }).chats)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  // A finished turn bumps updatedAt/title/unreadCount — keep the list fresh.
  usePluginEvent('chat.done', () => { void refresh() })
  usePluginEvent('chat.error', () => { void refresh() })
  usePluginEvent('chat.titled', () => { void refresh() })
  usePluginEvent('chat.seen', () => { void refresh() })

  const filtered = agentFilter ? chats.filter((c) => c.agentId === agentFilter) : chats
  return { chats: filtered, allChats: chats, loading, refresh }
}

export async function createChatRequest(agentId: string): Promise<ChatSummaryDto | null> {
  const res = await pluginFetch('chat', 'chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId }),
  })
  if (!res.ok) return null
  return ((await res.json()) as { chat: ChatSummaryDto }).chat
}

export async function deleteChatRequest(chatId: string): Promise<boolean> {
  const res = await pluginFetch('chat', `chats/${chatId}`, { method: 'DELETE' })
  return res.ok
}

export async function patchChatRequest(
  chatId: string,
  patch: { title?: string; pinned?: boolean },
): Promise<ChatSummaryDto | null> {
  const res = await pluginFetch('chat', `chats/${chatId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) return null
  return ((await res.json()) as { chat: ChatSummaryDto }).chat
}

export async function markSeenRequest(chatId: string): Promise<void> {
  await pluginFetch('chat', `chats/${chatId}/seen`, { method: 'POST' }).catch(() => {})
  // Client-side synthetic event: the badge provider and chat lists refresh
  // AFTER the seen write lands — refreshing on chat.done alone raced the
  // seen POST and left a stale unread count on the nav badge.
  emitPluginEvent({ event: 'chat.seen', chatId })
}

export async function abortTurnRequest(chatId: string): Promise<void> {
  await pluginFetch('chat', `chats/${chatId}/abort`, { method: 'POST' }).catch(() => {})
}

export interface UploadedAttachment {
  name: string
  mimeType: string
  path: string
}

export async function uploadAttachmentRequest(chatId: string, file: File): Promise<UploadedAttachment | null> {
  const form = new FormData()
  form.append('file', file)
  const res = await pluginFetch('chat', `chats/${chatId}/attachments`, { method: 'POST', body: form })
  if (!res.ok) return null
  return ((await res.json()) as { attachment: UploadedAttachment }).attachment
}

// Capability probes are per (agent, model) and stable within a session —
// cache so switching chats doesn't re-fetch.
const imageInputCache = new Map<string, boolean>()

export function useAgentImageInput(agentId: string): boolean {
  const [enabled, setEnabled] = useState(imageInputCache.get(agentId) ?? false)
  useEffect(() => {
    // Empty while the chat summary loads — the probe re-runs with the real id.
    if (!agentId) return
    const cached = imageInputCache.get(agentId)
    if (cached !== undefined) {
      setEnabled(cached)
      return
    }
    let cancelled = false
    void pluginFetch('chat', `capabilities?agent=${encodeURIComponent(agentId)}`)
      .then(async (res) => {
        const value = res.ok ? ((await res.json()) as { imageInput?: boolean }).imageInput === true : false
        imageInputCache.set(agentId, value)
        if (!cancelled) setEnabled(value)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [agentId])
  return enabled
}

export interface ChatStreamState {
  chat: ChatSummaryDto | null
  /** Durable transcript as kit rows (attachments URL-mapped). */
  messages: ConversationMessage[]
  /** The in-flight turn's chunks; null when idle. */
  liveChunks: RuntimeChatChunk[] | null
  streaming: boolean
  sendError: string | null
  send: (content: string, attachments?: Array<{ name: string; mimeType: string; path: string }>) => Promise<void>
  abort: () => void
  /** Re-send the newest user message (error-turn "Try again"). */
  retry: () => void
  refreshChat: () => Promise<void>
}

export function useChatStream(chatId: string): ChatStreamState {
  const [chat, setChat] = useState<ChatSummaryDto | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [liveChunks, setLiveChunks] = useState<RuntimeChatChunk[] | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  // Guard against SSE events for other chats / stale fetches after switching.
  const activeChatRef = useRef(chatId)
  activeChatRef.current = chatId
  const lastUserRef = useRef<{ content: string; attachments?: Array<{ name: string; mimeType: string; path: string }> }>({ content: '' })

  const loadTranscript = useCallback(async () => {
    if (!chatId) { setChat(null); setMessages([]); return }
    const res = await pluginFetch('chat', `chats/${chatId}`)
    if (!res.ok || activeChatRef.current !== chatId) return
    const body = (await res.json()) as { chat: ChatSummaryDto; messages: TranscriptRowDto[] }
    // Re-check AFTER the body read too — a slow response for the previous
    // chat could land post-switch and render the wrong transcript.
    if (activeChatRef.current !== chatId) return
    setChat(body.chat)
    setMessages(body.messages.map((row) => rowToMessage(chatId, row)))
    const lastUser = [...body.messages].reverse().find((r) => r.kind === 'user')
    if (lastUser?.kind === 'user') lastUserRef.current = { content: lastUser.content, attachments: lastUser.attachments }
  }, [chatId])

  useEffect(() => {
    setLiveChunks(null)
    setStreaming(false)
    setSendError(null)
    void loadTranscript()
    // Opening a chat marks it seen.
    if (chatId) void markSeenRequest(chatId)
  }, [loadTranscript, chatId])

  usePluginEvent('chat.chunk', (payload) => {
    if (payload.chatId !== activeChatRef.current) return
    const chunk = payload.chunk as RuntimeChatChunk | undefined
    if (!chunk?.type) return
    setStreaming(true)
    setLiveChunks((prev) => {
      const chunks = prev ?? []
      // Coalesce consecutive same-format text deltas so a long turn stays a
      // handful of chunks instead of hundreds; folding/rendering policy
      // itself lives in the kit's foldConversation.
      const last = chunks[chunks.length - 1]
      if (
        chunk.type === 'text' && chunk.content &&
        last?.type === 'text' && (last.format ?? 'markdown') === (chunk.format ?? 'markdown')
      ) {
        return [...chunks.slice(0, -1), { ...last, content: (last.content ?? '') + chunk.content }]
      }
      return [...chunks, chunk]
    })
  })

  const settle = useCallback(() => {
    setStreaming(false)
    setLiveChunks(null)
    void loadTranscript()
    // The reply landed while the user is looking at this chat.
    if (activeChatRef.current) void markSeenRequest(activeChatRef.current)
  }, [loadTranscript])

  usePluginEvent('chat.done', (payload) => {
    if (payload.chatId === activeChatRef.current) settle()
  })
  usePluginEvent('chat.error', (payload) => {
    if (payload.chatId === activeChatRef.current) settle()
  })

  const send = useCallback(async (
    content: string,
    attachments?: Array<{ name: string; mimeType: string; path: string }>,
  ) => {
    setSendError(null)
    lastUserRef.current = { content, attachments }
    // Optimistic user row — WITH its attachments (they lagged to the post-turn
    // refetch otherwise); the durable copy replaces it on the next refetch.
    setMessages((prev) => [
      ...prev,
      {
        kind: 'user',
        ts: new Date().toISOString(),
        content,
        ...(attachments?.length
          ? { attachments: attachments.map((a) => ({ name: a.name, mimeType: a.mimeType, url: attachmentUrl(chatId, a.name) })) }
          : {}),
      },
    ])
    setStreaming(true)
    setLiveChunks([])
    const res = await pluginFetch('chat', `chats/${chatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, ...(attachments?.length ? { attachments } : {}) }),
    })
    if (!res.ok) {
      setStreaming(false)
      setLiveChunks(null)
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setSendError(body.error ?? `send failed (${res.status})`)
    }
  }, [chatId])

  const abort = useCallback(() => {
    if (chatId) void abortTurnRequest(chatId)
  }, [chatId])

  const retry = useCallback(() => {
    // Re-send text AND the failed turn's attachments (they were dropped).
    const last = lastUserRef.current
    if (last.content || last.attachments?.length) void send(last.content, last.attachments)
  }, [send])

  return { chat, messages, liveChunks, streaming, sendError, send, abort, retry, refreshChat: loadTranscript }
}
