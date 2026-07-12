'use client'

/**
 * useConversationStream — client state machine for embedded conversation
 * surfaces whose turns stream over a per-request SSE Response (plugin
 * routes). Accumulates live chunks for foldConversation, exposes
 * send/abort, and settles through onDone/onError/onAborted.
 *
 * The chat plugin doesn't use this — its chunks arrive over the shared
 * plugin-event bus.
 */
import { useCallback, useRef, useState } from 'react'
import type { ChatChunk as RuntimeChatChunk } from '@bakin/core/adapters/runtime'

import { readConversationSseStream } from './sse'

export interface ConversationStreamOptions {
  /** POST the user's message; returns the SSE Response for the turn. */
  fetcher: (content: string, ctx: { signal: AbortSignal }) => Promise<Response>
  /** Non-chunk SSE events (e.g. messaging's `proposal`). */
  onCustom?: (event: string, data: unknown) => void
  /** Turn finished cleanly; caller refreshes its persisted messages. */
  onDone?: (finalContent: string) => void | Promise<void>
  onError?: (message: string) => void
  onAborted?: () => void
}

export interface ConversationStream {
  /** Non-null while a turn is in flight (or settled with a trailing error). */
  liveChunks: RuntimeChatChunk[] | null
  streaming: boolean
  send: (content: string) => Promise<void>
  abort: () => void
}

export function useConversationStream(options: ConversationStreamOptions): ConversationStream {
  const [liveChunks, setLiveChunks] = useState<RuntimeChatChunk[] | null>(null)
  const [streaming, setStreaming] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const abort = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  const send = useCallback(async (content: string) => {
    if (controllerRef.current) return // one turn at a time
    const controller = new AbortController()
    controllerRef.current = controller
    setStreaming(true)
    setLiveChunks([])
    const chunks: RuntimeChatChunk[] = []
    try {
      const response = await optionsRef.current.fetcher(content, { signal: controller.signal })
      const { content: finalContent } = await readConversationSseStream(response, {
        signal: controller.signal,
        onChunk: (chunk) => {
          chunks.push(chunk)
          setLiveChunks([...chunks])
        },
        onCustom: (event, data) => optionsRef.current.onCustom?.(event, data),
      })
      setLiveChunks(null)
      await optionsRef.current.onDone?.(finalContent)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setLiveChunks(null)
        optionsRef.current.onAborted?.()
      } else {
        const message = err instanceof Error ? err.message : String(err)
        // Keep the turn visible with a trailing error item until the next send.
        setLiveChunks([...chunks, { type: 'error', content: message }])
        optionsRef.current.onError?.(message)
      }
    } finally {
      controllerRef.current = null
      setStreaming(false)
    }
  }, [])

  return { liveChunks, streaming, send, abort }
}
