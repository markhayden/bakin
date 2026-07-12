/**
 * readConversationSseStream — the kit's per-request SSE reader for embedded
 * conversation surfaces (a plugin route streams one turn as SSE frames).
 *
 * Frame contract:
 *   event: chunk   data: <RuntimeChatChunk JSON>   → onChunk
 *   event: done    data: {"content"?: string}      → resolves
 *   event: error   data: {"message": string}       → throws
 *   anything else                                  → onCustom(name, data)
 *
 * Surfaces whose transport is the shared plugin-event bus (the chat plugin)
 * don't need this — they feed chunks straight into foldConversation.
 */
import type { ChatChunk as RuntimeChatChunk } from '@bakin/core/adapters/runtime'

export interface ConversationSseHandlers {
  signal: AbortSignal
  onChunk: (chunk: RuntimeChatChunk) => void
  onCustom?: (event: string, data: unknown) => void
}

interface SseFrame {
  event: string
  data: unknown
}

const CHUNK_TYPES = new Set(['text', 'tool', 'status', 'done', 'error'])

function isRuntimeChunk(data: unknown): data is RuntimeChatChunk {
  return Boolean(
    data &&
      typeof data === 'object' &&
      typeof (data as { type?: unknown }).type === 'string' &&
      CHUNK_TYPES.has((data as { type: string }).type),
  )
}

export async function readConversationSseStream(
  response: Response,
  handlers: ConversationSseHandlers,
): Promise<{ content: string }> {
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Server returned ${response.status}`)
  }

  const reader = response.body.getReader()
  const abort = () => {
    void reader.cancel().catch(() => {})
  }
  handlers.signal.addEventListener('abort', abort, { once: true })

  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''
  let finalContent = ''

  const dispatch = (frame: SseFrame) => {
    if (frame.event === 'chunk') {
      if (!isRuntimeChunk(frame.data)) return
      if (frame.data.type === 'text') accumulated += frame.data.content
      handlers.onChunk(frame.data)
      return
    }
    if (frame.event === 'done') {
      finalContent = textField(frame.data, 'content') || accumulated
      return
    }
    if (frame.event === 'error') {
      throw new Error(textField(frame.data, 'message') || 'Unknown error')
    }
    handlers.onCustom?.(frame.event, frame.data)
  }

  try {
    while (true) {
      if (handlers.signal.aborted) throw abortError()
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parsed = drainSseFrames(buffer)
      buffer = parsed.remainder
      for (const frame of parsed.frames) dispatch(frame)
    }

    buffer += decoder.decode()
    const parsed = drainSseFrames(buffer, true)
    for (const frame of parsed.frames) dispatch(frame)
  } finally {
    handlers.signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }

  return { content: finalContent || accumulated }
}

function drainSseFrames(input: string, flush = false): { frames: SseFrame[]; remainder: string } {
  const parts = input.split(/\r?\n\r?\n/)
  const remainder = flush ? '' : parts.pop() ?? ''
  const frames = parts.map(parseSseFrame).filter((frame): frame is SseFrame => frame !== null)
  if (flush && parts.length === 0 && input.trim()) {
    const frame = parseSseFrame(input)
    if (frame) frames.push(frame)
  }
  return { frames, remainder }
}

function parseSseFrame(frame: string): SseFrame | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const rawLine of frame.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }
  if (dataLines.length === 0) return null
  const rawData = dataLines.join('\n')
  let data: unknown = rawData
  try {
    data = JSON.parse(rawData)
  } catch {
    // Plain text SSE data is valid; callers can decide what to do with it.
  }
  return { event, data }
}

function textField(data: unknown, key: string): string {
  if (!data || typeof data !== 'object') return ''
  const value = (data as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

function abortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}
