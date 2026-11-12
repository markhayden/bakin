/**
 * `AdapterInitOpts.readOnly` on Pi (onboarding hardening): a process that
 * only checks must create and write nothing under the Pi home. The SDK's
 * file-backed stores create `models-store.json` and an empty `auth.json`
 * when they are first constructed, which is why Pi swaps them out.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createHash, randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-pi-read-only-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = join(testDir, 'pi')
process.env.BAKIN_HOME = join(testDir, 'bakin')

const contentDirMock = () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ home: join(testDir, 'bakin'), db: join(testDir, 'bakin', 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { createPiRuntimeAdapter } from '../../packages/adapter-pi/src/index'
import { resetPiHome } from '../../packages/adapter-pi/src/home'
import { resetModelRegistry, setModelRegistryReadOnly } from '../../packages/adapter-pi/src/models'

const piHome = join(testDir, 'pi')
const agentDir = join(piHome, 'agent')

/** Every path under the Pi home with its content hash. */
function fingerprint(): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) {
        out[`${full}/`] = 'dir'
        walk(full)
      } else {
        out[full] = createHash('sha256').update(readFileSync(full)).digest('hex')
      }
    }
  }
  walk(piHome)
  return out
}

const FAKE_MODELS = {
  providers: {
    fakeai: {
      name: 'Fake AI',
      baseUrl: 'http://127.0.0.1:9',
      api: 'openai-completions',
      apiKey: 'not-a-real-key',
      models: [{ id: 'fake-model', name: 'Fake Model', input: ['text'], reasoning: false, contextWindow: 100000, maxTokens: 32000, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 } }],
    },
  },
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
  mkdirSync(testDir, { recursive: true })
  resetPiHome()
  setModelRegistryReadOnly(false)
  resetModelRegistry()
})
afterAll(() => {
  setModelRegistryReadOnly(false)
  resetModelRegistry()
  rmSync(testDir, { recursive: true, force: true })
})

describe('Pi adapter, read-only init', () => {
  test('a Pi home that does not exist yet stays that way: initialize and a model listing create nothing', async () => {
    const adapter = createPiRuntimeAdapter()
    await adapter.initialize({ contentDir: join(testDir, 'bakin'), readOnly: true })
    await adapter.models.listAvailable({ includeUnavailable: true })
    expect(existsSync(piHome)).toBe(false)
  })

  test('installed but never logged in: no auth.json and no models-store.json appear', async () => {
    mkdirSync(agentDir, { recursive: true })
    const before = fingerprint()
    const adapter = createPiRuntimeAdapter()
    await adapter.initialize({ contentDir: join(testDir, 'bakin'), readOnly: true })
    await adapter.models.listAvailable({ includeUnavailable: true })
    expect((await adapter.credentialStatus()).llmProviders).toEqual([])
    expect(fingerprint()).toEqual(before)
  })

  test('logged in with a model: both are seen, and not a byte of the home changes', async () => {
    mkdirSync(agentDir, { recursive: true })
    writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({ fakeai: { type: 'api_key', key: 'not-a-real-key' } }))
    writeFileSync(join(agentDir, 'models.json'), JSON.stringify(FAKE_MODELS))
    const before = fingerprint()

    const adapter = createPiRuntimeAdapter()
    await adapter.initialize({ contentDir: join(testDir, 'bakin'), readOnly: true })
    expect((await adapter.credentialStatus()).llmProviders).toEqual(['fakeai'])
    const models = await adapter.models.listAvailable({ includeUnavailable: true })
    expect(models.find((model) => model.id === 'fakeai/fake-model')?.available).toBe(true)
    expect(fingerprint()).toEqual(before)
  })

  test('an existing catalog cache is left exactly as it is', async () => {
    mkdirSync(agentDir, { recursive: true })
    const cache = JSON.stringify({ somewhere: { fetchedAt: 1, models: [] } })
    writeFileSync(join(agentDir, 'models-store.json'), cache)
    const adapter = createPiRuntimeAdapter()
    await adapter.initialize({ contentDir: join(testDir, 'bakin'), readOnly: true })
    await adapter.models.listAvailable({ includeUnavailable: true })
    expect(readFileSync(join(agentDir, 'models-store.json'), 'utf-8')).toBe(cache)
  })

  test('teeth: without readOnly the same initialize DOES create files, which is why checks pass the flag', async () => {
    mkdirSync(agentDir, { recursive: true })
    const adapter = createPiRuntimeAdapter()
    await adapter.initialize({ contentDir: join(testDir, 'bakin') })
    await adapter.models.listAvailable({ includeUnavailable: true })
    expect(Object.keys(fingerprint()).length).toBeGreaterThan(1)
  })

  test('the mode follows the latest initialize: a normal one after a read-only one writes again', async () => {
    mkdirSync(agentDir, { recursive: true })
    const adapter = createPiRuntimeAdapter()
    await adapter.initialize({ contentDir: join(testDir, 'bakin'), readOnly: true })
    const afterReadOnly = fingerprint()
    await adapter.initialize({ contentDir: join(testDir, 'bakin') })
    await adapter.models.listAvailable({ includeUnavailable: true })
    expect(fingerprint()).not.toEqual(afterReadOnly)
  })
})
