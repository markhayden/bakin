/**
 * adapter-pi P9 (checkpoint γ) — REAL Pi SDK turns against the fake
 * OpenAI-compatible provider: send/stream, usage, tool bridge round-trip,
 * thread resume, abort, provider cooldown. Zero LLM tokens.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

// The Pi SDK calls global fetch; the happy-dom preload replaces it with a
// browser emulation that breaks real sockets — restore Bun's native fetch.
globalThis.fetch = (Bun as unknown as { fetch: typeof fetch }).fetch

const testDir = join(tmpdir(), `bakin-test-pi-turn-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = join(testDir, 'pi')
process.env.BAKIN_HOME = join(testDir, 'bakin')

const contentDirMock = () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ home: join(testDir, 'bakin'), db: join(testDir, 'bakin', 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import type { RuntimeError, RuntimeExecToolProvider, ChatChunk } from '../../../packages/core/src/adapters/runtime'
import type { AdapterInitOpts } from '../../../packages/core/src/adapters/shared'
import { createPiRuntimeAdapter } from '../../../packages/adapter-pi/src/index'
import { resetPiHome } from '../../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../../packages/adapter-pi/src/models'
import { getThreadSessionFile } from '../../../packages/adapter-pi/src/sessions'
import { startFakeProvider, type FakeProvider, type FakeTurnScript } from './fake-provider'

const invocations: Array<{ name: string; params: Record<string, unknown>; agentId: string }> = []
const execToolProvider: RuntimeExecToolProvider = {
  list: () => [{
    name: 'bakin_exec_test_echo',
    description: 'Echo a message',
    parametersSchema: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
  }],
  invoke: async (name, params, agentId) => {
    invocations.push({ name, params, agentId })
    return { ok: true, text: JSON.stringify({ ok: true, echoed: params.message }) }
  },
}

let provider: FakeProvider
const adapter = createPiRuntimeAdapter()

type ToolActivityEvent = Parameters<NonNullable<AdapterInitOpts['onToolActivity']>>[0]
type TurnActivityEvent = Parameters<NonNullable<AdapterInitOpts['onTurnActivity']>>[0]

function requireToolResult(event: ToolActivityEvent | undefined): Extract<ToolActivityEvent, { phase: 'result' }> {
  if (!event || event.phase !== 'result') throw new Error('expected a tool result event')
  return event
}

async function createTelemetryAdapter(
  onToolActivity: NonNullable<AdapterInitOpts['onToolActivity']>,
  onTurnActivity?: NonNullable<AdapterInitOpts['onTurnActivity']>,
) {
  const runtime = createPiRuntimeAdapter()
  await runtime.initialize({
    contentDir: join(testDir, 'bakin'),
    execTools: execToolProvider,
    settings: { retry: { enabled: false, provider: { maxRetries: 0 } } },
    onToolActivity,
    onTurnActivity,
  })
  return runtime
}

async function createTurnTelemetryAdapter(onTurnActivity: NonNullable<AdapterInitOpts['onTurnActivity']>) {
  const runtime = createPiRuntimeAdapter()
  await runtime.initialize({
    contentDir: join(testDir, 'bakin'),
    execTools: execToolProvider,
    settings: { retry: { enabled: false, provider: { maxRetries: 0 } } },
    onTurnActivity,
  })
  return runtime
}

function seedProvider(scripts: FakeTurnScript[]): FakeProvider {
  provider?.stop()
  provider = startFakeProvider(scripts)
  // Point the fixture model at the fresh server (port changes per start).
  const agentDir = join(testDir, 'pi', 'agent')
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({
    providers: {
      fakeai: {
        name: 'FakeAI',
        baseUrl: provider.url,
        api: 'openai-completions',
        models: [{
          id: 'fake-model',
          name: 'Fake Model',
          input: ['text'],
          reasoning: false,
          contextWindow: 100000,
          maxTokens: 8000,
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        }],
      },
    },
  }))
  resetModelRegistry()
  return provider
}

beforeAll(async () => {
  resetPiHome()
  const agentDir = join(testDir, 'pi', 'agent')
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({
    fakeai: { type: 'api_key', key: 'fake-key' },
  }))
  await adapter.initialize({
    contentDir: join(testDir, 'bakin'),
    execTools: execToolProvider,
    // Bakin's dispatch owns retries — disable BOTH of Pi's inner retry
    // layers so provider-failure tests settle immediately: session-level
    // auto-retry (retry.enabled) and provider-level HTTP retry with
    // exponential backoff (retry.provider.maxRetries).
    settings: { retry: { enabled: false, provider: { maxRetries: 0 } } },
  })
  await adapter.provisionToolAccess() // seeds main (write-free initialize)
  await adapter.agents.update('main', { model: 'fakeai/fake-model' })
  await adapter.agents.writeWorkspaceFile('main', { path: 'SOUL.md', content: 'You are the test soul.' })
})

afterAll(() => {
  provider?.stop()
  rmSync(testDir, { recursive: true, force: true })
})

describe('messaging.send', () => {
  test('adapter-level turn lifecycle reports send success with identity, class, result, and usage', async () => {
    const activity: TurnActivityEvent[] = []
    const runtime = await createTurnTelemetryAdapter((event) => activity.push(event))
    seedProvider([{ steps: [{ text: 'observed lifecycle' }] }])

    const result = await runtime.messaging.send({
      agentId: 'main',
      content: 'hi',
      threadId: 'task:turn-lifecycle-send:d1',
      activityClass: 'system',
    })

    expect(activity).toHaveLength(2)
    expect(activity[0]).toEqual({
      agentId: 'main',
      activityClass: 'system',
      threadId: 'task:turn-lifecycle-send:d1',
      operation: 'send',
      phase: 'start',
      status: 'running',
      turnId: expect.any(String),
    })
    expect(activity[1]).toMatchObject({
      agentId: 'main',
      activityClass: 'system',
      threadId: 'task:turn-lifecycle-send:d1',
      operation: 'send',
      phase: 'result',
      status: 'completed',
      turnId: activity[0]!.turnId,
      durationMs: expect.any(Number),
      resultId: result.id,
      usage: result.usage,
    })
    expect(result.metadata).toMatchObject({ adapterTurnId: activity[0]!.turnId })
  })

  test.each([
    ['failed', undefined],
    ['aborted', AbortSignal.abort()],
  ] as const)('adapter-level turn lifecycle reports send %s exactly once', async (status, signal) => {
    const activity: TurnActivityEvent[] = []
    const runtime = await createTurnTelemetryAdapter((event) => activity.push(event))

    await expect(runtime.messaging.send({
      agentId: status === 'failed' ? 'ghost' : 'main',
      content: 'hi',
      threadId: `task:turn-lifecycle-send-${status}:d1`,
      signal,
    })).rejects.toBeDefined()

    expect(activity.map((event) => event.phase)).toEqual(['start', 'result'])
    expect(activity[1]).toMatchObject({
      operation: 'send',
      status,
      turnId: activity[0]!.turnId,
      durationMs: expect.any(Number),
    })
  })

  test('a throwing adapter-level turn observer never fails send', async () => {
    let calls = 0
    const runtime = await createTurnTelemetryAdapter(() => {
      calls += 1
      throw new Error('turn observer exploded')
    })
    seedProvider([{ steps: [{ text: 'still succeeds' }] }])

    const result = await runtime.messaging.send({ agentId: 'main', content: 'hi' })

    expect(result.content).toBe('still succeeds')
    expect(calls).toBe(2)
  })

  test('text turn returns content + usage delta + sessionId; canonical files enter the system prompt', async () => {
    const fake = seedProvider([
      { steps: [{ text: 'Hello ' }, { text: 'from Pi' }], usage: { prompt: 42, completion: 7 } },
    ])
    const result = await adapter.messaging.send({ agentId: 'main', content: 'hi', threadId: 'task:t1:d1' })
    expect(result.content).toBe('Hello from Pi')
    expect(result.metadata?.sessionId).toBeDefined()
    expect(result.usage?.output).toBe(7)
    expect(result.usage?.input).toBe(42)
    expect(result.usage?.model).toBe('fakeai/fake-model')

    // System prompt carried the canonical workspace file.
    const req = fake.requests[0] as { messages: Array<{ role: string; content: unknown }> }
    const system = req.messages.find((m) => m.role === 'system')
    expect(JSON.stringify(system?.content)).toContain('You are the test soul.')

    // Thread mapping recorded for resume.
    expect(getThreadSessionFile('main', 'task:t1:d1')).not.toBeNull()
  })

  test('same threadId resumes the same session (history grows)', async () => {
    const fake = seedProvider([
      { steps: [{ text: 'first' }] },
      { steps: [{ text: 'second' }] },
    ])
    await adapter.messaging.send({ agentId: 'main', content: 'one', threadId: 'chat:resume-1' })
    await adapter.messaging.send({ agentId: 'main', content: 'two', threadId: 'chat:resume-1' })
    const first = fake.requests[0] as { messages: unknown[] }
    const second = fake.requests[1] as { messages: unknown[] }
    expect(second.messages.length).toBeGreaterThan(first.messages.length)
    const flat = JSON.stringify(second.messages)
    expect(flat).toContain('one')
    expect(flat).toContain('first')
    expect(flat).toContain('two')
  })

  test('exec-tool round trip: model calls bakin tool, result feeds the next request', async () => {
    invocations.length = 0
    const fake = seedProvider([
      { steps: [{ toolCall: { name: 'bakin_exec_test_echo', args: { message: 'ping' } } }] },
      { steps: [{ text: 'tool replied' }] },
    ])
    const result = await adapter.messaging.send({ agentId: 'main', content: 'use the tool', threadId: 'task:tool:d1' })
    expect(invocations).toEqual([{ name: 'bakin_exec_test_echo', params: { message: 'ping' }, agentId: 'main' }])
    expect(result.content).toBe('tool replied')
    // Tool result travelled back to the provider on the second request.
    expect(JSON.stringify(fake.requests[1])).toContain('echoed')
  })

  test('toolsMode none exposes no bakin tools to the model', async () => {
    const fake = seedProvider([{ steps: [{ text: 'no tools here' }] }])
    await adapter.messaging.send({ agentId: 'main', content: 'plain', toolsMode: 'none' })
    const req = fake.requests[0] as { tools?: unknown[] }
    expect(req.tools ?? []).toHaveLength(0)
  })

  test('onActivity taps tool + status chunks during a send turn (T8/D-plan-1)', async () => {
    invocations.length = 0
    seedProvider([
      // Token-bearing arg: previews leave the adapter (SSE → every browser),
      // so safePreview must redact before truncation (parity with OpenClaw).
      { steps: [{ toolCall: { name: 'bakin_exec_test_echo', args: { message: 'fetch https://api.example.com/data?apiKey=hunter2-super-secret' } } }] },
      { steps: [{ text: 'tap reply' }] },
    ])
    const activity: ChatChunk[] = []
    const result = await adapter.messaging.send({
      agentId: 'main',
      content: 'use the tool',
      threadId: 'task:tap:d1',
      onActivity: (chunk) => activity.push(chunk),
    })
    expect(result.content).toBe('tap reply')
    // v1 scope: tool + status only — never text/done/error.
    expect(activity.length).toBeGreaterThan(0)
    expect(activity.every((c) => c.type === 'tool' || c.type === 'status')).toBe(true)
    const tools = activity.filter((c) => c.type === 'tool')
    expect(tools.length).toBe(2)
    expect(tools[0]!.data).toMatchObject({ phase: 'call', toolName: 'bakin_exec_test_echo', status: 'running' })
    expect(tools[1]!.data).toMatchObject({ phase: 'result', toolName: 'bakin_exec_test_echo', status: 'completed' })
    const call = tools[0]!.data as { inputPreview?: string }
    expect(call.inputPreview).toContain('apiKey=[redacted]')
    expect(JSON.stringify(activity)).not.toContain('hunter2-super-secret')
  })

  test('a throwing onActivity callback never fails the turn', async () => {
    seedProvider([
      { steps: [{ toolCall: { name: 'bakin_exec_test_echo', args: { message: 'boom' } } }] },
      { steps: [{ text: 'still fine' }] },
    ])
    let calls = 0
    const result = await adapter.messaging.send({
      agentId: 'main',
      content: 'use the tool',
      threadId: 'task:tap-throw:d1',
      onActivity: () => {
        calls += 1
        throw new Error('tap exploded')
      },
    })
    expect(result.content).toBe('still fine')
    expect(calls).toBeGreaterThan(0)
  })

  test('adapter-level onToolActivity observes send tool calls without replacing per-turn onActivity', async () => {
    const toolActivity: ToolActivityEvent[] = []
    const lifecycle: TurnActivityEvent[] = []
    const runtime = await createTelemetryAdapter(
      (event) => toolActivity.push(event),
      (event) => lifecycle.push(event),
    )
    seedProvider([
      { steps: [{ toolCall: { name: 'bakin_exec_test_echo', args: { message: 'observe send' } } }] },
      { steps: [{ text: 'observed send' }] },
    ])
    const turnActivity: ChatChunk[] = []

    const result = await runtime.messaging.send({
      agentId: 'main',
      content: 'use the tool',
      threadId: 'task:tool-telemetry-send:d1',
      onActivity: (chunk) => turnActivity.push(chunk),
    })

    expect(result.content).toBe('observed send')
    expect(toolActivity).toHaveLength(2)
    expect(toolActivity[0]).toMatchObject({
      agentId: 'main',
      threadId: 'task:tool-telemetry-send:d1',
      phase: 'call',
      callId: expect.any(String),
      toolName: 'bakin_exec_test_echo',
      status: 'running',
      turnId: lifecycle[0]!.turnId,
    })
    const resultDurationMs = requireToolResult(toolActivity[1]).durationMs
    expect(typeof resultDurationMs).toBe('number')
    expect(resultDurationMs!).toBeGreaterThanOrEqual(0)
    expect(toolActivity[1]).toMatchObject({
      agentId: 'main',
      threadId: 'task:tool-telemetry-send:d1',
      turnId: lifecycle[0]!.turnId,
      phase: 'result',
      callId: toolActivity[0]!.callId,
      toolName: 'bakin_exec_test_echo',
      status: 'completed',
    })
    expect(turnActivity.filter((chunk) => chunk.type === 'tool')).toHaveLength(2)
  })

  test('adapter-level onToolActivity observes stream tool calls', async () => {
    const toolActivity: ToolActivityEvent[] = []
    const lifecycle: TurnActivityEvent[] = []
    const runtime = await createTelemetryAdapter(
      (event) => toolActivity.push(event),
      (event) => lifecycle.push(event),
    )
    seedProvider([
      { steps: [{ toolCall: { name: 'bakin_exec_test_echo', args: { message: 'observe stream' } } }] },
      { steps: [{ text: 'observed stream' }] },
    ])

    const chunks: ChatChunk[] = []
    for await (const chunk of runtime.messaging.stream({
      agentId: 'main',
      content: 'use the tool',
      threadId: 'chat:tool-telemetry-stream',
      activityClass: 'system',
    })) {
      chunks.push(chunk)
    }

    expect(chunks.at(-1)?.type).toBe('done')
    expect(toolActivity.map((event) => event.phase)).toEqual(['call', 'result'])
    expect(toolActivity[0]).toMatchObject({
      agentId: 'main',
      threadId: 'chat:tool-telemetry-stream',
      activityClass: 'system',
      toolName: 'bakin_exec_test_echo',
      status: 'running',
      turnId: lifecycle[0]!.turnId,
    })
    const resultDurationMs = requireToolResult(toolActivity[1]).durationMs
    expect(typeof resultDurationMs).toBe('number')
    expect(resultDurationMs!).toBeGreaterThanOrEqual(0)
    expect(toolActivity[1]).toMatchObject({
      agentId: 'main',
      threadId: 'chat:tool-telemetry-stream',
      turnId: lifecycle[0]!.turnId,
      activityClass: 'system',
      toolName: 'bakin_exec_test_echo',
      status: 'completed',
    })
  })

  test('a throwing adapter-level onToolActivity callback never fails a turn', async () => {
    let calls = 0
    const runtime = await createTelemetryAdapter(() => {
      calls += 1
      throw new Error('tool telemetry exploded')
    })
    seedProvider([
      { steps: [{ toolCall: { name: 'bakin_exec_test_echo', args: { message: 'still run' } } }] },
      { steps: [{ text: 'still fine' }] },
    ])

    const result = await runtime.messaging.send({
      agentId: 'main',
      content: 'use the tool',
      threadId: 'task:tool-telemetry-throw:d1',
    })

    expect(result.content).toBe('still fine')
    expect(calls).toBe(2)
  })

  test('provider 429 maps to provider_cooldown', async () => {
    // One seed only: with provider retries disabled exactly one request
    // fires; a residual retry would hit the empty-queue 500 and fail loudly.
    seedProvider([
      { status: 429, errorBody: { error: { message: 'rate limited, slow down' } } },
    ])
    try {
      await adapter.messaging.send({ agentId: 'main', content: 'hi' })
      throw new Error('expected send to reject')
    } catch (err) {
      expect((err as RuntimeError).kind).toBe('provider_cooldown')
    }
  }, 30_000)

  test('abort mid-turn settles kind aborted', async () => {
    seedProvider([
      { steps: [{ text: 'slow ' }, { delayMs: 3_000, text: 'never delivered' }] },
    ])
    const controller = new AbortController()
    const pending = adapter.messaging.send({ agentId: 'main', content: 'hi', signal: controller.signal })
    setTimeout(() => controller.abort(), 250)
    try {
      await pending
      throw new Error('expected send to reject')
    } catch (err) {
      expect((err as RuntimeError).kind).toBe('aborted')
    }
  }, 15_000)

  test('unknown agent is a typed runtime_failed', async () => {
    try {
      await adapter.messaging.send({ agentId: 'ghost', content: 'hi' })
      throw new Error('expected send to reject')
    } catch (err) {
      expect((err as RuntimeError).kind).toBe('runtime_failed')
    }
  })
})

describe('messaging.stream', () => {
  test.each([
    ['completed', 'main', undefined],
    ['failed', 'ghost', undefined],
    ['aborted', 'main', AbortSignal.abort()],
  ] as const)('adapter-level turn lifecycle reports stream %s exactly once', async (status, agentId, signal) => {
    const activity: TurnActivityEvent[] = []
    const runtime = await createTurnTelemetryAdapter((event) => activity.push(event))
    if (status === 'completed') seedProvider([{ steps: [{ text: 'stream observed' }] }])

    const chunks: ChatChunk[] = []
    for await (const chunk of runtime.messaging.stream({
      agentId,
      content: 'go',
      threadId: `chat:turn-lifecycle-stream-${status}`,
      activityClass: 'routine',
      signal,
    })) {
      chunks.push(chunk)
    }

    expect(chunks.at(-1)?.type).toBe(status === 'failed' ? 'error' : 'done')
    expect(activity.map((event) => event.phase)).toEqual(['start', 'result'])
    expect(activity[0]).toMatchObject({
      agentId,
      activityClass: 'routine',
      operation: 'stream',
      status: 'running',
    })
    expect(activity[1]).toMatchObject({
      operation: 'stream',
      status,
      turnId: activity[0]!.turnId,
      durationMs: expect.any(Number),
    })
  })

  test('a throwing adapter-level turn observer never fails stream', async () => {
    let calls = 0
    const runtime = await createTurnTelemetryAdapter(() => {
      calls += 1
      throw new Error('turn observer exploded')
    })
    seedProvider([{ steps: [{ text: 'still streams' }] }])

    const chunks = []
    for await (const chunk of runtime.messaging.stream({ agentId: 'main', content: 'go' })) chunks.push(chunk)

    expect(chunks.at(-1)?.type).toBe('done')
    expect(calls).toBe(2)
  })

  test('ordered chunks: status/text/tool → done', async () => {
    invocations.length = 0
    seedProvider([
      { steps: [{ toolCall: { name: 'bakin_exec_test_echo', args: { message: 'streamed' } } }] },
      { steps: [{ text: 'after tool' }] },
    ])
    const chunks: ChatChunk[] = []
    for await (const chunk of adapter.messaging.stream({ agentId: 'main', content: 'go', threadId: 'chat:stream-1' })) {
      chunks.push(chunk)
    }
    const kinds = chunks.map((c) => c.type)
    expect(kinds.at(-1)).toBe('done')
    expect(kinds).toContain('tool')
    expect(kinds).toContain('text')
    const toolPhases = chunks.filter((c) => c.type === 'tool').map((c) => (c.data as { phase: string }).phase)
    expect(toolPhases).toEqual(['call', 'result'])
    const text = chunks.filter((c) => c.type === 'text').map((c) => c.content).join('')
    expect(text).toBe('after tool')

    // Tool result summary is a clean one-liner (#608), not the escaped
    // {content:[{type:text,text:"{...}"}]} envelope dump.
    const resultChunk = chunks.find((c) => c.type === 'tool' && (c.data as { phase: string }).phase === 'result')
    const summary = (resultChunk!.data as { summary?: string }).summary ?? ''
    expect(summary).toContain('streamed')
    expect(summary).not.toContain('"content"')
    expect(summary).not.toContain('\\n')
  })

  test('provider failure surfaces as an error chunk carrying the typed kind, never a throw from iteration', async () => {
    seedProvider([
      { status: 500, errorBody: { error: { message: 'exploded' } } },
    ])
    const chunks: ChatChunk[] = []
    for await (const chunk of adapter.messaging.stream({ agentId: 'main', content: 'go' })) {
      chunks.push(chunk)
    }
    const last = chunks.at(-1)
    expect(last?.type).toBe('error')
    // R5: the error chunk carries the RuntimeError kind so consumers can
    // classify without parsing message text.
    const kind = (last?.data as { kind?: string } | undefined)?.kind
    expect(typeof kind).toBe('string')
    expect(kind!.length).toBeGreaterThan(0)
    // No done after a terminal error.
    expect(chunks.filter((c) => c.type === 'done')).toHaveLength(0)
  }, 30_000)

  test('deliberate abort ends the stream with a clean done, never an error chunk', async () => {
    seedProvider([
      { steps: [{ text: 'slow ' }, { delayMs: 3_000, text: 'never delivered' }] },
    ])
    const controller = new AbortController()
    const chunks: ChatChunk[] = []
    setTimeout(() => controller.abort(), 250)
    for await (const chunk of adapter.messaging.stream({
      agentId: 'main',
      content: 'go',
      signal: controller.signal,
    })) {
      chunks.push(chunk)
    }
    // Contract: abort is a clean end (matching the send path's
    // kind:'aborted' settle) — done last, no error chunk.
    expect(chunks.at(-1)?.type).toBe('done')
    expect(chunks.filter((c) => c.type === 'done')).toHaveLength(1)
    expect(chunks.some((c) => c.type === 'error')).toBe(false)
  }, 15_000)

  test('R5/R5b taxonomy: classified chunks only, done exactly once and last, structured tool data', async () => {
    invocations.length = 0
    seedProvider([
      { steps: [{ text: 'thinking about it. ' }, { toolCall: { name: 'bakin_exec_test_echo', args: { message: 'taxo' } } }] },
      { steps: [{ text: 'all done' }] },
    ])
    const chunks: ChatChunk[] = []
    for await (const chunk of adapter.messaging.stream({ agentId: 'main', content: 'go', threadId: 'chat:taxo-1' })) {
      chunks.push(chunk)
    }
    const allowed = new Set(['text', 'tool', 'status', 'done', 'error'])
    for (const c of chunks) expect(allowed.has(c.type)).toBe(true)
    // done exactly once, always last, nothing after it.
    expect(chunks.filter((c) => c.type === 'done')).toHaveLength(1)
    expect(chunks.at(-1)?.type).toBe('done')
    // Tool chunks carry structured RuntimeToolActivity — never a raw dump.
    const tools = chunks.filter((c) => c.type === 'tool')
    expect(tools.length).toBeGreaterThan(0)
    for (const t of tools) {
      const data = t.data as { toolName?: string; phase?: string }
      expect(typeof data?.toolName).toBe('string')
      expect(['call', 'result']).toContain(data?.phase ?? '')
    }
    // Text chunks: format hint is absent (markdown default) or a known value.
    for (const c of chunks.filter((x) => x.type === 'text')) {
      const format = (c as { format?: string }).format
      expect([undefined, 'markdown', 'plain', 'code']).toContain(format)
      expect(typeof c.content).toBe('string')
    }
  })
})

describe('sessions surface', () => {
  test('sessions.list surfaces persisted sessions with store stats', async () => {
    const sessions = await adapter.sessions.list('main')
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions[0].agentId).toBe('main')
    expect(existsSync(String(sessions[0].metadata?.path))).toBe(true)

    const stats = await adapter.sessions.storeStats!()
    const main = stats.find((s) => s.agentId === 'main')
    expect(main!.storeEntries).toBeGreaterThan(0)
    expect(main!.diskBytes).toBeGreaterThan(0)
  })
})
