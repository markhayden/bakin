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
  // Fixture auth: one provider configured. 0.85.x enforces credential type
  // per provider — openai-codex is OAuth-only, so an api_key credential
  // reads as UNCONFIGURED (availability empty).
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({
    'openai-codex': { type: 'oauth', refresh: 'r-test', access: 'a-test-not-real', expires: Date.now() + 3_600_000 },
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
  await adapter.provisionToolAccess() // seeds main (write-free initialize)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('config surface', () => {
  test('the contract config surface is GONE (P2.5) — adapter-internal reads only', () => {
    expect((adapter as unknown as Record<string, unknown>).config).toBeUndefined()
  })

  test('credentialStatus reports provider names only — never secrets, no channels (P2.2)', async () => {
    const status = await adapter.credentialStatus()
    expect(status.llmProviders).toContain('openai-codex')
    expect(status.channels).toEqual([])
    expect(JSON.stringify(status)).not.toContain('sk-test-not-real')
  })

  test('credentials.providers() is a complete, status-only inventory derived from configured auth (#907)', async () => {
    const inventory = await adapter.credentials!.providers()
    expect(inventory.evidence).toBe('complete')
    const codex = inventory.providers.find((p) => p.providerId === 'openai-codex')
    expect(codex).toEqual({ providerId: 'openai-codex', configured: true, source: 'runtime' })
    // The SDK's built-in catalog carries providers this fixture never
    // authenticated — they must be listed as NOT configured, not omitted,
    // so the eligibility engine can say "no credentials for X" precisely.
    const unconfigured = inventory.providers.filter((p) => !p.configured)
    expect(unconfigured.length).toBeGreaterThan(0)
    expect(JSON.stringify(inventory)).not.toMatch(/a-test-not-real|r-test/)
  })

  test('restartAdvice: Pi re-reads its stores per turn, so no change kind needs a restart (#878)', () => {
    for (const kind of ['model-config', 'roster', 'routing-policy'] as const) {
      expect(adapter.restartAdvice!(kind)).toEqual({ needed: false })
    }
  })
})

