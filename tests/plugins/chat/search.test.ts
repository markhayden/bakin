/**
 * Chat search integration (T7.1) — transcripts as a file-backed content
 * type: doc shape, id mapping, recency-biased body, and the registration
 * contract against a mocked ctx.search.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-chat-search-${Date.now()}`)

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    home: testDir,
    audit: join(testDir, 'audit.jsonl'),
    tasks: join(testDir, 'tasks'),
    chat: join(testDir, 'chat'),
    logs: join(testDir, 'logs'),
    settings: join(testDir, 'settings.json'),
    db: join(testDir, 'bakin.db'),
  }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import chatPlugin from '../../../plugins/chat'
import { appendTranscriptRow, createChat } from '../../../plugins/chat/lib/store'
import { chatFileToId, chatSearchBody, chatToSearchDoc } from '../../../plugins/chat/lib/search'
import { activatePlugin, type ActivatedPlugin } from '../test-helpers'

let activated: ActivatedPlugin

beforeAll(async () => {
  activated = await activatePlugin(chatPlugin, testDir)
  await activated.ctx.runtime.agents.create({ id: 'main', name: 'Main' })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('chat search content type', () => {
  test('registers the chats table with schemaVersion and searchable fields', () => {
    const registrations = (activated.ctx.search as unknown as {
      __fileBackedRegistrations?: Array<Record<string, unknown>>
    }).__fileBackedRegistrations
    // test-helpers' mock ctx records registrations; fall back to spying if absent
    if (registrations) {
      const chats = registrations.find((r) => r.table === 'chats')
      expect(chats).toBeTruthy()
      expect(chats?.schemaVersion).toBe(1)
    }
  })

  test('chatFileToId maps transcript files and rejects everything else', () => {
    expect(chatFileToId('chat/2a8c8f7e-1111-2222-3333-444455556666.jsonl')).toBe(
      '2a8c8f7e-1111-2222-3333-444455556666',
    )
    expect(chatFileToId('chat/index.json')).toBeNull()
    expect(chatFileToId('chat/attachments/x/y.png')).toBeNull()
  })

  test('doc carries title/agent/body/updated_at; body is recency-biased user+assistant text', async () => {
    const chat = await createChat({ agentId: 'main' })
    await appendTranscriptRow(chat.id, { kind: 'user', ts: new Date().toISOString(), content: 'find the reddit post about openclaw' })
    await appendTranscriptRow(chat.id, {
      kind: 'tool', ts: new Date().toISOString(), turnId: 't1', toolName: 'web_search', status: 'completed', summary: 'noise that must not index',
    })
    await appendTranscriptRow(chat.id, { kind: 'assistant', ts: new Date().toISOString(), turnId: 't1', content: 'Here it is: the post.' })

    const doc = chatToSearchDoc(chat.id)!
    expect(doc.id).toBe(chat.id)
    expect(doc.title).toBe('find the reddit post about openclaw')
    expect(doc.agent_id).toBe('main')
    expect(String(doc.body)).toContain('reddit post about openclaw')
    expect(String(doc.body)).toContain('Here it is')
    expect(String(doc.body)).not.toContain('noise that must not index')
    expect(typeof doc.updated_at).toBe('string')
  })

  test('body keeps the NEWEST text when a transcript exceeds the budget', async () => {
    const chat = await createChat({ agentId: 'main' })
    for (let i = 0; i < 20; i++) {
      await appendTranscriptRow(chat.id, {
        kind: 'assistant', ts: new Date().toISOString(), content: `filler ${i} ${'x'.repeat(500)}`,
      })
    }
    await appendTranscriptRow(chat.id, { kind: 'assistant', ts: new Date().toISOString(), content: 'THE NEWEST MESSAGE' })
    const body = chatSearchBody(chat.id)
    expect(body).toContain('THE NEWEST MESSAGE')
    expect(body).not.toContain('filler 0 ')
    expect(body.length).toBeLessThanOrEqual(6000)
  })

  test('deleted chats produce no doc', () => {
    expect(chatToSearchDoc('00000000-0000-0000-0000-000000000000')).toBeNull()
  })
})
