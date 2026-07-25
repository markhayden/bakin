'use client'

/**
 * useConversationThread — bus-driven client state for conversational
 * surfaces whose turns run server-side on the conversation turn engine
 * (src/core/conversation-turns.ts) and stream as plugin-events over the
 * shell's single SSE connection.
 *
 * This is the generalization of chat's client core (#703): the optimistic
 * user row appears synchronously on send, chunks accumulate from the bus
 * regardless of which page is mounted (navigation never loses a turn —
 * remount refetches the durable transcript, which the engine persists
 * incrementally), and done/error settle by refetching. Consumer-specific
 * concerns — seen tracking, retry, attachment URL mapping — stay in
 * consumer wrappers.
 *
 * Semantics mirror chat's use-chat-data.ts (chat wraps this hook): a
 * failed POST rolls back the streaming state and surfaces sendError but
 * leaves the optimistic row until the next refetch; consecutive
 * same-format text deltas coalesce; payloads for other threads are
 * ignored via an active-key ref that re-checks after every await.
 * Deliberate divergences from the pre-#703 chat hook (all bug fixes, not
 * drift): rollback/sendError are suppressed after a thread switch; a send
 * while a turn streams is refused instead of wiping the live turn; loads
 * that started before the newest send never clobber the optimistic row;
 * and load/post throws are contained (no unhandled rejections).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatChunk as RuntimeChatChunk } from '@bakin/core/adapters/runtime'

import { usePluginEvent } from '@/hooks/use-plugin-event'
import type { ConversationMessage } from './fold'
import type { ConversationQueuedItem } from './queued-message-list'

export interface ConversationThreadLoad<Meta> {
  messages: ConversationMessage[]
  /** Server-side pending queue (queue-enabled surfaces only). */
  queued?: ConversationQueuedItem[]
  /**
   * Server-seeded in-flight flag: true seeds the streaming indicator on
   * mount so a turn started before this mount shows as live immediately.
   */
  streaming?: boolean
  /**
   * Assistant text the in-flight turn streamed BEFORE this mount (the
   * engine's inflightPreview) — seeds liveChunks so mid-turn rehydration
   * doesn't show a reply missing its beginning.
   */
  streamingText?: string
  /** Consumer payload fetched alongside the transcript (e.g. chat summary). */
  meta?: Meta
}

export interface ConversationThreadOptions<Meta = unknown, Attachment = unknown> {
  /** Active thread key; empty string disables loading and sending. */
  threadKey: string
  /** The consumer's bus event names (e.g. chat.chunk/chat.done/chat.error). */
  events: { chunk: string; done: string; error: string }
  /** Extract the thread key from a bus payload (e.g. p => p.chatId). */
  keyOf: (payload: Record<string, unknown>) => unknown
  /** Fetch the durable transcript (+ in-flight flag + consumer meta). Null = gone. */
  load: (key: string) => Promise<ConversationThreadLoad<Meta> | null>
  /** POST the user's message; the turn itself arrives over the bus.
   *  Queue-enabled surfaces report a queued acceptance via `queued`. */
  post: (
    key: string,
    content: string,
    attachments?: Attachment[],
  ) => Promise<{ ok: boolean; status?: number; error?: string; queued?: { id: string; queueLength?: number } }>
  /** Build the optimistic user row (chat maps attachment paths to URLs here). */
  optimisticRow?: (content: string, attachments?: Attachment[]) => ConversationMessage
  /** A turn for the ACTIVE thread settled (after the refetch was triggered). */
  onSettled?: (payload: Record<string, unknown>) => void
  /**
   * Opt into queue-aware sends (#732): while a turn streams, send() POSTs
   * instead of refusing — the server queues it (202) and the hook records
   * an optimistic queued row from the response. Default (absent) keeps the
   * strict refusal.
   */
  queue?: {
    enabled: boolean
    /** Bus events that change queue state server-side → refetch on them. */
    queuedEvent?: string
    startedEvent?: string
    /** Consumer DELETE for one queued item; true = removed. */
    remove?: (key: string, id: string) => Promise<boolean>
  }
}

