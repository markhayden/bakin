/**
 * adapter-pi P6 — config surface (incl. onboarding key synthesis), skills
 * CRUD in both scopes, models via a fixture models.json + auth.json.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-pi-cms-${Date.now()}-${randomUUID()}`)
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
import { resetModelRegistry } from '../../packages/adapter-pi/src/models'

const adapter = createPiRuntimeAdapter()

beforeAll(async () => {
  resetPiHome()
  resetModelRegistry()
  const agentDir = join(testDir, 'pi', 'agent')
  mkdirSync(agentDir, { recursive: true })
  // Fixture auth: one provider configured.
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({
    'openai-codex': { type: 'api_key', key: 'sk-test-not-real' },
  }))
  // Fixture custom model so the registry has a deterministic entry.
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({
    providers: {
      'openai-codex': {
        name: 'OpenAI Codex (test)',
        baseUrl: 'http://127.0.0.1:9',
        api: 'openai-completions',
        models: [
          { id: 'gpt-test-vision', name: 'GPT Test Vision', input: ['text', 'image'], reasoning: true, contextWindow: 200000, maxTokens: 64000, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 } },
          { id: 'gpt-test-text', name: 'GPT Test Text', input: ['text'], reasoning: false, contextWindow: 100000, maxTokens: 32000, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 } },
        ],
      },
    },
  }))
  await adapter.initialize({ contentDir: join(testDir, 'bakin') })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('config surface', () => {
  test('get/replace round-trip settings.json', async () => {
    await adapter.config.replace({ theme: 'dark', defaultProvider: 'openai-codex' }, 'test')
    const cfg = await adapter.config.get<Record<string, unknown>>()
    expect(cfg.theme).toBe('dark')
  })

  test('raw synthesizes onboarding keys: authProfiles presence-only, channels empty', async () => {
    const profiles = await adapter.config.raw<Record<string, { configured: boolean; key?: string }>>('agents.main.authProfiles', 'onboarding.llm.check')
    expect(profiles['openai-codex']?.configured).toBe(true)
    // NEVER credential material:
    expect(JSON.stringify(profiles)).not.toContain('sk-test-not-real')

    const channels = await adapter.config.raw<Record<string, unknown>>('channels', 'onboarding.channels.check')
    expect(channels).toEqual({})

    const whole = await adapter.config.raw<Record<string, unknown>>('*', 'onboarding.runtime.integrity')
    expect(whole.theme).toBe('dark')

    expect(await adapter.config.raw<string>('defaultProvider', 'onboarding.runtime.integrity')).toBe('openai-codex')
  })
})

describe('skills surface', () => {
  test('global + per-agent scopes are separate; CRUD round-trips', async () => {
    await adapter.skills.write({ name: 'greet', instructions: '# Greet\nSay hi.', files: { 'extra.md': 'notes' } })
    await adapter.skills.write({ name: 'local-only', instructions: '# Local' }, 'main')

    const globalSkills = await adapter.skills.list()
    expect(globalSkills.map((s) => s.name)).toEqual(['greet'])
    expect(globalSkills[0].files?.['extra.md']).toBe('notes')

    const agentSkills = await adapter.skills.list('main')
    expect(agentSkills.map((s) => s.name)).toEqual(['local-only'])

    expect((await adapter.skills.get('greet'))?.instructions).toContain('Say hi.')
    expect(await adapter.skills.get('greet', 'main')).toBeNull()

    await adapter.skills.remove('greet')
    expect(await adapter.skills.list()).toEqual([])
  })

  test('path-hostile skill names/files rejected', async () => {
    await expect(adapter.skills.write({ name: '../evil', instructions: 'x' })).rejects.toThrow('invalid skill name')
    await expect(adapter.skills.write({ name: 'ok', instructions: 'x', files: { '../escape.md': 'x' } })).rejects.toThrow('invalid skill file name')
  })
})

describe('models + capabilities', () => {
  test('listAvailable maps registry models to provider/id with modality string', async () => {
    const models = await adapter.models.listAvailable({ includeUnavailable: false })
    const vision = models.find((m) => m.id === 'openai-codex/gpt-test-vision')
    expect(vision).toBeDefined()
    expect(vision!.input).toBe('text,image')
    expect(vision!.contextWindow).toBe(200000)
    expect(vision!.available).toBe(true)
    expect(vision!.tags).toContain('reasoning')
  })

  test('capabilities follow the agent model; unknown agent all-false', async () => {
    await adapter.agents.update('main', { model: 'openai-codex/gpt-test-vision' })
    expect(await adapter.capabilities!({ agentId: 'main' })).toEqual({ imageInput: true, audioInput: false })

    await adapter.agents.update('main', { model: 'openai-codex/gpt-test-text' })
    expect(await adapter.capabilities!({ agentId: 'main' })).toEqual({ imageInput: false, audioInput: false })

    expect(await adapter.capabilities!({ agentId: 'ghost' })).toEqual({ imageInput: false, audioInput: false })
  })

  test('describeToolAccess declares native invocation', () => {
    expect(adapter.describeToolAccess!()).toEqual({ invocation: 'native' })
  })
})
