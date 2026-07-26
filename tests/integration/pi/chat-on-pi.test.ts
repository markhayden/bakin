/**
 * adapter-pi P13 — the chat core plugin runs against the REAL Pi adapter
 * (fake provider): user message → runtime.messaging.stream → SSE events +
 * durable transcript. Chat was proven live on OpenClaw in PR-2; this
 * closes the "both runtimes" half of success criterion 7.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

globalThis.fetch = (Bun as unknown as { fetch: typeof fetch }).fetch

const testDir = join(tmpdir(), `bakin-test-chat-on-pi-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = join(testDir, 'pi')
process.env.BAKIN_HOME = join(testDir, 'bakin')

function testPaths() {
  const home = join(testDir, 'bakin')
  return {
    home,
    chat: join(home, 'chat'),
    db: join(home, 'bakin.db'),
    settings: join(home, 'settings.json'),
  }
}
const contentDirMock = () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: testPaths,
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { createPiRuntimeAdapter } from '../../../packages/adapter-pi/src/index'
import { resetPiHome } from '../../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../../packages/adapter-pi/src/models'
import { createChat, readTranscript } from '../../../plugins/chat/lib/store'
import { startChatTurn, waitForTurn } from '../../../plugins/chat/lib/stream-bridge'
import { BakinEventBus } from '../../../packages/core/src/events/event-bus'
import { startFakeProvider, type FakeProvider } from './fake-provider'

let provider: FakeProvider
const adapter = createPiRuntimeAdapter()

beforeAll(async () => {
  resetPiHome()
  const agentDir = join(testDir, 'pi', 'agent')
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({ fakeai: { type: 'api_key', key: 'k' } }))
  provider = startFakeProvider([
    { steps: [{ text: 'Hello from Pi, via the chat plugin.' }] },
  ])
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({
    providers: {
      fakeai: { name: 'F', baseUrl: provider.url, api: 'openai-completions', models: [{ id: 'fake-model', name: 'FM', input: ['text'], reasoning: false, contextWindow: 100000, maxTokens: 8000, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }] },
    },
  }))
  resetModelRegistry()
  await adapter.initialize({ contentDir: join(testDir, 'bakin'), settings: { retry: { enabled: false } } })
  await adapter.provisionToolAccess() // seeds main (write-free initialize)
  await adapter.agents.update('main', { model: 'fakeai/fake-model' })
})

afterAll(() => {
  provider?.stop()
  rmSync(testDir, { recursive: true, force: true })
})

describe('chat plugin on the Pi runtime', () => {
  test('full turn: SSE chunk/done events + durable transcript + Pi session threadId mapping', async () => {
    const events: string[] = []
    const bus = new BakinEventBus(() => {})
    bus.on('chat.*', (event) => events.push(event))

    const chat = await createChat({ agentId: 'main' })
    const ctx = { runtime: adapter, events: bus } as never
    expect(await startChatTurn(ctx, chat.id, 'hello over there')).toBe('accepted')
    await waitForTurn(chat.id)

    expect(events).toContain('chat.chunk')
    expect(events.at(-1)).toBe('chat.done')

    const rows = readTranscript(chat.id)
    // Trailing done marker: every settled chat turn ends terminal (#735).
    expect(rows.map((r) => r.kind)).toEqual(['user', 'assistant', 'done'])
    expect(rows[1]).toMatchObject({ content: 'Hello from Pi, via the chat plugin.' })

    // The runtime session persisted under the chat thread mapping.
    const { getThreadSessionFile } = await import('../../../packages/adapter-pi/src/sessions')
    expect(getThreadSessionFile('main', `chat:${chat.id}`)).not.toBeNull()
  })
})
