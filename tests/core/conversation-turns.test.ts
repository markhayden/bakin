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
import { waitUntil } from '../helpers/wait'

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
      describeToolAccess: () => ({ style: 'in-process', perTurnExecToolFiltering: true }),
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
  test('started event fires at accept, before any runtime chunk (#707)', async () => {
    const h = makeHarness()
    let releaseStream!: () => void
    const gate = new Promise<void>((resolve) => { releaseStream = resolve })
    h.setStream(async function* () {
      await gate
      yield { type: 'text', content: 'hi' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })
    const service = makeService(h, {
      events: { chunk: 'test.chunk', done: 'test.done', error: 'test.error', started: 'test.started' },
    })

    expect(await service.start(h.ctx, 't1', 'hello')).toBe('accepted')
    // The stream is gated — no chunk has been produced, yet started is out.
    expect(h.events).toEqual([{ event: 'test.started', data: { threadKey: 't1', agentId: 'main' } }])

    releaseStream()
    await service.waitFor('t1')
    expect(h.events.map((e) => e.event)).toEqual(['test.started', 'test.chunk', 'test.done'])
  })

  test('no started event configured → none emitted (optional wire contract)', async () => {
    const h = makeHarness()
    const service = makeService(h)
    expect(await service.start(h.ctx, 't1', 'hello')).toBe('accepted')
    await service.waitFor('t1')
    expect(h.events.some((e) => e.event.endsWith('.started'))).toBe(false)
  })

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
      await service.start(h.ctx, 't11', '   ', { attachments: [{ name: 'pic.png', mimeType: 'image/png', path: filePath }] }),
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

  test('file-lane: non-image attachments never reach the runtime attachments — they ride as path notes (#742)', async () => {
    mkdirSync(testDir, { recursive: true })
    const imgPath = join(testDir, 'pic.png')
    const pdfPath = join(testDir, 'doc.pdf')
    writeFileSync(imgPath, 'tiny-image-bytes')
    writeFileSync(pdfPath, 'fake-pdf-bytes')
    const h = makeHarness()
    const service = makeService(h)
    expect(
      await service.start(h.ctx, 't30', 'what are these?', {
        attachments: [
          { name: 'pic.png', mimeType: 'image/png', path: imgPath },
          { name: 'doc.pdf', mimeType: 'application/pdf', path: pdfPath },
        ],
      }),
    ).toBe('accepted')
    await service.waitFor('t30')
    // Runtime gets ONLY the raster image as a model attachment…
    expect(h.seenArgs[0].attachments).toEqual([{ path: imgPath, mimeType: 'image/png' }])
    // …and the PDF as a file-lane note pointing at the blessed tool.
    expect(h.seenArgs[0].content).toContain('what are these?')
    expect(h.seenArgs[0].content).toContain(`[file doc.pdf saved at ${pdfPath}`)
    expect(h.seenArgs[0].content).toContain('bakin_exec_pdf_read')
    // The transcript row keeps BOTH attachments (UI fidelity).
    const userRow = (h.rows.get('t30') ?? [])[0]
    expect((userRow as { attachments?: unknown[] }).attachments).toHaveLength(2)
    // The persisted user content stays clean — notes are runtime-only.
    expect((userRow as { content: string }).content).toBe('what are these?')
  })

  test('file-lane: non-PDF files get generic file-tool wording', async () => {
    mkdirSync(testDir, { recursive: true })
    const csvPath = join(testDir, 'data.csv')
    writeFileSync(csvPath, 'a,b\n1,2')
    const h = makeHarness()
    const service = makeService(h)
    await service.start(h.ctx, 't31', 'check this', {
      attachments: [{ name: 'data.csv', mimeType: 'text/csv', path: csvPath }],
    })
    await service.waitFor('t31')
    expect(h.seenArgs[0].attachments).toBeUndefined()
    expect(h.seenArgs[0].content).toContain(`[file data.csv saved at ${csvPath} — open it with your file tools]`)
  })

  test('file-lane: tool reference renders in the active runtime style (mcp)', async () => {
    mkdirSync(testDir, { recursive: true })
    const pdfPath = join(testDir, 'mcp.pdf')
    writeFileSync(pdfPath, 'fake-pdf-bytes')
    const h = makeHarness()
    ;(h.ctx.runtime as unknown as { describeToolAccess: () => unknown }).describeToolAccess = () => ({
      style: 'mcp',
      mcpServerTemplate: 'bakin-<agent>',
      perTurnExecToolFiltering: false,
    })
    const service = makeService(h)
    await service.start(h.ctx, 't32', 'read it', {
      attachments: [{ name: 'mcp.pdf', mimeType: 'application/pdf', path: pdfPath }],
    })
    await service.waitFor('t32')
    expect(h.seenArgs[0].content).toContain('bakin-main.bakin_exec_pdf_read')
  })

  test('attachment-only placeholder is kind-aware: file wording for non-images', async () => {
    mkdirSync(testDir, { recursive: true })
    const pdfPath = join(testDir, 'only.pdf')
    writeFileSync(pdfPath, 'fake-pdf-bytes')
    const h = makeHarness()
    const service = makeService(h)
    await service.start(h.ctx, 't33', '   ', {
      attachments: [{ name: 'only.pdf', mimeType: 'application/pdf', path: pdfPath }],
    })
    await service.waitFor('t33')
    const userRow = (h.rows.get('t33') ?? [])[0]
    expect((userRow as { content: string }).content).toBe('See the attached file.')
  })

  test('per-turn agentId override and runtimeContent: runtime sees both, transcript keeps the clean text', async () => {
    const h = makeHarness()
    const service = makeService(h, { framing: '[never sent when runtimeContent wins]', ephemeral: true })
    expect(
      await service.start(h.ctx, 't13', 'clean question', {
        agentId: 'pixel',
        runtimeContent: '## Doc context\n...\nOperator: clean question',
      }),
    ).toBe('accepted')
    await service.waitFor('t13')
    expect(h.seenArgs[0].agentId).toBe('pixel')
    expect(h.seenArgs[0].content).toBe('## Doc context\n...\nOperator: clean question')
    expect((h.seenArgs[0] as { ephemeral?: boolean }).ephemeral).toBe(true)
    expect((h.rows.get('t13') ?? [])[0]).toMatchObject({ kind: 'user', content: 'clean question' })
    const done = h.events.find((e) => e.event === 'test.done')
    expect(done?.data.agentId).toBe('pixel')
  })

  test('onTurnComplete runs after final persistence and BEFORE the done event; skipped on error turns', async () => {
    const h = makeHarness()
    const order: string[] = []
    const service = makeService(h, {
      appendRow: (key, row) => {
        order.push(`row:${row.kind}`)
        const list = h.rows.get(key) ?? []
        list.push(row)
        h.rows.set(key, list)
      },
      hooks: {
        onTurnComplete: ({ aborted }) => {
          order.push(`complete:${aborted}`)
        },
      },
    })
    h.setStream(async function* () {
      yield { type: 'text', content: 'reply' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })
    h.ctx.events.emit = ((event: string, data?: Record<string, unknown>) => {
      order.push(`event:${event}`)
      h.events.push({ event, data: data ?? {} })
    }) as typeof h.ctx.events.emit

    expect(await service.start(h.ctx, 't14', 'go')).toBe('accepted')
    await service.waitFor('t14')
    expect(order).toEqual(['row:user', 'event:test.chunk', 'row:assistant', 'complete:false', 'event:test.done'])

    // Error turns never run onTurnComplete.
    const completions: boolean[] = []
    const failing = makeService(h, { hooks: { onTurnComplete: ({ aborted }) => { completions.push(aborted) } } })
    h.setStream(async function* () {
      yield { type: 'error', content: 'boom' } as ChatChunk
    })
    expect(await failing.start(h.ctx, 't15', 'go')).toBe('accepted')
    await failing.waitFor('t15')
    expect(completions).toEqual([])
  })

  test('a throwing onSettled never rejects the retained promise — waitFor resolves cleanly', async () => {
    const h = makeHarness()
    const service = makeService(h, {
      hooks: {
        onSettled: async () => {
          throw new Error('settle hook exploded')
        },
      },
    })
    expect(await service.start(h.ctx, 't16', 'go')).toBe('accepted')
    await service.waitFor('t16') // must not throw
    expect(h.events.some((e) => e.event === 'test.done')).toBe(true)
  })

  test('an empty resolved agentId (no override) fails as not_found before reserving', async () => {
    const h = makeHarness()
    const service = makeService(h, { resolveThread: () => ({ agentId: '' }) })
    expect(await service.start(h.ctx, 't17', 'go')).toBe('not_found')
    expect(h.rows.get('t17')).toBeUndefined() // no user row persisted
    expect(service.isInFlight('t17')).toBe(false)
    // Override supplies the agent — accepted.
    expect(await service.start(h.ctx, 't17', 'go', { agentId: 'pixel' })).toBe('accepted')
    await service.waitFor('t17')
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

  test('queueIfBusy without queue config stays busy (strict surfaces unchanged)', async () => {
    const h = makeHarness()
    const service = makeService(h)
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    h.setStream(async function* () {
      await gate
      yield { type: 'done' } as ChatChunk
    })
    expect(await service.start(h.ctx, 'tq0', 'go')).toBe('accepted')
    expect(await service.start(h.ctx, 'tq0', 'follow-up', { queueIfBusy: true })).toBe('busy')
    release()
    await service.waitFor('tq0')
  })

  test('inflightPreview exposes streamed-so-far text mid-turn and null when idle (#706)', async () => {
    const h = makeHarness()
    const service = makeService(h)
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    h.setStream(async function* () {
      yield { type: 'text', content: 'stream so ' } as ChatChunk
      yield { type: 'text', content: 'far' } as ChatChunk
      await gate
      yield { type: 'done' } as ChatChunk
    })
    expect(service.inflightPreview('t18')).toBeNull()
    expect(await service.start(h.ctx, 't18', 'go')).toBe('accepted')
    // Wait for both text chunks to land before peeking.
    for (let i = 0; i < 50 && service.inflightPreview('t18') !== 'stream so far'; i++) {
      await new Promise((r) => setTimeout(r, 2))
    }
    expect(service.inflightPreview('t18')).toBe('stream so far')
    release()
    await service.waitFor('t18')
    expect(service.inflightPreview('t18')).toBeNull()
  })
})

/**
 * Pending queue (#729): opt-in per service config. Messages sent while the
 * slot is busy queue durably (via the persist hook) and drain as ONE
 * combined turn when the active turn settles — done, error, AND abort all
 * drain. The drained turn persists each message as its own user row.
 */
describe('conversation turn service — pending queue', () => {
  /** Queue-enabled service + a per-call stream script queue. */
  function makeQueueHarness(overrides?: Partial<ConversationTurnServiceConfig>) {
    const h = makeHarness()
    const persisted: Array<{ key: string; items: Array<{ id: string; content: string }> }> = []
    const scripts: Array<() => AsyncIterable<ChatChunk>> = []
    h.setStream(() => {
      const next = scripts.shift() ?? (async function* () {
        yield { type: 'done' } as ChatChunk
      })
      return next()
    })
    const service = makeService(h, {
      events: { chunk: 'test.chunk', done: 'test.done', error: 'test.error', started: 'test.started' },
      queue: {
        persist: (key, items) => {
          persisted.push({ key, items: items.map((i) => ({ id: i.id, content: i.content })) })
        },
        event: 'test.queued',
      },
      ...overrides,
    })
    return { h, service, persisted, scripts }
  }

  /** A stream gated on an external release; pushes onto `scripts`. */
  function gatedScript(scripts: Array<() => AsyncIterable<ChatChunk>>, chunks: ChatChunk[] = []) {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    scripts.push(async function* () {
      for (const c of chunks) yield c
      await gate
      yield { type: 'done' } as ChatChunk
    })
    return () => release()
  }

  test('enqueue while busy: queued result, queued event, persisted snapshot, listQueued', async () => {
    const { h, service, persisted, scripts } = makeQueueHarness()
    const release = gatedScript(scripts)
    expect(await service.start(h.ctx, 'q1', 'first')).toBe('accepted')

    expect(await service.start(h.ctx, 'q1', 'follow-up', { queueIfBusy: true })).toMatchObject({ queued: true })
    const queued = service.listQueued('q1')
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ content: 'follow-up' })
    expect(typeof queued[0].id).toBe('string')
    // Snapshot persisted at enqueue; queued event carries id + length.
    expect(persisted[persisted.length - 1]).toMatchObject({ key: 'q1', items: [{ content: 'follow-up' }] })
    const queuedEvent = h.events.find((e) => e.event === 'test.queued')
    expect(queuedEvent?.data).toMatchObject({ threadKey: 'q1', queueId: queued[0].id, queueLength: 1 })

    release()
    await service.waitFor('q1')
    await waitUntil(() => !service.isInFlight('q1') && service.listQueued('q1').length === 0, { label: 'drain settle' })
  })

  test('combined drain after done: FIFO user rows, ONE runtime call with joined content + merged attachments, one meter', async () => {
    mkdirSync(testDir, { recursive: true })
    const filePath = join(testDir, 'queued-pic.png')
    writeFileSync(filePath, 'tiny')
    const metered: Array<Record<string, unknown>> = []
    const { h, service, persisted, scripts } = makeQueueHarness({
      hooks: { meter: (info) => { metered.push(info) } },
    })
    const release = gatedScript(scripts)
    scripts.push(async function* () {
      yield { type: 'text', content: 'combined reply' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })

    expect(await service.start(h.ctx, 'q2', 'first')).toBe('accepted')
    expect(await service.start(h.ctx, 'q2', 'fix A', { queueIfBusy: true })).toMatchObject({ queued: true })
    expect(
      await service.start(h.ctx, 'q2', 'also B', {
        queueIfBusy: true,
        attachments: [{ name: 'queued-pic.png', mimeType: 'image/png', path: filePath }],
      }),
    ).toMatchObject({ queued: true })
    expect(service.listQueued('q2')).toHaveLength(2)

    release()
    await service.waitFor('q2')
    await waitUntil(() => h.events.filter((e) => e.event === 'test.done').length === 2, { label: 'drained turn done' })

    // Exactly two runtime calls total: original + ONE combined drained turn.
    expect(h.seenArgs).toHaveLength(2)
    expect(h.seenArgs[1].content).toBe('fix A\n\nalso B')
    expect(h.seenArgs[1].attachments).toEqual([{ path: filePath, mimeType: 'image/png' }])

    // Rows: user(first) … user(fix A), user(also B) in FIFO order, then reply.
    const rows = h.rows.get('q2') ?? []
    const userRows = rows.filter((r) => r.kind === 'user').map((r) => (r as { content: string }).content)
    expect(userRows).toEqual(['first', 'fix A', 'also B'])
    const queuedUserRow = rows.find((r) => r.kind === 'user' && (r as { content: string }).content === 'also B')
    expect((queuedUserRow as { attachments?: unknown[] }).attachments).toHaveLength(1)
    expect(rows.filter((r) => r.kind === 'assistant').map((r) => (r as { content: string }).content).join('')).toContain('combined reply')

    // Drained turn: started event fired, queue empty + persisted empty, one meter per turn.
    expect(h.events.filter((e) => e.event === 'test.started')).toHaveLength(2)
    expect(service.listQueued('q2')).toHaveLength(0)
    expect(persisted[persisted.length - 1]).toMatchObject({ key: 'q2', items: [] })
    expect(metered).toHaveLength(2)
  })

  test('drain fires after an error settle', async () => {
    const { h, service, scripts } = makeQueueHarness()
    let releaseErr!: () => void
    const errGate = new Promise<void>((r) => { releaseErr = r })
    scripts.push(async function* () {
      yield { type: 'text', content: 'partial' } as ChatChunk
      await errGate
      yield { type: 'error', content: 'boom', data: { kind: 'session_lost' } } as ChatChunk
    })
    scripts.push(async function* () {
      yield { type: 'text', content: 'recovered' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })

    expect(await service.start(h.ctx, 'q3', 'first')).toBe('accepted')
    expect(await service.start(h.ctx, 'q3', 'follow-up', { queueIfBusy: true })).toMatchObject({ queued: true })
    releaseErr()
    await service.waitFor('q3')
    await waitUntil(() => h.events.some((e) => e.event === 'test.done'), { label: 'drained turn after error' })

    const rows = h.rows.get('q3') ?? []
    expect(rows.some((r) => r.kind === 'error')).toBe(true)
    const userRows = rows.filter((r) => r.kind === 'user').map((r) => (r as { content: string }).content)
    expect(userRows).toEqual(['first', 'follow-up'])
    expect(service.listQueued('q3')).toHaveLength(0)
  })

  test('drain fires after abort (the steering flow): aborted row, then combined turn', async () => {
    const { h, service, scripts } = makeQueueHarness()
    const release = gatedScript(scripts, [{ type: 'text', content: 'wrong direction' } as ChatChunk])
    scripts.push(async function* () {
      yield { type: 'text', content: 'corrected' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })

    expect(await service.start(h.ctx, 'q4', 'first')).toBe('accepted')
    await waitUntil(() => service.inflightPreview('q4') === 'wrong direction', { label: 'first text chunk' })
    expect(await service.start(h.ctx, 'q4', 'correction', { queueIfBusy: true })).toMatchObject({ queued: true })
    expect(service.abort('q4')).toBe(true)
    release()
    await service.waitFor('q4')
    await waitUntil(() => h.events.filter((e) => e.event === 'test.done').length === 2, { label: 'drained turn after abort' })

    const rows = h.rows.get('q4') ?? []
    const abortedIdx = rows.findIndex((r) => r.kind === 'aborted')
    expect(abortedIdx).toBeGreaterThan(-1)
    const correctionIdx = rows.findIndex((r) => r.kind === 'user' && (r as { content: string }).content === 'correction')
    expect(correctionIdx).toBeGreaterThan(abortedIdx)
    expect(h.seenArgs[1].content).toBe('correction')
  })

  test('removeQueued and clearQueue mutate + persist; remove of unknown id is false', async () => {
    const { h, service, persisted, scripts } = makeQueueHarness()
    const release = gatedScript(scripts)
    expect(await service.start(h.ctx, 'q5', 'first')).toBe('accepted')
    await service.start(h.ctx, 'q5', 'a', { queueIfBusy: true })
    await service.start(h.ctx, 'q5', 'b', { queueIfBusy: true })
    const [a] = service.listQueued('q5')

    expect(service.removeQueued('q5', a.id)).toBe(true)
    expect(service.removeQueued('q5', 'nope')).toBe(false)
    expect(service.listQueued('q5').map((i) => i.content)).toEqual(['b'])
    await waitUntil(() => {
      const last = persisted[persisted.length - 1]
      return last?.key === 'q5' && last.items.length === 1
    }, { label: 'remove persisted' })

    service.clearQueue('q5')
    expect(service.listQueued('q5')).toHaveLength(0)
    await waitUntil(() => persisted[persisted.length - 1]?.items.length === 0, { label: 'clear persisted' })

    release()
    await service.waitFor('q5')
    // Cleared queue: nothing drains — exactly one runtime call ever.
    await new Promise((r) => setTimeout(r, 20))
    expect(h.seenArgs).toHaveLength(1)
  })

  test('restore with idle slot drains immediately; restore while busy drains at settle', async () => {
    const { h, service, scripts } = makeQueueHarness()
    scripts.push(async function* () {
      yield { type: 'text', content: 'restored reply' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })
    service.restore(h.ctx, 'q6', [
      { id: 'r1', ts: new Date().toISOString(), content: 'restored A', agentId: 'main' },
      { id: 'r2', ts: new Date().toISOString(), content: 'restored B', agentId: 'main' },
    ])
    await waitUntil(() => h.seenArgs.length === 1, { label: 'boot drain' })
    expect(h.seenArgs[0].content).toBe('restored A\n\nrestored B')
    await service.waitFor('q6')

    // Busy thread: restore parks; drains when the active turn settles.
    const release = gatedScript(scripts)
    scripts.push(async function* () {
      yield { type: 'done' } as ChatChunk
    })
    expect(await service.start(h.ctx, 'q7', 'live')).toBe('accepted')
    service.restore(h.ctx, 'q7', [{ id: 'r3', ts: new Date().toISOString(), content: 'parked', agentId: 'main' }])
    await new Promise((r) => setTimeout(r, 20))
    expect(h.seenArgs.filter((a) => a.content === 'parked')).toHaveLength(0)
    release()
    await service.waitFor('q7')
    await waitUntil(() => h.seenArgs.some((a) => a.content === 'parked'), { label: 'parked drain after settle' })
  })

  test('drain against a deleted thread drops the queue and persists empty — no throw, no runtime call', async () => {
    let gone = false
    const { h, service, persisted, scripts } = makeQueueHarness({
      resolveThread: (key) => (key === 'q8' && gone ? null : { agentId: 'main' }),
    })
    const release = gatedScript(scripts)
    expect(await service.start(h.ctx, 'q8', 'first')).toBe('accepted')
    expect(await service.start(h.ctx, 'q8', 'orphan', { queueIfBusy: true })).toMatchObject({ queued: true })
    gone = true
    release()
    await service.waitFor('q8')
    await waitUntil(() => service.listQueued('q8').length === 0, { label: 'queue dropped' })
    expect(persisted[persisted.length - 1]).toMatchObject({ key: 'q8', items: [] })
    // Only the original call — the drained turn never ran.
    await new Promise((r) => setTimeout(r, 20))
    expect(h.seenArgs).toHaveLength(1)
    expect((h.rows.get('q8') ?? []).filter((r) => r.kind === 'user')).toHaveLength(1)
  })

  test('start(queueIfBusy) during the drained turn queues again — never a double turn', async () => {
    const { h, service, scripts } = makeQueueHarness()
    const releaseFirst = gatedScript(scripts)
    const releaseDrain = gatedScript(scripts)
    scripts.push(async function* () {
      yield { type: 'done' } as ChatChunk
    })

    expect(await service.start(h.ctx, 'q9', 'first')).toBe('accepted')
    expect(await service.start(h.ctx, 'q9', 'queued-1', { queueIfBusy: true })).toMatchObject({ queued: true })
    releaseFirst()
    await waitUntil(() => h.seenArgs.length === 2, { label: 'drained turn started' })
    // The drained turn holds the slot — a new send queues behind it.
    expect(await service.start(h.ctx, 'q9', 'queued-2', { queueIfBusy: true })).toMatchObject({ queued: true })
    releaseDrain()
    await waitUntil(() => h.seenArgs.length === 3, { label: 'second drain' })
    expect(h.seenArgs.map((a) => a.content)).toEqual(['first', 'queued-1', 'queued-2'])
    await waitUntil(() => !service.isInFlight('q9'), { label: 'all settled' })
  })

  test('concurrent enqueues each get THEIR OWN queueId even when persist parks (review: no tail re-read)', async () => {
    let releasePersist!: () => void
    const persistGate = new Promise<void>((r) => { releasePersist = r })
    const { h, service, scripts } = makeQueueHarness({
      queue: {
        // Persist parks behind a gate — simulating the serialized store
        // chain being busy with streaming transcript writes.
        persist: () => persistGate,
        event: 'test.queued',
      },
    })
    const releaseTurn = gatedScript(scripts)
    scripts.push(async function* () {
      yield { type: 'done' } as ChatChunk
    })

    expect(await service.start(h.ctx, 'q11', 'first')).toBe('accepted')
    const [a, b] = [
      service.start(h.ctx, 'q11', 'send A', { queueIfBusy: true }),
      service.start(h.ctx, 'q11', 'send B', { queueIfBusy: true }),
    ]
    releasePersist()
    const [ra, rb] = await Promise.all([a, b])
    if (typeof ra !== 'object' || typeof rb !== 'object') throw new Error('expected queued outcomes')
    const items = service.listQueued('q11')
    // Each caller got the id of ITS message, not the tail's.
    expect(ra.queueId).toBe(items.find((i) => i.content === 'send A')!.id)
    expect(rb.queueId).toBe(items.find((i) => i.content === 'send B')!.id)
    expect(ra.queueId).not.toBe(rb.queueId)
    // queueLength captured at push time: 1 then 2 (in some order of settle).
    expect([ra.queueLength, rb.queueLength].sort()).toEqual([1, 2])
    releaseTurn()
    await service.waitFor('q11')
    await waitUntil(() => !service.isInFlight('q11'), { label: 'drain settle' })
  })

  test('abort during the drained turn\'s async prefix settles CLEAN as aborted — never an error row', async () => {
    let releaseResolve!: () => void
    const resolveGate = new Promise<void>((r) => { releaseResolve = r })
    let drainResolves = 0
    const { h, service, scripts } = makeQueueHarness({
      resolveThread: async () => {
        drainResolves += 1
        // Gate only the DRAIN's re-resolve (second call for this key).
        if (drainResolves === 3) await resolveGate
        return { agentId: 'main' }
      },
    })
    const releaseTurn = gatedScript(scripts)
    scripts.push(() => {
      // The drained turn's stream: an already-aborted signal makes real
      // adapters throw before the first chunk — simulate exactly that.
      throw Object.assign(new Error('turn aborted before start'), { kind: 'aborted' })
    })

    expect(await service.start(h.ctx, 'q12', 'first')).toBe('accepted')
    expect(await service.start(h.ctx, 'q12', 'correction', { queueIfBusy: true })).toMatchObject({ queued: true })
    releaseTurn()
    await service.waitFor('q12')
    // The drain is now parked in resolveThread — Stop lands mid-prefix.
    await waitUntil(() => service.isInFlight('q12'), { label: 'drain slot reserved' })
    expect(service.abort('q12')).toBe(true)
    releaseResolve()
    await service.waitFor('q12')
    await waitUntil(() => !service.isInFlight('q12'), { label: 'drain settled' })

    const rows = h.rows.get('q12') ?? []
    // Clean abort settle: aborted marker, NO error row, done carries aborted.
    expect(rows.some((r) => r.kind === 'error')).toBe(false)
    expect(rows[rows.length - 1]?.kind).toBe('aborted')
    const dones = h.events.filter((e) => e.event === 'test.done')
    expect(dones[dones.length - 1]?.data.aborted).toBe(true)
  })

  test('restore prepends older from-disk items before live enqueues (chronological drain)', async () => {
    const { h, service, scripts } = makeQueueHarness()
    const release = gatedScript(scripts)
    scripts.push(async function* () {
      yield { type: 'done' } as ChatChunk
    })
    expect(await service.start(h.ctx, 'q13', 'live turn')).toBe('accepted')
    expect(await service.start(h.ctx, 'q13', 'typed after boot', { queueIfBusy: true })).toMatchObject({ queued: true })
    // Boot restore arrives while busy: its items predate the live enqueue.
    service.restore(h.ctx, 'q13', [
      { id: 'old-1', ts: new Date(Date.now() - 60_000).toISOString(), content: 'from before the restart', agentId: 'main' },
    ])
    release()
    await service.waitFor('q13')
    await waitUntil(() => h.seenArgs.length === 2, { label: 'combined drain' })
    expect(h.seenArgs[1].content).toBe('from before the restart\n\ntyped after boot')
    await waitUntil(() => !service.isInFlight('q13'), { label: 'settled' })
  })

  test('attachment-only queued message gets the visible placeholder at enqueue', async () => {
    mkdirSync(testDir, { recursive: true })
    const filePath = join(testDir, 'q-only.png')
    writeFileSync(filePath, 'tiny')
    const { h, service, scripts } = makeQueueHarness()
    const release = gatedScript(scripts)
    scripts.push(async function* () {
      yield { type: 'done' } as ChatChunk
    })
    expect(await service.start(h.ctx, 'q10', 'first')).toBe('accepted')
    expect(
      await service.start(h.ctx, 'q10', '  ', {
        queueIfBusy: true,
        attachments: [{ name: 'q-only.png', mimeType: 'image/png', path: filePath }],
      }),
    ).toMatchObject({ queued: true })
    expect(service.listQueued('q10')[0].content).toBe('See the attached image.')
    release()
    await service.waitFor('q10')
    await waitUntil(() => !service.isInFlight('q10') && service.listQueued('q10').length === 0, { label: 'drained' })
  })

  test('terminalMarkerRows: the drained combined turn gets its own marker — one done row per settled turn (#735)', async () => {
    const { h, service, scripts } = makeQueueHarness({ terminalMarkerRows: true })
    const release = gatedScript(scripts)
    scripts.push(async function* () {
      yield { type: 'text', content: 'combined reply' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })
    expect(await service.start(h.ctx, 'qm1', 'first')).toBe('accepted')
    expect(await service.start(h.ctx, 'qm1', 'follow-up', { queueIfBusy: true })).toMatchObject({ queued: true })
    release()
    await service.waitFor('qm1')
    await waitUntil(() => h.events.filter((e) => e.event === 'test.done').length === 2, { label: 'drained turn done' })
    await waitUntil(() => !service.isInFlight('qm1'), { label: 'settled' })

    const rows = h.rows.get('qm1') ?? []
    const dones = rows.filter((r) => r.kind === 'done') as Array<{ turnId?: string }>
    expect(dones).toHaveLength(2)
    expect(dones[0].turnId).not.toBe(dones[1].turnId)
    expect(rows[rows.length - 1]?.kind).toBe('done')
  })

  test('terminalMarkerRows: abort in the drained turn\'s async prefix — aborted terminal, never a done row for that turn (#735)', async () => {
    let releaseResolve!: () => void
    const resolveGate = new Promise<void>((r) => { releaseResolve = r })
    let drainResolves = 0
    const { h, service, scripts } = makeQueueHarness({
      terminalMarkerRows: true,
      resolveThread: async () => {
        drainResolves += 1
        if (drainResolves === 3) await resolveGate
        return { agentId: 'main' }
      },
    })
    const releaseTurn = gatedScript(scripts)
    scripts.push(() => {
      throw Object.assign(new Error('turn aborted before start'), { kind: 'aborted' })
    })

    expect(await service.start(h.ctx, 'qm2', 'first')).toBe('accepted')
    expect(await service.start(h.ctx, 'qm2', 'correction', { queueIfBusy: true })).toMatchObject({ queued: true })
    releaseTurn()
    await service.waitFor('qm2')
    await waitUntil(() => service.isInFlight('qm2'), { label: 'drain slot reserved' })
    expect(service.abort('qm2')).toBe(true)
    releaseResolve()
    await service.waitFor('qm2')
    await waitUntil(() => !service.isInFlight('qm2'), { label: 'drain settled' })

    const rows = h.rows.get('qm2') ?? []
    // First turn completed cleanly → exactly one done marker; the aborted
    // drain's terminal is its aborted row, never a done row.
    expect(rows.filter((r) => r.kind === 'done')).toHaveLength(1)
    expect(rows[rows.length - 1]?.kind).toBe('aborted')
    expect(rows.some((r) => r.kind === 'error')).toBe(false)
  })
})

/**
 * Terminal marker rows (#735): with `terminalMarkerRows` on, EVERY settle
 * shape leaves the transcript ending on a terminal row (done | aborted |
 * error) — the boot-sweep evidence chat uses to stamp partial-output deaths
 * without ever falsely marking a completed turn. A new settle path added to
 * runTurn MUST keep this invariant and extend these tests.
 */
describe('conversation turn service — terminal marker rows (#735)', () => {
  test('clean success: the done row lands LAST, after all content rows, carrying the turn id', async () => {
    const h = makeHarness()
    const service = makeService(h, { terminalMarkerRows: true })
    h.setStream(async function* () {
      yield { type: 'text', content: 'reply' } as ChatChunk
      yield { type: 'tool', data: { phase: 'result', toolName: 'bash', status: 'completed' } } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })
    expect(await service.start(h.ctx, 'm1', 'go')).toBe('accepted')
    await service.waitFor('m1')

    const rows = h.rows.get('m1') ?? []
    const last = rows[rows.length - 1] as { kind: string; turnId?: string }
    expect(last.kind).toBe('done')
    const assistant = rows.find((r) => r.kind === 'assistant') as { turnId?: string }
    expect(typeof last.turnId).toBe('string')
    expect(last.turnId).toBe(assistant.turnId)
    expect(rows.filter((r) => r.kind === 'done')).toHaveLength(1)
  })

  test('the done row persists AFTER final content rows and BEFORE onTurnComplete and the done event', async () => {
    const h = makeHarness()
    const order: string[] = []
    const service = makeService(h, {
      terminalMarkerRows: true,
      appendRow: (_key, row) => { order.push(`row:${row.kind}`) },
      hooks: { onTurnComplete: ({ aborted }) => { order.push(`complete:${aborted}`) } },
    })
    h.setStream(async function* () {
      yield { type: 'text', content: 'reply' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })
    h.ctx.events.emit = ((event: string, data?: Record<string, unknown>) => {
      order.push(`event:${event}`)
      h.events.push({ event, data: data ?? {} })
    }) as typeof h.ctx.events.emit

    expect(await service.start(h.ctx, 'm2', 'go')).toBe('accepted')
    await service.waitFor('m2')
    expect(order).toEqual(['row:user', 'event:test.chunk', 'row:assistant', 'row:done', 'complete:false', 'event:test.done'])
  })

  test('error settles never write a done row — the error row is the terminal (both error shapes)', async () => {
    const h = makeHarness()
    const service = makeService(h, { terminalMarkerRows: true })
    h.setStream(async function* () {
      yield { type: 'text', content: 'partial' } as ChatChunk
      yield { type: 'error', content: 'session died', data: { kind: 'session_lost' } } as ChatChunk
    })
    expect(await service.start(h.ctx, 'm3', 'go')).toBe('accepted')
    await service.waitFor('m3')
    let rows = h.rows.get('m3') ?? []
    expect(rows[rows.length - 1]?.kind).toBe('error')
    expect(rows.some((r) => r.kind === 'done')).toBe(false)

    h.setStream(async function* () {
      yield { type: 'text', content: 'partial' } as ChatChunk
      throw new Error('socket torn')
    })
    expect(await service.start(h.ctx, 'm4', 'go')).toBe('accepted')
    await service.waitFor('m4')
    rows = h.rows.get('m4') ?? []
    expect(rows[rows.length - 1]?.kind).toBe('error')
    expect(rows.some((r) => r.kind === 'done')).toBe(false)
  })

  test('abort during the stream: the aborted row is the terminal, no done row', async () => {
    const h = makeHarness()
    const service = makeService(h, { terminalMarkerRows: true })
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    h.setStream(async function* () {
      yield { type: 'text', content: 'partial reply' } as ChatChunk
      await gate
      yield { type: 'done' } as ChatChunk
    })
    expect(await service.start(h.ctx, 'm5', 'go')).toBe('accepted')
    expect(service.abort('m5')).toBe(true)
    release()
    await service.waitFor('m5')

    const rows = h.rows.get('m5') ?? []
    expect(rows[rows.length - 1]?.kind).toBe('aborted')
    expect(rows.some((r) => r.kind === 'done')).toBe(false)
  })

  test('flag absent: no done row ever (bounded/foreign stores stay clean)', async () => {
    const h = makeHarness()
    const service = makeService(h)
    h.setStream(async function* () {
      yield { type: 'text', content: 'reply' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })
    expect(await service.start(h.ctx, 'm6', 'go')).toBe('accepted')
    await service.waitFor('m6')
    const rows = h.rows.get('m6') ?? []
    expect(rows.some((r) => r.kind === 'done')).toBe(false)
    expect(rows[rows.length - 1]?.kind).toBe('assistant')
  })
})
