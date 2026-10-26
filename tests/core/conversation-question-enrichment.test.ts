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
const { enrichQuestionChunk } = await import('../../packages/core/src/conversation/questions')
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
 * Run the real tool and serialize its result exactly as the runtime exec-tool
 * provider does for both adapters (`src/core/exec-tools/provider.ts`:
 * `JSON.stringify(result, null, 2)`). The provider itself needs a fully
 * initialized AppServices for its per-call tool context, which ask_user never
 * reads; the adapter mappings below are the real code under test.
 */
async function callAskUser(): Promise<string> {
  const result = await getExecTool('bakin_exec_ask_user')!.handler(ARGS, 'roscoe')
  if (!result.ok) throw new Error(`ask_user failed: ${String(result.error)}`)
  return JSON.stringify(result, null, 2)
}

function bakinQuestionOf(chunk: ChatChunk): Record<string, unknown> | undefined {
  if (chunk.type !== 'tool') return undefined
  const metadata = (chunk.data as { metadata?: Record<string, unknown> }).metadata
  return metadata?.bakinQuestion as Record<string, unknown> | undefined
}

/** The Pi chunk for a finished tool call, produced by Pi's real mapping. */
async function piResultChunk(): Promise<ChatChunk> {
  const text = await callAskUser()
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

describe('enrichQuestionChunk through real adapter mappings', () => {
  test('Pi (summary-only result) carries the full question after enrichment', async () => {
    const chunk = await piResultChunk()
    expect(bakinQuestionOf(chunk)).toBeUndefined()
    const question = bakinQuestionOf(enrichQuestionChunk(chunk))
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
    expect(bakinQuestionOf(enrichQuestionChunk(chunks[0]!))).toMatchObject({ question: ARGS.question })
  })

  test('non-question tool chunks are returned untouched', () => {
    const chunk: ChatChunk = { type: 'tool', content: 'x', data: { phase: 'result', toolName: 'bakin_exec_heartbeat', status: 'completed', summary: 'ok' } }
    expect(enrichQuestionChunk(chunk)).toBe(chunk)
  })

  test('an unknown or expired id is left as a plain tool row', () => {
    const chunk: ChatChunk = { type: 'tool', content: 'x', data: { phase: 'result', toolName: 'bakin_exec_ask_user', status: 'completed', summary: 'bakin-question:q_0000000000000000 posted.' } }
    expect(bakinQuestionOf(enrichQuestionChunk(chunk))).toBeUndefined()
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