describe('routing policy (P2.3)', () => {
  test('declares defaultModel-only support + the honored thinking ladder', () => {
    expect(adapter.models.routingSupport()).toEqual({
      defaultModel: true,
      fallbackModels: false,
      defaultSubagentModel: false,
      aliases: false,
      perAgentSubagentModel: false,
      // adaptive/max have no Pi semantics — Bakin clamps before the send.
      supportedThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      // In-process runtime always honors per-turn model refs (#880).
      perTurnModel: true,
    })
  })

  test('defaultModel round-trips through settings.json; unsupported fields stay empty', async () => {
    await adapter.models.setRoutingPolicy({ defaultModel: 'openai-codex/gpt-test-text' }, 'test')
    expect(await adapter.models.routingPolicy()).toEqual({
      defaultModel: 'openai-codex/gpt-test-text',
      fallbackModels: [],
      defaultSubagentModel: null,
      aliases: {},
    })
  })

  test('rejects a patch carrying an unsupported field — never silently stored', async () => {
    await expect(
      adapter.models.setRoutingPolicy({ aliases: { fast: 'x/y' } }, 'test'),
    ).rejects.toThrow('not supported by the pi runtime')
    await expect(
      adapter.models.setRoutingPolicy({ fallbackModels: ['x/y'] }, 'test'),
    ).rejects.toThrow('not supported by the pi runtime')
  })

  test('agents.update: model null clears; subagentModel is rejected', async () => {
    await adapter.agents.update('main', { model: 'openai-codex/gpt-test-text' })
    expect((await adapter.agents.get('main'))?.model).toBe('openai-codex/gpt-test-text')

    await adapter.agents.update('main', { model: null })
    expect((await adapter.agents.get('main'))?.model).toBeUndefined()

    await expect(
      adapter.agents.update('main', { subagentModel: 'x/y' }),
    ).rejects.toThrow('not supported by the pi runtime')
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

  // Dropping these sidecars on write meant plugin-asset installs on Pi could
  // never read back as installed ("5 missing" → install → "5 drifted", live
  // P5.3) and user edits could never lock a projection.
  test('installedBy marker round-trips through write→get; userEdited sentinel surfaces', async () => {
    const marker = { pluginId: 'images', sha256: 'abc123' }
    await adapter.skills.write({ name: 'marked', instructions: '# M', metadata: { installedBy: marker } })

    const readBack = await adapter.skills.get('marked')
    expect(readBack?.metadata?.installedBy).toEqual(marker)
    expect(readBack?.metadata?.userEdited).toBe(false)
    // Sidecars are metadata, never content files.
    expect(readBack?.files?.['.installedBy']).toBeUndefined()

    const { writeFileSync: writeFs } = await import('fs')
    const { join: joinPath } = await import('path')
    writeFs(joinPath(readBack!.path!, '.userEdited'), '')
    expect((await adapter.skills.get('marked'))?.metadata?.userEdited).toBe(true)

    // Re-writing without a marker clears it (OpenClaw parity).
    await adapter.skills.write({ name: 'marked', instructions: '# M2' })
    expect((await adapter.skills.get('marked'))?.metadata?.installedBy).toBeUndefined()

    await adapter.skills.remove('marked')
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

  test('unavailable models carry the runtime reason: no_credentials, never an invented one (#907)', async () => {
    const models = await adapter.models.listAvailable({ includeUnavailable: true })
    const unavailable = models.filter((m) => m.available === false)
    expect(unavailable.length).toBeGreaterThan(0)
    for (const m of unavailable) expect(m.unavailableReason).toBe('no_credentials')
    const configured = models.find((m) => m.id === 'openai-codex/gpt-test-vision')
    expect(configured!.available).toBe(true)
    expect(configured!.unavailableReason).toBeUndefined()
  })

  test('resolveId answers with the turn path\'s rule: exact provider/id, bare id → the registry row, wrong provider → null (#907 review)', async () => {
    expect(await adapter.models.resolveId!('openai-codex/gpt-test-vision')).toBe('openai-codex/gpt-test-vision')
    // A bare id is what a turn would run it as — the same row Pi's session build picks.
    expect(await adapter.models.resolveId!('gpt-test-text')).toBe('openai-codex/gpt-test-text')
    // A real id under the wrong provider is NOT rescued by bare-name matching: no turn would run it.
    expect(await adapter.models.resolveId!('anthropic/gpt-test-text')).toBeNull()
    expect(await adapter.models.resolveId!('nobody/no-such-model')).toBeNull()
  })

  test('capabilities follow the agent model; unknown agent all-false', async () => {
    await adapter.agents.update('main', { model: 'openai-codex/gpt-test-vision' })
    expect((await adapter.capabilities!({ agentId: 'main' })).input).toEqual({ imageInput: true, audioInput: false })

    await adapter.agents.update('main', { model: 'openai-codex/gpt-test-text' })
    expect((await adapter.capabilities!({ agentId: 'main' })).input).toEqual({ imageInput: false, audioInput: false })

    expect((await adapter.capabilities!({ agentId: 'ghost' })).input).toEqual({ imageInput: false, audioInput: false })
  })

  test('describeToolAccess declares in-process invocation', () => {
    expect(adapter.describeToolAccess!()).toEqual({ style: 'in-process', perTurnExecToolFiltering: true })
  })
})

describe('skills.write atomicity', () => {
  test('validates every filename BEFORE writing — a traversal path leaves NO half-written skill', async () => {
    await expect(
      adapter.skills.write({ name: 'nested-carry', instructions: '# nested', files: { '../aux.md': 'aux' } }, 'main'),
    ).rejects.toThrow('invalid skill file name')
    // The dir must not exist at all — a half-written SKILL.md would make
    // skills.list report a valid skill that never fully carried.
    expect(await adapter.skills.get('nested-carry', 'main')).toBeNull()
  })

  test('nested (non-traversal) paths are valid — the OpenClaw carry shape writes cleanly', async () => {
    await adapter.skills.write({ name: 'nested-ok', instructions: '# nested', files: { 'ref/aux.md': 'aux' } }, 'main')
    const skill = await adapter.skills.get('nested-ok', 'main')
    expect(skill?.files?.['ref/aux.md']).toBe('aux')
  })
})
