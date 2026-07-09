/**
 * Chat client data hooks — REST reads + live streaming assembly.
 *
 * The server streams a turn as `chat.chunk` / `chat.done` / `chat.error`
 * plugin-events over the shell's single SSE connection; these hooks fold
 * that into per-chat live state on top of the durable transcript.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePluginEvent } from '@makinbakin/sdk/hooks'

const API = '/api/plugins/chat'

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

export interface LiveToolChip {
  key: string
  toolName: string
  summary?: string
  status: 'running' | 'completed' | 'failed'
}

export function useChats(agentFilter: string) {
  const [chats, setChats] = useState<ChatSummaryDto[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const url = agentFilter ? `${API}/chats?agent=${encodeURIComponent(agentFilter)}` : `${API}/chats`
      const res = await fetch(url)
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
  const res = await fetch(`${API}/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId }),
  })
  if (!res.ok) return null
  return ((await res.json()) as { chat: ChatSummaryDto }).chat
}

export async function deleteChatRequest(chatId: string): Promise<boolean> {
  const res = await fetch(`${API}/chats/${chatId}`, { method: 'DELETE' })
  return res.ok
}

export interface ChatStreamState {
  chat: ChatSummaryDto | null
  rows: TranscriptRowDto[]
  liveText: string
  liveTools: LiveToolChip[]
  streaming: boolean
  sendError: string | null
  send: (content: string) => Promise<void>
}

export function useChatStream(chatId: string): ChatStreamState {
  const [chat, setChat] = useState<ChatSummaryDto | null>(null)
  const [rows, setRows] = useState<TranscriptRowDto[]>([])
  const [liveText, setLiveText] = useState('')
  const [liveTools, setLiveTools] = useState<LiveToolChip[]>([])
  const [streaming, setStreaming] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  // Guard against SSE events for other chats / stale fetches after switching.
  const activeChatRef = useRef(chatId)
  activeChatRef.current = chatId

  const loadTranscript = useCallback(async () => {
    if (!chatId) { setChat(null); setRows([]); return }
    const res = await fetch(`${API}/chats/${chatId}`)
    if (!res.ok || activeChatRef.current !== chatId) return
    const body = (await res.json()) as { chat: ChatSummaryDto; messages: TranscriptRowDto[] }
    setChat(body.chat)
    setRows(body.messages)
  }, [chatId])

  useEffect(() => {
    setLiveText('')
    setLiveTools([])
    setStreaming(false)
    setSendError(null)
    void loadTranscript()
  }, [loadTranscript])

  usePluginEvent('chat.chunk', (payload) => {
    if (payload.chatId !== activeChatRef.current) return
    const chunk = payload.chunk as { type: string; content?: string; data?: Record<string, unknown> } | undefined
    if (!chunk) return
    setStreaming(true)
    if (chunk.type === 'text' && chunk.content) {
      setLiveText((prev) => prev + chunk.content)
    } else if (chunk.type === 'tool' && chunk.data) {
      const tool = chunk.data as { callId?: string; toolName?: string; phase?: string; summary?: string; status?: string }
      const key = tool.callId ?? `${tool.toolName}-${Date.now()}`
      setLiveTools((prev) => {
        const status: LiveToolChip['status'] =
          tool.phase === 'result' ? (tool.status === 'failed' ? 'failed' : 'completed') : 'running'
        const existing = prev.findIndex((c) => c.key === key)
        // Result chunks usually carry no summary — keep the call's summary
        // instead of wiping the chip back to a bare tool name.
        const summary = tool.summary ?? (existing >= 0 ? prev[existing].summary : undefined)
        const chip: LiveToolChip = { key, toolName: tool.toolName ?? 'tool', summary, status }
        if (existing >= 0) return prev.map((c, i) => (i === existing ? chip : c))
        return [...prev, chip]
      })
    }
  })

  const settle = useCallback(() => {
    setStreaming(false)
    setLiveText('')
    setLiveTools([])
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
    const res = await fetch(`${API}/chats/${chatId}/messages`, {
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

  return { chat, rows, liveText, liveTools, streaming, sendError, send }
}
