import type { ConversationChunk } from '@bakin/ui/conversation'

/** Callbacks for one response-scoped conversation SSE stream. */
export interface ConversationSseHandlers {
  signal: AbortSignal
  onChunk: (chunk: ConversationChunk) => void
  onCustom?: (event: string, data: unknown) => void
}

interface SseFrame {
  event: string
  data: unknown
}

function isConversationChunk(data: unknown): data is ConversationChunk {
  if (!isRecord(data) || typeof data.type !== 'string') return false

  if (data.type === 'text') {
    return typeof data.content === 'string'
      && (data.format === undefined || data.format === 'markdown' || data.format === 'plain' || data.format === 'code')
      && optionalRecord(data.data)
  }

  if (data.type === 'tool') {
    return isRecord(data.data)
      && (data.data.phase === 'call' || data.data.phase === 'result')
      && typeof data.data.toolName === 'string'
      && optionalString(data.content)
      && optionalString(data.data.callId)
      && optionalString(data.data.status)
      && optionalString(data.data.summary)
      && optionalString(data.data.inputPreview)
      && optionalString(data.data.outputPreview)
      && optionalNumber(data.data.durationMs)
      && optionalNumber(data.data.exitCode)
      && optionalRecord(data.data.metadata)
  }

  if (data.type === 'status' || data.type === 'done' || data.type === 'error') {
    return optionalString(data.content) && optionalRecord(data.data)
  }

  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function optionalRecord(value: unknown): boolean {
  return value === undefined || isRecord(value)
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value))
}

/**
 * Read one plugin-route SSE response. Chunk events are normalized for the
 * conversation folder; unknown events remain available to the consumer.
 */
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
      if (!isConversationChunk(frame.data)) return
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
      // reader.cancel() settles a pending read as `done`; preserve abort as
      // a distinct terminal state instead of reporting a clean completion.
      if (handlers.signal.aborted) throw abortError()
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
    // Plain-text SSE data is valid and remains available to custom handlers.
  }
  return { event, data }
}

function textField(data: unknown, key: string): string {
  if (!data || typeof data !== 'object') return ''
  const value = (data as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

function abortError(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}
