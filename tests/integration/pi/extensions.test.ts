/**
 * adapter-pi #626 — Pi extension loading policy in Bakin-driven turns.
 * A fixture extension registers a tool; a broken one throws at load (must
 * be contained, never failing the turn). Policy: all (default) /
 * allowlist / none via settings.runtime.settings.piExtensions.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

globalThis.fetch = (Bun as unknown as { fetch: typeof fetch }).fetch

const testDir = join(tmpdir(), `bakin-test-pi-ext-${Date.now()}-${randomUUID()}`)
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

const FIXTURE_EXTENSION = `
export default function (pi) {
  pi.registerTool({
    name: 'ext_fixture_echo',
    label: 'ext_fixture_echo',
    description: 'Fixture extension tool',
    parameters: { type: 'object', properties: { word: { type: 'string' } }, required: ['word'] },
    async execute(_id, params) {
      return { content: [{ type: 'text', text: 'ext says ' + params.word }], details: undefined }
    },
  })
}
`

let provider: FakeProvider

function seedProvider(scripts: FakeTurnScript[]): FakeProvider {
  provider?.stop()
  provider = startFakeProvider(scripts)
  writeFileSync(join(testDir, 'pi', 'agent', 'models.json'), JSON.stringify({
    providers: {
      fakeai: { name: 'F', baseUrl: provider.url, api: 'openai-completions', models: [{ id: 'fake-model', name: 'FM', input: ['text'], reasoning: false, contextWindow: 100000, maxTokens: 8000, cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }] },
    },
  }))
  resetModelRegistry()
  return provider
}

function requestToolNames(req: unknown): string[] {
  const tools = (req as { tools?: Array<{ function?: { name?: string }; name?: string }> }).tools ?? []
  return tools.map((t) => t.function?.name ?? t.name ?? '').filter(Boolean)
}

async function adapterWithPolicy(policy: Record<string, unknown> | undefined) {
  const adapter = createPiRuntimeAdapter()
  await adapter.initialize({
    contentDir: join(testDir, 'bakin'),
    settings: { retry: { enabled: false }, ...(policy ? { piExtensions: policy } : {}) },
  })
  await adapter.provisionToolAccess() // seeds main (write-free initialize)
  await adapter.agents.update('main', { model: 'fakeai/fake-model' })
  return adapter
}

beforeAll(() => {
  resetPiHome()
  const extDir = join(testDir, 'pi', 'agent', 'extensions')
  mkdirSync(extDir, { recursive: true })
  writeFileSync(join(extDir, 'bakin-fixture.ts'), FIXTURE_EXTENSION)
  writeFileSync(join(extDir, 'broken.ts'), 'throw new Error("broken extension on purpose")\n')
  writeFileSync(join(testDir, 'pi', 'agent', 'auth.json'), JSON.stringify({ fakeai: { type: 'api_key', key: 'k' } }))
})

afterAll(() => {
  provider?.stop()
  rmSync(testDir, { recursive: true, force: true })
})

describe('pi extension policy', () => {
  test("DEFAULT ('allowlist', empty): discovered extensions stay INERT until approved (WS4 flip)", async () => {
    const fake = seedProvider([{ steps: [{ text: 'no ext by default' }] }])
    const adapter = await adapterWithPolicy(undefined)
    await adapter.messaging.send({ agentId: 'main', content: 'plain' })
    expect(requestToolNames(fake.requests[0])).not.toContain('ext_fixture_echo')
  })

  test("'all': extension tool is live and callable; broken extension is contained", async () => {
    const fake = seedProvider([
      { steps: [{ toolCall: { name: 'ext_fixture_echo', args: { word: 'hello' } } }] },
      { steps: [{ text: 'ext round trip done' }] },
    ])
    const adapter = await adapterWithPolicy({ mode: 'all' })
    const result = await adapter.messaging.send({ agentId: 'main', content: 'use the ext tool' })
    expect(result.content).toBe('ext round trip done')
    expect(requestToolNames(fake.requests[0])).toContain('ext_fixture_echo')
    // The extension's execution result reached the second provider request.
    expect(JSON.stringify(fake.requests[1])).toContain('ext says hello')
  })

  test("'none': extension tools absent from the model's tool list", async () => {
    const fake = seedProvider([{ steps: [{ text: 'no ext' }] }])
    const adapter = await adapterWithPolicy({ mode: 'none' })
    await adapter.messaging.send({ agentId: 'main', content: 'plain' })
    expect(requestToolNames(fake.requests[0])).not.toContain('ext_fixture_echo')
  })

  test("'allowlist': matching pattern loads, non-matching drops", async () => {
    const fake = seedProvider([{ steps: [{ text: 'a' }] }, { steps: [{ text: 'b' }] }])
    const allowed = await adapterWithPolicy({ mode: 'allowlist', allow: ['bakin-fixture'] })
    await allowed.messaging.send({ agentId: 'main', content: 'x' })
    expect(requestToolNames(fake.requests[0])).toContain('ext_fixture_echo')

    const denied = await adapterWithPolicy({ mode: 'allowlist', allow: ['something-else'] })
    await denied.messaging.send({ agentId: 'main', content: 'y' })
    expect(requestToolNames(fake.requests[1])).not.toContain('ext_fixture_echo')
  })
})
