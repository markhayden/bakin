/**
 * adapter-pi P10 — usage flows end-to-end from a REAL Pi session file
 * (produced by a real SDK turn against the fake provider) through the
 * memory tier surface into core's session-usage parser. No transform
 * layer: Pi's on-disk shape IS the parser contract.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

globalThis.fetch = (Bun as unknown as { fetch: typeof fetch }).fetch

const testDir = join(tmpdir(), `bakin-test-pi-usage-${Date.now()}-${randomUUID()}`)
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
import { SESSION_TIER_ID, DURABLE_TIER_ID } from '../../../packages/adapter-pi/src/memory'
import { parseSessionUsageMessages } from '../../../src/core/agent-usage'
import { startFakeProvider, type FakeProvider } from './fake-provider'

let provider: FakeProvider
const adapter = createPiRuntimeAdapter()

beforeAll(async () => {
  resetPiHome()
  const agentDir = join(testDir, 'pi', 'agent')
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({ fakeai: { type: 'api_key', key: 'k' } }))
  provider = startFakeProvider([
    { steps: [{ text: 'usage turn one' }], usage: { prompt: 100, completion: 25 } },
    { steps: [{ text: 'usage turn two' }], usage: { prompt: 200, completion: 50 } },
  ])
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({
    providers: {
      fakeai: {
        name: 'FakeAI',
        baseUrl: provider.url,
        api: 'openai-completions',
        models: [{ id: 'fake-model', name: 'Fake Model', input: ['text'], reasoning: false, contextWindow: 100000, maxTokens: 8000, cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } }],
      },
    },
  }))
  resetModelRegistry()
  await adapter.initialize({ contentDir: join(testDir, 'bakin'), settings: { retry: { enabled: false } } })
  await adapter.provisionToolAccess() // seeds main (write-free initialize)
  await adapter.agents.update('main', { model: 'fakeai/fake-model' })
  await adapter.messaging.send({ agentId: 'main', content: 'one', threadId: 'task:usage:d1' })
  await adapter.messaging.send({ agentId: 'main', content: 'two', threadId: 'task:usage:d1' })
})

afterAll(() => {
  provider?.stop()
  rmSync(testDir, { recursive: true, force: true })
})

describe('memory tiers → usage scan', () => {
  test('session tier is discoverable by sourceKind session_jsonl', async () => {
    const tiers = await adapter.memory.listTiers()
    const sessionTier = tiers.find((t) => t.metadata?.sourceKind === 'session_jsonl')
    expect(sessionTier?.id).toBe(SESSION_TIER_ID)
    expect(tiers.some((t) => t.id === DURABLE_TIER_ID)).toBe(true)
  })

  test('real Pi session content parses through core parser with tokens AND cost', async () => {
    const entries = await adapter.memory.listEntries(SESSION_TIER_ID, { agentId: 'main' })
    expect(entries.length).toBeGreaterThan(0)

    const stat = await adapter.memory.statEntry(SESSION_TIER_ID, entries[0].id, { agentId: 'main' })
    expect(stat!.size).toBeGreaterThan(0)
    expect(stat!.mtimeMs).toBeGreaterThan(0)

    const full = await adapter.memory.getEntry(SESSION_TIER_ID, entries[0].id, { agentId: 'main' })
    const parsed = parseSessionUsageMessages(full!.content)
    expect(parsed.integrity).toEqual({ status: 'complete', malformedLines: 0 })
    expect(parsed.sessionId).toBeTruthy()
    expect(parsed.messages.length).toBe(2)
    expect(parsed.messages[0].model).toBe('fake-model')
    expect(parsed.messages[0].tokens.input).toBe(100)
    expect(parsed.messages[0].tokens.output).toBe(25)
    expect(parsed.messages[0].tokens.total).toBe(125)
    expect(parsed.messages[1].tokens.total).toBe(250)
    // Cost computed by Pi from the model's cost table.
    expect(parsed.messages[0].cost?.total).toBeGreaterThan(0)
  })

  test('entry ids cannot traverse out of the tier', async () => {
    await expect(adapter.memory.getEntry(SESSION_TIER_ID, '../../escape', { agentId: 'main' })).rejects.toThrow('escapes')
  })

  test('watchPaths + resolvePath stay inside the Pi home', async () => {
    const paths = await adapter.memory.watchPaths()
    expect(paths.length).toBe(1)
    expect(paths[0]).toContain(join('pi', 'agent', 'agents'))
    expect(await adapter.memory.resolvePath('/etc/passwd')).toBeNull()
  })
})
