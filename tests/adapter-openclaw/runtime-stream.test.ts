import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterable) out.push(item)
  return out
}

function sseResponse(frames: unknown[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function delayedSseResponse(run: (controller: ReadableStreamDefaultController<Uint8Array>) => Promise<void>): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      await run(controller)
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('OpenClaw runtime stream parsing', () => {
  let testDir: string
  let originalOpenClawHome: string | undefined
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-stream-test-'))
    originalOpenClawHome = process.env.OPENCLAW_HOME
    originalFetch = globalThis.fetch
    process.env.OPENCLAW_HOME = testDir
    mkdirSync(testDir, { recursive: true })
    writeFileSync(join(testDir, 'openclaw.json'), JSON.stringify({
      gateway: { auth: { token: 'test-token' } },
    }), 'utf-8')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalOpenClawHome === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = originalOpenClawHome
    rmSync(testDir, { recursive: true, force: true })
  })

  it('preserves OpenClaw status and tool frames as chat chunks', async () => {
    globalThis.fetch = mock(async () => sseResponse([
      { type: 'status', content: 'Checking project notes' },
      {
        type: 'tool',
        content: 'Read project file',
        data: {
          phase: 'call',
          toolName: 'bakin_exec_projects_get',
          status: 'running',
        },
      },
      { choices: [{ delta: { content: 'Done.' } }] },
    ])) as unknown as typeof fetch

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const chunks = await collect(runtime.messaging.stream({
      agentId: 'main',
      content: 'hello',
      threadId: 'thread-1',
    }))

    expect(chunks).toEqual([
      { type: 'status', content: 'Checking project notes', data: undefined },
      {
        type: 'tool',
        content: 'Read project file',
        data: {
          phase: 'call',
          toolName: 'bakin_exec_projects_get',
          status: 'running',
        },
      },
      { type: 'text', content: 'Done.' },
      { type: 'done' },
    ])
  })

  it('maps OpenAI tool_calls deltas to tool chunks', async () => {
    globalThis.fetch = mock(async () => sseResponse([
      {
        choices: [{
          delta: {
            tool_calls: [{
              id: 'call-1',
              type: 'function',
              function: { name: 'bakin_exec_projects_get', arguments: '{"projectId":"p1"}' },
            }],
          },
        }],
      },
    ])) as unknown as typeof fetch

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const chunks = await collect(runtime.messaging.stream({
      agentId: 'main',
      content: 'hello',
      threadId: 'thread-1',
    }))

    expect(chunks[0]).toEqual({
      type: 'tool',
      content: 'bakin_exec_projects_get',
      data: {
        phase: 'call',
        callId: 'call-1',
        toolName: 'bakin_exec_projects_get',
        status: 'running',
        inputPreview: '{"projectId":"p1"}',
      },
    })
  })

  it('emits OpenClaw transcript tool activity while the chat stream is pending', async () => {
    const sessionsDir = join(testDir, 'agents', 'main', 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    const sessionFile = join(sessionsDir, 'session-1.jsonl')
    writeFileSync(sessionFile, [
      JSON.stringify({ type: 'session', id: 'session-1' }),
      JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'before' }] } }),
      '',
    ].join('\n'), 'utf-8')
    writeFileSync(join(sessionsDir, 'sessions.json'), JSON.stringify({
      'thread-1': { sessionId: 'session-1', sessionFile },
    }), 'utf-8')

    const encoder = new TextEncoder()
    globalThis.fetch = mock(async () => delayedSseResponse(async (controller) => {
      await wait(20)
      appendFileSync(sessionFile, `${JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            id: 'call-1',
            name: 'exec',
            arguments: { command: 'gh issue list --repo markhayden/bakin --search messaging' },
          }],
        },
      })}\n`)
      appendFileSync(sessionFile, `${JSON.stringify({
        type: 'message',
        message: {
          role: 'toolResult',
          toolName: 'exec',
          toolCallId: 'call-1',
          content: [{ type: 'text', text: 'Found #190' }],
          details: { status: 'completed', exitCode: 0, durationMs: 12 },
        },
      })}\n`)
      await wait(260)
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Done.' } }] })}\n\n`))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    })) as unknown as typeof fetch

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const chunks = await collect(runtime.messaging.stream({
      agentId: 'main',
      content: 'hello',
      threadId: 'thread-1',
    }))

    expect(chunks).toEqual([
      {
        type: 'tool',
        content: 'exec: gh issue list --repo markhayden/bakin --search messaging',
        data: {
          phase: 'call',
          callId: 'call-1',
          toolName: 'exec',
          status: 'running',
          inputPreview: '{"command":"gh issue list --repo markhayden/bakin --search messaging"}',
        },
      },
      {
        type: 'tool',
        content: 'exec completed',
        data: {
          phase: 'result',
          toolName: 'exec',
          callId: 'call-1',
          status: 'completed',
          exitCode: 0,
          durationMs: 12,
          outputPreview: '[{"type":"text","text":"Found #190"}]',
        },
      },
      { type: 'text', content: 'Done.' },
      { type: 'done' },
    ])
  })

  it('emits transcript activity before OpenClaw chat response headers arrive', async () => {
    const sessionsDir = join(testDir, 'agents', 'main', 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    const sessionFile = join(sessionsDir, 'session-2.jsonl')
    writeFileSync(sessionFile, [
      JSON.stringify({ type: 'session', id: 'session-2' }),
      '',
    ].join('\n'), 'utf-8')
    writeFileSync(join(sessionsDir, 'sessions.json'), JSON.stringify({
      'thread-2': { sessionId: 'session-2', sessionFile },
    }), 'utf-8')

    let fetchResolved = false
    const encoder = new TextEncoder()
    globalThis.fetch = mock(async () => {
      setTimeout(() => {
        appendFileSync(sessionFile, `${JSON.stringify({
          type: 'message',
          message: {
            role: 'assistant',
            content: [{
              type: 'toolCall',
              id: 'call-2',
              name: 'read',
              arguments: { path: '/tmp/project.md' },
            }],
          },
        })}\n`)
      }, 20)

      await wait(800)
      fetchResolved = true
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'After tools.' } }] })}\n\n`))
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as unknown as typeof fetch

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const iterator = runtime.messaging.stream({
      agentId: 'main',
      content: 'hello',
      threadId: 'thread-2',
    })[Symbol.asyncIterator]()

    const first = await Promise.race([
      iterator.next(),
      wait(500).then(() => 'timeout' as const),
    ])

    expect(first).not.toBe('timeout')
    expect(fetchResolved).toBe(false)
    if (first !== 'timeout') {
      expect(first.value).toEqual({
        type: 'tool',
        content: 'read: /tmp/project.md',
        data: {
          phase: 'call',
          callId: 'call-2',
          toolName: 'read',
          status: 'running',
          inputPreview: '{"path":"/tmp/project.md"}',
        },
      })
    }

    const remaining: unknown[] = []
    for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
      remaining.push(chunk)
    }
    expect(remaining).toContainEqual({ type: 'text', content: 'After tools.' })
    expect(remaining).toContainEqual({ type: 'done' })
  })
})