export interface ConversationThread<Meta = unknown, Attachment = unknown> {
  /** Durable transcript rows (+ any optimistic user rows awaiting refetch). */
  messages: ConversationMessage[]
  /** Consumer meta from the last load (e.g. chat summary), null before it. */
  meta: Meta | null
  /** The in-flight turn's chunks; null when idle. */
  liveChunks: RuntimeChatChunk[] | null
  streaming: boolean
  sendError: string | null
  /** Pending queued follow-ups (always [] on strict surfaces). */
  queued: ConversationQueuedItem[]
  /**
   * Remove a queued item (server + local). Returns the removed item so the
   * surface can restore its text into an empty composer; null when absent
   * or the server refused.
   */
  removeQueued: (id: string) => Promise<ConversationQueuedItem | null>
  send: (content: string, attachments?: Attachment[]) => Promise<void>
  refresh: () => Promise<void>
}

export function useConversationThread<Meta = unknown, Attachment = unknown>(
  options: ConversationThreadOptions<Meta, Attachment>,
): ConversationThread<Meta, Attachment> {
  const { threadKey, events } = options
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [liveChunks, setLiveChunks] = useState<RuntimeChatChunk[] | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [queued, setQueued] = useState<ConversationQueuedItem[]>([])
  const queuedRef = useRef(queued)
  queuedRef.current = queued
  // Guard against bus events for other threads / stale fetches after switching.
  const activeKeyRef = useRef(threadKey)
  activeKeyRef.current = threadKey
  const optionsRef = useRef(options)
  optionsRef.current = options

  // Monotonic send counter: a load snapshot taken BEFORE the newest send
  // must never clobber the optimistic user row appended by that send.
  const sendSeqRef = useRef(0)

  const loadTranscript = useCallback(async () => {
    if (!threadKey) {
      setMeta(null)
      setMessages([])
      return
    }
    const sendSeqAtStart = sendSeqRef.current
    let body: ConversationThreadLoad<Meta> | null = null
    try {
      body = await optionsRef.current.load(threadKey)
    } catch {
      // A throwing load (network blip, server restart) keeps the current
      // view; the next settle/switch retries. Never an unhandled rejection.
      return
    }
    // Re-check AFTER the load resolves too — a slow response for the
    // previous thread could land post-switch and render the wrong transcript.
    if (activeKeyRef.current !== threadKey) return
    if (!body) return
    if (sendSeqRef.current !== sendSeqAtStart) return
    setMeta(body.meta ?? null)
    setMessages(body.messages)
    setQueued(body.queued ?? [])
    if (body.streaming) {
      setStreaming(true)
      const seed = body.streamingText
      setLiveChunks((prev) => prev ?? (seed ? [{ type: 'text', content: seed }] : []))
    }
  }, [threadKey])

  useEffect(() => {
    // Reset EVERYTHING on a thread switch — the previous thread's
    // transcript must never render under the new key (even transiently, or
    // permanently when the new load fails).
    setMessages([])
    setMeta(null)
    setLiveChunks(null)
    setStreaming(false)
    setSendError(null)
    setQueued([])
    void loadTranscript()
  }, [loadTranscript])

  // Queue state changes server-side on enqueue (another tab) and on drain
  // (the drained turn's started event) — refetch so the strip stays true.
  const refetchQueueState = (payload: Record<string, unknown>) => {
    if (!optionsRef.current.queue?.enabled) return
    if (optionsRef.current.keyOf(payload) !== activeKeyRef.current) return
    void loadTranscript()
  }
  usePluginEvent(options.queue?.queuedEvent ?? '__conv_thread_no_queued__', refetchQueueState)
  usePluginEvent(options.queue?.startedEvent ?? '__conv_thread_no_started__', refetchQueueState)

  usePluginEvent(events.chunk, (payload) => {
    if (optionsRef.current.keyOf(payload) !== activeKeyRef.current) return
    const chunk = payload.chunk as RuntimeChatChunk | undefined
    if (!chunk?.type) return
    setStreaming(true)
    setLiveChunks((prev) => {
      const chunks = prev ?? []
      // Coalesce consecutive same-format text deltas so a long turn stays a
      // handful of chunks instead of hundreds; folding/rendering policy
      // itself lives in foldConversation.
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

  const settle = useCallback((payload: Record<string, unknown>) => {
    setStreaming(false)
    setLiveChunks(null)
    // The settle refetch IS the newest truth — bump the seq so it applies
    // even if an older send's guard would otherwise block a stale load.
    sendSeqRef.current += 1
    void loadTranscript()
    optionsRef.current.onSettled?.(payload)
  }, [loadTranscript])

  usePluginEvent(events.done, (payload) => {
    if (optionsRef.current.keyOf(payload) === activeKeyRef.current) settle(payload)
  })
  usePluginEvent(events.error, (payload) => {
    if (optionsRef.current.keyOf(payload) === activeKeyRef.current) settle(payload)
  })

  const streamingRef = useRef(streaming)
  streamingRef.current = streaming

  const send = useCallback(async (content: string, attachments?: Attachment[]) => {
    const key = activeKeyRef.current
    if (!key) return
    // One turn per thread: on strict surfaces a send while streaming would
    // wipe the live chunks locally and 409 server-side — refuse honestly.
    if (streamingRef.current && !optionsRef.current.queue?.enabled) {
      setSendError('A reply is already in progress')
      return
    }
    if (streamingRef.current) {
      // Queue path (#732): nothing optimistic until the server answers —
      // the 202 carries the queueId the optimistic row needs.
      setSendError(null)
      let res: Awaited<ReturnType<ConversationThreadOptions<Meta, Attachment>['post']>>
      try {
        res = await optionsRef.current.post(key, content, attachments)
      } catch (err) {
        res = { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      if (activeKeyRef.current !== key) return
      if (!res.ok) {
        setSendError(res.error ?? `send failed (${res.status ?? 'network'})`)
        return
      }
      const base = optionsRef.current.optimisticRow?.(content, attachments)
      const baseUser = base?.kind === 'user' ? base : undefined
      if (res.queued) {
        setQueued((prev) => [
          ...prev,
          {
            id: res.queued!.id,
            ts: new Date().toISOString(),
            content: baseUser?.content ?? content,
            ...(baseUser?.attachments ? { attachments: baseUser.attachments } : {}),
          },
        ])
      } else {
        // The turn settled before the POST landed — the server accepted a
        // normal turn. Adopt the normal optimistic shape.
        sendSeqRef.current += 1
        setMessages((prev) => [...prev, baseUser ?? { kind: 'user', ts: new Date().toISOString(), content }])
        setStreaming(true)
        setLiveChunks([])
      }
      return
    }
    setSendError(null)
    sendSeqRef.current += 1
    // Optimistic user row — synchronously, before the network call; the
    // durable copy replaces it on the next refetch.
    const row: ConversationMessage = optionsRef.current.optimisticRow
      ? optionsRef.current.optimisticRow(content, attachments)
      : { kind: 'user', ts: new Date().toISOString(), content }
    setMessages((prev) => [...prev, row])
    setStreaming(true)
    setLiveChunks([])
    let res: { ok: boolean; status?: number; error?: string }
    try {
      res = await optionsRef.current.post(key, content, attachments)
    } catch (err) {
      // pluginFetch rejects on network failure — same rollback as a
      // non-OK response, never an unhandled rejection or a stuck spinner.
      res = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    if (!res.ok && activeKeyRef.current === key) {
      setStreaming(false)
      setLiveChunks(null)
      setSendError(res.error ?? `send failed (${res.status ?? 'network'})`)
    }
  }, [])

  const removeQueued = useCallback(async (id: string): Promise<ConversationQueuedItem | null> => {
    const key = activeKeyRef.current
    const item = queuedRef.current.find((i) => i.id === id)
    if (!item) return null
    const remove = optionsRef.current.queue?.remove
    if (remove) {
      let ok = false
      try {
        ok = await remove(key, id)
      } catch {
        ok = false
      }
      if (!ok) return null
    }
    if (activeKeyRef.current === key) setQueued((prev) => prev.filter((i) => i.id !== id))
    return item
  }, [])

  return { messages, meta, liveChunks, streaming, sendError, queued, removeQueued, send, refresh: loadTranscript }
}
