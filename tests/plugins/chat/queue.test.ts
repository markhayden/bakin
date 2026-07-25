/**
 * Chat plugin — queued follow-up messages (#729).
 *
 * DELIBERATE wire-contract change: a busy chat no longer 409s — POST
 * /chats/:chatId/messages enqueues (202 { queued: true }) and the queue
 * drains as ONE combined turn when the active turn settles. Queue
 * snapshots persist at chat/queue/<chatId>.json; boot restore drains
 * after the interrupted-turn sweep; delete-chat clears queue + files.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, readFileSync, rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-chat-queue-${Date.now()}`)

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
mock.module('../../../src/core/agent-cost', () => ({
  meterAgentTurn: async () => {},
  meterImageTurn: async () => {},
}))

import chatPlugin from '../../../plugins/chat'
import { createChat, readTranscript, readQueue } from '../../../plugins/chat/lib/store'
import { restoreQueues, startChatTurn, waitForTurn, isTurnInFlight } from '../../../plugins/chat/lib/stream-bridge'
import { activatePlugin, callRoute, findRoute, type ActivatedPlugin } from '../test-helpers'
import type { ChatChunk, MessageArgs } from '../../../packages/core/src/adapters/runtime/concepts'

let activated: ActivatedPlugin

function scriptStreams(scripts: Array<() => AsyncIterable<ChatChunk>>, capture?: MessageArgs[]) {
  activated.ctx.runtime.messaging.stream = ((args: MessageArgs) => {
    capture?.push(args)
    const next = scripts.shift() ?? (async function* () {
      yield { type: 'done' } as ChatChunk
    })
    return next()
  }) as typeof activated.ctx.runtime.messaging.stream
}

function gated(scripts: Array<() => AsyncIterable<ChatChunk>>) {
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  scripts.push(async function* () {
    await gate
    yield { type: 'done' } as ChatChunk
  })
  return () => release()
}

async function waitUntil(cond: () => boolean, label: string) {
  for (let i = 0; i < 300 && !cond(); i++) await new Promise((r) => setTimeout(r, 2))
  if (!cond()) throw new Error(`timed out waiting for ${label}`)
}

/** Settle everything: active turn + any drained turn it triggers. */
async function settleAll(chatId: string) {
  for (let i = 0; i < 10; i++) {
    await waitForTurn(chatId)
    if (!isTurnInFlight(chatId)) break
  }
}

