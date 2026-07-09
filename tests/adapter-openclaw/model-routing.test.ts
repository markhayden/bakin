/**
 * OpenClaw model routing (P2.3) — the routing policy + per-agent model
 * persistence relocated behind the adapter. Round-trips against a temp
 * openclaw.json; covers the three native alias spellings and null-clears.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testHome = mkdtempSync(join(tmpdir(), 'bakin-test-oc-routing-'))

mock.module('../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => testHome,
  getOpenClawPath: (...parts: string[]) => join(testHome, ...parts),
  resetOpenClawHome: () => {},
}))
const contentDirMock = () => ({
  getContentDir: () => join(testHome, 'bakin'),
  getBakinPaths: () => ({ home: join(testHome, 'bakin'), db: join(testHome, 'bakin', 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { readRoutingPolicy, applyRoutingPolicy, setAgentModels } from '../../packages/adapter-openclaw/src/model-routing'
import { resetOpenClawConfigCache } from '../../packages/adapter-openclaw/src/config'

const configPath = () => join(testHome, 'openclaw.json')

function writeConfig(config: Record<string, unknown>): void {
  writeFileSync(configPath(), JSON.stringify(config, null, 2))
  resetOpenClawConfigCache()
}

function readConfigFile(): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath(), 'utf-8')) as Record<string, unknown>
}

beforeEach(() => {
  rmSync(configPath(), { force: true })
  resetOpenClawConfigCache()
})

afterAll(() => rmSync(testHome, { recursive: true, force: true }))

describe('readRoutingPolicy', () => {
  it('reads defaults + fallbacks + subagent default + both alias spellings (bare entries are params, not aliases)', () => {
    writeConfig({
      agents: {
        defaults: {
          model: { primary: 'anthropic/claude-sonnet-4-6', fallbacks: ['openai/gpt-5.5'] },
          subagents: { model: 'anthropic/claude-haiku-4-5' },
          models: {
            fast: 'anthropic/claude-haiku-4-5',                 // string spelling
            opus: { alias: 'anthropic/claude-opus-4-6' },       // { alias } spelling
            'anthropic/claude-sonnet-4-6': {},                  // bare entry: per-model params, NOT an alias
          },
        },
        list: [{ id: 'main' }],
      },
    })
    expect(readRoutingPolicy()).toEqual({
      defaultModel: 'anthropic/claude-sonnet-4-6',
      fallbackModels: ['openai/gpt-5.5'],
      defaultSubagentModel: 'anthropic/claude-haiku-4-5',
      aliases: {
        fast: 'anthropic/claude-haiku-4-5',
        opus: 'anthropic/claude-opus-4-6',
      },
    })
  })

  it('reads an empty policy from a bare config', () => {
    writeConfig({})
    expect(readRoutingPolicy()).toEqual({
      defaultModel: '',
      fallbackModels: [],
      defaultSubagentModel: null,
      aliases: {},
    })
  })
})

describe('applyRoutingPolicy', () => {
  it('merges a partial patch, preserving unrelated config', () => {
    writeConfig({
      gateway: { auth: { token: 'keep-me' } },
      agents: { defaults: { model: { primary: 'old/model' } }, list: [{ id: 'main' }] },
    })
    applyRoutingPolicy({ defaultModel: 'anthropic/claude-sonnet-4-6', fallbackModels: ['openai/gpt-5.5'] })

    const config = readConfigFile()
    expect((config.gateway as { auth: { token: string } }).auth.token).toBe('keep-me')
    expect(readRoutingPolicy().defaultModel).toBe('anthropic/claude-sonnet-4-6')
    expect(readRoutingPolicy().fallbackModels).toEqual(['openai/gpt-5.5'])
  })

  it('writes aliases in the canonical { alias } spelling and null-clears the subagent default', () => {
    writeConfig({ agents: { defaults: { subagents: { model: 'x/y' } }, list: [] } })
    applyRoutingPolicy({ aliases: { fast: 'anthropic/claude-haiku-4-5' }, defaultSubagentModel: null })

    const defaults = (readConfigFile().agents as { defaults: Record<string, unknown> }).defaults
    expect(defaults.models).toEqual({ fast: { alias: 'anthropic/claude-haiku-4-5' } })
    expect((defaults.subagents as Record<string, unknown>).model).toBeUndefined()
    expect(readRoutingPolicy().defaultSubagentModel).toBeNull()
  })
})

describe('setAgentModels', () => {
  it('persists model + subagentModel onto agents.list[] and null-clears both', () => {
    writeConfig({ agents: { list: [{ id: 'pixel', model: { primary: 'old/model' } }] } })

    setAgentModels('pixel', { model: 'anthropic/claude-opus-4-6', subagentModel: 'anthropic/claude-haiku-4-5' })
    let agent = (readConfigFile().agents as { list: Array<Record<string, unknown>> }).list[0]
    expect(agent.model).toEqual({ primary: 'anthropic/claude-opus-4-6' })
    expect(agent.subagents).toEqual({ model: 'anthropic/claude-haiku-4-5' })

    setAgentModels('pixel', { model: null, subagentModel: null })
    agent = (readConfigFile().agents as { list: Array<Record<string, unknown>> }).list[0]
    expect(agent.model).toBeUndefined()
    expect((agent.subagents as Record<string, unknown>).model).toBeUndefined()
  })

  it('preserves other model-object fields when updating primary', () => {
    writeConfig({ agents: { list: [{ id: 'main', model: { primary: 'a/b', temperature: 0.2 } }] } })
    setAgentModels('main', { model: 'c/d' })
    const agent = (readConfigFile().agents as { list: Array<Record<string, unknown>> }).list[0]
    expect(agent.model).toEqual({ primary: 'c/d', temperature: 0.2 })
  })

  it('throws for an unknown agent', () => {
    writeConfig({ agents: { list: [] } })
    expect(() => setAgentModels('ghost', { model: 'a/b' })).toThrow('Agent not found')
  })
})

describe('config-safety regressions (branch review)', () => {
  it('refuses to modify a corrupt openclaw.json instead of clobbering it', () => {
    writeFileSync(configPath(), '{ "gateway": { "auth": { "token": "SECRET" }')
    resetOpenClawConfigCache()
    expect(() => applyRoutingPolicy({ defaultModel: 'gpt-6' })).toThrow('refusing to modify')
    expect(() => setAgentModels('main', { model: 'gpt-6' })).toThrow('refusing to modify')
    // The broken file is untouched — nothing overwrote the secret.
    expect(readFileSync(configPath(), 'utf-8')).toContain('SECRET')
  })

  it('setAgentModels materializes the implicit main on a minimal config', () => {
    writeConfig({ agents: { defaults: { model: { primary: 'gpt-5.5' } } } })
    setAgentModels('main', { model: 'gpt-6' })
    const config = readConfigFile() as { agents?: { list?: Array<{ id: string; model?: { primary?: string } }> } }
    const main = config.agents?.list?.find((a) => a.id === 'main')
    expect(main?.model?.primary).toBe('gpt-6')
  })

  it('alias writes preserve non-alias model entries and their extra properties', () => {
    writeConfig({
      agents: {
        defaults: {
          models: {
            'gpt-6': { temperature: 0.2 },
            fast: { alias: 'gemini-flash', note: 'cheap' },
          },
        },
      },
    })
    // Round-trip: read (must NOT fabricate a self-alias for gpt-6) then write.
    const policy = readRoutingPolicy()
    expect(policy.aliases).toEqual({ fast: 'gemini-flash' })
    applyRoutingPolicy({ aliases: { fast: 'gemini-flash-2' } })

    const models = (readConfigFile() as { agents: { defaults: { models: Record<string, unknown> } } }).agents.defaults.models
    expect(models['gpt-6']).toEqual({ temperature: 0.2 })
    expect(models.fast).toEqual({ alias: 'gemini-flash-2', note: 'cheap' })
  })

  it('fallback-only patch never synthesizes primary: ""', () => {
    writeConfig({})
    applyRoutingPolicy({ fallbackModels: ['gemini-flash'] })
    const model = (readConfigFile() as { agents: { defaults: { model: Record<string, unknown> } } }).agents.defaults.model
    expect(model.fallbacks).toEqual(['gemini-flash'])
    expect('primary' in model).toBe(false)
  })
})
