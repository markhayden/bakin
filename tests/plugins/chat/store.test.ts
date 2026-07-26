/**
 * Chat plugin — store + CRUD route tests (C2).
 * All storage isolated to a temp dir via the content-dir mocks.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-chat-${Date.now()}`)

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
  createLogger: () => ({
    info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  }),
}))

import { appendFileSync } from 'fs'

import chatPlugin from '../../../plugins/chat'
import { appendTranscriptRow, createChat, listChats, markSeen, readTranscript, setPinned, setTitle } from '../../../plugins/chat/lib/store'
import { activatePlugin, callRoute, findRoute, type ActivatedPlugin } from '../test-helpers'

let activated: ActivatedPlugin

beforeAll(async () => {
  activated = await activatePlugin(chatPlugin, testDir)
  await activated.ctx.runtime.agents.create({ id: 'main', name: 'Main' })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('chat store', () => {
  test('createChat + appendTranscriptRow maintain index and transcript (v2 rows)', async () => {
    const chat = await createChat({ agentId: 'main' })
    expect(chat.messageCount).toBe(0)
    expect(chat.title).toBe('')
    expect(chat.titleSource).toBe('fallback')
    expect(chat.pinned).toBe(false)
    expect(chat.unreadCount).toBe(0)

    await appendTranscriptRow(chat.id, { kind: 'user', ts: new Date().toISOString(), content: 'Hello there, agent friend' })
    await appendTranscriptRow(chat.id, {
      kind: 'tool', ts: new Date().toISOString(), turnId: 't1', callId: 'c1',
      toolName: 'bash', status: 'completed', summary: 'ran bash', durationMs: 40,
    })
    await appendTranscriptRow(chat.id, { kind: 'assistant', ts: new Date().toISOString(), turnId: 't1', content: 'Hi!' })

    const rows = readTranscript(chat.id)
    expect(rows.map((r) => r.kind)).toEqual(['user', 'tool', 'assistant'])
    expect(rows[1]).toMatchObject({ toolName: 'bash', status: 'completed', summary: 'ran bash', callId: 'c1', turnId: 't1' })

    const listed = listChats('main').find((c) => c.id === chat.id)
    expect(listed?.messageCount).toBe(2) // tool rows don't count
    expect(listed?.title).toBe('Hello there, agent friend') // titled from first user row
    expect(listed?.unreadCount).toBe(1) // the assistant reply is unseen
    expect(listed?.lastMessagePreview).toBe('Hi!')
  })

  test('legacy v1 tool rows parse leniently into structured summary-only rows', async () => {
    const chat = await createChat({ agentId: 'main' })
    appendFileSync(
      join(testDir, 'chat', `${chat.id}.jsonl`),
      `${JSON.stringify({ kind: 'tool', ts: new Date().toISOString(), summary: 'bash: curl -s example.com' })}\n`,
    )
    const rows = readTranscript(chat.id)
    expect(rows[0]).toMatchObject({ kind: 'tool', toolName: 'bash', status: 'completed', summary: 'curl -s example.com' })
  })

  test('markSeen clears unread; a user send also clears it', async () => {
    const chat = await createChat({ agentId: 'main' })
    await appendTranscriptRow(chat.id, { kind: 'assistant', ts: new Date().toISOString(), content: 'ping' })
    await appendTranscriptRow(chat.id, { kind: 'assistant', ts: new Date().toISOString(), content: 'ping again' })
    expect(listChats().find((c) => c.id === chat.id)?.unreadCount).toBe(2)

    const seen = await markSeen(chat.id)
    expect(seen?.unreadCount).toBe(0)
    expect(seen?.lastSeenAt).toBeTruthy()

    await appendTranscriptRow(chat.id, { kind: 'assistant', ts: new Date().toISOString(), content: 'ping 3' })
    await appendTranscriptRow(chat.id, { kind: 'user', ts: new Date().toISOString(), content: 'saw it' })
    expect(listChats().find((c) => c.id === chat.id)?.unreadCount).toBe(0)
  })

  test('setTitle precedence: user renames beat llm; llm beats fallback and never overwrites user', async () => {
    const chat = await createChat({ agentId: 'main' })
    await appendTranscriptRow(chat.id, { kind: 'user', ts: new Date().toISOString(), content: 'first message title seed' })
    expect((await setTitle(chat.id, 'LLM title', 'llm'))?.title).toBe('LLM title')
    expect((await setTitle(chat.id, 'My rename', 'user'))?.title).toBe('My rename')
    const after = await setTitle(chat.id, 'LLM tries again', 'llm')
    expect(after?.title).toBe('My rename')
    expect(after?.titleSource).toBe('user')
  })

  test('pinned chats sort first in listChats', async () => {
    const a = await createChat({ agentId: 'main' })
    const b = await createChat({ agentId: 'main' })
    await appendTranscriptRow(b.id, { kind: 'user', ts: new Date().toISOString(), content: 'newer activity' })
    await setPinned(a.id, true)
    const ids = listChats().map((c) => c.id)
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id))
  })

  test('appendTranscriptRow to unknown chat throws', async () => {
    await expect(
      appendTranscriptRow('00000000-0000-0000-0000-000000000000', { kind: 'user', ts: '', content: 'x' }),
    ).rejects.toThrow('unknown chat')
  })

  test('done marker rows bump NOTHING — no messageCount/unread/preview (#735); new chats are marker-era', async () => {
    const chat = await createChat({ agentId: 'main' })
    expect(chat.markerEra).toBe(true)
    await appendTranscriptRow(chat.id, { kind: 'user', ts: new Date().toISOString(), content: 'question' })
    await appendTranscriptRow(chat.id, { kind: 'assistant', ts: new Date().toISOString(), turnId: 't1', content: 'answer' })
    const before = listChats().find((c) => c.id === chat.id)!

    await appendTranscriptRow(chat.id, { kind: 'done', ts: new Date().toISOString(), turnId: 't1' })
    const after = listChats().find((c) => c.id === chat.id)!
    expect(after.messageCount).toBe(before.messageCount)
    expect(after.unreadCount).toBe(before.unreadCount)
    expect(after.lastMessagePreview).toBe(before.lastMessagePreview)
    expect(after.lastMessageAt).toBe(before.lastMessageAt)
    expect(readTranscript(chat.id).map((r) => r.kind)).toEqual(['user', 'assistant', 'done'])
  })
})

describe('chat routes v2', () => {
  test('PATCH /chats/:chatId renames (user precedence) and pins', async () => {
    const post = findRoute(activated.routes, 'POST', '/chats')!
    const created = await callRoute(post, activated.ctx, { body: { agentId: 'main' } })
    const chatId = (created.body.chat as { id: string }).id

    const patch = findRoute(activated.routes, 'PATCH', '/chats/:chatId')!
    const renamed = await callRoute(patch, activated.ctx, { path: `/chats/${chatId}`, body: { title: 'Ops standup', pinned: true } })
    expect(renamed.status).toBe(200)
    expect(renamed.body.chat).toMatchObject({ title: 'Ops standup', titleSource: 'user', pinned: true })

    const missing = await callRoute(patch, activated.ctx, { path: '/chats/00000000-0000-0000-0000-000000000000', body: { title: 'x' } })
    expect(missing.status).toBe(404)
  })

  test('POST /chats/:chatId/seen clears unread; list carries unreadCount + streaming', async () => {
    const post = findRoute(activated.routes, 'POST', '/chats')!
    const created = await callRoute(post, activated.ctx, { body: { agentId: 'main' } })
    const chatId = (created.body.chat as { id: string }).id
    await appendTranscriptRow(chatId, { kind: 'assistant', ts: new Date().toISOString(), content: 'unseen reply' })

    const list = findRoute(activated.routes, 'GET', '/chats')!
    const listed = await callRoute(list, activated.ctx)
    const row = (listed.body.chats as Array<{ id: string; unreadCount: number; streaming: boolean }>).find((c) => c.id === chatId)
    expect(row?.unreadCount).toBe(1)
    expect(row?.streaming).toBe(false)

    const seen = findRoute(activated.routes, 'POST', '/chats/:chatId/seen')!
    const marked = await callRoute(seen, activated.ctx, { path: `/chats/${chatId}/seen` })
    expect(marked.status).toBe(200)
    expect((marked.body.chat as { unreadCount: number }).unreadCount).toBe(0)
  })

  test('POST /chats/:chatId/abort is 409 when idle, 404 when unknown', async () => {
    const post = findRoute(activated.routes, 'POST', '/chats')!
    const created = await callRoute(post, activated.ctx, { body: { agentId: 'main' } })
    const chatId = (created.body.chat as { id: string }).id

    const abort = findRoute(activated.routes, 'POST', '/chats/:chatId/abort')!
    const idle = await callRoute(abort, activated.ctx, { path: `/chats/${chatId}/abort` })
    expect(idle.status).toBe(409)
    const missing = await callRoute(abort, activated.ctx, { path: '/chats/00000000-0000-0000-0000-000000000000/abort' })
    expect(missing.status).toBe(404)
  })
})

describe('chat routes', () => {
  test('POST /chats validates the agent against the runtime roster', async () => {
    const post = findRoute(activated.routes, 'POST', '/chats')!
    const missing = await callRoute(post, activated.ctx, { body: { agentId: 'ghost' } })
    expect(missing.status).toBe(404)

    const created = await callRoute(post, activated.ctx, { body: { agentId: 'main', title: 'Test chat' } })
    expect(created.status).toBe(201)
    const chat = created.body.chat as { id: string; agentId: string; title: string }
    expect(chat.agentId).toBe('main')
    expect(chat.title).toBe('Test chat')
    expect(existsSync(join(testDir, 'chat', `${chat.id}.jsonl`))).toBe(true)
  })

  test('GET /chats lists and filters; GET/DELETE round-trip', async () => {
    const list = findRoute(activated.routes, 'GET', '/chats')!
    const all = await callRoute(list, activated.ctx)
    expect((all.body.chats as unknown[]).length).toBeGreaterThanOrEqual(1)

    const filtered = await callRoute(list, activated.ctx, { searchParams: { agent: 'nobody' } })
    expect((filtered.body.chats as unknown[]).length).toBe(0)

    const post = findRoute(activated.routes, 'POST', '/chats')!
    const created = await callRoute(post, activated.ctx, { body: { agentId: 'main' } })
    const chatId = (created.body.chat as { id: string }).id

    const get = findRoute(activated.routes, 'GET', '/chats/:chatId')!
    const got = await callRoute(get, activated.ctx, { path: `/chats/${chatId}` })
    expect(got.status).toBe(200)
    expect(Array.isArray(got.body.messages)).toBe(true)

    const del = findRoute(activated.routes, 'DELETE', '/chats/:chatId')!
    const deleted = await callRoute(del, activated.ctx, { path: `/chats/${chatId}` })
    expect(deleted.status).toBe(200)
    expect(existsSync(join(testDir, 'chat', `${chatId}.jsonl`))).toBe(false)

    const gone = await callRoute(get, activated.ctx, { path: `/chats/${chatId}` })
    expect(gone.status).toBe(404)
  })

  test('GET /chats/:chatId serves done marker rows to the client (#735 — the fold hides them, the wire does not)', async () => {
    const chat = await createChat({ agentId: 'main' })
    await appendTranscriptRow(chat.id, { kind: 'user', ts: new Date().toISOString(), content: 'q' })
    await appendTranscriptRow(chat.id, { kind: 'assistant', ts: new Date().toISOString(), turnId: 't1', content: 'a' })
    await appendTranscriptRow(chat.id, { kind: 'done', ts: new Date().toISOString(), turnId: 't1' })

    const get = findRoute(activated.routes, 'GET', '/chats/:chatId')!
    const got = await callRoute(get, activated.ctx, { path: `/chats/${chat.id}` })
    expect(got.status).toBe(200)
    const kinds = (got.body.messages as Array<{ kind: string }>).map((m) => m.kind)
    expect(kinds).toEqual(['user', 'assistant', 'done'])
  })
})