beforeAll(async () => {
  activated = await activatePlugin(chatPlugin, testDir)
  await activated.ctx.runtime.agents.create({ id: 'main', name: 'Main' })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('chat queue — send route', () => {
  test('busy chat: POST enqueues with 202 {queued}, chat.queued fires, snapshot persists; drain runs ONE combined turn', async () => {
    const chat = await createChat({ agentId: 'main' })
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    const off = activated.ctx.events.on('chat.*', (event, data) => events.push({ event, data }))
    const scripts: Array<() => AsyncIterable<ChatChunk>> = []
    const seenArgs: MessageArgs[] = []
    const release = gated(scripts)
    scripts.push(async function* () {
      yield { type: 'text', content: 'combined answer' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })
    scriptStreams(scripts, seenArgs)

    expect(await startChatTurn(activated.ctx, chat.id, 'first')).toBe('accepted')
    const send = findRoute(activated.routes, 'POST', '/chats/:chatId/messages')!
    const q1 = await callRoute(send, activated.ctx, {
      path: `/chats/${chat.id}/messages`,
      body: { content: 'fix A' },
    })
    expect(q1.status).toBe(202)
    expect(q1.body).toMatchObject({ accepted: true, queued: true, queueLength: 1 })
    expect(typeof q1.body.queueId).toBe('string')
    const q2 = await callRoute(send, activated.ctx, {
      path: `/chats/${chat.id}/messages`,
      body: { content: 'also B' },
    })
    expect(q2.body).toMatchObject({ queued: true, queueLength: 2 })

    // chat.queued on the bus; snapshot durable on disk.
    expect(events.filter((e) => e.event === 'chat.queued')).toHaveLength(2)
    const queueFile = join(testDir, 'chat', 'queue', `${chat.id}.json`)
    expect(existsSync(queueFile)).toBe(true)
    expect(readFileSync(queueFile, 'utf-8')).toContain('fix A')

    // GET carries the queue for hydration.
    const get = findRoute(activated.routes, 'GET', '/chats/:chatId')!
    const before = await callRoute(get, activated.ctx, { path: `/chats/${chat.id}` })
    expect((before.body.queued as unknown[]).length).toBe(2)

    release()
    await settleAll(chat.id)
    await waitUntil(() => readQueue(chat.id).length === 0 && !isTurnInFlight(chat.id), 'drain settle')
    off()

    // ONE combined drained turn.
    expect(seenArgs).toHaveLength(2)
    expect(seenArgs[1].content).toContain('fix A\n\nalso B')
    const rows = readTranscript(chat.id)
    expect(rows.filter((r) => r.kind === 'user').map((r) => (r as { content: string }).content)).toEqual([
      'first', 'fix A', 'also B',
    ])
    const after = await callRoute(get, activated.ctx, { path: `/chats/${chat.id}` })
    expect((after.body.queued as unknown[]).length).toBe(0)
  })

  test('idle chat: POST is the normal 202 accept — no queued flag', async () => {
    const chat = await createChat({ agentId: 'main' })
    scriptStreams([])
    const send = findRoute(activated.routes, 'POST', '/chats/:chatId/messages')!
    const res = await callRoute(send, activated.ctx, {
      path: `/chats/${chat.id}/messages`,
      body: { content: 'hello' },
    })
    expect(res.status).toBe(202)
    expect(res.body.queued).toBeUndefined()
    await settleAll(chat.id)
  })

  test('attachment validation still runs BEFORE enqueue (traversal rejected while busy)', async () => {
    const chat = await createChat({ agentId: 'main' })
    const scripts: Array<() => AsyncIterable<ChatChunk>> = []
    const release = gated(scripts)
    scriptStreams(scripts)
    expect(await startChatTurn(activated.ctx, chat.id, 'first')).toBe('accepted')

    const send = findRoute(activated.routes, 'POST', '/chats/:chatId/messages')!
    const dir = join(testDir, 'chat', 'attachments', chat.id)
    const sneaky = await callRoute(send, activated.ctx, {
      path: `/chats/${chat.id}/messages`,
      body: {
        content: 'queued with a bad path',
        attachments: [{ name: 'x.png', mimeType: 'image/png', path: `${dir}/../../../../index.json` }],
      },
    })
    expect(sneaky.status).toBe(400)
    expect(readQueue(chat.id)).toHaveLength(0)
    release()
    await settleAll(chat.id)
  })
})

describe('chat queue — management', () => {
  test('DELETE /chats/:chatId/queued/:queueId removes one item; unknown id 404s', async () => {
    const chat = await createChat({ agentId: 'main' })
    const scripts: Array<() => AsyncIterable<ChatChunk>> = []
    const release = gated(scripts)
    scriptStreams(scripts)
    expect(await startChatTurn(activated.ctx, chat.id, 'first')).toBe('accepted')

    const send = findRoute(activated.routes, 'POST', '/chats/:chatId/messages')!
    const q = await callRoute(send, activated.ctx, { path: `/chats/${chat.id}/messages`, body: { content: 'oops' } })
    const queueId = q.body.queueId as string

    const del = findRoute(activated.routes, 'DELETE', '/chats/:chatId/queued/:queueId')!
    const removed = await callRoute(del, activated.ctx, { path: `/chats/${chat.id}/queued/${queueId}` })
    expect(removed.status).toBe(200)
    expect(readQueue(chat.id)).toHaveLength(0)
    const again = await callRoute(del, activated.ctx, { path: `/chats/${chat.id}/queued/${queueId}` })
    expect(again.status).toBe(404)

    release()
    await settleAll(chat.id)
    // Removed message never reached the runtime.
    expect(readTranscript(chat.id).filter((r) => r.kind === 'user')).toHaveLength(1)
  })

  test('deleting the chat mid-queue aborts, clears the queue file, and never drains', async () => {
    const chat = await createChat({ agentId: 'main' })
    const scripts: Array<() => AsyncIterable<ChatChunk>> = []
    const seenArgs: MessageArgs[] = []
    const release = gated(scripts)
    scriptStreams(scripts, seenArgs)
    expect(await startChatTurn(activated.ctx, chat.id, 'first')).toBe('accepted')

    const send = findRoute(activated.routes, 'POST', '/chats/:chatId/messages')!
    await callRoute(send, activated.ctx, { path: `/chats/${chat.id}/messages`, body: { content: 'orphan' } })
    const queueFile = join(testDir, 'chat', 'queue', `${chat.id}.json`)
    expect(existsSync(queueFile)).toBe(true)

    const del = findRoute(activated.routes, 'DELETE', '/chats/:chatId')!
    const res = await callRoute(del, activated.ctx, { path: `/chats/${chat.id}` })
    expect(res.status).toBe(200)
    release()
    await settleAll(chat.id)
    await new Promise((r) => setTimeout(r, 30))
    expect(existsSync(queueFile)).toBe(false)
    // The orphaned message never became a turn.
    expect(seenArgs.filter((a) => a.content.includes('orphan'))).toHaveLength(0)
  })
})

describe('chat queue — boot restore', () => {
  test('restoreQueues drains persisted queues (restart with queued items)', async () => {
    const chat = await createChat({ agentId: 'main' })
    const scripts: Array<() => AsyncIterable<ChatChunk>> = []
    const seenArgs: MessageArgs[] = []
    const release = gated(scripts)
    scripts.push(async function* () {
      yield { type: 'text', content: 'post-restart answer' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })
    scriptStreams(scripts, seenArgs)

    // A live enqueue drains normally; the restart case is a queue FILE with
    // no in-memory engine state (the in-flight map dies with the process) —
    // simulate it by writing the snapshot directly and calling restore.
    expect(await startChatTurn(activated.ctx, chat.id, 'first')).toBe('accepted')
    release()
    await settleAll(chat.id)
    await waitUntil(() => !isTurnInFlight(chat.id), 'first turn settle')

    const { writeQueue } = await import('../../../plugins/chat/lib/store')
    await writeQueue(chat.id, [
      { id: 'boot-1', ts: new Date().toISOString(), content: 'restored instruction', agentId: 'main' },
    ])
    scripts.push(async function* () {
      yield { type: 'text', content: 'handled' } as ChatChunk
      yield { type: 'done' } as ChatChunk
    })
    await restoreQueues(activated.ctx)
    await waitUntil(() => seenArgs.some((a) => a.content.includes('restored instruction')), 'boot drain')
    await settleAll(chat.id)
    expect(readQueue(chat.id)).toHaveLength(0)
    const users = readTranscript(chat.id).filter((r) => r.kind === 'user').map((r) => (r as { content: string }).content)
    expect(users).toContain('restored instruction')
  })
})
