/**
 * Chat's side of a hand-off: what is carried, to whom, the marker the chat
 * keeps, and the event open tabs follow.
 */
import { describe, test, expect, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-chat-handoff-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, chat: join(testDir, 'chat'), db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { appendTranscriptRow, createChat } from '../../../plugins/chat/lib/store'
import { carriedRows, handOffSettledTurn } from '../../../plugins/chat/lib/handoff'
import { createHandoffRegistry, type HandoffRequest } from '../../../packages/core/src/conversation/handoff'
import type { HandoffRow } from '../../../packages/core/src/conversation/turns'
import type { ChatTranscriptRow } from '../../../plugins/chat/types'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

const project = { kind: 'projects:project', id: 'p-1', title: 'Launch plan', action: 'created' as const }
const session = { kind: 'messaging:session', id: 's-1', title: 'Launch posts', action: 'created' as const }
const task = { kind: 'tasks:task', id: 't-9', title: 'Write the brief', action: 'created' as const }

const TURN: ChatTranscriptRow[] = [
  { kind: 'user', ts: '2026-11-14T09:00:00.000Z', content: 'plan the spring launch' },
  { kind: 'tool', ts: '2026-11-14T09:00:01.000Z', turnId: 't1', toolName: 'bakin_exec_projects_create', status: 'completed', metadata: { bakinEntities: [project] } },
  { kind: 'assistant', ts: '2026-11-14T09:00:02.000Z', turnId: 't1', content: 'Project created.' },
  { kind: 'done', ts: '2026-11-14T09:00:03.000Z', turnId: 't1' },
]

async function setup(rows: ChatTranscriptRow[] = TURN) {
  const chat = await createChat({ agentId: 'main', title: 'Launch chat' })
  for (const row of rows) await appendTranscriptRow(chat.id, row)
  const registry = createHandoffRegistry()
  const received: HandoffRequest[] = []
  registry.register('projects', 'projects:project', (request) => { received.push(request) })
  const events: Array<{ event: string; data: Record<string, unknown> }> = []
  const audits: unknown[][] = []
  const out: HandoffRow[] = []
  const ctx = {
    events: { emit: (event: string, data?: Record<string, unknown>) => { events.push({ event, data: data ?? {} }) }, on: () => () => {}, once: () => () => {} },
    activity: { audit: (...args: unknown[]) => { audits.push(args) }, log: () => {} },
  } as never
  const run = (entities: Array<typeof project>, turnId = 't1') =>
    handOffSettledTurn(ctx, chat.id, { turnId, entities }, { registry, appendOut: async (row) => { out.push(row) } })
  return { chat, registry, received, events, audits, out, run }
}

describe('carriedRows', () => {
  test('stops at the settled turn: a later queued message is not carried', () => {
    const rows: ChatTranscriptRow[] = [
      ...TURN,
      { kind: 'user', ts: '2026-11-14T09:01:00.000Z', content: 'and another thing' },
      { kind: 'assistant', ts: '2026-11-14T09:01:01.000Z', turnId: 't2', content: 'Sure.' },
    ]
    expect(carriedRows(rows, 't1').map((row) => row.kind)).toEqual(['user', 'tool', 'assistant'])
  })

  test('bookkeeping rows are left behind; cards on tool rows travel', () => {
    const rows: ChatTranscriptRow[] = [
      { kind: 'handoff', ts: 't', handoffId: 'old', direction: 'out', peers: [] },
      ...TURN,
    ]
    const carried = carriedRows(rows, 't1')
    expect(carried.some((row) => row.kind === 'done' || row.kind === 'handoff')).toBe(false)
    expect(carried.find((row) => row.kind === 'tool')).toMatchObject({ metadata: { bakinEntities: [project] } })
  })

  test('attachments stay in the chat; the message keeps a note naming them', () => {
    const rows: ChatTranscriptRow[] = [
      { kind: 'user', ts: 't', content: 'use this brief', attachments: [{ name: 'brief.pdf', mimeType: 'application/pdf', path: '/x/brief.pdf' }] },
      { kind: 'assistant', ts: 't', turnId: 't1', content: 'Read it.' },
    ]
    const [first] = carriedRows(rows, 't1')
    expect(first).toEqual({ kind: 'user', ts: 't', content: 'use this brief\n\n_Attachment kept in the original chat: brief.pdf._' })
  })
})

describe('handOffSettledTurn', () => {
  test('one created target: it receives the history, the chat keeps a marker, the event says one of one', async () => {
    const t = await setup()
    await t.run([project])

    expect(t.received).toHaveLength(1)
    expect(t.received[0]).toMatchObject({ handoffId: `${t.chat.id}:t1:p-1`, target: { kind: 'projects:project', id: 'p-1' } })
    const [marker, ...carried] = t.received[0]!.rows
    expect(marker).toMatchObject({ kind: 'handoff', direction: 'in', peers: [{ entity: 'chat:chat', id: t.chat.id, title: 'Launch chat' }], carried: 3 })
    expect(carried.map((row) => row.kind)).toEqual(['user', 'tool', 'assistant'])

    expect(t.out).toMatchObject([{ kind: 'handoff', direction: 'out', peers: [{ entity: 'projects:project', id: 'p-1', title: 'Launch plan' }] }])
    expect(t.events).toEqual([{ event: 'chat.handoff', data: {
      chatId: t.chat.id, turnId: 't1', created: 1, targets: [{ entity: 'projects:project', id: 'p-1', title: 'Launch plan' }],
    } }])
  })

  test('two created targets each receive the history; the event says two', async () => {
    const t = await setup()
    const sessions: HandoffRequest[] = []
    t.registry.register('messaging', 'messaging:session', (request) => { sessions.push(request) })
    await t.run([project, session])

    expect(t.received).toHaveLength(1)
    expect(sessions).toHaveLength(1)
    expect(t.out[0]!.peers.map((peer) => peer.entity)).toEqual(['projects:project', 'messaging:session'])
    expect(t.events[0]!.data).toMatchObject({ created: 2 })
  })

  test('two created, one refuses: the other still gets it, the failure is audited, the event counts both', async () => {
    const t = await setup()
    t.registry.register('messaging', 'messaging:session', () => { throw new Error('session s-1 not found') })
    await t.run([project, session])

    expect(t.received).toHaveLength(1)
    expect(t.out[0]!.peers).toEqual([{ entity: 'projects:project', id: 'p-1', title: 'Launch plan' }])
    expect(t.events[0]!.data).toMatchObject({ created: 2, targets: [{ entity: 'projects:project', id: 'p-1' }] })
    expect(t.audits).toHaveLength(1)
    expect(t.audits[0]).toMatchObject(['chat.handoff.failed', 'system', { kind: 'messaging:session', id: 's-1' }])
  })

  test('every target refuses: no marker, an event with no targets', async () => {
    const t = await setup()
    t.registry.sweep('projects')
    t.registry.register('projects', 'projects:project', () => { throw new Error('gone') })
    await t.run([project])
    expect(t.out).toEqual([])
    expect(t.events[0]!.data).toMatchObject({ created: 1, targets: [] })
  })

  test('nothing that accepts a hand-off: no delivery, no marker, no event', async () => {
    const t = await setup()
    expect(await t.run([task])).toBeNull()
    expect(await t.run([{ ...project, action: 'updated' as never }])).toBeNull()
    expect(t.received).toEqual([])
    expect(t.out).toEqual([])
    expect(t.events).toEqual([])
  })

  test('the same target reported twice in one reply is handed off once', async () => {
    const t = await setup()
    await t.run([project, { ...project }])
    expect(t.received).toHaveLength(1)
    expect(t.events[0]!.data).toMatchObject({ created: 1 })
  })

  test('a second hand-off later in the same chat carries the whole chat so far, without the first marker', async () => {
    const t = await setup()
    await t.run([project])
    await appendTranscriptRow(t.chat.id, t.out[0]!)
    for (const row of [
      { kind: 'user', ts: '2026-11-14T10:00:00.000Z', content: 'now a second project' },
      { kind: 'assistant', ts: '2026-11-14T10:00:01.000Z', turnId: 't2', content: 'Done.' },
    ] as ChatTranscriptRow[]) await appendTranscriptRow(t.chat.id, row)

    await t.run([{ ...project, id: 'p-2', title: 'Second plan' }], 't2')
    const second = t.received[1]!
    expect(second.handoffId).toBe(`${t.chat.id}:t2:p-2`)
    expect(second.rows.slice(1).map((row) => row.kind)).toEqual(['user', 'tool', 'assistant', 'user', 'assistant'])
  })
})
