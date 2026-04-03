/**
 * Tests for models plugin routes, exec tools, and hooks.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ActivatedPlugin } from '../test-helpers'

// ---------------------------------------------------------------------------
// Temp directory & mock OpenClaw config
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), 'bakin-test-models-routes')
const mockOpenclawDir = join(testDir, '.openclaw')

const mockOpenclawConfig = {
  agents: {
    defaults: {
      model: { primary: 'anthropic/claude-sonnet-4-6' },
      models: {
        haiku: { alias: 'claude-haiku-4-5' },
        opus: { alias: 'claude-opus-4-6' },
      },
      subagents: { model: 'anthropic/claude-haiku-4-5' },
    },
    list: [
      {
        id: 'main',
        identity: { name: 'Main Operator', emoji: '🐾' },
        model: { primary: 'anthropic/claude-opus-4-6' },
        subagents: { model: 'anthropic/claude-sonnet-4-6' },
      },
      {
        id: 'patch',
        identity: { name: 'Patch', emoji: '⚙️' },
      },
      {
        id: 'pixel',
        identity: { name: 'Pixel', emoji: '🖼️' },
        model: { primary: 'anthropic/claude-sonnet-4-6' },
      },
    ],
  },
}

const mockAuthProfiles = {
  profiles: {
    'anthropic:default': { token: 'test-key-123' },
  },
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the openclaw.json path by replacing the constants module-level reads
// We redirect the file reads to our test directory
const openclawJsonPath = join(mockOpenclawDir, 'openclaw.json')
const authProfilesPath = join(mockOpenclawDir, 'agents', 'main', 'agent', 'auth-profiles.json')

vi.mock('os', async (importOriginal) => {
  const os = await importOriginal<typeof import('os')>()
  const { join: pathJoin } = await import('path')
  return {
    ...os,
    homedir: () => pathJoin(os.tmpdir(), 'bakin-test-models-routes'),
  }
})

vi.mock('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock fetch for Anthropic models API
const mockFetch = vi.fn(async (url: string) => {
  if (typeof url === 'string' && url.includes('api.anthropic.com/v1/models')) {
    return {
      ok: true,
      json: async () => ({
        data: [
          { id: 'claude-opus-4-6-20250514', display_name: 'Claude Opus 4.6' },
          { id: 'claude-sonnet-4-6-20250514', display_name: 'Claude Sonnet 4.6' },
          { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' },
        ],
      }),
    }
  }
  throw new Error(`unexpected fetch: ${url}`)
})
vi.stubGlobal('fetch', mockFetch)

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { activatePlugin, findRoute, findTool, callRoute, callTool, makeRequest } from '../test-helpers'
import modelsPlugin from '../../../plugins/models'

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let activated: ActivatedPlugin

function writeOpenclawConfig(config = mockOpenclawConfig) {
  writeFileSync(openclawJsonPath, JSON.stringify(config, null, 2))
}

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  mkdirSync(join(mockOpenclawDir, 'agents', 'main', 'agent'), { recursive: true })
  writeOpenclawConfig()
  writeFileSync(authProfilesPath, JSON.stringify(mockAuthProfiles))

  // Plugin settings dir
  mkdirSync(join(testDir, '.bakin', 'plugin-settings'), { recursive: true })

  activated = await activatePlugin(modelsPlugin, testDir)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Plugin activation tests
// ---------------------------------------------------------------------------

describe('Models Plugin Activation', () => {
  it('registers expected routes', () => {
    const routePaths = activated.routes.map((r) => `${r.method} ${r.path}`).sort()
    expect(routePaths).toEqual([
      'GET /aliases',
      'GET /available',
      'GET /config',
      'GET /profiles',
      'POST /aliases',
      'POST /config',
      'POST /defaults',
      'POST /gateway/restart',
      'PUT /profiles',
    ])
  })

  it('registers 2 exec tools', () => {
    expect(activated.execTools.length).toBe(2)
    expect(activated.execTools.map((t) => t.name).sort()).toEqual([
      'bakin_exec_models_get_config',
      'bakin_exec_models_list',
    ])
  })

  it('registers 3 hooks', () => {
    expect(activated.ctx.hooks.register).toHaveBeenCalledTimes(3)
    const hookNames = (activated.ctx.hooks.register as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0]
    )
    expect(hookNames.sort()).toEqual([
      'models.configChanged',
      'models.getAvailableModels',
      'models.getEffectiveModel',
    ])
  })

  it('has valid settings schema', () => {
    expect(modelsPlugin.settingsSchema).toBeDefined()
    const fields = modelsPlugin.settingsSchema!.fields
    expect(fields.length).toBe(2)
    expect(fields.map((f) => f.key).sort()).toEqual(['defaultModel', 'showUsageMetrics'])
  })
})

// ---------------------------------------------------------------------------
// Route tests
// ---------------------------------------------------------------------------

describe('GET /config', () => {
  it('returns agents with effective models', async () => {
    const route = findRoute(activated.routes, 'GET', '/config')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)

    const agents = body.agents as Array<Record<string, unknown>>
    expect(agents.length).toBe(3)

    // Main Operator (main) should be first
    expect(agents[0].agentId).toBe('main-operator')
    expect(agents[0].effectiveModel).toBe('anthropic/claude-opus-4-6')
    expect(agents[0].ownModel).toBe('anthropic/claude-opus-4-6')

    // Patch has no own model — uses default
    const patch = agents.find((a) => a.agentId === 'patch')!
    expect(patch.effectiveModel).toBe('anthropic/claude-sonnet-4-6')
    expect(patch.ownModel).toBeNull()
  })

  it('resolves agent names from OpenClaw identity', async () => {
    const route = findRoute(activated.routes, 'GET', '/config')!
    const { body } = await callRoute(route, activated.ctx)
    const agents = body.agents as Array<Record<string, unknown>>
    expect(agents[0].name).toBe('Main Operator')
    expect(agents[0].emoji).toBe('🐾')
  })
})

describe('POST /config', () => {
  it('rejects missing agentId', async () => {
    const route = findRoute(activated.routes, 'POST', '/config')!
    const req = makeRequest('/config', { method: 'POST', body: { ownModel: 'claude-haiku-4-5' } })
    const res = await route.handler(req, activated.ctx)
    expect(res.status).toBe(400)
  })

  it('updates agent own model', async () => {
    writeOpenclawConfig() // reset
    const route = findRoute(activated.routes, 'POST', '/config')!
    const req = makeRequest('/config', {
      method: 'POST',
      body: { agentId: 'patch', ownModel: 'anthropic/claude-opus-4-6' },
    })
    const res = await route.handler(req, activated.ctx)
    const data = await res.json()
    expect(data.ok).toBe(true)

    // Verify the change persisted
    const getRoute = findRoute(activated.routes, 'GET', '/config')!
    const { body } = await callRoute(getRoute, activated.ctx)
    const patch = (body.agents as Array<Record<string, unknown>>).find((a) => a.agentId === 'patch')!
    expect(patch.ownModel).toBe('anthropic/claude-opus-4-6')
    expect(patch.effectiveModel).toBe('anthropic/claude-opus-4-6')

    // Activity logged
    expect(activated.ctx.activity.audit).toHaveBeenCalledWith(
      'config.updated',
      'system',
      expect.objectContaining({ agentId: 'patch' })
    )
    expect(activated.ctx.activity.log).toHaveBeenCalled()

    writeOpenclawConfig() // reset for other tests
  })

  it('clears agent model when set to null', async () => {
    // First set a model
    const route = findRoute(activated.routes, 'POST', '/config')!
    await route.handler(
      makeRequest('/config', { method: 'POST', body: { agentId: 'patch', ownModel: 'test-model' } }),
      activated.ctx
    )
    // Now clear it
    await route.handler(
      makeRequest('/config', { method: 'POST', body: { agentId: 'patch', ownModel: null } }),
      activated.ctx
    )

    const getRoute = findRoute(activated.routes, 'GET', '/config')!
    const { body } = await callRoute(getRoute, activated.ctx)
    const patch = (body.agents as Array<Record<string, unknown>>).find((a) => a.agentId === 'patch')!
    expect(patch.ownModel).toBeNull()

    writeOpenclawConfig() // reset
  })
})

describe('POST /defaults', () => {
  it('updates default model', async () => {
    const route = findRoute(activated.routes, 'POST', '/defaults')!
    const req = makeRequest('/defaults', {
      method: 'POST',
      body: { defaultModel: 'anthropic/claude-opus-4-6' },
    })
    const res = await route.handler(req, activated.ctx)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(activated.ctx.activity.audit).toHaveBeenCalledWith(
      'defaults.updated',
      'system',
      expect.anything()
    )

    writeOpenclawConfig() // reset
  })
})

describe('GET /available', () => {
  it('returns models from API with tiers', async () => {
    const route = findRoute(activated.routes, 'GET', '/available')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)

    const models = body.models as Array<Record<string, unknown>>
    expect(models.length).toBe(3)

    const opus = models.find((m) => (m.id as string).includes('opus'))!
    expect(opus.tier).toBe('premium')

    const haiku = models.find((m) => (m.id as string).includes('haiku'))!
    expect(haiku.tier).toBe('budget')
  })
})

describe('GET /aliases', () => {
  it('returns aliases from config', async () => {
    writeOpenclawConfig() // ensure fresh
    const route = findRoute(activated.routes, 'GET', '/aliases')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)

    const aliases = body.aliases as Record<string, string>
    expect(aliases.haiku).toBe('claude-haiku-4-5')
    expect(aliases.opus).toBe('claude-opus-4-6')
  })
})

describe('POST /aliases', () => {
  it('adds a new alias', async () => {
    writeOpenclawConfig()
    const route = findRoute(activated.routes, 'POST', '/aliases')!
    const req = makeRequest('/aliases', {
      method: 'POST',
      body: { action: 'add', name: 'fast', target: 'claude-haiku-4-5' },
    })
    const res = await route.handler(req, activated.ctx)
    const data = await res.json()
    expect(data.ok).toBe(true)

    // Verify it persisted
    const getRoute = findRoute(activated.routes, 'GET', '/aliases')!
    const { body } = await callRoute(getRoute, activated.ctx)
    expect((body.aliases as Record<string, string>).fast).toBe('claude-haiku-4-5')

    writeOpenclawConfig() // reset
  })

  it('deletes an alias', async () => {
    writeOpenclawConfig()
    const route = findRoute(activated.routes, 'POST', '/aliases')!
    const req = makeRequest('/aliases', {
      method: 'POST',
      body: { action: 'delete', name: 'haiku' },
    })
    const res = await route.handler(req, activated.ctx)
    const data = await res.json()
    expect(data.ok).toBe(true)

    const getRoute = findRoute(activated.routes, 'GET', '/aliases')!
    const { body } = await callRoute(getRoute, activated.ctx)
    expect((body.aliases as Record<string, string>).haiku).toBeUndefined()

    writeOpenclawConfig() // reset
  })

  it('prepopulates default aliases', async () => {
    // Start with empty models
    const emptyConfig = JSON.parse(JSON.stringify(mockOpenclawConfig))
    emptyConfig.agents.defaults.models = {}
    writeOpenclawConfig(emptyConfig)

    const route = findRoute(activated.routes, 'POST', '/aliases')!
    const req = makeRequest('/aliases', {
      method: 'POST',
      body: { action: 'prepopulate' },
    })
    const res = await route.handler(req, activated.ctx)
    const data = await res.json()
    expect(data.ok).toBe(true)

    const getRoute = findRoute(activated.routes, 'GET', '/aliases')!
    const { body } = await callRoute(getRoute, activated.ctx)
    const aliases = body.aliases as Record<string, string>
    expect(aliases.haiku).toBeDefined()
    expect(aliases.sonnet).toBeDefined()
    expect(aliases.opus).toBeDefined()

    writeOpenclawConfig() // reset
  })
})

describe('GET /profiles', () => {
  it('returns default profiles when none saved', async () => {
    const route = findRoute(activated.routes, 'GET', '/profiles')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)

    const profiles = body.profiles as Array<Record<string, unknown>>
    expect(profiles.length).toBeGreaterThan(0)
    expect(profiles[0].taskType).toBeDefined()
    expect(profiles[0].recommendedModel).toBeDefined()
  })
})

describe('PUT /profiles', () => {
  it('validates profile structure', async () => {
    const route = findRoute(activated.routes, 'PUT', '/profiles')!
    const req = makeRequest('/profiles', {
      method: 'PUT',
      body: { profiles: [{ taskType: '', recommendedModel: 'test', notes: 'x' }] },
    })
    const res = await route.handler(req, activated.ctx)
    expect(res.status).toBe(400)
  })

  it('saves valid profiles', async () => {
    const route = findRoute(activated.routes, 'PUT', '/profiles')!
    const newProfiles = [
      { taskType: 'Testing', recommendedModel: 'claude-haiku-4-5', notes: 'Quick iteration' },
    ]
    const req = makeRequest('/profiles', {
      method: 'PUT',
      body: { profiles: newProfiles },
    })
    const res = await route.handler(req, activated.ctx)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(activated.ctx.updateSettings).toHaveBeenCalledWith({ taskProfiles: newProfiles })
  })
})

// ---------------------------------------------------------------------------
// Exec tool tests
// ---------------------------------------------------------------------------

describe('Exec Tools', () => {
  describe('bakin_exec_models_list', () => {
    it('returns all available models', async () => {
      const tool = findTool(activated.execTools, 'bakin_exec_models_list')!
      const result = await callTool(tool, {})
      expect(result.ok).toBe(true)
      expect(Array.isArray(result.models)).toBe(true)
      expect((result.models as unknown[]).length).toBe(3)
    })

    it('filters by tier', async () => {
      const tool = findTool(activated.execTools, 'bakin_exec_models_list')!
      const result = await callTool(tool, { tier: 'premium' })
      expect(result.ok).toBe(true)
      const models = result.models as Array<Record<string, unknown>>
      expect(models.every((m) => m.tier === 'premium')).toBe(true)
    })
  })

  describe('bakin_exec_models_get_config', () => {
    it('returns all agent configs', async () => {
      writeOpenclawConfig()
      const tool = findTool(activated.execTools, 'bakin_exec_models_get_config')!
      const result = await callTool(tool, {})
      expect(result.ok).toBe(true)
      expect(Array.isArray(result.agents)).toBe(true)
      expect((result.agents as unknown[]).length).toBe(3)
    })

    it('returns single agent config', async () => {
      const tool = findTool(activated.execTools, 'bakin_exec_models_get_config')!
      const result = await callTool(tool, { agentId: 'main-operator' })
      expect(result.ok).toBe(true)
      const agent = result.agent as Record<string, unknown>
      expect(agent.agentId).toBe('main-operator')
      expect(agent.effectiveModel).toBe('anthropic/claude-opus-4-6')
    })

    it('returns error for unknown agent', async () => {
      const tool = findTool(activated.execTools, 'bakin_exec_models_get_config')!
      const result = await callTool(tool, { agentId: 'nonexistent' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not found')
    })
  })
})
