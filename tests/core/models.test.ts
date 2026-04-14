import { describe, it, expect, beforeEach, vi } from 'vitest'
import { join } from 'path'

const testHome = vi.hoisted(() => {
  const { mkdtempSync } = require('fs')
  const { tmpdir } = require('os')
  const { join } = require('path')
  const home = mkdtempSync(join(tmpdir(), 'bakin-test-home-'))
  const openclaw = mkdtempSync(join(tmpdir(), 'bakin-test-openclaw-'))
  process.env.BAKIN_HOME = home
  process.env.OPENCLAW_HOME = openclaw
  return { home, openclaw }
})

vi.mock('../../src/core/content-dir', () => ({
  getContentDir: () => testHome.home,
  getBakinPaths: () => ({
    home: testHome.home,
    memoryLog: join(testHome.home, 'MEMORY-LOG.md'),
    messaging: join(testHome.home, 'messaging.json'),
    audit: join(testHome.home, 'audit.jsonl'),
    assets: join(testHome.home, 'assets'),
    'assets.text': join(testHome.home, 'assets', 'text'),
    'assets.images': join(testHome.home, 'assets', 'images'),
    'assets.video': join(testHome.home, 'assets', 'video'),
    'assets.audio': join(testHome.home, 'assets', 'audio'),
    'assets.plans': join(testHome.home, 'assets', 'plans'),
    'assets.data': join(testHome.home, 'assets', 'data'),
    'assets.other': join(testHome.home, 'assets', 'other'),
    agents: join(testHome.home, 'agents'),
    personas: join(testHome.home, 'team', 'personas'),
    team: join(testHome.home, 'team'),
    heartbeats: join(testHome.home, 'heartbeats'),
    inbox: join(testHome.home, 'inbox'),
    projects: join(testHome.home, 'projects'),
    workflows: join(testHome.home, 'workflows'),
    settings: join(testHome.home, 'settings.json'),
    logs: join(testHome.home, 'logs'),
  }),
  isUsingBakinHome: () => true,
  resetContentDir: () => {},
}))

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../src/core/settings', () => ({
  getSettings: vi.fn().mockReturnValue({
    models: {},
  }),
}))

vi.mock('../../src/core/vault', () => ({
  get: vi.fn().mockReturnValue(null),
}))

// Mock readFileSync/writeFileSync/existsSync so readConfig/writeConfig don't touch real fs
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
  }
})

import {
  resolveAgents,
  isModelAllowed,
  fallbackModels,
  fetchAvailableModels,
  readAliases,
  DEFAULT_ALIASES,
  readConfig,
} from '../../src/core/models'
import { getSettings } from '../../src/core/settings'
import * as vault from '../../src/core/vault'
import { readFileSync } from 'fs'

const SAMPLE_CONFIG = {
  agents: {
    defaults: {
      model: { primary: 'claude-sonnet-4-6' },
      subagents: { model: 'claude-haiku-4-5' },
    },
    list: [
      { id: 'main', identity: { name: 'Main Operator', emoji: '🐾' } },
      { id: 'pixel', model: { primary: 'claude-opus-4-6' }, identity: { name: 'Pixel', emoji: '🖼️' } },
      { id: 'trainer', identity: { name: 'Trainer', emoji: '🐠' }, subagents: { model: 'claude-sonnet-4-5' } },
    ],
  },
}

