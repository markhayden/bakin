/**
 * Chat hand-off: the acceptor registry, delivery, the acceptor's write, and
 * the carried-history preamble.
 */
import { afterAll, describe, expect, mock, test } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-conversation-handoff-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import type { ChatChunk, MessageArgs } from '../../packages/core/src/adapters/runtime/concepts'
import type { ConversationTurnRow, TurnContext } from '../../packages/core/src/conversation/turns'
import { settleFor } from '../helpers/wait'

const {
  HandoffError,
  createHandoffRegistry,
  handoffId,
  handoffPreamble,
  writeHandoffBatch,
} = await import('../../packages/core/src/conversation/handoff')
const { createConversationTurnService } = await import('../../packages/core/src/conversation/turns')

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

const source = { entity: 'chat:chat', id: 'c-1', title: 'Launch chat' }
const carried: ConversationTurnRow[] = [
  { kind: 'user', ts: '2026-11-14T09:00:00.000Z', content: 'plan the spring launch' },
  { kind: 'assistant', ts: '2026-11-14T09:00:01.000Z', turnId: 't1', agentId: 'main', content: 'Creating a project for it.' },
]
const delivery = (id = 'p-1') => ({
  handoffId: handoffId('c-1', 't1', id),
  target: { kind: 'projects:project', id },
  source,
  carried,
  ts: '2026-11-14T10:00:00.000Z',
})

describe('hand-off registry', () => {
  test('delivery hands the acceptor one batch: the in marker, then the carried rows', async () => {
    const registry = createHandoffRegistry()
    const seen: unknown[] = []
    registry.register('projects', 'projects:project', (request) => { seen.push(request) })
    await registry.deliver(delivery())

    expect(seen).toEqual([{
      handoffId: 'c-1:t1:p-1',
      target: { kind: 'projects:project', id: 'p-1' },
      rows: [
        { kind: 'handoff', ts: '2026-11-14T10:00:00.000Z', handoffId: 'c-1:t1:p-1', direction: 'in', peers: [source], carried: 2 },
        ...carried,
      ],
    }])
  })

  test('a kind nobody accepts, and an acceptor that throws, are typed failures', async () => {
    const registry = createHandoffRegistry()
    await expect(registry.deliver(delivery())).rejects.toMatchObject({ name: 'HandoffError', kind: 'no_acceptor' })

    registry.register('projects', 'projects:project', () => { throw new Error('project p-1 not found') })
    const failure = await registry.deliver(delivery()).catch((err: unknown) => err)
    expect(failure).toBeInstanceOf(HandoffError)
    expect(failure).toMatchObject({ kind: 'rejected' })
    expect((failure as Error).message).toContain('project p-1 not found')
  })

  test('a kind has one acceptor, and sweeping a plugin removes its own', () => {
    const registry = createHandoffRegistry()
    registry.register('projects', 'projects:project', () => {})
    registry.register('messaging', 'messaging:session', () => {})
    expect(() => registry.register('other', 'projects:project', () => {})).toThrow(/already has an acceptor/)

    registry.sweep('projects')
    expect(registry.has('projects:project')).toBe(false)
    expect(registry.has('messaging:session')).toBe(true)
  })
})

