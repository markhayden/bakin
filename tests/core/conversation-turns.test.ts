/**
 * Conversation turn service (engine) tests — #703.
 *
 * The engine is the generalization of chat's stream bridge; these tests
 * mirror tests/plugins/chat/stream.test.ts shapes against a mock consumer
 * and pin every load-bearing semantic the extraction must preserve
 * (TOCTOU slot reservation, incremental persistence, abort/error rows,
 * metering rules, settle ordering, chunk-event membership).
 */
import { describe, test, expect, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-conversation-turns-${Date.now()}-${randomUUID()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import type {
  ConversationTurnRow,
  ConversationTurnServiceConfig,
  TurnContext,
  TurnOutcome,
} from '../../src/core/conversation-turns'
import type { ChatChunk, MessageArgs } from '../../packages/core/src/adapters/runtime/concepts'

// Dynamic import AFTER the mock.module calls — a hoisted static import would
// bind the engine's module-level logger to the real one before the mock lands.
const { createConversationTurnService } = await import('../../src/core/conversation-turns')

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

interface Harness {
  ctx: TurnContext
  events: Array<{ event: string; data: Record<string, unknown> }>
  rows: Map<string, ConversationTurnRow[]>
  seenArgs: MessageArgs[]
  setStream: (script: () => AsyncIterable<ChatChunk>) => void
}

function makeHarness(): Harness {
  const events: Harness['events'] = []
  const rows = new Map<string, ConversationTurnRow[]>()
  const seenArgs: MessageArgs[] = []
  let script: () => AsyncIterable<ChatChunk> = async function* () {
    yield { type: 'done' } as ChatChunk
  }
  const ctx = {
    events: {
      emit: (event: string, data?: Record<string, unknown>) => {
        events.push({ event, data: data ?? {} })
      },
      on: () => () => {},
      once: () => () => {},
    },
    runtime: {
      messaging: {
        stream: (args: MessageArgs) => {
          seenArgs.push(args)
          return script()
        },
      },
    },
  } as unknown as TurnContext
  return { ctx, events, rows, seenArgs, setStream: (s) => { script = s } }
}

function makeService(
  h: Harness,
  overrides?: Partial<ConversationTurnServiceConfig>,
) {
  return createConversationTurnService({
    name: 'test',
    events: { chunk: 'test.chunk', done: 'test.done', error: 'test.error' },
    payload: (key) => ({ threadKey: key }),
    resolveThread: (key) => (key.startsWith('missing') ? null : { agentId: 'main' }),
    appendRow: (key, row) => {
      const list = h.rows.get(key) ?? []
      list.push(row)
      h.rows.set(key, list)
    },
    threadId: (key) => `test:${key}`,
    ...overrides,
  })
}

describe('conversation turn service', () => {
  test('happy path: liveness chunks ride the chunk event, rows persist incrementally, done carries preview', async () => {
    const h = makeHarness()
    const service = makeService(h, {
      hooks: {
        meter: (info) => { metered.push(info) },
      },
    })
    const metered: Array<Record<string, unknown>> = []
    h.setStream(async function* () {
      yield { type: 'status', content: 'thinking' } as ChatChunk
      yield { type: 'text', content: 'Hello ' } as ChatChunk
      yield { type: 'tool', data: { phase: 'call', callId: 'c1', toolName: 'bash', summary: 'ls' } } as ChatChunk
      yield { type: 'tool', data: { phase: 'result', callId: 'c1', toolName: 'bash', status: 'completed' } } as ChatChunk
      yield { type: 'text', content: 'world\nsecond line' } as ChatChunk
      yield { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } } as ChatChunk
    })

    expect(await service.start(h.ctx, 't1', 'hi there')).toBe('accepted')
    await service.waitFor('t1')

    // Chunk events: only text/tool/status, with the consumer payload base.
    const chunkEvents = h.events.filter((e) => e.event === 'test.chunk')
    expect(chunkEvents.map((e) => (e.data.chunk as { type: string }).type)).toEqual([
      'status', 'text', 'tool', 'tool', 'text',
    ])
    for (const e of chunkEvents) {
      expect(e.data.threadKey).toBe('t1')
      expect(e.data.agentId).toBe('main')
    }

    // Done event: payload base + preview (first line only).
    const done = h.events.find((e) => e.event === 'test.done')
    expect(done?.data).toMatchObject({ threadKey: 't1', agentId: 'main', preview: 'Hello world' })
    expect(done?.data.aborted).toBeUndefined()

    // Durable rows: user first, tool row with call-phase summary reuse,
    // one assistant row per flush.
    const rows = h.rows.get('t1') ?? []
    expect(rows[0]).toMatchObject({ kind: 'user', content: 'hi there' })
    const toolRow = rows.find((r) => r.kind === 'tool')
    expect(toolRow).toMatchObject({ toolName: 'bash', status: 'completed', summary: 'ls', callId: 'c1' })
    const assistantText = rows.filter((r) => r.kind === 'assistant').map((r) => (r as { content: string }).content).join('')
    expect(assistantText).toBe('Hello world\nsecond line')

    // Metering: once, with the done chunk's usage.
    expect(metered).toHaveLength(1)
    expect(metered[0]).toMatchObject({ key: 't1', agentId: 'main', usage: { inputTokens: 10, outputTokens: 5 } })
    expect(typeof metered[0].turnId).toBe('string')
  })

  test('framing is appended to the runtime content but never persisted; absent framing sends content verbatim', async () => {
    const h = makeHarness()
    const framed = makeService(h, { framing: '[framing block]' })
    expect(await framed.start(h.ctx, 't-framed', 'question')).toBe('accepted')
    await framed.waitFor('t-framed')
    expect(h.seenArgs[0].content).toBe('question\n\n[framing block]')
    expect(h.seenArgs[0].threadId).toBe('test:t-framed')
    expect((h.rows.get('t-framed') ?? [])[0]).toMatchObject({ kind: 'user', content: 'question' })

    const bare = makeService(h)
    expect(await bare.start(h.ctx, 't-bare', 'question')).toBe('accepted')
    await bare.waitFor('t-bare')
    expect(h.seenArgs[1].content).toBe('question')
  })

  test('TOCTOU: two concurrent sends — exactly one wins the slot', async () => {
    const h = makeHarness()
    const service = makeService(h)
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    h.setStream(async function* () {
      await gate
      yield { type: 'done' } as ChatChunk
    })

    const [a, b] = await Promise.all([
      service.start(h.ctx, 't2', 'first'),
      service.start(h.ctx, 't2', 'second'),
    ])
    expect([a, b].sort()).toEqual(['accepted', 'busy'])
    release()
    await service.waitFor('t2')
    // Exactly one user row — the loser never appended.
    expect((h.rows.get('t2') ?? []).filter((r) => r.kind === 'user')).toHaveLength(1)
  })

  test('one in-flight turn per key: busy while streaming, accepted again after settle', async () => {
    const h = makeHarness()
    const service = makeService(h)
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    h.setStream(async function* () {
      await gate
      yield { type: 'done' } as ChatChunk
    })

    expect(await service.start(h.ctx, 't3', 'go')).toBe('accepted')
    expect(service.isInFlight('t3')).toBe(true)
    expect(await service.start(h.ctx, 't3', 'again')).toBe('busy')
    release()
    await service.waitFor('t3')
    expect(service.isInFlight('t3')).toBe(false)
    expect(await service.start(h.ctx, 't3', 'again')).toBe('accepted')
    await service.waitFor('t3')
  })

  test('unknown thread → not_found; user-row append failure releases the slot and reports not_found', async () => {
    const h = makeHarness()
    const service = makeService(h)
    expect(await service.start(h.ctx, 'missing-1', 'hi')).toBe('not_found')

    let failFirstAppend = true
    const failing = makeService(h, {
      appendRow: (key, row) => {
        if (failFirstAppend) { failFirstAppend = false; throw new Error('store gone') }
        const list = h.rows.get(key) ?? []
        list.push(row)
        h.rows.set(key, list)
      },
    })
    expect(await failing.start(h.ctx, 't4', 'hi')).toBe('not_found')
    expect(failing.isInFlight('t4')).toBe(false)
    // Slot was released — the next send goes through.
    expect(await failing.start(h.ctx, 't4', 'hi again')).toBe('accepted')
    await failing.waitFor('t4')
  })

  test('abort: partial reply persists, aborted marker row lands, done carries aborted:true, metering still runs', async () => {
    const h = makeHarness()
    const metered: Array<Record<string, unknown>> = []
    const service = makeService(h, { hooks: { meter: (info) => { metered.push(info) } } })
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    let streamSignal: AbortSignal | undefined
    h.setStream(async function* () {
      streamSignal = h.seenArgs[h.seenArgs.length - 1].signal
      yield { type: 'text', content: 'partial reply' } as ChatChunk
      await gate
      // Deliberate abort ends the runtime stream with a clean done.
      yield { type: 'done' } as ChatChunk
    })

    expect(await service.start(h.ctx, 't5', 'go')).toBe('accepted')
    expect(service.abort('t5')).toBe(true)
    expect(streamSignal?.aborted ?? true).toBe(true)
    release()
    await service.waitFor('t5')

    const rows = h.rows.get('t5') ?? []
    expect(rows.find((r) => r.kind === 'assistant')).toMatchObject({ content: 'partial reply' })
    expect(rows[rows.length - 1]?.kind).toBe('aborted')
    const done = h.events.find((e) => e.event === 'test.done')
    expect(done?.data.aborted).toBe(true)
    expect(metered).toHaveLength(1)
    // Idle abort is a no-op.
    expect(service.abort('t5')).toBe(false)
  })

  test('error chunk: typed kind survives to the durable row and the error event; partial text kept; no metering', async () => {
    const h = makeHarness()
    const metered: Array<Record<string, unknown>> = []
    const outcomes: TurnOutcome[] = []
    const service = makeService(h, {
      hooks: {
        meter: (info) => { metered.push(info) },
        onSettled: ({ outcome }) => { outcomes.push(outcome) },
      },
    })
    h.setStream(async function* () {
      yield { type: 'text', content: 'so far so good' } as ChatChunk
      yield { type: 'error', content: 'session died', data: { kind: 'session_lost' } } as ChatChunk
    })

    expect(await service.start(h.ctx, 't6', 'go')).toBe('accepted')
    await service.waitFor('t6')

    const rows = h.rows.get('t6') ?? []
    expect(rows.find((r) => r.kind === 'assistant')).toMatchObject({ content: 'so far so good' })
    expect(rows[rows.length - 1]).toMatchObject({ kind: 'error', message: 'session died', errorKind: 'session_lost' })
    const errorEvent = h.events.find((e) => e.event === 'test.error')
    expect(errorEvent?.data).toMatchObject({ threadKey: 't6', agentId: 'main', message: 'session died', kind: 'session_lost' })
    expect(h.events.find((e) => e.event === 'test.done')).toBeUndefined()
    expect(metered).toHaveLength(0)
    expect(outcomes).toEqual([{ aborted: false, errored: true }])
  })

  test('a stream that throws mid-iteration settles as an error turn (no typed kind)', async () => {
    const h = makeHarness()
    const service = makeService(h)
    h.setStream(async function* () {
      yield { type: 'text', content: 'partial' } as ChatChunk
      throw new Error('socket torn')
    })
    expect(await service.start(h.ctx, 't7', 'go')).toBe('accepted')
    await service.waitFor('t7')
    const rows = h.rows.get('t7') ?? []
    expect(rows[rows.length - 1]).toMatchObject({ kind: 'error', message: 'socket torn' })
    expect((rows[rows.length - 1] as { errorKind?: string }).errorKind).toBeUndefined()
  })

  test('slot releases BEFORE onSettled runs; waitFor resolves only after onSettled completes', async () => {
    const h = makeHarness()
    let inFlightDuringSettle: boolean | undefined
    let settledDone = false
    const service = makeService(h, {
      hooks: {
        onSettled: async ({ key }) => {
          inFlightDuringSettle = service.isInFlight(key)
          await new Promise((r) => setTimeout(r, 10))
          settledDone = true
        },
      },
    })
    expect(await service.start(h.ctx, 't8', 'go')).toBe('accepted')
    await service.waitFor('t8')
    expect(inFlightDuringSettle).toBe(false)
    expect(settledDone).toBe(true)
  })

  test('onChunk taps every chunk including done, and a throwing tap never kills the turn', async () => {
    const h = makeHarness()
    const tapped: string[] = []
    const service = makeService(h, {
      hooks: {
        onChunk: (_key, chunk) => {
          tapped.push(chunk.type)
          throw new Error('bad tap')
        },
      },
    })
    h.setStream(async function* () {
      yield { type: 'text', content: 'x' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })
    expect(await service.start(h.ctx, 't9', 'go')).toBe('accepted')
    await service.waitFor('t9')
    expect(tapped).toEqual(['text', 'done'])
    expect(h.events.find((e) => e.event === 'test.done')).toBeTruthy()
  })

  test('mid-turn persistence failures never throw into the turn — done still lands', async () => {
    const h = makeHarness()
    let appended = 0
    const service = makeService(h, {
      appendRow: () => {
        appended += 1
        if (appended > 1) throw new Error('disk gone') // user row ok, rest fail
      },
    })
    h.setStream(async function* () {
      yield { type: 'text', content: 'reply' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })
    expect(await service.start(h.ctx, 't10', 'go')).toBe('accepted')
    await service.waitFor('t10')
    expect(h.events.find((e) => e.event === 'test.done')).toBeTruthy()
    expect(h.events.find((e) => e.event === 'test.error')).toBeUndefined()
  })

  test('attachment-only sends carry the visible placeholder and reach the runtime', async () => {
    mkdirSync(testDir, { recursive: true })
    const filePath = join(testDir, 'pic.png')
    writeFileSync(filePath, 'tiny-image-bytes')
    const h = makeHarness()
    const service = makeService(h)
    expect(
      await service.start(h.ctx, 't11', '   ', [{ name: 'pic.png', mimeType: 'image/png', path: filePath }]),
    ).toBe('accepted')
    await service.waitFor('t11')
    const userRow = (h.rows.get('t11') ?? [])[0]
    expect(userRow).toMatchObject({
      kind: 'user',
      content: 'See the attached image.',
      attachments: [{ name: 'pic.png', mimeType: 'image/png', path: filePath }],
    })
    // Small file passes through undownscaled to the runtime call.
    expect(h.seenArgs[0].attachments).toEqual([{ path: filePath, mimeType: 'image/png' }])
  })

  test('listInFlight exposes key/agent/turnId during the turn and empties after settle', async () => {
    const h = makeHarness()
    const service = makeService(h)
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    h.setStream(async function* () {
      await gate
      yield { type: 'done' } as ChatChunk
    })
    expect(await service.start(h.ctx, 't12', 'go')).toBe('accepted')
    const inflight = service.listInFlight()
    expect(inflight).toHaveLength(1)
    expect(inflight[0]).toMatchObject({ key: 't12', agentId: 'main' })
    expect(typeof inflight[0].turnId).toBe('string')
    release()
    await service.waitFor('t12')
    expect(service.listInFlight()).toHaveLength(0)
  })
})