describe('models', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Reset the models cache by resetting modules isn't needed for most tests
    // since we test functions that don't rely on cache, except fetchAvailableModels
  })

  // -------------------------------------------------------------------------
  // resolveAgents
  // -------------------------------------------------------------------------

  describe('resolveAgents', () => {
    it('resolves agents from config with effective models', () => {
      const agents = resolveAgents(SAMPLE_CONFIG as any)
      expect(agents.length).toBe(3)

      const main = agents.find(a => a.agentId === 'main')!
      expect(main.effectiveModel).toBe('claude-sonnet-4-6') // uses default
      expect(main.ownModel).toBeNull()

      const pixel = agents.find(a => a.agentId === 'pixel')!
      expect(pixel.effectiveModel).toBe('claude-opus-4-6') // own model
      expect(pixel.ownModel).toBe('claude-opus-4-6')
    })

    it('passes "main" agent id through unchanged', () => {
      const agents = resolveAgents(SAMPLE_CONFIG as any)
      const ids = agents.map(a => a.agentId)
      expect(ids).toContain('main')
      expect(ids).not.toContain('main-operator')
    })

    it('sorts main agent first, then alphabetically', () => {
      const agents = resolveAgents(SAMPLE_CONFIG as any)
      expect(agents[0].agentId).toBe('main')
      // Remaining should be alphabetical by name
      const rest = agents.slice(1).map(a => a.name)
      expect(rest).toEqual([...rest].sort())
    })

    it('includes default and per-agent subagent models', () => {
      const agents = resolveAgents(SAMPLE_CONFIG as any)

      const main = agents.find(a => a.agentId === 'main')!
      expect(main.defaultSubagentModel).toBe('claude-haiku-4-5')
      expect(main.subagentModel).toBeNull()

      const trainer = agents.find(a => a.agentId === 'trainer')!
      expect(trainer.subagentModel).toBe('claude-sonnet-4-5')
    })

    it('reads identity.name and emoji directly from OpenClaw config', () => {
      const agents = resolveAgents(SAMPLE_CONFIG as any)
      const pixel = agents.find(a => a.agentId === 'pixel')!
      expect(pixel.name).toBe('Pixel')
      expect(pixel.emoji).toBe('🖼️')

      const main = agents.find(a => a.agentId === 'main')!
      expect(main.name).toBe('Main Operator')
      expect(main.emoji).toBe('🐾')
    })

    it('falls back to identity/name for unknown agents', () => {
      const config = {
        agents: {
          defaults: { model: { primary: 'claude-sonnet-4-6' } },
          list: [{ id: 'custom-bot', identity: { name: 'CustomBot', emoji: '🤖' } }],
        },
      }
      const agents = resolveAgents(config as any)
      expect(agents[0].name).toBe('CustomBot')
      expect(agents[0].emoji).toBe('🤖')
    })
  })

  // -------------------------------------------------------------------------
  // isModelAllowed
  // -------------------------------------------------------------------------

  describe('isModelAllowed', () => {
    it('returns true when no allowlist or blocklist', () => {
      vi.mocked(getSettings).mockReturnValue({ models: {} } as any)
      expect(isModelAllowed('claude-opus-4-6')).toBe(true)
    })

    it('blocks models matching blocklist', () => {
      vi.mocked(getSettings).mockReturnValue({
        models: { blocklist: ['opus'] },
      } as any)
      expect(isModelAllowed('claude-opus-4-6')).toBe(false)
      expect(isModelAllowed('claude-sonnet-4-6')).toBe(true)
    })

    it('allows only models matching allowlist', () => {
      vi.mocked(getSettings).mockReturnValue({
        models: { allowlist: ['sonnet', 'haiku'] },
      } as any)
      expect(isModelAllowed('claude-sonnet-4-6')).toBe(true)
      expect(isModelAllowed('claude-haiku-4-5')).toBe(true)
      expect(isModelAllowed('claude-opus-4-6')).toBe(false)
    })

    it('blocklist takes precedence over allowlist', () => {
      vi.mocked(getSettings).mockReturnValue({
        models: { allowlist: ['claude'], blocklist: ['opus'] },
      } as any)
      expect(isModelAllowed('claude-opus-4-6')).toBe(false)
      expect(isModelAllowed('claude-sonnet-4-6')).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // fallbackModels
  // -------------------------------------------------------------------------

  describe('fallbackModels', () => {
    it('returns a non-empty array of models', () => {
      const models = fallbackModels()
      expect(models.length).toBeGreaterThan(0)
    })

    it('includes all three tiers', () => {
      const tiers = new Set(fallbackModels().map(m => m.tier))
      expect(tiers).toContain('premium')
      expect(tiers).toContain('standard')
      expect(tiers).toContain('budget')
    })

    it('each model has id, name, and tier', () => {
      for (const model of fallbackModels()) {
        expect(model.id).toBeTruthy()
        expect(model.name).toBeTruthy()
        expect(['budget', 'standard', 'premium']).toContain(model.tier)
      }
    })
  })

  // -------------------------------------------------------------------------
  // fetchAvailableModels
  // -------------------------------------------------------------------------

  describe('fetchAvailableModels', () => {
    beforeEach(() => {
      vi.resetModules()
    })

    it('returns fallback models when no API key', async () => {
      vi.mocked(vault.get).mockReturnValue(null)
      const { fetchAvailableModels: fetch } = await import('../../src/core/models')
      const result = await fetch()
      expect(result.cached).toBe(false)
      expect(result.models.length).toBeGreaterThan(0)
    })

    it('fetches from Anthropic API when key is available', async () => {
      vi.mocked(vault.get).mockReturnValue('sk-test-key')
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({
          data: [
            { id: 'claude-sonnet-4-6-20250514', display_name: 'Claude Sonnet 4.6' },
            { id: 'claude-opus-4-6-20250514', display_name: 'Claude Opus 4.6' },
            { id: 'gpt-4', display_name: 'GPT-4' }, // non-claude, should be filtered
          ],
        })),
      )

      const { fetchAvailableModels: fetch } = await import('../../src/core/models')
      const result = await fetch()

      expect(fetchSpy).toHaveBeenCalledOnce()
      // Only claude models
      expect(result.models.every(m => m.id.startsWith('claude-'))).toBe(true)
      expect(result.models).toHaveLength(2)
      // Sorted by tier (premium first)
      expect(result.models[0].tier).toBe('premium')
    })

    it('returns fallback on API error', async () => {
      vi.mocked(vault.get).mockReturnValue('sk-test-key')
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('error', { status: 500 }),
      )

      const { fetchAvailableModels: fetch } = await import('../../src/core/models')
      const result = await fetch()
      expect(result.cached).toBe(false)
      expect(result.models.length).toBeGreaterThan(0)
    })

    it('returns fallback on network failure', async () => {
      vi.mocked(vault.get).mockReturnValue('sk-test-key')
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))

      const { fetchAvailableModels: fetch } = await import('../../src/core/models')
      const result = await fetch()
      expect(result.cached).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // readAliases
  // -------------------------------------------------------------------------

  describe('readAliases', () => {
    it('returns empty object when no models in defaults', () => {
      const config = { agents: { defaults: { model: { primary: 'x' } }, list: [] } }
      expect(readAliases(config as any)).toEqual({})
    })

    it('reads string aliases', () => {
      const config = {
        agents: {
          defaults: {
            model: { primary: 'x' },
            models: { fast: 'claude-haiku-4-5', smart: 'claude-opus-4-6' },
          },
          list: [],
        },
      }
      const aliases = readAliases(config as any)
      expect(aliases).toEqual({ fast: 'claude-haiku-4-5', smart: 'claude-opus-4-6' })
    })

    it('reads object aliases with alias field', () => {
      const config = {
        agents: {
          defaults: {
            model: { primary: 'x' },
            models: { fast: { alias: 'claude-haiku-4-5' } },
          },
          list: [],
        },
      }
      expect(readAliases(config as any)).toEqual({ fast: 'claude-haiku-4-5' })
    })

    it('falls back to key name for non-string non-alias objects', () => {
      const config = {
        agents: {
          defaults: {
            model: { primary: 'x' },
            models: { 'claude-sonnet-4-6': { temperature: 0.7 } },
          },
          list: [],
        },
      }
      expect(readAliases(config as any)).toEqual({ 'claude-sonnet-4-6': 'claude-sonnet-4-6' })
    })
  })

  // -------------------------------------------------------------------------
  // DEFAULT_ALIASES
  // -------------------------------------------------------------------------

  describe('DEFAULT_ALIASES', () => {
    it('maps haiku, sonnet, opus to full model IDs', () => {
      expect(DEFAULT_ALIASES.haiku).toContain('haiku')
      expect(DEFAULT_ALIASES.sonnet).toContain('sonnet')
      expect(DEFAULT_ALIASES.opus).toContain('opus')
    })
  })
})
