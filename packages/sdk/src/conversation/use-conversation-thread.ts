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
import type {
  ConversationMessage,
  ConversationQueuedItem,
} from '@bakin/ui/conversation'
import { usePluginEvent } from '../hooks/use-plugin-event'
import type { RuntimeChatChunk } from '../types/runtime'

export interface ConversationThreadLoad<Meta> {
  messages: ConversationMessage[]
  /** Server-side pending follow-ups for queue-enabled surfaces. */
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
  /**
   * The consumer's bus event names (e.g. chat.chunk/chat.done/chat.error).
   * `appended` announces rows written OUTSIDE a turn (e.g. an agent's
   * scheduled check-in): the idle thread refetches; a streaming thread
   * waits for its settle refetch, which already includes them.
   */
  events: { chunk: string; done: string; error: string; appended?: string }
  /** Extract the thread key from a bus payload (e.g. p => p.chatId). */
  keyOf: (payload: Record<string, unknown>) => unknown
  /** Fetch the durable transcript (+ in-flight flag + consumer meta). Null = gone. */
  load: (key: string) => Promise<ConversationThreadLoad<Meta> | null>
  /** POST the user's message; queue-enabled surfaces report an acceptance. */
  post: (
    key: string,
    content: string,
    attachments?: Attachment[],
  ) => Promise<{
    ok: boolean
    status?: number
    error?: string
    queued?: { id: string; queueLength?: number }
  }>
  /** Build the optimistic user row (chat maps attachment paths to URLs here). */
  optimisticRow?: (content: string, attachments?: Attachment[]) => ConversationMessage
  /** A turn for the ACTIVE thread settled (after the refetch was triggered). */
  onSettled?: (payload: Record<string, unknown>) => void
  /** Opt into server-backed follow-up queueing while a turn is active. */
  queue?: {
    enabled: boolean
    queuedEvent?: string
    startedEvent?: string
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
  /** Pending follow-ups; strict surfaces always expose an empty array. */
  queued: ConversationQueuedItem[]
  /** Remove and return one queued item so a consumer can restore its draft. */
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
  const streamingRef = useRef(streaming)
  streamingRef.current = streaming
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
  // Overlapping loads (mount + appended + queue refetches) resolve in any
  // order: a response applies only if it STARTED after the one on screen, so
  // an older snapshot never erases rows a newer one already showed — and a
  // failed newer load never blocks an older success.
  const loadSeqRef = useRef(0)
  const appliedLoadSeqRef = useRef(0)
  // A settled turn keeps its live chunks on screen until the refetch that
  // carries its durable rows applies — clearing them first left one network
  // round trip where the whole turn (and its question card) vanished, then
  // remounted (2026-11-11 "the questions flash off and on"). The ref holds
  // the load sequence from which a load may drop the retained chunks (a load
  // that STARTED before the settle would swap stale rows in for them), and
  // null once nothing is retained: the next turn (a send, or a queued turn's
  // first chunk) starts from an empty live turn and is never cleared by the
  // previous turn's refetch settling after it.
  const retainedLiveFromLoadSeqRef = useRef<number | null>(null)

  const loadTranscript = useCallback(async () => {
    if (!threadKey) {
      setMeta(null)
      setMessages([])
      setQueued([])
      return
    }
    const sendSeqAtStart = sendSeqRef.current
    const loadSeq = ++loadSeqRef.current
    // This load carries the settled turn's durable rows (or was meant to):
    // the retained live turn goes with its outcome, whatever that is.
    const settlesRetained = () =>
      retainedLiveFromLoadSeqRef.current !== null && loadSeq >= retainedLiveFromLoadSeqRef.current
    const dropRetained = () => {
      if (!settlesRetained() || activeKeyRef.current !== threadKey) return
      retainedLiveFromLoadSeqRef.current = null
      setLiveChunks(null)
    }
    let body: ConversationThreadLoad<Meta> | null = null
    try {
      body = await optionsRef.current.load(threadKey)
    } catch {
      // A throwing load (network blip, server restart) keeps the current
      // view; the next settle/switch retries. Never an unhandled rejection.
      // A settled turn still stops looking live — stale text beats a turn
      // that streams forever (its question card would stay disabled).
      dropRetained()
      return
    }
    // Re-check AFTER the load resolves too — a slow response for the
    // previous thread could land post-switch and render the wrong transcript.
    if (activeKeyRef.current !== threadKey) return
    if (!body) {
      // Gone, or a non-OK transcript response the consumer maps to null:
      // same settlement as a throw, never a retained turn that looks live.
      dropRetained()
      return
    }
    if (sendSeqRef.current !== sendSeqAtStart) return
    if (loadSeq < appliedLoadSeqRef.current) return
    appliedLoadSeqRef.current = loadSeq
    setMeta(body.meta ?? null)
    setMessages(body.messages)
    setQueued(body.queued ?? [])
    // Same batch as the rows that replace it: the live turn is swapped for
    // its durable twin in one render, never a frame without it.
    dropRetained()
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
    retainedLiveFromLoadSeqRef.current = null
    setStreaming(false)
    setSendError(null)
    setQueued([])
    void loadTranscript()
  }, [loadTranscript])

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
    // A chunk after a settle belongs to the NEXT turn (a queued follow-up the
    // server started): it starts its own live turn instead of growing the
    // retained one, and the settled turn's refetch no longer owns the clear.
    const fresh = retainedLiveFromLoadSeqRef.current !== null
    retainedLiveFromLoadSeqRef.current = null
    setLiveChunks((prev) => {
      const chunks = fresh ? [] : (prev ?? [])
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
    // Synchronously too: out-of-turn rows flush AFTER the done event, and an
    // `appended` that lands before React re-renders must still refetch (the
    // settle load may have read storage before the flush).
    streamingRef.current = false
    // The live chunks stay until the settle refetch (the next load, or any
    // later one) applies — loadTranscript clears them in the same batch as
    // the rows.
    retainedLiveFromLoadSeqRef.current = loadSeqRef.current + 1
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

  usePluginEvent(events.appended ?? '__conv_thread_no_appended__', (payload) => {
    if (optionsRef.current.keyOf(payload) !== activeKeyRef.current) return
    // Mid-stream, the persisted partial rows would render twice beside the
    // live chunks; the engine never flushes out-of-turn rows during a turn,
    // so an `appended` after settle always gets its own refetch.
    if (streamingRef.current) return
    void loadTranscript()
  })

  const send = useCallback(async (content: string, attachments?: Attachment[]) => {
    const key = activeKeyRef.current
    if (!key) return
    if (streamingRef.current && !optionsRef.current.queue?.enabled) {
      setSendError('A reply is already in progress')
      return
    }
    if (streamingRef.current) {
      setSendError(null)
      let result: Awaited<ReturnType<ConversationThreadOptions<Meta, Attachment>['post']>>
      try {
        result = await optionsRef.current.post(key, content, attachments)
      } catch (error) {
        result = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
      if (activeKeyRef.current !== key) return
      if (!result.ok) {
        setSendError(result.error ?? `send failed (${result.status ?? 'network'})`)
        return
      }

      const optimistic = optionsRef.current.optimisticRow?.(content, attachments)
      const optimisticUser = optimistic?.kind === 'user' ? optimistic : undefined
      if (result.queued) {
        sendSeqRef.current += 1
        const queuedId = result.queued.id
        setQueued((current) =>
          current.some((item) => item.id === queuedId)
            ? current
            : [
                ...current,
                {
                  id: queuedId,
                  ts: new Date().toISOString(),
                  content: optimisticUser?.content ?? content,
                  ...(optimisticUser?.attachments
                    ? { attachments: optimisticUser.attachments }
                    : {}),
                },
              ],
        )
      } else {
        sendSeqRef.current += 1
        setMessages((current) => [
          ...current,
          optimisticUser ?? {
            kind: 'user',
            ts: new Date().toISOString(),
            content,
          },
        ])
        setStreaming(true)
        retainedLiveFromLoadSeqRef.current = null
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
    // This turn owns the live state now: a previous turn's settle refetch
    // landing (or failing) after this point must not clear it.
    retainedLiveFromLoadSeqRef.current = null
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

  const removeQueued = useCallback(async (
    id: string,
  ): Promise<ConversationQueuedItem | null> => {
    const key = activeKeyRef.current
    const item = queuedRef.current.find((candidate) => candidate.id === id)
    if (!item) return null

    const remove = optionsRef.current.queue?.remove
    if (remove) {
      let removed = false
      try {
        removed = await remove(key, id)
      } catch {
        removed = false
      }
      if (!removed) return null
    }

    if (activeKeyRef.current === key) {
      setQueued((current) => current.filter((candidate) => candidate.id !== id))
    }
    return item
  }, [])

  return {
    messages,
    meta,
    liveChunks,
    streaming,
    sendError,
    queued,
    removeQueued,
    send,
    refresh: loadTranscript,
  }
}

export type { ConversationQueuedItem } from '@bakin/ui/conversation'
