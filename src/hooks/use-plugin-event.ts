'use client'

import { useEffect, useRef } from 'react'

/**
 * Subscribe to server-pushed plugin events over the shell's SINGLE EventSource.
 *
 * The shell owns one `/api/events` connection (`use-sse.ts`) with reconnect +
 * backoff. Plugins used to each open their own `new EventSource('/api/events')`
 * — N connections, no reconnect. Instead the shell fans every
 * `{ type: 'plugin-event', event, … }` payload into this process-global emitter,
 * and components subscribe by event name here. The handler receives the full
 * payload so it can filter on `assetId`/`taskId`/etc.
 */
export type PluginEventPayload = Record<string, unknown> & { event?: string }
type Handler = (payload: PluginEventPayload) => void

const subscribers: Map<string, Set<Handler>> =
  ((globalThis as Record<string, unknown>).__bakinPluginEventSubs as Map<string, Set<Handler>>)
  ?? ((globalThis as Record<string, unknown>).__bakinPluginEventSubs = new Map())

/** Called by the shell SSE handler for every `plugin-event` payload. */
export function emitPluginEvent(payload: PluginEventPayload): void {
  const event = payload?.event
  if (typeof event !== 'string') return
  const set = subscribers.get(event)
  if (!set) return
  for (const handler of [...set]) {
    try {
      handler(payload)
    } catch {
      // a bad subscriber must not break the others or the connection
    }
  }
}

/** Run `handler` whenever the server pushes a plugin event named `event`. */
export function usePluginEvent(event: string, handler: Handler): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    const wrapped: Handler = (payload) => handlerRef.current(payload)
    let set = subscribers.get(event)
    if (!set) {
      set = new Set()
      subscribers.set(event, set)
    }
    set.add(wrapped)
    return () => {
      set.delete(wrapped)
      if (set.size === 0) subscribers.delete(event)
    }
  }, [event])
}
