/** Starting a conversation from Home (home-first-run plan, task 1.7): create, then send, and never lose what was typed. */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const testDir = join(tmpdir(), `bakin-test-home-start-chat-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { draftChatWith, startChat } from '../../../plugins/home/lib/client/start-chat'

type Call = { path: string; body: unknown }
function scripted(answers: Array<Response | Error>) {
  const calls: Call[] = []
  const drafts: Array<[string, string]> = []
  const fetch = (async (_pluginId: string, path: string, init?: RequestInit) => {
    calls.push({ path, body: JSON.parse(String(init?.body)) })
    const answer = answers.shift()
    if (!answer || answer instanceof Error) throw answer ?? new Error('unscripted request')
    return answer
  }) as never
  return { calls, drafts, deps: { fetch, saveDraft: (key: string, text: string) => { drafts.push([key, text]) } } }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('startChat', () => {
  it('creates the chat for the agent, then sends the message into it', async () => {
    const { calls, drafts, deps } = scripted([json({ chat: { id: 'c1' } }, 201), json({ ok: true }, 202)])
    expect(await startChat('main', 'Plan my week', deps)).toEqual({ chatId: 'c1', sent: true })
    expect(calls).toEqual([
      { path: 'chats', body: { agentId: 'main' } },
      { path: 'chats/c1/messages', body: { content: 'Plan my week' } },
    ])
    expect(drafts).toEqual([])
  })

  it('a chat that could not be created sends nothing and saves nothing: the caller still has the text', async () => {
    for (const answer of [json({ error: 'nope' }, 500), new Error('offline'), json({ chat: {} }, 201)]) {
      const { calls, drafts, deps } = scripted([answer])
      expect(await startChat('main', 'hello', deps)).toEqual({ chatId: null, sent: false })
      expect(calls).toHaveLength(1)
      expect(drafts).toEqual([])
    }
  })

  it('a message that did not send is left as that chat\'s draft, and the chat is still opened', async () => {
    for (const answer of [json({ error: 'busy' }, 409), new Error('connection reset')]) {
      const { drafts, deps } = scripted([json({ chat: { id: 'c2' } }, 201), answer])
      expect(await startChat('main', 'Research llamas', deps)).toEqual({ chatId: 'c2', sent: false })
      expect(drafts).toEqual([['chat:c2', 'Research llamas']])
    }
  })
})

describe('draftChatWith', () => {
  it('hands the words to Chat\'s draft composer for that agent and says where to go', () => {
    const drafts: Array<[string, string]> = []
    const path = draftChatWith('main', 'Please summarize the attached document.', { saveDraft: (key, text) => { drafts.push([key, text]) } })
    expect(path).toBe('/chat/new?agent=main')
    expect(drafts).toEqual([['chat-draft:main', 'Please summarize the attached document.']])
  })
})
