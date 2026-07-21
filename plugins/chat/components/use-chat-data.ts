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
import { useConversationThread, type ConversationMessage } from '@makinbakin/sdk/components'
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
  const lastUserRef = useRef<{ content: string; attachments?: Array<{ name: string; mimeType: string; path: string }> }>({ content: '' })
  // Guards the lastUserRef side effect below: a slow load for a PREVIOUS
  // chat must never overwrite the retry payload after a switch (the kit's
  // own stale-load guard protects messages/meta, not this ref).
  const chatIdRef = useRef(chatId)
  chatIdRef.current = chatId

  // The kit hook owns the shared client core (optimistic echo, bus
  // streaming + coalescing, active-thread guards, settle-by-refetch);
  // chat keeps its own policy here: seen tracking, retry with
  // attachments, attachment URL mapping, and NO streaming pre-light from
  // the server flag (the transcript + next chunk carry the state).
  const thread = useConversationThread<ChatSummaryDto, { name: string; mimeType: string; path: string }>({
    threadKey: chatId,
    events: { chunk: 'chat.chunk', done: 'chat.done', error: 'chat.error' },
    keyOf: (payload) => payload.chatId,
    load: async (key) => {
      const res = await pluginFetch('chat', `chats/${key}`)
      if (!res.ok) return null
      const body = (await res.json()) as { chat: ChatSummaryDto; messages: TranscriptRowDto[] }
      if (key === chatIdRef.current) {
        const lastUser = [...body.messages].reverse().find((r) => r.kind === 'user')
        if (lastUser?.kind === 'user') lastUserRef.current = { content: lastUser.content, attachments: lastUser.attachments }
      }
      return { messages: body.messages.map((row) => rowToMessage(key, row)), meta: body.chat }
    },
    post: async (key, content, attachments) => {
      const res = await pluginFetch('chat', `chats/${key}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, ...(attachments?.length ? { attachments } : {}) }),
      })
      if (res.ok) return { ok: true }
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, status: res.status, ...(body.error ? { error: body.error } : {}) }
    },
    // Optimistic user row — WITH its attachments (they lagged to the
    // post-turn refetch otherwise); the durable copy replaces it on the
    // next refetch.
    optimisticRow: (content, attachments) => ({
      kind: 'user',
      ts: new Date().toISOString(),
      content,
      ...(attachments?.length
        ? { attachments: attachments.map((a) => ({ name: a.name, mimeType: a.mimeType, url: attachmentUrl(chatId, a.name) })) }
        : {}),
    }),
    // The reply landed while the user is looking at this chat.
    onSettled: () => {
      if (chatId) void markSeenRequest(chatId)
    },
  })

  // Opening a chat marks it seen.
  useEffect(() => {
    if (chatId) void markSeenRequest(chatId)
  }, [chatId])

  const threadSend = thread.send
  const send = useCallback(async (
    content: string,
    attachments?: Array<{ name: string; mimeType: string; path: string }>,
  ) => {
    lastUserRef.current = { content, attachments }
    await threadSend(content, attachments)
  }, [threadSend])

  const abort = useCallback(() => {
    if (chatId) void abortTurnRequest(chatId)
  }, [chatId])

  const retry = useCallback(() => {
    // Re-send text AND the failed turn's attachments (they were dropped).
    const last = lastUserRef.current
    if (last.content || last.attachments?.length) void send(last.content, last.attachments)
  }, [send])

  return {
    chat: thread.meta,
    messages: thread.messages,
    liveChunks: thread.liveChunks,
    streaming: thread.streaming,
    sendError: thread.sendError,
    send,
    abort,
    retry,
    refreshChat: thread.refresh,
  }
}
