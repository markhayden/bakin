/**
 * Chat plugin — stream bridge tests (C3).
 * runtime.messaging.stream is mocked with scripted chunk generators; the
 * bridge must persist durable rows, emit chat.chunk/done/error on the
 * event bus, and enforce one in-flight turn per chat.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-chat-stream-${Date.now()}`)

function testPaths() {
  return {
    home: testDir,
    memoryLog: join(testDir, 'MEMORY-LOG.md'),
    audit: join(testDir, 'audit.jsonl'),
    assets: join(testDir, 'assets'),
    'assets.store': join(testDir, 'assets', 'store'),
    'assets.inbox': join(testDir, 'assets', 'inbox'),
    'assets.trash': join(testDir, 'assets', '.trash'),
    agents: join(testDir, 'agents'),
    personas: join(testDir, 'team', 'personas'),
    team: join(testDir, 'team'),
    heartbeats: join(testDir, 'heartbeats'),
    inbox: join(testDir, 'inbox'),
    tasks: join(testDir, 'tasks'),
    workflows: join(testDir, 'workflows'),
    chat: join(testDir, 'chat'),
    settings: join(testDir, 'settings.json'),
    logs: join(testDir, 'logs'),
    antfly: join(testDir, 'antfly'),
    db: join(testDir, 'bakin.db'),
  }
}

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: testPaths,
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

// Capture metering (T2.2): chat turns are attributed run_costs rows now —
// mocked so the test never touches the real ledger.
const meteredTurns: Array<Record<string, unknown>> = []
mock.module('../../../src/core/agent-cost', () => ({
  meterAgentTurn: async (opts: Record<string, unknown>) => { meteredTurns.push(opts) },
  meterImageTurn: async () => {},
}))

import chatPlugin from '../../../plugins/chat'
import { createChat, readTranscript } from '../../../plugins/chat/lib/store'
import { abortChatTurn, isTurnInFlight, startChatTurn, waitForTurn } from '../../../plugins/chat/lib/stream-bridge'
import { activatePlugin, callRoute, findRoute, type ActivatedPlugin } from '../test-helpers'
import type { ChatChunk, MessageArgs } from '../../../packages/core/src/adapters/runtime/concepts'

let activated: ActivatedPlugin

function scriptStream(script: () => AsyncIterable<ChatChunk>, capture?: MessageArgs[]) {
  activated.ctx.runtime.messaging.stream = ((args: MessageArgs) => {
    capture?.push(args)
    return script()
  }) as typeof activated.ctx.runtime.messaging.stream
}

beforeAll(async () => {
  activated = await activatePlugin(chatPlugin, testDir)
  await activated.ctx.runtime.agents.create({ id: 'main', name: 'Main' })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('chat stream bridge', () => {
  test('summary-less result chunks reuse the call summary (live chips and durable rows)', async () => {
    // OpenClaw trajectory result records carry no summary — without callId
    // reuse, durable tool rows degrade back to bare tool names (the P5.3
    // "IT STILL SAYS JUST BASH" bug).
    const chat = await createChat({ agentId: 'main' })
    scriptStream(async function* () {
      yield { type: 'tool', data: { phase: 'call', callId: 'c1', toolName: 'bash', summary: 'curl -s https://example.com' } } as ChatChunk
      yield { type: 'tool', data: { phase: 'result', callId: 'c1', toolName: 'bash', status: 'completed' } } as ChatChunk
      yield { type: 'text', content: 'done' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    }, [])

    expect(await startChatTurn(activated.ctx, chat.id, 'fetch it')).toBe('accepted')
    await waitForTurn(chat.id)

    const rows = readTranscript(chat.id)
    const toolRow = rows.find((r) => r.kind === 'tool')
    expect(toolRow).toMatchObject({
      toolName: 'bash',
      status: 'completed',
      summary: 'curl -s https://example.com',
      callId: 'c1',
    })
    expect((toolRow as { turnId?: string }).turnId).toBeTruthy()
  })

  test('happy path: chunks broadcast in order, durable rows persisted, chat.done emitted', async () => {
    const chat = await createChat({ agentId: 'main' })
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const off = activated.ctx.events.on('chat.*', (event, data) => events.push({ event, data }))

    const seenArgs: MessageArgs[] = []
    scriptStream(async function* () {
      yield { type: 'status', content: 'thinking' } as ChatChunk
      yield { type: 'text', content: 'Hello ' } as ChatChunk
      yield { type: 'tool', data: { phase: 'call', toolName: 'bash' } } as ChatChunk
      yield { type: 'tool', data: { phase: 'result', toolName: 'bash', summary: 'ls -la' } } as ChatChunk
      yield { type: 'text', content: 'world' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    }, seenArgs)

    expect(await startChatTurn(activated.ctx, chat.id, 'hi')).toBe('accepted')
    await waitForTurn(chat.id)
    off()

    // threadId contract: chat:<chatId>
    expect(seenArgs[0]?.threadId).toBe(`chat:${chat.id}`)
    expect(seenArgs[0]?.agentId).toBe('main')
    // Every turn carries the delivery framing (runtime-only); the persisted
    // transcript keeps the user's clean text.
    expect(seenArgs[0]?.content).toContain('hi')
    expect(seenArgs[0]?.content).toContain('Bakin chat turn')
    const userRow = readTranscript(chat.id).find((r) => r.kind === 'user')
    if (userRow?.kind !== 'user') throw new Error('expected user row')
    expect(userRow.content).toBe('hi')

    // SSE: text/tool/status chunks relayed on chat.chunk (done/error ride
    // their dedicated events — the wire matches the declared ChatChunkEvent
    // union), then chat.done closes the turn.
    const chunkEvents = events.filter((e) => e.event === 'chat.chunk')
    expect(chunkEvents.length).toBe(5)
    const wireTypes = chunkEvents.map((e) => (e.data.chunk as { type: string }).type)
    expect(wireTypes.every((t) => t === 'text' || t === 'tool' || t === 'status')).toBe(true)

    // chat.done carries agentId + a reply preview for the attention system.
    const done = events.at(-1)
    expect(done?.event).toBe('chat.done')
    expect(done?.data).toMatchObject({ chatId: chat.id, agentId: 'main', preview: 'Hello world' })

    // Durable transcript v2: interleaving preserved — text before the tool
    // result flushes as its own row, structured tool row, trailing text.
    const rows = readTranscript(chat.id)
    expect(rows.map((r) => r.kind)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    expect(rows[1]).toMatchObject({ content: 'Hello ' })
    expect(rows[2]).toMatchObject({ toolName: 'bash', status: 'completed', summary: 'ls -la' })
    expect(rows[3]).toMatchObject({ content: 'world' })
    // rows of one turn share a turnId so replay regroups exactly
    const turnIds = rows.slice(1).map((r) => (r as { turnId?: string }).turnId)
    expect(new Set(turnIds).size).toBe(1)
    expect(turnIds[0]).toBeTruthy()
  })

  test("chat turns are metered: done usage → meterAgentTurn with workClass 'chat'", async () => {
    const chat = await createChat({ agentId: 'main' })
    meteredTurns.length = 0
    scriptStream(async function* () {
      yield { type: 'text', content: 'reply' } as ChatChunk
      yield { type: 'done', usage: { input: 120, output: 30, total: 150, model: 'anthropic/claude-haiku-4-5' } } as ChatChunk
    })

    expect(await startChatTurn(activated.ctx, chat.id, 'meter me')).toBe('accepted')
    await waitForTurn(chat.id)

    // Scope to the chat-class entry — the chained auto-title may also meter.
    const chatMeters = meteredTurns.filter((t) => t.workClass === 'chat')
    expect(chatMeters.length).toBe(1)
    const m = chatMeters[0]
    expect(m).toMatchObject({ agent: 'main', activityClass: 'user', workClass: 'chat' })
    expect(String(m.runId)).toStartWith(`chat:${chat.id}:turn:`)
    expect((m.result as { usage?: { total?: number } }).usage?.total).toBe(150)
  })

  test('a done chunk with no usage still meters the run (tokens unknown, never $0)', async () => {
    const chat = await createChat({ agentId: 'main' })
    meteredTurns.length = 0
    scriptStream(async function* () {
      yield { type: 'text', content: 'no usage here' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })
    expect(await startChatTurn(activated.ctx, chat.id, 'meter me anyway')).toBe('accepted')
    await waitForTurn(chat.id)
    const chatMeters = meteredTurns.filter((t) => t.workClass === 'chat')
    expect(chatMeters.length).toBe(1)
    expect((chatMeters[0].result as { usage?: unknown }).usage).toBeUndefined()
  })

  test('abort: stream cancels, partial text kept, aborted row persisted, chat.done carries aborted', async () => {
    const chat = await createChat({ agentId: 'main' })
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const off = activated.ctx.events.on('chat.*', (event, data) => events.push({ event, data }))

    const seenArgs: MessageArgs[] = []
    scriptStream(async function* () {
      yield { type: 'text', content: 'partial thought' } as ChatChunk
      // Mimic the adapter contract: a deliberate abort ends the stream with
      // a clean done once the signal fires.
      const signal = seenArgs[0]?.signal
      await new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve()
        signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      yield { type: 'done' } as ChatChunk
    }, seenArgs)

    expect(await startChatTurn(activated.ctx, chat.id, 'go long')).toBe('accepted')
    // Give the generator a beat to yield the first chunk, then abort.
    await new Promise((r) => setTimeout(r, 10))
    expect(abortChatTurn(chat.id)).toBe(true)
    await waitForTurn(chat.id)
    off()

    const done = events.find((e) => e.event === 'chat.done')
    expect(done?.data).toMatchObject({ chatId: chat.id, aborted: true })

    const rows = readTranscript(chat.id)
    expect(rows.map((r) => r.kind)).toEqual(['user', 'assistant', 'aborted'])
    expect(rows[1]).toMatchObject({ content: 'partial thought' })
  })

  test('stream failure: partial text kept, error row persisted, chat.error emitted', async () => {
    const chat = await createChat({ agentId: 'main' })
    const events: Array<{ event: string }> = []
    const off = activated.ctx.events.on('chat.*', (event) => events.push({ event }))

    scriptStream(async function* () {
      yield { type: 'text', content: 'partial answer' } as ChatChunk
      throw new Error('session died')
    })

    expect(await startChatTurn(activated.ctx, chat.id, 'hi')).toBe('accepted')
    await waitForTurn(chat.id)
    off()

    expect(events.at(-1)?.event).toBe('chat.error')
    const rows = readTranscript(chat.id)
    expect(rows.map((r) => r.kind)).toEqual(['user', 'assistant', 'error'])
    expect(rows[1]).toMatchObject({ content: 'partial answer' })
    expect(rows[2]).toMatchObject({ message: 'session died' })
  })

  test('error chunk with a typed kind: kind preserved on chat.error and the durable row', async () => {
    const chat = await createChat({ agentId: 'main' })
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const off = activated.ctx.events.on('chat.*', (event, data) => events.push({ event, data }))

    scriptStream(async function* () {
      yield { type: 'text', content: 'part' } as ChatChunk
      yield { type: 'error', content: 'session died', data: { kind: 'session_died' } } as ChatChunk
    })

    expect(await startChatTurn(activated.ctx, chat.id, 'hi')).toBe('accepted')
    await waitForTurn(chat.id)
    off()

    // The typed kind the adapter provided survives to both surfaces —
    // consumers classify without parsing message text.
    const errorEvent = events.find((e) => e.event === 'chat.error')
    expect(errorEvent?.data).toMatchObject({ message: 'session died', kind: 'session_died' })
    // Error chunks never ride chat.chunk (the wire matches ChatChunkEvent).
    const wireTypes = events
      .filter((e) => e.event === 'chat.chunk')
      .map((e) => (e.data.chunk as { type: string }).type)
    expect(wireTypes).toEqual(['text'])
    const rows = readTranscript(chat.id)
    expect(rows.at(-1)).toMatchObject({ kind: 'error', message: 'session died', errorKind: 'session_died' })
  })

  test('resolveActiveTurnForAgent binds tools to the agent\'s current chat turn', async () => {
    const { resolveActiveTurnForAgent } = await import('../../../plugins/chat/lib/stream-bridge')
    const chat = await createChat({ agentId: 'main' })
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    scriptStream(async function* () {
      yield { type: 'text', content: 'working' } as ChatChunk
      await gate
      yield { type: 'done' } as ChatChunk
    })

    expect(resolveActiveTurnForAgent('main')).toBeNull()
    await startChatTurn(activated.ctx, chat.id, 'go')
    expect(resolveActiveTurnForAgent('main')).toMatchObject({ chatId: chat.id })
    expect(typeof resolveActiveTurnForAgent('main')?.turnId).toBe('string')
    expect(resolveActiveTurnForAgent('someone-else')).toBeNull()
    release()
    await waitForTurn(chat.id)
    expect(resolveActiveTurnForAgent('main')).toBeNull()
  })

  test('TOCTOU: two CONCURRENT sends — exactly one wins the busy slot', async () => {
    const chat = await createChat({ agentId: 'main' })
    let starts = 0
    scriptStream(async function* () {
      starts++
      yield { type: 'text', content: 'only once' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })
    // Fire both before either awaits — the old check-then-await guard let
    // both through (review finding).
    const [a, b] = await Promise.all([
      startChatTurn(activated.ctx, chat.id, 'first'),
      startChatTurn(activated.ctx, chat.id, 'second'),
    ])
    expect([a, b].sort()).toEqual(['accepted', 'busy'])
    await waitForTurn(chat.id)
    expect(starts).toBe(1)
  })

  test('one in-flight turn per chat: a second send QUEUES (202) — the 409 contract was retired by #729', async () => {
    // DELIBERATE wire-contract change (spec chat-queue-and-followups D7/T3):
    // busy no longer rejects; the message queues and drains after settle.
    // tests/plugins/chat/queue.test.ts owns the full queue behavior.
    const chat = await createChat({ agentId: 'main' })
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })

    scriptStream(async function* () {
      yield { type: 'text', content: 'slow' } as ChatChunk
      await gate
      yield { type: 'done' } as ChatChunk
    })

    expect(await startChatTurn(activated.ctx, chat.id, 'first')).toBe('accepted')

    const send = findRoute(activated.routes, 'POST', '/chats/:chatId/messages')!
    const busy = await callRoute(send, activated.ctx, { path: `/chats/${chat.id}/messages`, body: { content: 'second' } })
    expect(busy.status).toBe(202)
    expect(busy.body).toMatchObject({ queued: true, queueLength: 1 })

    release()
    await waitForTurn(chat.id)
    // Drained turn (the queued 'second') settles too.
    await waitForTurn(chat.id)
    for (let i = 0; i < 200 && isTurnInFlight(chat.id); i++) await new Promise((r) => setTimeout(r, 2))

    const done = await callRoute(send, activated.ctx, { path: `/chats/${chat.id}/messages`, body: { content: 'third' } })
    expect(done.status).toBe(202)
    expect(done.body.queued).toBeUndefined()
    await waitForTurn(chat.id)
  })

  test('unknown chat: 404 through the route', async () => {
    const send = findRoute(activated.routes, 'POST', '/chats/:chatId/messages')!
    const res = await callRoute(send, activated.ctx, {
      path: '/chats/00000000-0000-0000-0000-000000000000/messages',
      body: { content: 'hello?' },
    })
    expect(res.status).toBe(404)
  })
})
