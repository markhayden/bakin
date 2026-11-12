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

interface OptimisticEntry {
  row: ConversationMessage
  failed: boolean
  /** Loads starting at or after this sequence read the row from storage. */
  ackedLoadSeq: number | null
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
  // The settle refetch is owed until a load started at or after the settle
  // finishes (applied, thrown, or null) — a send landing mid-flight rejects
  // that load's snapshot, so the settlement is re-run from a fresh read.
  const settleLoadFloorRef = useRef<number | null>(null)
  // Optimistic user rows not yet seen in a transcript load. A load re-appends
  // them after its rows, so a refetch that read storage before the POST
  // landed never hides the message the composer already let go of. A row is
  // durable — retired — once a load that STARTED after its own
  // acknowledgment applies (the engine appends the user row before it
  // answers); nothing is ever matched by content, so identical text in
  // history or a sibling send can never consume it. A load that raced the
  // POST keeps the row beside its durable twin for one round trip at most
  // (the owed settle load waits for in-flight sends, below, so that race is
  // a consumer refresh, not the normal path). A FAILED send keeps its row
  // until the next successful send or thread switch — the row is the user's
  // only copy of the text.
  const optimisticRowsRef = useRef<OptimisticEntry[]>([])
  const withOptimisticRows = useCallback((durable: ConversationMessage[], loadSeq: number): ConversationMessage[] => {
    const kept = optimisticRowsRef.current.filter((o) => o.failed || o.ackedLoadSeq === null || loadSeq < o.ackedLoadSeq)
    optimisticRowsRef.current = kept
    return kept.length ? [...durable, ...kept.map((o) => o.row)] : durable
  }, [])
  // A successful send retires earlier FAILED rows (their text is back in the
  // composer or abandoned) — from the tracking ref AND the screen.
  const retireFailedRows = useCallback(() => {
    const failed = optimisticRowsRef.current.filter((o) => o.failed)
    if (failed.length === 0) return
    optimisticRowsRef.current = optimisticRowsRef.current.filter((o) => !o.failed)
    setMessages((current) => current.filter((m) => !failed.some((o) => o.row === m)))
  }, [])
  const addOptimisticRow = useCallback((row: ConversationMessage): OptimisticEntry => {
    const entry: OptimisticEntry = { row, failed: false, ackedLoadSeq: null }
    optimisticRowsRef.current = [...optimisticRowsRef.current, entry]
    return entry
  }, [])
  // Sends whose POST has not answered yet. The owed settle load (a settle
  // refetch invalidated by a send) starts only once they have, so it begins
  // AFTER every acknowledgment and the ack rule above retires their rows —
  // a replacement that raced the POST would show the row twice for a turn.
  const inFlightSendsRef = useRef(0)
  const settleOwedRef = useRef(false)

