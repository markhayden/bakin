import type { SendContext } from './types'

interface BrainstormSseReadOptions {
  onCustomEvent?: (event: string, data: unknown) => boolean | void
}

interface SseFrame {
  event: string
  data: unknown
}

export async function readBrainstormSseResponse(
  response: Response,
  ctx: SendContext,
  options: BrainstormSseReadOptions = {},
): Promise<{ content: string }> {
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Server returned ${response.status}`)
  }

  const reader = response.body.getReader()
  const abort = () => {
    void reader.cancel().catch(() => {})
  }
  ctx.signal.addEventListener('abort', abort, { once: true })

  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''
  let finalContent = ''

  const dispatch = (frame: SseFrame) => {
    if (frame.event === 'token') {
      const text = textField(frame.data, 'text')
      accumulated += text
      ctx.onToken(text)
      return
    }
    if (frame.event === 'activity') {
      ctx.onCustom?.('activity', frame.data)
      return
    }
    if (frame.event === 'done') {
      finalContent = textField(frame.data, 'content') || accumulated
      return
    }
    if (frame.event === 'error') {
      throw new Error(textField(frame.data, 'message') || 'Unknown error')
    }
    if (options.onCustomEvent?.(frame.event, frame.data) === true) return
    ctx.onCustom?.(frame.event, frame.data)
  }

  try {
    while (true) {
      if (ctx.signal.aborted) throw abortError()
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
    ctx.signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }

  return { content: finalContent || accumulated }
}

function drainSseFrames(input: string, flush = false): { frames: SseFrame[]; remainder: string } {
  const parts = input.split(/\r?\n\r?\n/)
  const remainder = flush ? '' : parts.pop() ?? ''
  const frames = parts
    .map(parseSseFrame)
    .filter((frame): frame is SseFrame => frame !== null)
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