describe('writeHandoffBatch', () => {
  function target() {
    const stored: ConversationTurnRow[] = []
    let script: () => AsyncIterable<ChatChunk> = async function* () {
      yield { type: 'text', content: 'ok' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    }
    const ctx = {
      events: { emit: () => {}, on: () => () => {}, once: () => () => {} },
      runtime: {
        messaging: { stream: (_args: MessageArgs) => script() },
        describeToolAccess: () => ({ style: 'in-process', perTurnExecToolFiltering: true }),
      },
    } as unknown as TurnContext
    let failNext = false
    const service = createConversationTurnService({
      name: 'target',
      events: { chunk: 't.chunk', done: 't.done', error: 't.error' },
      payload: (key) => ({ key }),
      resolveThread: () => ({ agentId: 'lead' }),
      appendRow: (_key, row) => { stored.push(row) },
      // One atomic write: all of the rows, or none.
      appendRows: (_key, rows) => {
        if (failNext) { failNext = false; throw new Error('disk full') }
        stored.push(...rows)
      },
      threadId: (key) => `target:${key}`,
    })
    return { ctx, service, stored, setStream: (s: typeof script) => { script = s }, failNextBatch: () => { failNext = true } }
  }
  const request = { handoffId: 'c-1:t1:p-1', target: { kind: 'projects:project', id: 'p-1' }, rows: [
    { kind: 'handoff', ts: '2026-11-14T10:00:00.000Z', handoffId: 'c-1:t1:p-1', direction: 'in', peers: [source], carried: 2 } as ConversationTurnRow,
    ...carried,
  ] }

  test('writes the batch once; a repeat of the same hand-off is a no-op', async () => {
    const t = target()
    await writeHandoffBatch(t.service, t.ctx, 'p-1', request, t.stored)
    expect(t.stored).toEqual(request.rows)

    await writeHandoffBatch(t.service, t.ctx, 'p-1', request, t.stored)
    expect(t.stored).toEqual(request.rows)
  })

  test('a failed write leaves nothing behind and rejects', async () => {
    const t = target()
    t.failNextBatch()
    await expect(writeHandoffBatch(t.service, t.ctx, 'p-1', request, t.stored)).rejects.toThrow('disk full')
    expect(t.stored).toEqual([])
  })

  test('a busy target: resolves only once the batch is durable, after its turn', async () => {
    const t = target()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    t.setStream(async function* () {
      await gate
      yield { type: 'text', content: 'mid-turn reply' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })
    expect(await t.service.start(t.ctx, 'p-1', 'working')).toBe('accepted')

    let resolved = false
    const write = writeHandoffBatch(t.service, t.ctx, 'p-1', request, t.stored).then(() => { resolved = true })
    await settleFor(20, 'the hand-off must not resolve while the target turn holds the slot')
    expect(resolved).toBe(false)
    expect(t.stored.some((row) => row.kind === 'handoff')).toBe(false)

    release()
    await write
    const at = t.stored.findIndex((row) => row.kind === 'handoff')
    // The batch landed whole, after the live turn's rows.
    expect(t.stored.slice(at)).toEqual(request.rows)
    expect(t.stored.slice(0, at).some((row) => row.kind === 'assistant')).toBe(true)
  })
})

describe('handoffPreamble', () => {
  const marker: ConversationTurnRow = { kind: 'handoff', ts: '2026-11-14T10:00:00.000Z', handoffId: 'h', direction: 'in', peers: [source], carried: 2 }
  const base = [marker, ...carried]

  test('carries the history until the receiving agent has replied', () => {
    const preamble = handoffPreamble(base, 'lead')!
    expect(preamble).toContain('carried over from the chat "Launch chat"')
    expect(preamble).toContain('User: plan the spring launch')
    expect(preamble).toContain('Assistant: Creating a project for it.')
    expect(preamble).toContain('do not answer or repeat it')

    const afterReply = [...base,
      { kind: 'user', ts: 't', content: 'what is first?' } as ConversationTurnRow,
      { kind: 'assistant', ts: 't', turnId: 't2', agentId: 'lead', content: 'The brief.' } as ConversationTurnRow,
    ]
    expect(handoffPreamble(afterReply, 'lead')).toBeNull()
  })

  test('a turn that failed before the agent replied primes again on retry', () => {
    const failed = [...base,
      { kind: 'user', ts: 't', content: 'what is first?' } as ConversationTurnRow,
      { kind: 'error', ts: 't', turnId: 't2', message: 'runtime unavailable' } as ConversationTurnRow,
    ]
    expect(handoffPreamble(failed, 'lead')).not.toBeNull()
  })

  test('a second agent on the same target is primed for its own thread', () => {
    const afterLead = [...base,
      { kind: 'user', ts: 't', content: 'what is first?' } as ConversationTurnRow,
      { kind: 'assistant', ts: 't', turnId: 't2', agentId: 'lead', content: 'The brief.' } as ConversationTurnRow,
    ]
    expect(handoffPreamble(afterLead, 'lead')).toBeNull()
    expect(handoffPreamble(afterLead, 'designer')).not.toBeNull()
  })

  test('the carried assistant rows are the chat agent\'s, not a reply here', () => {
    // `main` wrote the carried reply in the chat; here it has said nothing yet.
    expect(handoffPreamble(base, 'main')).not.toBeNull()
  })

  test('a first turn that ended on a tool call with no text still counts as a reply', () => {
    const asked = [...base,
      { kind: 'user', ts: 't', content: 'what is first?' } as ConversationTurnRow,
      { kind: 'tool', ts: 't', turnId: 't2', agentId: 'lead', toolName: 'bakin_exec_ask_user', status: 'completed' } as ConversationTurnRow,
    ]
    expect(handoffPreamble(asked, 'lead')).toBeNull()
    expect(handoffPreamble(asked, 'designer')).not.toBeNull()
  })

  test('the carried tool rows are not a reply here, whoever made them', () => {
    const withTool = [{ ...marker, carried: 3 } as ConversationTurnRow, ...carried,
      { kind: 'tool', ts: 't', turnId: 't1', agentId: 'lead', toolName: 'bakin_exec_projects_create', status: 'completed' } as ConversationTurnRow,
    ]
    expect(handoffPreamble(withTool, 'lead')).not.toBeNull()
  })

  test('no hand-off, or nothing to say, is no preamble', () => {
    expect(handoffPreamble(carried, 'lead')).toBeNull()
    expect(handoffPreamble([{ ...marker, carried: 0 } as ConversationTurnRow], 'lead')).toBeNull()
  })

  test('stays within the byte budget, keeps the newest, marks what was dropped, never splits a character', () => {
    const long: ConversationTurnRow[] = Array.from({ length: 40 }, (_, i) => (
      { kind: 'user', ts: 't', content: `message ${i} ${'é'.repeat(200)}` } as ConversationTurnRow
    ))
    const rows = [{ ...marker, carried: long.length } as ConversationTurnRow, ...long]
    const preamble = handoffPreamble(rows, 'lead', { maxBytes: 4096 })!

    expect(new TextEncoder().encode(preamble).length).toBeLessThanOrEqual(4096)
    expect(preamble).toContain('message 39 ')
    expect(preamble).not.toContain('message 0 ')
    expect(preamble).toMatch(/\[… \d+ earlier messages omitted …\]/)
    expect(preamble).not.toContain('�')

    // One message larger than the whole budget is clipped, not dropped.
    const huge = [{ ...marker, carried: 1 } as ConversationTurnRow, { kind: 'user', ts: 't', content: '日本語'.repeat(4000) } as ConversationTurnRow]
    const clipped = handoffPreamble(huge, 'lead', { maxBytes: 2048 })!
    expect(new TextEncoder().encode(clipped).length).toBeLessThanOrEqual(2048)
    expect(clipped).toContain('User: 日本語')
    expect(clipped).toContain('[…]')
    expect(clipped).not.toContain('�')
  })
})
