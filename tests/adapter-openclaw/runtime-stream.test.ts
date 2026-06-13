import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const mockBakinHome = join(tmpdir(), `bakin-openclaw-stream-home-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = mockBakinHome

const mockedContentDir = {
  getContentDir: () => mockBakinHome,
  getBakinPaths: () => ({
    root: mockBakinHome,
    settings: join(mockBakinHome, 'settings.json'),
    pluginSettings: join(mockBakinHome, 'plugin-settings'),
    plugins: join(mockBakinHome, 'plugins'),
    pluginData: join(mockBakinHome, 'plugin-data'),
    agents: join(mockBakinHome, 'agents'),
    packages: join(mockBakinHome, 'packages'),
    assets: join(mockBakinHome, 'assets'),
    heartbeats: join(mockBakinHome, 'heartbeats'),
    tasks: join(mockBakinHome, 'tasks'),
    schedule: join(mockBakinHome, 'schedule'),
    workflows: join(mockBakinHome, 'workflows'),
    team: join(mockBakinHome, 'team'),
    memoryLog: join(mockBakinHome, 'MEMORY-LOG.md'),
    audit: join(mockBakinHome, 'audit.jsonl'),
    logs: join(mockBakinHome, 'logs'),
  }),
}

mock.module('../../src/core/content-dir', () => mockedContentDir)
mock.module('../../packages/core/src/content-dir', () => mockedContentDir)

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
      timeout: 600,
    })
    // Threaded sends use the stable per-attempt key (same threadId → same
    // key → gateway-side idempotency for transport retries of one turn).
    expect(agentRequest?.params.idempotencyKey).toBe('bakin:messaging:a50b420e:pixel')
    expect(agentRequest?.params).not.toHaveProperty('expectFinal')
    expect(agentRequest?.params).not.toHaveProperty('timeoutMs')
    expect(agentRequest?.params.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(result.metadata?.sessionId).toBe(agentRequest?.params.sessionId)
    // No trajectory written for this turn → usage is honestly absent, never zero-filled.
    expect(result.usage).toBeUndefined()
  })

  it('surfaces token usage on a successful turn from the trajectory', async () => {
    FakeWebSocket.onRequest = (frame, ws) => {
      if (frame.method !== 'agent') return
      const sessionId = frame.params.sessionId as string
      const dir = join(testDir, 'agents', 'pixel', 'sessions')
      mkdirSync(dir, { recursive: true })
      const lines = [
        { type: 'session.started', data: { toolCount: 3 } },
        { type: 'model.completed', data: { timedOut: false, aborted: false, usage: { input: 1500, output: 320, total: 1820 }, assistantTexts: ['done'] } },
        { type: 'session.ended', data: { status: 'success', timedOut: false } },
      ].map((e, i) => JSON.stringify({
        traceSchema: 'openclaw-trajectory', schemaVersion: 1, traceId: sessionId,
        type: e.type, ts: new Date(0).toISOString(), seq: i + 1, sessionId, runId: 'run-1', data: e.data,
      }))
      writeFileSync(join(dir, `${sessionId}.trajectory.jsonl`), lines.join('\n') + '\n')
      ws.emitMessage({ type: 'res', id: frame.id, ok: true, payload: gatewayAgentPayload('done') })
    }

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const result = await runtime.messaging.send({
      agentId: 'pixel',
      content: 'Say done.',
      threadId: 'task:t-usage:d1',
    })

    expect(result.content).toBe('done')
    expect(result.usage).toEqual({ input: 1500, output: 320, total: 1820 })
  })

  it('unthreaded sends keep a random idempotency key and expose no session id', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const result = await runtime.messaging.send({ agentId: 'pixel', content: 'notify' })

    const ws = FakeWebSocket.instances[0]!
    const agentRequest = ws.sentFrames.find(frame => frame.method === 'agent')
    expect(agentRequest?.params.idempotencyKey).toMatch(/^bakin-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(agentRequest?.params).not.toHaveProperty('sessionId')
    expect(result.metadata).toBeUndefined()
  })

  it('two task-attempt threadIds land in distinct provider sessions', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const first = await runtime.messaging.send({ agentId: 'pixel', content: 'attempt 1', threadId: 'task:t-1:d1' })
    const second = await runtime.messaging.send({ agentId: 'pixel', content: 'attempt 2', threadId: 'task:t-1:d2' })

    expect(first.metadata?.sessionId).toBeDefined()
    expect(second.metadata?.sessionId).toBeDefined()
    expect(first.metadata?.sessionId).not.toBe(second.metadata?.sessionId)
  })

  it('forwards per-turn tool policy on messaging sends', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    await runtime.messaging.send({
      agentId: 'pixel',
      content: 'Plan without tools.',
      toolsMode: 'none',
      toolsAllow: ['message_send', 'message_send', ' '],
      toolsDeny: ['schedule_create'],
    })

    const ws = FakeWebSocket.instances[0]!
    const agentRequest = ws.sentFrames.find(frame => frame.method === 'agent')
    expect(agentRequest?.params).toMatchObject({
      toolsMode: 'none',
      toolsAllow: ['message_send'],
      toolsDeny: ['schedule_create'],
    })
  })

  it('forwards per-turn tool policy on messaging streams', async () => {
    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    await collect(runtime.messaging.stream({
      agentId: 'pixel',
      content: 'Stream without tools.',
      toolsMode: 'none',
    }))

    const ws = FakeWebSocket.instances[0]!
    const agentRequest = ws.sentFrames.find(frame => frame.method === 'agent')
    expect(agentRequest?.params).toMatchObject({ toolsMode: 'none' })
  })

  it('waits for the Gateway final response after the accepted ack', async () => {
    let finalEmitted = false
    FakeWebSocket.onRequest = (frame, ws) => {
      if (frame.method !== 'agent') return
      ws.emitMessage({ type: 'res', id: frame.id, ok: true, payload: gatewayAgentAcceptedAck() })
      setTimeout(() => {
        finalEmitted = true
        ws.emitMessage({ type: 'res', id: frame.id, ok: true, payload: gatewayAgentPayload('final reply') })
      }, 50)
    }

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const result = await runtime.messaging.send({
      agentId: 'pixel',
      content: 'are you there?',
      threadId: 'messaging:a50b420e:pixel',
    })

    expect(finalEmitted).toBe(true)
    expect(result.content).toBe('final reply')
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
    })).rejects.toThrow('Invalid session ID: messaging:a50b420e:pixel; code=invalid_session')
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
    })).rejects.toThrow('protocol mismatch; code=INVALID_REQUEST; details={"expectedProtocol":4}')
  })

  it('post-mortem: a mid-turn disconnect with a dead session yields RuntimeTurnError with diagnosis', async () => {
    const { RuntimeTurnError } = await import('../../packages/core/src/adapters/runtime')
    const bigText = 'B'.repeat(262_144)

    FakeWebSocket.onRequest = (frame, ws) => {
      if (frame.method !== 'agent') return
      // OpenClaw records the death in the trajectory, then the gateway
      // connection drops without ever delivering a final frame.
      const sessionId = frame.params.sessionId as string
      const dir = join(testDir, 'agents', 'pixel', 'sessions')
      mkdirSync(dir, { recursive: true })
      const lines = [
        { type: 'session.started', data: { toolCount: 15 } },
        { type: 'tool.call', data: { name: 'bakin_exec_tasks_log_progress' } },
        { type: 'model.completed', data: { timedOut: false, aborted: false, usage: { input: 42000, output: 12000, total: 54000 }, assistantTexts: [bigText] } },
        { type: 'session.ended', data: { status: 'interrupted', timedOut: false } },
      ].map((e, i) => JSON.stringify({
        traceSchema: 'openclaw-trajectory', schemaVersion: 1, traceId: sessionId,
        type: e.type, ts: new Date(0).toISOString(), seq: i + 1, sessionId, runId: 'run-1', data: e.data,
      }))
      writeFileSync(join(dir, `${sessionId}.trajectory.jsonl`), lines.join('\n') + '\n')
      ws.close()
    }

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    try {
      await runtime.messaging.send({
        agentId: 'pixel',
        content: 'produce six deliverables',
        threadId: 'task:t-100:d1',
      })
      throw new Error('expected send to reject')
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeTurnError)
      const diagnosis = (err as InstanceType<typeof RuntimeTurnError>).diagnosis
      expect(diagnosis.reason).toBe('session_interrupted')
      expect(diagnosis.sessionStatus).toBe('interrupted')
      expect(diagnosis.oversizedOutput).toBe(true)
      expect(diagnosis.outputTruncated).toBe(true)
      expect(diagnosis.completionBytes).toBe(262_144)
      expect(diagnosis.lastToolCall).toBe('bakin_exec_tasks_log_progress')
      expect(diagnosis.salvagedText?.length).toBe(262_144)
      expect(diagnosis.detail).toContain('oversized model completion')
    }
  })

  it('fail-fast: a session death during a PENDING turn rejects in <1s without waiting for the transport timer (CP2)', async () => {
    const { RuntimeTurnError } = await import('../../packages/core/src/adapters/runtime')

    FakeWebSocket.onRequest = (frame, ws) => {
      if (frame.method !== 'agent') return
      // The gateway accepts the turn… and then never sends a final frame.
      ws.emitMessage({ type: 'res', id: frame.id, ok: true, payload: { status: 'accepted' } })
      const sessionId = frame.params.sessionId as string
      const dir = join(testDir, 'agents', 'jessica', 'sessions')
      mkdirSync(dir, { recursive: true })
      // ~300ms into the turn, OpenClaw records the death on disk.
      setTimeout(() => {
        const lines = [
          { type: 'session.started', data: {} },
          { type: 'tool.call', data: { name: 'bakin_exec_tasks_log_progress' } },
          { type: 'model.completed', data: { timedOut: false, assistantTexts: ['X'.repeat(200_000)] } },
          { type: 'session.ended', data: { status: 'interrupted', timedOut: false } },
        ].map((e, i) => JSON.stringify({
          traceSchema: 'openclaw-trajectory', schemaVersion: 1, traceId: sessionId,
          type: e.type, ts: new Date(0).toISOString(), seq: i + 1, sessionId, runId: 'run-1', data: e.data,
        }))
        writeFileSync(join(dir, `${sessionId}.trajectory.jsonl`), lines.join('\n') + '\n')
      }, 300)
    }

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const startedAt = Date.now()
    try {
      await runtime.messaging.send({
        agentId: 'jessica',
        content: 'six deliverables please',
        threadId: 'task:t-200:d1',
      })
      throw new Error('expected send to reject')
    } catch (err) {
      const elapsed = Date.now() - startedAt
      expect(err).toBeInstanceOf(RuntimeTurnError)
      const diagnosis = (err as InstanceType<typeof RuntimeTurnError>).diagnosis
      expect(diagnosis.reason).toBe('session_interrupted')
      expect(diagnosis.oversizedOutput).toBe(true)
      expect(diagnosis.lastToolCall).toBe('bakin_exec_tasks_log_progress')
      // Death written at ~300ms; detection budget is 2 poll intervals.
      expect(elapsed).toBeLessThan(1000)
    }
  })

  it('post-mortem covers runtime_failed: a gateway error FRAME with a dead session on disk yields the diagnosis', async () => {
    // Live-rig finding: a graceful gateway shutdown mid-turn sends an error
    // frame (kind runtime_failed) AND writes session.ended(error) to the
    // trajectory. The frame races the fail-fast watcher; when the frame
    // wins, post-mortem must still convert it into the diagnosed death.
    const { RuntimeTurnError } = await import('../../packages/core/src/adapters/runtime')

    FakeWebSocket.onRequest = (frame, ws) => {
      if (frame.method !== 'agent') return
      const sessionId = frame.params.sessionId as string
      const dir = join(testDir, 'agents', 'pixel', 'sessions')
      mkdirSync(dir, { recursive: true })
      const lines = [
        { type: 'session.started', data: {} },
        { type: 'turn.client_closed', data: {} }, // new event type seen live — must be tolerated
        { type: 'model.completed', data: { timedOut: false, assistantTexts: ['partial work'] } },
        { type: 'session.ended', data: { status: 'error', timedOut: false } },
      ].map((e, i) => JSON.stringify({
        traceSchema: 'openclaw-trajectory', schemaVersion: 1, traceId: sessionId,
        type: e.type, ts: new Date(0).toISOString(), seq: i + 1, sessionId, runId: 'run-1', data: e.data,
      }))
      writeFileSync(join(dir, `${sessionId}.trajectory.jsonl`), lines.join('\n') + '\n')
      // Error frame arrives immediately — beats the 200ms watcher poll.
      ws.emitMessage({ type: 'res', id: frame.id, ok: false, error: { message: 'gateway shutting down', code: 'unavailable' } })
    }

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    try {
      await runtime.messaging.send({ agentId: 'pixel', content: 'do work', threadId: 'task:t-frame:d1' })
      throw new Error('expected send to reject')
    } catch (err) {
      expect(err).toBeInstanceOf(RuntimeTurnError)
      const diagnosis = (err as InstanceType<typeof RuntimeTurnError>).diagnosis
      expect(diagnosis.sessionStatus).toBe('error')
      expect(diagnosis.salvagedText).toBe('partial work')
    }
  })

  it('fail-fast success arm: a lost final frame on a SUCCESSFUL run recovers after the grace window, not after 630s', async () => {
    FakeWebSocket.onRequest = (frame, ws) => {
      if (frame.method !== 'agent') return
      // Accept the turn; record success on disk; never send the final frame.
      ws.emitMessage({ type: 'res', id: frame.id, ok: true, payload: { status: 'accepted' } })
      const sessionId = frame.params.sessionId as string
      const dir = join(testDir, 'agents', 'pixel', 'sessions')
      mkdirSync(dir, { recursive: true })
      setTimeout(() => {
        const lines = [
          { type: 'session.started', data: {} },
          { type: 'model.completed', data: { timedOut: false, assistantTexts: ['saved everything: a1..a6'] } },
          { type: 'session.ended', data: { status: 'success', timedOut: false } },
        ].map((e, i) => JSON.stringify({
          traceSchema: 'openclaw-trajectory', schemaVersion: 1, traceId: sessionId,
          type: e.type, ts: new Date(0).toISOString(), seq: i + 1, sessionId, runId: 'run-1', data: e.data,
        }))
        writeFileSync(join(dir, `${sessionId}.trajectory.jsonl`), lines.join('\n') + '\n')
      }, 100)
    }

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const startedAt = Date.now()
    const result = await runtime.messaging.send({
      agentId: 'pixel',
      content: 'finish up',
      threadId: 'task:t-graced:d1',
    })
    const elapsed = Date.now() - startedAt
    expect(result.content).toBe('saved everything: a1..a6')
    // Success at ~100ms + 2s grace — far below the 630s transport timer.
    expect(elapsed).toBeLessThan(5000)
  })

  it('a success frame with no extractable text recovers the content from the trajectory', async () => {
    FakeWebSocket.onRequest = (frame, ws) => {
      if (frame.method !== 'agent') return
      const sessionId = frame.params.sessionId as string
      const dir = join(testDir, 'agents', 'pixel', 'sessions')
      mkdirSync(dir, { recursive: true })
      const lines = [
        { type: 'session.started', data: {} },
        { type: 'model.completed', data: { timedOut: false, assistantTexts: ['content lives on disk'] } },
        { type: 'session.ended', data: { status: 'success', timedOut: false } },
      ].map((e, i) => JSON.stringify({
        traceSchema: 'openclaw-trajectory', schemaVersion: 1, traceId: sessionId,
        type: e.type, ts: new Date(0).toISOString(), seq: i + 1, sessionId, runId: 'run-1', data: e.data,
      }))
      writeFileSync(join(dir, `${sessionId}.trajectory.jsonl`), lines.join('\n') + '\n')
      // SUCCESS frame whose payload yields no text via extractOpenClawAgentText.
      ws.emitMessage({ type: 'res', id: frame.id, ok: true, payload: { status: 'accepted' } })
      queueMicrotask(() => {
        ws.emitMessage({ type: 'res', id: frame.id, ok: true, payload: { unexpected: 'shape' } })
      })
    }

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const result = await runtime.messaging.send({
      agentId: 'pixel',
      content: 'finish up',
      threadId: 'task:t-notext:d1',
    })
    expect(result.content).toBe('content lives on disk')
  })

  it('post-mortem: recovers the response text when the run succeeded but the frame was lost', async () => {
    FakeWebSocket.onRequest = (frame, ws) => {
      if (frame.method !== 'agent') return
      const sessionId = frame.params.sessionId as string
      const dir = join(testDir, 'agents', 'pixel', 'sessions')
      mkdirSync(dir, { recursive: true })
      const lines = [
        { type: 'session.started', data: {} },
        { type: 'model.completed', data: { timedOut: false, assistantTexts: ['done: saved assets a1..a6'] } },
        { type: 'session.ended', data: { status: 'success', timedOut: false } },
      ].map((e, i) => JSON.stringify({
        traceSchema: 'openclaw-trajectory', schemaVersion: 1, traceId: sessionId,
        type: e.type, ts: new Date(0).toISOString(), seq: i + 1, sessionId, runId: 'run-1', data: e.data,
      }))
      writeFileSync(join(dir, `${sessionId}.trajectory.jsonl`), lines.join('\n') + '\n')
      ws.close()
    }

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()

    const result = await runtime.messaging.send({
      agentId: 'pixel',
      content: 'finish the task',
      threadId: 'task:t-101:d1',
    })
    expect(result.content).toBe('done: saved assets a1..a6')
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

  it('finds transcript activity stored under OpenClaw explicit session keys', async () => {
    const sessionKey = 'messaging:session-explicit:main'
    const sessionsDir = join(testDir, 'agents', 'main', 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    let sessionFile = ''

    let gatewayResolved = false
    FakeWebSocket.onRequest = (frame, ws) => {
      if (frame.method !== 'agent') return
      const openClawSessionId = String(frame.params.sessionId)
      sessionFile = join(sessionsDir, `${openClawSessionId}.jsonl`)
      writeFileSync(sessionFile, [
        JSON.stringify({ type: 'session', id: openClawSessionId }),
        '',
      ].join('\n'), 'utf-8')
      writeFileSync(join(sessionsDir, 'sessions.json'), JSON.stringify({
        [`agent:main:explicit:${openClawSessionId}`]: {
          sessionId: openClawSessionId,
          sessionFile,
        },
      }), 'utf-8')
      setTimeout(() => {
        appendFileSync(sessionFile, `${JSON.stringify({
          type: 'message',
          message: {
            role: 'assistant',
            content: [{
              type: 'toolCall',
              id: 'call-explicit',
              name: 'exec',
              arguments: { command: 'mcporter call bakin-main.bakin_exec_messaging_session_get --args {"sessionId":"session-explicit"}' },
            }],
          },
        })}\n`)
      }, 20)
      setTimeout(() => {
        gatewayResolved = true
        ws.emitMessage({ type: 'res', id: frame.id, ok: true, payload: gatewayAgentPayload('Final reply.') })
      }, 800)
    }

    const { createOpenClawRuntimeAdapter } = await import('@bakin/adapter-openclaw')
    const runtime = createOpenClawRuntimeAdapter()
    const iterator = runtime.messaging.stream({
      agentId: 'main',
      content: 'hello',
      threadId: sessionKey,
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
        content: 'exec: mcporter call bakin-main.bakin_exec_messaging_session_get --args {"sessionId":"session-explicit"}',
        data: {
          phase: 'call',
          callId: 'call-explicit',
          toolName: 'exec',
          status: 'running',
          summary: 'Updating messaging content',
          inputPreview: '{"command":"mcporter call bakin-main.bakin_exec_messaging_session_get --args {\\"sessionId\\":\\"session-explicit\\"}"}',
        },
      })
    }

    const remaining: unknown[] = []
    for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
      remaining.push(chunk)
    }
    expect(remaining).toContainEqual({ type: 'text', content: 'Final reply.' })
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

function gatewayAgentAcceptedAck(): Record<string, unknown> {
  return { runId: 'run-1', status: 'accepted', acceptedAt: Date.now() }
}

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
      this.emitMessage({ type: 'res', id: frame.id, ok: true, payload: gatewayAgentAcceptedAck() })
      queueMicrotask(() => {
        this.emitMessage({ type: 'res', id: frame.id, ok: true, payload: gatewayAgentPayload('ok from gateway') })
      })
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
