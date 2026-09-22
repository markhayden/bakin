/**
 * #907 item 5 ("the live Pi adapter appears to serve a cached roster — the
 * change may need a runtime reload") — disproven in-process: a model change
 * written through agents.update is what the very next turn sends to the
 * provider, with no restart() in between. Pi re-reads bakin-agents.json per
 * turn and refreshes its model registry on every catalog read, so there is
 * no roster cache to reset (the dirty-marker banner is a false alarm here;
 * restartAdvice() says needed:false).
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

// The Pi SDK calls global fetch; the happy-dom preload replaces it with a
// browser emulation that breaks real sockets (CORS preflight against the
// fake provider). Real HTTP goes through Bun's fetch.
globalThis.fetch = (Bun as unknown as { fetch: typeof fetch }).fetch

const testDir = join(tmpdir(), `bakin-test-pi-model-change-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = join(testDir, 'pi')
process.env.BAKIN_HOME = join(testDir, 'bakin')

const contentDirMock = () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ home: join(testDir, 'bakin'), db: join(testDir, 'bakin', 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { createPiRuntimeAdapter } from '../../../packages/adapter-pi/src/index'
import { resetPiHome } from '../../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../../packages/adapter-pi/src/models'
import { startFakeProvider, type FakeProvider, type FakeTurnScript } from './fake-provider'

let provider: FakeProvider
const adapter = createPiRuntimeAdapter()
let threadSeq = 0

function seedProvider(scripts: FakeTurnScript[]): FakeProvider {
  provider?.stop()
  provider = startFakeProvider(scripts)
  const agentDir = join(testDir, 'pi', 'agent')
  // Two models on ONE fake provider so a pin change is observable in the
  // request body without touching auth.
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({
    providers: {
      fakeai: {
        name: 'FakeAI',
        baseUrl: provider.url,
        api: 'openai-completions',
        models: ['fake-model', 'fake-model-2'].map((id) => ({
          id, name: id, input: ['text'], reasoning: false, contextWindow: 100000, maxTokens: 8000,
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        })),
      },
    },
  }))
  resetModelRegistry()
  return provider
}

const reply: FakeTurnScript[] = [{ steps: [{ text: 'ok' }], usage: { prompt: 2, completion: 1 } }]

beforeAll(async () => {
  resetPiHome()
  const agentDir = join(testDir, 'pi', 'agent')
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({ fakeai: { type: 'api_key', key: 'fake-key' } }))
  await adapter.initialize({
    contentDir: join(testDir, 'bakin'),
    settings: { retry: { enabled: false, provider: { maxRetries: 0 } } },
  })
  await adapter.provisionToolAccess()
})

afterAll(() => {
  provider?.stop()
  rmSync(testDir, { recursive: true, force: true })
})

describe('Pi applies a model change on the next turn — no restart (#907 item 5)', () => {
  test('agents.update(model) → the next send uses the new model; restartAdvice says needed:false', async () => {
    seedProvider(reply)
    await adapter.agents.update('main', { model: 'fakeai/fake-model' })
    await adapter.messaging.send({ agentId: 'main', content: 'first', threadId: `t:${++threadSeq}` })
    expect(provider.requests.at(-1)?.model).toBe('fake-model')

    // Repoint WITHOUT restart() — the equivalent of POST /selections.
    seedProvider(reply)
    await adapter.agents.update('main', { model: 'fakeai/fake-model-2' })
    expect(adapter.restartAdvice!('model-config')).toEqual({ needed: false })
    await adapter.messaging.send({ agentId: 'main', content: 'second', threadId: `t:${++threadSeq}` })
    expect(provider.requests.at(-1)?.model).toBe('fake-model-2')
  })
})