  const loadTranscriptRef = useRef<() => Promise<void>>(async () => {})
  const runOwedSettle = useCallback(() => {
    if (!settleOwedRef.current) return
    settleOwedRef.current = false
    settleLoadFloorRef.current = loadSeqRef.current + 1
    void loadTranscriptRef.current()
  }, [])

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
    const isSettleLoad = () => settleLoadFloorRef.current !== null && loadSeq >= settleLoadFloorRef.current
    const dropRetained = () => {
      if (activeKeyRef.current !== threadKey) return
      if (isSettleLoad()) settleLoadFloorRef.current = null
      if (!settlesRetained()) return
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
    if (sendSeqRef.current !== sendSeqAtStart) {
      // A send (or a queued-send acknowledgment) landed while this load was
      // in flight; its snapshot is stale. If it was the load meant to settle
      // the retained turn, settlement still has to happen — from a fresh
      // read, the newest truth — or the finished turn stays "live" and the
      // reply it carries never shows (review finding, round 2).
      if (isSettleLoad()) {
        // The obligation carries over to the replacement (a send invalidating
        // THAT load spawns another; every send is one more, never a loop) —
        // deferred until the in-flight send has answered.
        settleLoadFloorRef.current = null
        settleOwedRef.current = true
        if (inFlightSendsRef.current === 0) runOwedSettle()
      }
      return
    }
    if (loadSeq < appliedLoadSeqRef.current) return
    appliedLoadSeqRef.current = loadSeq
    setMeta(body.meta ?? null)
    setMessages(withOptimisticRows(body.messages, loadSeq))
    setQueued(body.queued ?? [])
    // Same batch as the rows that replace it: the live turn is swapped for
    // its durable twin in one render, never a frame without it.
    dropRetained()
    if (body.streaming) {
      setStreaming(true)
      const seed = body.streamingText
      setLiveChunks((prev) => prev ?? (seed ? [{ type: 'text', content: seed }] : []))
    }
  }, [threadKey, withOptimisticRows, runOwedSettle])
  loadTranscriptRef.current = loadTranscript

  useEffect(() => {
    // Reset EVERYTHING on a thread switch — the previous thread's
    // transcript must never render under the new key (even transiently, or
    // permanently when the new load fails).
    setMessages([])
    setMeta(null)
    setLiveChunks(null)
    retainedLiveFromLoadSeqRef.current = null
    settleLoadFloorRef.current = null
    settleOwedRef.current = false
    optimisticRowsRef.current = []
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
    settleLoadFloorRef.current = loadSeqRef.current + 1
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

  const addQueuedItem = useCallback((queuedId: string, row: ConversationMessage) => {
    const user = row.kind === 'user' ? row : undefined
    setQueued((current) =>
      current.some((item) => item.id === queuedId)
        ? current
        : [
            ...current,
            {
              id: queuedId,
              ts: new Date().toISOString(),
              content: user?.content ?? '',
              ...(user?.attachments ? { attachments: user.attachments } : {}),
            },
          ],
    )
  }, [])

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
      inFlightSendsRef.current += 1
      try {
        result = await optionsRef.current.post(key, content, attachments)
      } catch (error) {
        result = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }
      } finally {
        inFlightSendsRef.current -= 1
      }
      if (activeKeyRef.current !== key) return
      if (!result.ok) {
        setSendError(result.error ?? `send failed (${result.status ?? 'network'})`)
        if (inFlightSendsRef.current === 0) runOwedSettle()
        return
      }

      const optimistic = optionsRef.current.optimisticRow?.(content, attachments)
      const optimisticUser = optimistic?.kind === 'user' ? optimistic : undefined
      retireFailedRows()
      if (result.queued) {
        sendSeqRef.current += 1
        addQueuedItem(result.queued.id, optimisticUser ?? { kind: 'user', ts: new Date().toISOString(), content })
      } else {
        sendSeqRef.current += 1
        const row = optimisticUser ?? { kind: 'user' as const, ts: new Date().toISOString(), content }
        // Acknowledged already (the POST answered): any load from here on carries it.
        addOptimisticRow(row).ackedLoadSeq = loadSeqRef.current + 1
        setMessages((current) => [...current, row])
        setStreaming(true)
        retainedLiveFromLoadSeqRef.current = null
        setLiveChunks([])
      }
      if (inFlightSendsRef.current === 0) runOwedSettle()
      return
    }
    setSendError(null)
    sendSeqRef.current += 1
    // Optimistic user row — synchronously, before the network call; the
    // durable copy replaces it on the next refetch.
    const row: ConversationMessage = optionsRef.current.optimisticRow
      ? optionsRef.current.optimisticRow(content, attachments)
      : { kind: 'user', ts: new Date().toISOString(), content }
    const entry = addOptimisticRow(row)
    setMessages((prev) => [...prev, row])
    setStreaming(true)
    // This turn owns the live state now: a previous turn's settle refetch
    // landing (or failing) after this point must not clear it.
    retainedLiveFromLoadSeqRef.current = null
    setLiveChunks([])
    let res: Awaited<ReturnType<ConversationThreadOptions<Meta, Attachment>['post']>>
    inFlightSendsRef.current += 1
    try {
      res = await optionsRef.current.post(key, content, attachments)
    } catch (err) {
      // pluginFetch rejects on network failure — same rollback as a
      // non-OK response, never an unhandled rejection or a stuck spinner.
      res = { ok: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      inFlightSendsRef.current -= 1
    }
    if (activeKeyRef.current !== key) return
    if (res.ok && res.queued) {
      // The server was still busy (its turn had not settled on our side yet):
      // the message is in the QUEUE, not the transcript — show it there and
      // take the optimistic row back; the drain's durable row arrives with
      // the started/settle refetch.
      optimisticRowsRef.current = optimisticRowsRef.current.filter((o) => o !== entry)
      setMessages((current) => current.filter((m) => m !== row))
      setStreaming(false)
      setLiveChunks(null)
      retireFailedRows()
      addQueuedItem(res.queued.id, row)
    } else if (res.ok) {
      // Acknowledged: the engine appended the row before answering, so any
      // load that starts from now on reads it — no content matching needed.
      entry.ackedLoadSeq = loadSeqRef.current + 1
      retireFailedRows()
    } else {
      setStreaming(false)
      setLiveChunks(null)
      setSendError(res.error ?? `send failed (${res.status ?? 'network'})`)
      entry.failed = true
    }
    if (inFlightSendsRef.current === 0) runOwedSettle()
  }, [addOptimisticRow, addQueuedItem, retireFailedRows, runOwedSettle])

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
