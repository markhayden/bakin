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
import {
  useConversationThread,
  type ContextMeterStats,
  type ConversationMessage,
  type ConversationQueuedItem,
  type ConversationTurnUsage,
} from '@makinbakin/sdk/components'
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

/** Chat-level usage totals (GET /chats/:id `usageTotals`, #733). */
export interface ChatUsageTotals {
  turns: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costUsd?: number
}

/** Server queued-message DTO (GET /chats/:id `queued`). */
export interface ChatQueuedDto {
  id: string
  ts: string
  content: string
  attachments?: Array<{ name: string; mimeType: string; path: string }>
}

/** Queued DTO → kit item. The spread keeps `path` alongside the display
 *  url so remove-restore can re-stage the attachment for a resend. */
function toQueuedItem(chatId: string, q: ChatQueuedDto): ConversationQueuedItem {
  return {
    ...q,
    attachments: q.attachments?.map((a) => ({ ...a, url: attachmentUrl(chatId, a.name) })),
  }
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
  // chat.started re-lights the rail's working spinner the instant a drained
  // turn reserves its slot (without it the dot blinked off between a done
  // and the drained turn's first chunk).
  usePluginEvent('chat.started', () => { void refresh() })
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

// Capability cache — stale-while-revalidate (#731): the Map is only an
// instant seed (no flicker when switching chats); EVERY mount re-probes in
// the background so a model change surfaces on the next chat open instead
// of after a browser restart. Staleness is bounded to the mounted view.
const imageInputCache = new Map<string, boolean>()
// In-flight probe dedup — rail + view mounting together share one fetch.
const imageInputProbes = new Map<string, Promise<boolean | null>>()

/** Probe the agent's image capability; null = probe failed (keep last-known). */
function probeImageInput(agentId: string): Promise<boolean | null> {
  let probe = imageInputProbes.get(agentId)
  if (!probe) {
    probe = pluginFetch('chat', `capabilities?agent=${encodeURIComponent(agentId)}`)
      .then(async (res) => (res.ok ? ((await res.json()) as { imageInput?: boolean }).imageInput === true : null))
      .catch(() => null)
      .finally(() => {
        imageInputProbes.delete(agentId)
      })
    imageInputProbes.set(agentId, probe)
  }
  return probe
}

export function useAgentImageInput(agentId: string): boolean {
  const [enabled, setEnabled] = useState(imageInputCache.get(agentId) ?? false)
  useEffect(() => {
    // Empty while the chat summary loads — the probe re-runs with the real id.
    if (!agentId) return
    let cancelled = false
    setEnabled(imageInputCache.get(agentId) ?? false)
    void probeImageInput(agentId).then((value) => {
      // Failure keeps last-known (a blip never yanks a working affordance);
      // an agent never probed successfully stays conservative-false.
      if (value === null) return
      imageInputCache.set(agentId, value)
      if (!cancelled) setEnabled(value)
    })
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
  /** Pending queued follow-ups (#729). */
  queued: ConversationQueuedItem[]
  /** Remove a queued item; returns it so the view can restore its text. */
  removeQueued: (id: string) => Promise<ConversationQueuedItem | null>
  /** Per-turn recorded usage keyed by turnId (#733) — footers. */
  turnUsage: Record<string, ConversationTurnUsage>
  /** Chat-level usage sums; null when nothing is recorded (no chip). */
  usageTotals: ChatUsageTotals | null
  /** Runtime context reading (#737); null = no bar (honest absence). */
  contextStats: ContextMeterStats | null
  send: (content: string, attachments?: Array<{ name: string; mimeType: string; path: string }>) => Promise<void>
  abort: () => void
  /** Re-send the newest user message (error-turn "Try again"). */
  retry: () => void
  refreshChat: () => Promise<void>
}

export function useChatStream(chatId: string): ChatStreamState {
  const lastUserRef = useRef<{ content: string; attachments?: Array<{ name: string; mimeType: string; path: string }> }>({ content: '' })
  // Usage decoration (#733) — refreshed by the same loads that refresh the
  // transcript (mount + every settle), so footers land the moment a turn
  // finishes. Chat-owned state beside the kit hook (same pattern as
  // lastUserRef): the kit's load contract stays usage-agnostic.
  const [turnUsage, setTurnUsage] = useState<Record<string, ConversationTurnUsage>>({})
  const [usageTotals, setUsageTotals] = useState<ChatUsageTotals | null>(null)
  const [contextStats, setContextStats] = useState<ContextMeterStats | null>(null)
  useEffect(() => {
    setTurnUsage({})
    setUsageTotals(null)
    setContextStats(null)
  }, [chatId])
  // Guards the lastUserRef side effect below: a slow load for a PREVIOUS
  // chat must never overwrite the retry payload after a switch (the kit's
  // own stale-load guard protects messages/meta, not this ref).
  const chatIdRef = useRef(chatId)
  chatIdRef.current = chatId

  // The kit hook owns the shared client core (optimistic echo, bus
  // streaming + coalescing, active-thread guards, settle-by-refetch);
  // chat keeps its own policy here: seen tracking, retry with
  // attachments, and attachment URL mapping.
  const thread = useConversationThread<ChatSummaryDto, { name: string; mimeType: string; path: string }>({
    threadKey: chatId,
    events: { chunk: 'chat.chunk', done: 'chat.done', error: 'chat.error' },
    keyOf: (payload) => payload.chatId,
    load: async (key) => {
      const res = await pluginFetch('chat', `chats/${key}`)
      if (!res.ok) return null
      const body = (await res.json()) as {
        chat: ChatSummaryDto
        messages: TranscriptRowDto[]
        queued?: ChatQueuedDto[]
        usage?: Record<string, ConversationTurnUsage>
        usageTotals?: ChatUsageTotals
        contextStats?: ContextMeterStats
        streamingText?: string
      }
      if (key === chatIdRef.current) {
        const lastUser = [...body.messages].reverse().find((r) => r.kind === 'user')
        if (lastUser?.kind === 'user') lastUserRef.current = { content: lastUser.content, attachments: lastUser.attachments }
        setTurnUsage(body.usage ?? {})
        setUsageTotals(body.usageTotals ?? null)
        setContextStats(body.contextStats ?? null)
      }
      return {
        messages: body.messages.map((row) => rowToMessage(key, row)),
        queued: (body.queued ?? []).map((q) => toQueuedItem(key, q)),
        meta: body.chat,
        // Chat now pre-lights like every other surface (#706 decision):
        // reopening a chat mid-turn shows the live indicator + the text
        // streamed so far instead of looking idle until the next chunk.
        streaming: body.chat.streaming === true,
        ...(body.streamingText ? { streamingText: body.streamingText } : {}),
      }
    },
    post: async (key, content, attachments) => {
      const res = await pluginFetch('chat', `chats/${key}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, ...(attachments?.length ? { attachments } : {}) }),
      })
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { queued?: boolean; queueId?: string; queueLength?: number }
        return {
          ok: true,
          ...(body.queued && body.queueId ? { queued: { id: body.queueId, queueLength: body.queueLength } } : {}),
        }
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, status: res.status, ...(body.error ? { error: body.error } : {}) }
    },
    // Queue-aware sends (#729): streaming sends enqueue server-side; the
    // queued/started events keep the strip honest across tabs and drains.
    queue: {
      enabled: true,
      queuedEvent: 'chat.queued',
      startedEvent: 'chat.started',
      remove: async (key, id) => {
        const res = await pluginFetch('chat', `chats/${key}/queued/${encodeURIComponent(id)}`, { method: 'DELETE' })
        return res.ok
      },
    },
    // Optimistic user row — WITH its attachments (they lagged to the
    // post-turn refetch otherwise); the durable copy replaces it on the
    // next refetch. The spread keeps `path` so queued rows stay restorable.
    optimisticRow: (content, attachments) => ({
      kind: 'user',
      ts: new Date().toISOString(),
      content,
      ...(attachments?.length
        ? { attachments: attachments.map((a) => ({ ...a, url: attachmentUrl(chatId, a.name) })) }
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
    queued: thread.queued,
    removeQueued: thread.removeQueued,
    turnUsage,
    usageTotals,
    contextStats,
    send,
    abort,
    retry,
    refreshChat: thread.refresh,
  }
}
