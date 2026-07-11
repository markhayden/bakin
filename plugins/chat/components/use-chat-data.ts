/**
 * Chat client data hooks — REST reads + live streaming assembly.
 *
 * The server streams a turn as `chat.chunk` / `chat.done` / `chat.error`
 * plugin-events over the shell's single SSE connection; these hooks fold
 * that into per-chat live state on top of the durable transcript.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePluginEvent } from '@makinbakin/sdk/hooks'
import type { RuntimeChatChunk } from '@makinbakin/sdk/types'
import { pluginFetch } from '@makinbakin/sdk/utils'

export interface ChatSummaryDto {
  id: string
  agentId: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export type TranscriptRowDto =
  | { kind: 'user'; ts: string; content: string }
  | { kind: 'assistant'; ts: string; content: string }
  | { kind: 'tool'; ts: string; summary: string }
  | { kind: 'error'; ts: string; message: string }

// Live tool-chip folding now lives in the SDK's TurnOutputView
// (foldTurnChunks) — the hook just accumulates the turn's chunks.

export function useChats(agentFilter: string) {
  const [chats, setChats] = useState<ChatSummaryDto[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const url = agentFilter ? `chats?agent=${encodeURIComponent(agentFilter)}` : 'chats'
      const res = await pluginFetch('chat', url)
      if (res.ok) setChats(((await res.json()) as { chats: ChatSummaryDto[] }).chats)
    } finally {
      setLoading(false)
    }
  }, [agentFilter])

  useEffect(() => { void refresh() }, [refresh])
  // A finished turn bumps updatedAt/title/messageCount — keep the list fresh.
  usePluginEvent('chat.done', () => { void refresh() })

  return { chats, loading, refresh }
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

export interface ChatStreamState {
  chat: ChatSummaryDto | null
  rows: TranscriptRowDto[]
  /** The in-flight turn's normalized chunks — render via TurnOutputView. */
  liveChunks: RuntimeChatChunk[]
  streaming: boolean
  sendError: string | null
  send: (content: string) => Promise<void>
}

export function useChatStream(chatId: string): ChatStreamState {
  const [chat, setChat] = useState<ChatSummaryDto | null>(null)
  const [rows, setRows] = useState<TranscriptRowDto[]>([])
  const [liveChunks, setLiveChunks] = useState<RuntimeChatChunk[]>([])
  const [streaming, setStreaming] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  // Guard against SSE events for other chats / stale fetches after switching.
  const activeChatRef = useRef(chatId)
  activeChatRef.current = chatId

  const loadTranscript = useCallback(async () => {
    if (!chatId) { setChat(null); setRows([]); return }
    const res = await pluginFetch('chat', `chats/${chatId}`)
    if (!res.ok || activeChatRef.current !== chatId) return
    const body = (await res.json()) as { chat: ChatSummaryDto; messages: TranscriptRowDto[] }
    setChat(body.chat)
    setRows(body.messages)
  }, [chatId])

  useEffect(() => {
    setLiveChunks([])
    setStreaming(false)
    setSendError(null)
    void loadTranscript()
  }, [loadTranscript])

  usePluginEvent('chat.chunk', (payload) => {
    if (payload.chatId !== activeChatRef.current) return
    const chunk = payload.chunk as RuntimeChatChunk | undefined
    if (!chunk?.type) return
    setStreaming(true)
    setLiveChunks((prev) => {
      // Coalesce consecutive same-format text deltas so a long turn stays a
      // handful of chunks instead of hundreds; folding/rendering policy
      // itself lives in TurnOutputView.
      const last = prev[prev.length - 1]
      if (
        chunk.type === 'text' && chunk.content &&
        last?.type === 'text' && (last.format ?? 'markdown') === (chunk.format ?? 'markdown')
      ) {
        return [...prev.slice(0, -1), { ...last, content: (last.content ?? '') + chunk.content }]
      }
      return [...prev, chunk]
    })
  })

  const settle = useCallback(() => {
    setStreaming(false)
    setLiveChunks([])
    void loadTranscript()
  }, [loadTranscript])

  usePluginEvent('chat.done', (payload) => {
    if (payload.chatId === activeChatRef.current) settle()
  })
  usePluginEvent('chat.error', (payload) => {
    if (payload.chatId === activeChatRef.current) settle()
  })

  const send = useCallback(async (content: string) => {
    setSendError(null)
    // Optimistic user row; the durable copy replaces it on the next refetch.
    setRows((prev) => [...prev, { kind: 'user', ts: new Date().toISOString(), content }])
    setStreaming(true)
    const res = await pluginFetch('chat', `chats/${chatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) {
      setStreaming(false)
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setSendError(body.error ?? `send failed (${res.status})`)
    }
  }, [chatId])

  return { chat, rows, liveChunks, streaming, sendError, send }
}
