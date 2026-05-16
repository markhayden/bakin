import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterable) out.push(item)
  return out
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('OpenClaw runtime Gateway chat', () => {
  let testDir: string
  let originalOpenClawHome: string | undefined
  let originalWebSocket: typeof globalThis.WebSocket | undefined

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'bakin-openclaw-stream-test-'))
    originalOpenClawHome = process.env.OPENCLAW_HOME
    originalWebSocket = globalThis.WebSocket
    process.env.OPENCLAW_HOME = testDir
    mkdirSync(testDir, { recursive: true })
    writeFileSync(join(testDir, 'openclaw.json'), JSON.stringify({
      gateway: { auth: { token: 'test-token' } },
    }), 'utf-8')
    FakeWebSocket.instances.length = 0
    FakeWebSocket.onRequest = null
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket as typeof WebSocket
    if (originalOpenClawHome === undefined) delete process.env.OPENCLAW_HOME
    else process.env.OPENCLAW_HOME = originalOpenClawHome
    rmSync(testDir, { recursive: true, force: true })
  })

  it('sends chat through the OpenClaw Gateway agent RPC', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const result = await runtime.messaging.send({
      agentId: 'pixel',
      content: 'Say ok.',
      threadId: 'messaging:a50b420e:pixel',
    })

    expect(result.content).toBe('ok from gateway')
    const ws = FakeWebSocket.instances[0]!
    const connectRequest = ws.sentFrames.find(frame => frame.method === 'connect')
    const agentRequest = ws.sentFrames.find(frame => frame.method === 'agent')
    expect(connectRequest?.params).toMatchObject({
      minProtocol: 1,
      maxProtocol: 10,
      client: {
        id: 'gateway-client',
        displayName: 'Bakin',
        version: '1.0.0',
        platform: process.platform,
        mode: 'backend',
      },
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      auth: { token: 'test-token' },
    })
    expect(agentRequest?.params).toMatchObject({
      agentId: 'pixel',
      message: 'Say ok.',
      deliver: false,
      expectFinal: true,
    })
    expect(agentRequest?.params.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('streams Gateway agent responses as chat chunks', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const chunks = await collect(runtime.messaging.stream({
      agentId: 'pixel',
      content: 'Say ok.',
      threadId: 'brainstorm-2',
    }))

    expect(chunks).toEqual([
      { type: 'text', content: 'ok from gateway' },
      { type: 'done' },
    ])
  })

  it('rejects loudly when the Gateway agent RPC fails', async () => {
    FakeWebSocket.onRequest = (frame, ws) => {
      if (frame.method === 'agent') {
        ws.emitMessage({
          type: 'res',
          id: frame.id,
          ok: false,
          error: { message: 'Invalid session ID: messaging:a50b420e:pixel', code: 'invalid_session' },
        })
      }
    }

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    await expect(runtime.messaging.send({
      agentId: 'pixel',
      content: 'hello',
      threadId: 'messaging:a50b420e:pixel',
    })).rejects.toThrow('OpenClaw chat failed: Invalid session ID: messaging:a50b420e:pixel; code=invalid_session')
  })

  it('includes safe Gateway error details in chat failures', async () => {
    FakeWebSocket.onRequest = (frame, ws) => {
      if (frame.method === 'agent') {
        ws.emitMessage({
          type: 'res',
          id: frame.id,
          ok: false,
          error: {
            message: 'protocol mismatch',
            code: 'INVALID_REQUEST',
            details: { expectedProtocol: 4, token: 'secret' },
          },
        })
      }
    }

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    await expect(runtime.messaging.send({
      agentId: 'pixel',
      content: 'hello',
      threadId: 'messaging:a50b420e:pixel',
    })).rejects.toThrow('OpenClaw chat failed: protocol mismatch; code=INVALID_REQUEST; details={"expectedProtocol":4}')
  })

  it('emits OpenClaw transcript tool activity while the Gateway agent request is pending', async () => {
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

    FakeWebSocket.onRequest = (frame, ws) => {
      if (frame.method !== 'agent') return
      setTimeout(() => {
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
      }, 20)
      setTimeout(() => {
        ws.emitMessage({ type: 'res', id: frame.id, ok: true, payload: gatewayAgentPayload('Done.') })
      }, 300)
    }

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
          summary: 'Checking GitHub issues',
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

  it('emits transcript activity before the Gateway agent response arrives', async () => {
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

    let gatewayResolved = false
    FakeWebSocket.onRequest = (frame, ws) => {
      if (frame.method !== 'agent') return
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
      setTimeout(() => {
        gatewayResolved = true
        ws.emitMessage({ type: 'res', id: frame.id, ok: true, payload: gatewayAgentPayload('After tools.') })
      }, 800)
    }

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
    expect(gatewayResolved).toBe(false)
    if (first !== 'timeout') {
      expect(first.value).toEqual({
        type: 'tool',
        content: 'read: /tmp/project.md',
        data: {
          phase: 'call',
          callId: 'call-2',
          toolName: 'read',
          status: 'running',
          summary: 'Reading project.md',
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

  it('summarizes transcript web fetch tools without leaking query secrets', async () => {
    const sessionsDir = join(testDir, 'agents', 'main', 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    const sessionFile = join(sessionsDir, 'session-web.jsonl')
    writeFileSync(sessionFile, [
      JSON.stringify({ type: 'session', id: 'session-web' }),
      '',
    ].join('\n'), 'utf-8')
    writeFileSync(join(sessionsDir, 'sessions.json'), JSON.stringify({
      'thread-web': { sessionId: 'session-web', sessionFile },
    }), 'utf-8')

    FakeWebSocket.onRequest = (frame, ws) => {
      if (frame.method !== 'agent') return
      setTimeout(() => {
        appendFileSync(sessionFile, `${JSON.stringify({
          type: 'message',
          message: {
            role: 'assistant',
            content: [{
              type: 'toolCall',
              id: 'call-web',
              name: 'web_fetch',
              arguments: { url: 'https://example.com/docs?token=secret' },
            }],
          },
        })}\n`)
      }, 20)
      setTimeout(() => {
        ws.emitMessage({ type: 'res', id: frame.id, ok: true, payload: gatewayAgentPayload('Done.') })
      }, 300)
    }

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const chunks = await collect(runtime.messaging.stream({
      agentId: 'main',
      content: 'hello',
      threadId: 'thread-web',
    }))

    expect(chunks[0]).toEqual({
      type: 'tool',
      content: 'web_fetch',
      data: {
        phase: 'call',
        callId: 'call-web',
        toolName: 'web_fetch',
        status: 'running',
        summary: 'Fetching https://example.com/docs?token=[redacted]',
        inputPreview: '{"url":"https://example.com/docs?token=[redacted]"}',
      },
    })
  })
})

function gatewayAgentPayload(text: string): Record<string, unknown> {
  return {
    runId: 'run-1',
    status: 'ok',
    summary: 'completed',
    result: {
      payloads: [{ text, mediaUrl: null }],
      meta: {
        finalAssistantVisibleText: text,
        finalAssistantRawText: text,
      },
    },
  }
}

interface FakeGatewayFrame {
  type: 'req'
  id: string
  method: string
  params: Record<string, unknown>
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static onRequest: ((frame: FakeGatewayFrame, ws: FakeWebSocket) => void) | null = null
  readyState = 0
  sentFrames: FakeGatewayFrame[] = []
  private listeners = new Map<string, Set<(event: { data?: string }) => void>>()

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = 1
      this.emit('open', {})
      this.emitMessage({
        type: 'event',
        event: 'connect.challenge',
        payload: { nonce: 'nonce-1' },
      })
    })
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: { data?: string }) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as FakeGatewayFrame
    this.sentFrames.push(frame)
    if (frame.method === 'connect') {
      this.emitMessage({ type: 'res', id: frame.id, ok: true, payload: { auth: { scopes: frame.params.scopes } } })
      return
    }
    if (FakeWebSocket.onRequest) {
      FakeWebSocket.onRequest(frame, this)
      return
    }
    if (frame.method === 'agent') {
      this.emitMessage({ type: 'res', id: frame.id, ok: true, payload: gatewayAgentPayload('ok from gateway') })
    }
  }

  close(): void {
    this.readyState = 3
    this.emit('close', {})
  }

  emitMessage(frame: Record<string, unknown>): void {
    this.emit('message', { data: JSON.stringify(frame) })
  }

  private emit(type: string, event: { data?: string }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}
