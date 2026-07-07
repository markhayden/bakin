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

import chatPlugin from '../../../plugins/chat'
import { appendTranscriptRow, createChat, listChats, readTranscript } from '../../../plugins/chat/lib/store'
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
  test('createChat + appendTranscriptRow maintain index and transcript', async () => {
    const chat = await createChat({ agentId: 'main' })
    expect(chat.messageCount).toBe(0)
    expect(chat.title).toBe('')

    await appendTranscriptRow(chat.id, { kind: 'user', ts: new Date().toISOString(), content: 'Hello there, agent friend' })
    await appendTranscriptRow(chat.id, { kind: 'tool', ts: new Date().toISOString(), summary: 'ran bash' })
    await appendTranscriptRow(chat.id, { kind: 'assistant', ts: new Date().toISOString(), content: 'Hi!' })

    const rows = readTranscript(chat.id)
    expect(rows.map((r) => r.kind)).toEqual(['user', 'tool', 'assistant'])

    const listed = listChats('main').find((c) => c.id === chat.id)
    expect(listed?.messageCount).toBe(2) // tool rows don't count
    expect(listed?.title).toBe('Hello there, agent friend') // titled from first user row
  })

  test('appendTranscriptRow to unknown chat throws', async () => {
    await expect(
      appendTranscriptRow('00000000-0000-0000-0000-000000000000', { kind: 'user', ts: '', content: 'x' }),
    ).rejects.toThrow('unknown chat')
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
})
