/**
 * Question enrichment through the REAL adapter chunk mappers (projects
 * revamp D2 / T3). A hand-built "ideal" tool row would prove nothing: Pi
 * emits only a one-line result summary and OpenClaw clips previews at 500
 * chars, so these tests run the real tool, the real adapter mapping, and the
 * real turn engine end to end.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-question-enrichment-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.PI_HOME = join(testDir, 'pi')
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import type { ChatChunk, MessageArgs } from '../../packages/core/src/adapters/runtime/concepts'
import type { ConversationTurnRow, TurnContext } from '../../packages/core/src/conversation/turns'
import type { AgentEventPayload } from '../../packages/adapter-openclaw/src/gateway-frames'

await import('../../src/core/exec-tools/tools/ask-user')
const { getExecTool } = await import('../../src/core/exec-tools/registry')
const { sessionEventChunks } = await import('../../packages/adapter-pi/src/messaging')
const { OpenClawTurnChunkMachine } = await import('../../packages/adapter-openclaw/src/stream-events')
const { enrichReceiptChunk, sealToolResult } = await import('../../packages/core/src/conversation/receipts')
const { createConversationTurnService } = await import('../../packages/core/src/conversation/turns')

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

const ARGS = {
  question: 'Which inbox are we cleaning?',
  options: [
    { label: 'Just my personal Gmail', description: 'Fastest win; work mail has retention rules.' },
    { label: 'Personal and work', description: 'Bigger payoff, two sets of rules.' },
    { label: 'A shared team inbox' },
  ],
  recommended: 0,
}

/**
 * Run the real tool and serialize its result exactly as both invoke paths do
 * (`sealToolResult`, `src/core/exec-tools/provider.ts` and
 * `src/core/mcp-server.ts`). The provider itself needs a fully
 * initialized AppServices for its per-call tool context, which ask_user never
 * reads; the adapter mappings below are the real code under test.
 */
async function callAskUser(args: typeof ARGS = ARGS): Promise<string> {
  const result = await getExecTool('bakin_exec_ask_user')!.handler(args, 'roscoe')
  if (!result.ok) throw new Error(`ask_user failed: ${String(result.error)}`)
  return sealToolResult(result, { agentId: 'roscoe', toolName: 'bakin_exec_ask_user' })
}

/** The turn engine's enrichment for the agent these turns run as. */
const enrich = (chunk: ChatChunk, agentId = 'roscoe') => enrichReceiptChunk(chunk, agentId)

function bakinQuestionOf(chunk: ChatChunk): Record<string, unknown> | undefined {
  if (chunk.type !== 'tool') return undefined
  const metadata = (chunk.data as { metadata?: Record<string, unknown> }).metadata
  return metadata?.bakinQuestion as Record<string, unknown> | undefined
}

/** The Pi chunk for a finished tool call, produced by Pi's real mapping. */
async function piResultChunk(args: typeof ARGS = ARGS): Promise<ChatChunk> {
  const text = await callAskUser(args)
  const chunks = sessionEventChunks(
    {
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'bakin_exec_ask_user',
      result: { content: [{ type: 'text', text }], details: undefined },
      isError: false,
    } as Parameters<typeof sessionEventChunks>[0],
    { announcedThinking: false },
  )
  expect(chunks).toHaveLength(1)
  return chunks[0]!
}

