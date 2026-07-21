'use client'

import { useCallback, useRef, useState } from 'react'
import type { ConversationChunk } from '@bakin/ui/conversation'

import { readConversationSseStream } from './sse'

/** Consumer-owned request and lifecycle callbacks for streamed turns. */
export interface ConversationStreamOptions {
  fetcher: (content: string, context: { signal: AbortSignal }) => Promise<Response>
  onCustom?: (event: string, data: unknown) => void
  onDone?: (finalContent: string) => void | Promise<void>
  onError?: (message: string) => void
  onAborted?: () => void
}

/** State and actions for one-at-a-time response-scoped conversation turns. */
export interface ConversationStream {
  liveChunks: ConversationChunk[] | null
  streaming: boolean
  send: (content: string) => Promise<void>
  abort: () => void
}

/**
 * Accumulate one response-scoped SSE turn for `ConversationPanel`. Transport,
 * persisted messages, retry policy, and custom-event mutations stay external.
 */
export function useConversationStream(options: ConversationStreamOptions): ConversationStream {
  const [liveChunks, setLiveChunks] = useState<ConversationChunk[] | null>(null)
  const [streaming, setStreaming] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const abort = useCallback(() => {
    controllerRef.current?.abort()
  }, [])

  const send = useCallback(async (content: string) => {
    if (controllerRef.current) return
    const controller = new AbortController()
    controllerRef.current = controller
    setStreaming(true)
    setLiveChunks([])
    const chunks: ConversationChunk[] = []

    try {
      const response = await optionsRef.current.fetcher(content, { signal: controller.signal })
      const result = await readConversationSseStream(response, {
        signal: controller.signal,
        onChunk: (chunk) => {
          chunks.push(chunk)
          setLiveChunks([...chunks])
        },
        onCustom: (event, data) => optionsRef.current.onCustom?.(event, data),
      })
      setLiveChunks(null)
      await optionsRef.current.onDone?.(result.content)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setLiveChunks(null)
        optionsRef.current.onAborted?.()
      } else {
        const message = error instanceof Error ? error.message : String(error)
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
