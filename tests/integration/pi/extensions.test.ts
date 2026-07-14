/**
 * adapter-pi #626 — Pi extension loading policy in Bakin-driven turns.
 * A fixture extension registers a tool; a broken one throws at load (must
 * be contained, never failing the turn). Policy: all (default) /
 * allowlist / none via settings.runtime.settings.piExtensions.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
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

const allowEntry = (p: string) => ({ path: realpathSync(p), sha256: createHash('sha256').update(readFileSync(p)).digest('hex') })

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

/**
 * The security fixture: its module TOP LEVEL writes a sentinel. If the loader
 * imports it, the file exists — proving whether unapproved code ran, which no
 * tool-list assertion can show (a post-load filter hides tools but the module
 * already executed).
 */
const SENTINEL = join(testDir, 'UNAPPROVED-CODE-RAN')
const SIDE_EFFECT_EXTENSION = `
import { writeFileSync } from 'fs'
writeFileSync(${JSON.stringify(SENTINEL)}, 'imported')
export default function (pi) {
  pi.registerTool({
    name: 'ext_sideeffect_noop',
    label: 'ext_sideeffect_noop',
    description: 'never approved',
    parameters: { type: 'object', properties: {} },
    async execute() { return { content: [], details: undefined } },
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
  writeFileSync(join(extDir, 'side-effect.ts'), SIDE_EFFECT_EXTENSION)
  writeFileSync(join(testDir, 'pi', 'agent', 'auth.json'), JSON.stringify({ fakeai: { type: 'api_key', key: 'k' } }))
})

afterAll(() => {
  provider?.stop()
  rmSync(testDir, { recursive: true, force: true })
})

describe('pi extension policy', () => {
  test('THE SECURITY PROMISE: an unapproved extension is never IMPORTED — its module code never runs', async () => {
    rmSync(SENTINEL, { force: true })
    const fake = seedProvider([{ steps: [{ text: 'plain' }] }])
    // allowlist mode with ONLY the fixture approved — side-effect.ts is pending.
    const adapter = await adapterWithPolicy({
      mode: 'allowlist',
      allow: [allowEntry(join(testDir, 'pi', 'agent', 'extensions', 'bakin-fixture.ts'))],
    })
    await adapter.messaging.send({ agentId: 'main', content: 'go' })

    // POSITIVE CONTROL: the APPROVED extension genuinely loaded — proving the
    // loader actually ran and the negative assertions below aren't vacuous.
    expect(requestToolNames(fake.requests[0])).toContain('ext_fixture_echo')
    // …and the unapproved one's TOOLS are absent — necessary but NOT sufficient:
    expect(requestToolNames(fake.requests[0])).not.toContain('ext_sideeffect_noop')
    // …and, the point: its module was never imported, so its code never ran.
    expect(existsSync(SENTINEL)).toBe(false)
  })

  test("DEFAULT ('allowlist', empty): discovered extensions stay INERT until approved (WS4 flip)", async () => {
    rmSync(SENTINEL, { force: true })
    const fake = seedProvider([{ steps: [{ text: 'no ext by default' }] }])
    const adapter = await adapterWithPolicy(undefined)
    await adapter.messaging.send({ agentId: 'main', content: 'plain' })
    expect(requestToolNames(fake.requests[0])).not.toContain('ext_fixture_echo')
    expect(existsSync(SENTINEL)).toBe(false) // nothing imported at all
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

  test('a file SWAPPED after approval does not load its new code (content-hash pin)', async () => {
    rmSync(SENTINEL, { force: true })
    const swap = join(testDir, 'pi', 'agent', 'extensions', 'swap.ts')
    writeFileSync(swap, 'export default function(){}\n') // benign v1
    const approved = allowEntry(swap) // approve v1's exact bytes
    // Now an attacker overwrites the approved file with the sentinel-writer.
    writeFileSync(swap, SIDE_EFFECT_EXTENSION)
    const fake = seedProvider([{ steps: [{ text: 'x' }] }])
    const adapter = await adapterWithPolicy({ mode: 'allowlist', allow: [approved] })
    await adapter.messaging.send({ agentId: 'main', content: 'go' })
    // The stored hash is v1's; the on-disk file is v2 → not loaded, no import.
    expect(existsSync(SENTINEL)).toBe(false)
  })

  test("'allowlist': the approved PATH loads; a bare name or wrong path does not", async () => {
    const fixture = join(testDir, 'pi', 'agent', 'extensions', 'bakin-fixture.ts')
    const fake = seedProvider([{ steps: [{ text: 'a' }] }, { steps: [{ text: 'b' }] }, { steps: [{ text: 'c' }] }])

    const allowed = await adapterWithPolicy({ mode: 'allowlist', allow: [allowEntry(fixture)] })
    await allowed.messaging.send({ agentId: 'main', content: 'x' })
    expect(requestToolNames(fake.requests[0])).toContain('ext_fixture_echo')

    // A basename is NOT trust — identity is the path (no pattern matching).
    const byName = await adapterWithPolicy({ mode: 'allowlist', allow: ['bakin-fixture'] })
    await byName.messaging.send({ agentId: 'main', content: 'y' })
    expect(requestToolNames(fake.requests[1])).not.toContain('ext_fixture_echo')

    const denied = await adapterWithPolicy({ mode: 'allowlist', allow: [{ path: join(testDir, 'nope.ts'), sha256: 'x'.repeat(64) }] })
    await denied.messaging.send({ agentId: 'main', content: 'z' })
    expect(requestToolNames(fake.requests[2])).not.toContain('ext_fixture_echo')
  })
})
