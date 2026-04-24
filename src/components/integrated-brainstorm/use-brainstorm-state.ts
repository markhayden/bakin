'use client'

import { useCallback, useRef, useState } from 'react'
import { THINKING_VERBS } from './thinking-indicator'
import type { BrainstormMessage, BrainstormOnSend } from './types'

export type BrainstormStatus = 'idle' | 'sending' | 'streaming'

function pickVerb(): string {
  return THINKING_VERBS[Math.floor(Math.random() * THINKING_VERBS.length)]
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

interface UseBrainstormStateOpts {
  messages: BrainstormMessage[]
  onMessagesChange: (next: BrainstormMessage[]) => void
  onSend: BrainstormOnSend
  defaultAgentId: string
}

export interface BrainstormController {
  status: BrainstormStatus
  streamingContent: string
  thinkingVerb: string
  errorMessage: string | null
  wasAborted: boolean
  send: (
    prompt: string,
    options?: { onCustom?: (name: string, data: unknown) => void },
  ) => Promise<void>
  abort: () => void
}

export function useBrainstormState({
  messages,
  onMessagesChange,
  onSend,
  defaultAgentId,
}: UseBrainstormStateOpts): BrainstormController {
  const [status, setStatus] = useState<BrainstormStatus>('idle')
  const [streamingContent, setStreamingContent] = useState('')
  const [thinkingVerb, setThinkingVerb] = useState<string>(() => pickVerb())
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [wasAborted, setWasAborted] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // Ref-based guard so two rapid submit attempts in the same frame can't
  // both see `status === 'idle'` before the setStatus('sending') flushes.
  const sendingRef = useRef(false)

  const send = useCallback(
    async (
      prompt: string,
      options?: { onCustom?: (name: string, data: unknown) => void },
    ) => {
      if (sendingRef.current) return
      const trimmed = prompt.trim()
      if (!trimmed) return
      sendingRef.current = true

      const userMsg: BrainstormMessage = {
        id: newId('u'),
        role: 'user',
        content: trimmed,
        timestamp: new Date().toISOString(),
      }
      const historyWithUser = [...messages, userMsg]
      onMessagesChange(historyWithUser)

      setErrorMessage(null)
      setWasAborted(false)
      setStreamingContent('')
      setThinkingVerb(pickVerb())
      setStatus('sending')

      const controller = new AbortController()
      abortRef.current = controller

      let accumulated = ''
      try {
        const result = await onSend(trimmed, messages, {
          signal: controller.signal,
          onToken: (text: string) => {
            accumulated += text
            setStreamingContent(accumulated)
            setStatus('streaming')
          },
          onCustom: options?.onCustom,
        })
        const resolvedContent = result?.content?.trim() ?? ''
        const finalContent = resolvedContent.length > 0 ? resolvedContent : accumulated.trim()
        if (finalContent) {
          const assistantMsg: BrainstormMessage = {
            id: newId('a'),
            role: 'assistant',
            content: finalContent,
            agentId: defaultAgentId,
            timestamp: new Date().toISOString(),
          }
          onMessagesChange([...historyWithUser, assistantMsg])
        }
      } catch (err) {
        if (controller.signal.aborted) {
          setWasAborted(true)
          const partial = accumulated.trim()
          if (partial) {
            const assistantMsg: BrainstormMessage = {
              id: newId('a'),
              role: 'assistant',
              content: partial,
              agentId: defaultAgentId,
              timestamp: new Date().toISOString(),
            }
            onMessagesChange([...historyWithUser, assistantMsg])
          }
        } else {
          setErrorMessage(err instanceof Error ? err.message : String(err))
        }
      } finally {
        setStatus('idle')
        setStreamingContent('')
        abortRef.current = null
        sendingRef.current = false
      }
    },
    [messages, onMessagesChange, onSend, defaultAgentId],
  )

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { status, streamingContent, thinkingVerb, errorMessage, wasAborted, send, abort }
}