describe('enrichReceiptChunk through real adapter mappings', () => {
  test('Pi carries the full question after enrichment, and its summary stays human', async () => {
    const chunk = await piResultChunk()
    expect(bakinQuestionOf(chunk)).toBeUndefined()
    expect((chunk.data as { summary?: string }).summary).toBe("Question posted. End your turn and wait for the user's answer.")
    const question = bakinQuestionOf(enrich(chunk))
    expect(question).toMatchObject({ v: 1, question: ARGS.question, recommended: 0, allowOther: true })
    expect((question!.options as unknown[]).length).toBe(3)
  })

  test('OpenClaw (500-char clipped preview) carries the full question after enrichment', async () => {
    const text = await callAskUser()
    const machine = new OpenClawTurnChunkMachine('run-1')
    const chunks = machine.onAgentEvent({
      runId: 'run-1',
      stream: 'tool',
      data: {
        phase: 'result',
        name: 'bakin-roscoe.bakin_exec_ask_user',
        toolCallId: 'call-1',
        result: { content: [{ type: 'text', text }] },
      },
    } as AgentEventPayload)
    expect(chunks).toHaveLength(1)
    expect(bakinQuestionOf(enrich(chunks[0]!))).toMatchObject({ question: ARGS.question })
  })

  test('non-question tool chunks are returned untouched', () => {
    const chunk: ChatChunk = { type: 'tool', content: 'x', data: { phase: 'result', toolName: 'bakin_exec_heartbeat', status: 'completed', summary: 'ok' } }
    expect(enrich(chunk)).toBe(chunk)
  })

  test('a token is honoured once; replays (and other tools quoting it) stay plain rows', async () => {
    const chunk = await piResultChunk()
    expect(bakinQuestionOf(enrich(chunk))).toBeDefined()
    // The same result replayed — e.g. a duplicate frame — no longer opens a card.
    expect(bakinQuestionOf(enrich(chunk))).toBeUndefined()

    // A different tool reading a transcript that quotes a LIVE token.
    const fresh = await piResultChunk()
    const quoted = (fresh.data as { outputPreview?: string }).outputPreview
    expect(quoted).toContain('bakin-receipt:')
    const reader: ChatChunk = { type: 'tool', content: 'x', data: { phase: 'result', toolName: 'read_file', status: 'completed', outputPreview: JSON.stringify({ quoted }) } }
    expect(bakinQuestionOf(enrich(reader))).toBeUndefined()
    expect(bakinQuestionOf(enrich(fresh))).toBeDefined()
  })

  test('the asking tool in another agent\'s turn cannot take the receipt', async () => {
    const chunk = await piResultChunk()
    expect(bakinQuestionOf(enrich(chunk, 'scout'))).toBeUndefined()
    expect(bakinQuestionOf(enrich(chunk))).toBeDefined()
  })

  test('two calls in flight for one agent each get their own question', async () => {
    const first = await piResultChunk({ ...ARGS, question: 'First question?' })
    const second = await piResultChunk({ ...ARGS, question: 'Second question?' })
    // Results arrive out of order, as they do across concurrent turns.
    expect(bakinQuestionOf(enrich(second))).toMatchObject({ question: 'Second question?' })
    expect(bakinQuestionOf(enrich(first))).toMatchObject({ question: 'First question?' })
  })

  test('an unknown or expired id is left as a plain tool row', () => {
    const chunk: ChatChunk = { type: 'tool', content: 'x', data: { phase: 'result', toolName: 'bakin_exec_ask_user', status: 'completed', outputPreview: '{"receipt":"bakin-receipt:r_0000000000000000","result":{}}' } }
    expect(bakinQuestionOf(enrich(chunk))).toBeUndefined()
  })
})

describe('turn engine', () => {
  function harness(script: () => AsyncIterable<ChatChunk>) {
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const rows: ConversationTurnRow[] = []
    const ctx = {
      events: { emit: (event: string, data?: Record<string, unknown>) => { events.push({ event, data: data ?? {} }) }, on: () => () => {}, once: () => () => {} },
      runtime: {
        messaging: { stream: (_args: MessageArgs) => script() },
        describeToolAccess: () => ({ style: 'in-process', perTurnExecToolFiltering: true }),
      },
    } as unknown as TurnContext
    const service = createConversationTurnService({
      name: 'test',
      events: { chunk: 'test.chunk', done: 'test.done', error: 'test.error' },
      payload: (key) => ({ threadKey: key }),
      resolveThread: () => ({ agentId: 'roscoe' }),
      appendRow: (_key, row) => { rows.push(row) },
      threadId: (key) => `test:${key}`,
    })
    return { ctx, events, rows, service }
  }

  test('a question tool row is enriched on the live chunk event AND the persisted row', async () => {
    const chunk = await piResultChunk()
    const h = harness(async function* () {
      yield { type: 'text', content: 'Scope first.' }
      yield chunk
      yield { type: 'done' }
    })
    expect(await h.service.start(h.ctx, 't1', 'help me clean my inbox')).toBe('accepted')
    await h.service.waitFor('t1')

    const live = h.events.find((e) => e.event === 'test.chunk' && (e.data.chunk as ChatChunk).type === 'tool')
    expect(bakinQuestionOf(live!.data.chunk as ChatChunk)).toMatchObject({ question: ARGS.question })
    const toolRow = h.rows.find((row) => row.kind === 'tool')
    expect((toolRow as { metadata?: Record<string, unknown> }).metadata?.bakinQuestion).toMatchObject({ question: ARGS.question })
  })

  test('a turn that ends on a question previews the question', async () => {
    const chunk = await piResultChunk()
    const h = harness(async function* () {
      yield { type: 'text', content: 'Scope first.' }
      yield chunk
      yield { type: 'done' }
    })
    await h.service.start(h.ctx, 't2', 'go')
    await h.service.waitFor('t2')
    expect(h.events.find((e) => e.event === 'test.done')?.data.preview).toBe(`Asked: ${ARGS.question}`)
  })

  test('text after the question keeps the ordinary text preview', async () => {
    const chunk = await piResultChunk()
    const h = harness(async function* () {
      yield chunk
      yield { type: 'text', content: 'Answer whenever you are ready.' }
      yield { type: 'done' }
    })
    await h.service.start(h.ctx, 't3', 'go')
    await h.service.waitFor('t3')
    expect(h.events.find((e) => e.event === 'test.done')?.data.preview).toBe('Answer whenever you are ready.')
  })
})
