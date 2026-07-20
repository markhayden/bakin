/**
 * Deterministic OpenAI-compatible streaming provider for Pi integration
 * tests. Zero tokens, zero network beyond 127.0.0.1 — the Pi analog of
 * Imitation Crab, ~100 lines instead of a rig.
 *
 * Each incoming /chat/completions request consumes the next script in the
 * queue (FIFO). A script is either an HTTP error or a list of streamed
 * steps (text deltas and/or one tool call), closed with usage + [DONE].
 */

// The repo's hand-rolled Bun namespace (bun-env.d.ts) doesn't declare
// fetch/serve — cast per the antfly-conformance precedent.
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
const bunServe = (Bun as unknown as {
  serve: (opts: {
    port: number
    hostname: string
    fetch: (req: Request) => Promise<Response>
  }) => { port: number; stop: (force?: boolean) => void }
}).serve

// The happy-dom preload replaces global Response/ReadableStream with DOM
// emulations Bun.serve rejects. Recover Bun's NATIVE Response class from a
// data: fetch; stream bodies via async generators (native-supported).
const NativeResponse = (await nativeFetch('data:text/plain,x')).constructor as typeof Response

function nativeJson(body: unknown, status = 200): Response {
  return new NativeResponse(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export interface FakeToolCall {
  name: string
  args: Record<string, unknown>
  id?: string
}

export interface FakeTurnScript {
  /** Streamed assistant steps, in order. */
  steps?: Array<{ text?: string; toolCall?: FakeToolCall; delayMs?: number }>
  usage?: { prompt: number; completion: number }
  /** Return this HTTP status + body instead of streaming. */
  status?: number
  errorBody?: Record<string, unknown>
  /**
   * Phase matcher for CONCURRENT turns, where FIFO consumption is racy: an
   * 'initial' script only serves requests whose messages carry no tool
   * result yet; 'after-tool' only serves follow-ups that do. Unset keeps
   * plain FIFO. Lets two concurrent tool turns each deterministically get
   * [toolCall, then reply] regardless of request interleaving.
   */
  when?: 'initial' | 'after-tool'
}

export interface FakeProvider {
  url: string
  requests: Array<Record<string, unknown>>
  stop: () => void
}

function sseChunk(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 1700000000,
    model: 'fake-model',
    ...payload,
  })}\n\n`
}

export function startFakeProvider(scripts: FakeTurnScript[]): FakeProvider {
  const queue = [...scripts]
  const requests: Array<Record<string, unknown>> = []

  const server = bunServe({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req: Request) {
      const url = new URL(req.url)
      if (!url.pathname.endsWith('/chat/completions')) {
        return new NativeResponse('not found', { status: 404 })
      }
      const body = (await req.json()) as Record<string, unknown>
      requests.push(body)
      const messages = (body.messages ?? []) as Array<{ role?: string }>
      const phase = messages.some((m) => m.role === 'tool') ? 'after-tool' : 'initial'
      const index = queue.findIndex((s) => !s.when || s.when === phase)
      const script = index === -1 ? undefined : queue.splice(index, 1)[0]
      if (!script) {
        return nativeJson({ error: { message: 'fake provider: script queue empty' } }, 500)
      }
      if (script.status) {
        return nativeJson(script.errorBody ?? { error: { message: `fake provider error ${script.status}` } }, script.status)
      }

      const steps = script.steps ?? []
      const usage = script.usage ?? { prompt: 10, completion: 5 }
      const hasToolCall = steps.some((s) => s.toolCall)
      const enc = new TextEncoder()

      async function* sse(): AsyncGenerator<Uint8Array> {
        yield enc.encode(sseChunk({ choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }))
        let toolIndex = 0
        for (const step of steps) {
          if (step.delayMs) await new Promise((r) => setTimeout(r, step.delayMs))
          if (step.text) {
            yield enc.encode(sseChunk({ choices: [{ index: 0, delta: { content: step.text }, finish_reason: null }] }))
          }
          if (step.toolCall) {
            yield enc.encode(sseChunk({
              choices: [{
                index: 0,
                delta: {
                  tool_calls: [{
                    index: toolIndex,
                    id: step.toolCall.id ?? `call_${toolIndex}_fake`,
                    type: 'function',
                    function: { name: step.toolCall.name, arguments: JSON.stringify(step.toolCall.args) },
                  }],
                },
                finish_reason: null,
              }],
            }))
            toolIndex += 1
          }
        }
        yield enc.encode(sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: hasToolCall ? 'tool_calls' : 'stop' }] }))
        yield enc.encode(sseChunk({
          choices: [],
          usage: {
            prompt_tokens: usage.prompt,
            completion_tokens: usage.completion,
            total_tokens: usage.prompt + usage.completion,
          },
        }))
        yield enc.encode('data: [DONE]\n\n')
      }

      return new NativeResponse(sse() as unknown as BodyInit, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      })
    },
  })

  return {
    url: `http://127.0.0.1:${server.port}/v1`,
    requests,
    stop: () => server.stop(true),
  }
}
