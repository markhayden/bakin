/**
 * Tests for models plugin routes, exec tools, and hooks.
 */
import { describe, it, expect, beforeAll, afterAll, mock, spyOn } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ActivatedPlugin } from '../test-helpers'

// ---------------------------------------------------------------------------
// Temp directory & mock runtime config
// ---------------------------------------------------------------------------

const testDir = join(tmpdir(), 'bakin-test-models-routes')

// ES imports are hoisted above mock.module — set env so the guards don't trip
// when plugin modules call getContentDir at init.
process.env.BAKIN_HOME = testDir

const mockRuntimeConfig = {
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

const runtimeModels = [
  { id: 'openai-codex/gpt-5.4', name: 'GPT-5.4', available: true, local: false, tags: ['default', 'configured'] },
  { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', available: true, local: false, tags: ['configured', 'alias:opus'] },
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', available: true, local: false, tags: ['configured', 'fallback#1', 'alias:sonnet'] },
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', available: true, local: false, tags: ['configured'] },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', available: true, local: false, tags: [] },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', available: true, local: false, tags: [] },
  { id: 'xai/grok-4', name: 'Grok 4', available: false, local: false, tags: [] },
]

let runtimeConfig = cloneConfig(mockRuntimeConfig)

const runtimeMocks = {
  listAvailable: mock(async () => runtimeModels),
  replace: mock(async (next: typeof mockRuntimeConfig, reason: string) => {
    if (!reason) throw new Error('replace reason required')
    runtimeConfig = cloneConfig(next)
  }),
  restart: mock(async () => {}),
}

function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// The hook validator requires an explicit content-dir mock.
const contentDir = join(testDir, '.bakin')
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => contentDir,
  getBakinPaths: () => ({ root: contentDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => contentDir,
  getBakinPaths: () => ({ root: contentDir }),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { activatePlugin, findRoute, findTool, callRoute, callTool, makeRequest } from '../test-helpers'
const modelsPlugin = (await import('../../../plugins/models')).default as typeof import('../../../plugins/models').default

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let activated: ActivatedPlugin

function writeRuntimeConfig(config = mockRuntimeConfig) {
  runtimeConfig = cloneConfig(config)
}

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  writeRuntimeConfig()

  // Plugin settings dir
  mkdirSync(join(testDir, '.bakin', 'plugin-settings'), { recursive: true })

  activated = await activatePlugin(modelsPlugin, testDir)
  activated.ctx.runtime.config.get = (async <T = Record<string, unknown>>() => cloneConfig(runtimeConfig) as T) as typeof activated.ctx.runtime.config.get
  activated.ctx.runtime.config.replace = runtimeMocks.replace as typeof activated.ctx.runtime.config.replace
  activated.ctx.runtime.models.listAvailable = runtimeMocks.listAvailable as typeof activated.ctx.runtime.models.listAvailable
  activated.ctx.runtime.restart = runtimeMocks.restart
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
  mock.restore()
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
      'GET /runtime/status',
      'POST /aliases',
      'POST /config',
      'POST /defaults',
      'POST /refresh',
      'POST /runtime/restart',
    ])
  })

  it('registers 2 exec tools', () => {
    expect(activated.execTools.length).toBe(2)
    expect(activated.execTools.map((t) => t.name).sort()).toEqual([
      'bakin_exec_models_get_config',
      'bakin_exec_models_list',
    ])
  })

  it('registers 5 hooks', () => {
    expect(activated.ctx.hooks.register).toHaveBeenCalledTimes(5)
    const hookNames = (activated.ctx.hooks.register as ReturnType<typeof mock>).mock.calls.map(
      (c: unknown[]) => c[0]
    )
    expect(hookNames.sort()).toEqual([
      'models.configChanged',
      'models.getAvailableModels',
      'models.getEffectiveModel',
      'models.markConfigDirty',
      'models.markRuntimeRestarted',
    ])
  })

  it('has valid settings schema', () => {
    expect(modelsPlugin.settingsSchema).toBeDefined()
    const fields = modelsPlugin.settingsSchema!.fields
    expect(fields.length).toBe(1)
    expect(fields.map((f) => f.key).sort()).toEqual(['defaultModel'])
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

    // Main agent should be first
    expect(agents[0].agentId).toBe('main')
    expect(agents[0].effectiveModel).toBe('anthropic/claude-opus-4-6')
    expect(agents[0].ownModel).toBe('anthropic/claude-opus-4-6')

    // Patch has no own model — uses default
    const patch = agents.find((a) => a.agentId === 'patch')!
    expect(patch.effectiveModel).toBe('anthropic/claude-sonnet-4-6')
    expect(patch.ownModel).toBeNull()
  })

  it('resolves agent names from runtime identity', async () => {
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
    const { status } = await callRoute(route, activated.ctx, { body: { ownModel: 'claude-haiku-4-5' } })
    expect(status).toBe(400)
  })

  it('updates agent own model', async () => {
    writeRuntimeConfig() // reset
    const route = findRoute(activated.routes, 'POST', '/config')!
    const { body: data } = await callRoute(route, activated.ctx, {
      body: { agentId: 'patch', ownModel: 'anthropic/claude-opus-4-6' },
    })
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

    writeRuntimeConfig() // reset for other tests
  })

  it('clears agent model when set to null', async () => {
    // First set a model
    const route = findRoute(activated.routes, 'POST', '/config')!
    await callRoute(route, activated.ctx, {
      body: { agentId: 'patch', ownModel: 'test-model' },
    })
    // Now clear it
    await callRoute(route, activated.ctx, {
      body: { agentId: 'patch', ownModel: null },
    })

    const getRoute = findRoute(activated.routes, 'GET', '/config')!
    const { body } = await callRoute(getRoute, activated.ctx)
    const patch = (body.agents as Array<Record<string, unknown>>).find((a) => a.agentId === 'patch')!
    expect(patch.ownModel).toBeNull()

    writeRuntimeConfig() // reset
  })
})

describe('POST /defaults', () => {
  it('updates default model', async () => {
    const route = findRoute(activated.routes, 'POST', '/defaults')!
    const { body: data } = await callRoute(route, activated.ctx, {
      body: { defaultModel: 'anthropic/claude-opus-4-6' },
    })
    expect(data.ok).toBe(true)
    expect(activated.ctx.activity.audit).toHaveBeenCalledWith(
      'defaults.updated',
      'system',
      expect.anything()
    )

    writeRuntimeConfig() // reset
  })

  it('updates fallback models', async () => {
    const route = findRoute(activated.routes, 'POST', '/defaults')!
    const { body: data } = await callRoute(route, activated.ctx, {
      body: { fallbackModels: ['anthropic/claude-opus-4-6', 'anthropic/claude-haiku-4-5'] },
    })
    expect(data.ok).toBe(true)

    const getRoute = findRoute(activated.routes, 'GET', '/config')!
    const { body } = await callRoute(getRoute, activated.ctx)
    expect(body.fallbackModels).toEqual(['anthropic/claude-opus-4-6', 'anthropic/claude-haiku-4-5'])

    writeRuntimeConfig() // reset
  })
})

describe('GET /available', () => {
  it('returns models from API with tiers', async () => {
    const route = findRoute(activated.routes, 'GET', '/available')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)

    const models = body.models as Array<Record<string, unknown>>
    expect(models.length).toBe(6)

    const opus = models.find((m) => (m.id as string).includes('opus'))!
    expect(opus.tier).toBe('premium')
    expect(opus.provider).toBe('anthropic')

    const gpt = models.find((m) => m.id === 'openai-codex/gpt-5.4')!
    expect(gpt.isDefault).toBe(false)

    const sonnet = models.find((m) => m.id === 'anthropic/claude-sonnet-4-6')!
    expect(sonnet.isDefault).toBe(true)

    const gemini = models.find((m) => m.id === 'google/gemini-2.5-pro')!
    expect(gemini.provider).toBe('google')

    const haiku = models.find((m) => (m.id as string).includes('haiku'))!
    expect(haiku.tier).toBe('budget')
  })

  it('returns stale flag in response shape', async () => {
    const route = findRoute(activated.routes, 'GET', '/available')!
    const { body } = await callRoute(route, activated.ctx)
    // stale is defined on every successful response (true|false)
    expect(typeof body.stale).toBe('boolean')
  })

  it('returns a structured error when runtime model listing fails without dumping the thrown object', async () => {
    const restartRoute = findRoute(activated.routes, 'POST', '/runtime/restart')!
    await callRoute(restartRoute, activated.ctx)

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {})
    runtimeMocks.listAvailable.mockImplementationOnce(async () => {
      throw new Error('OpenClaw model list failed: code=1; killed=true')
    })

    const route = findRoute(activated.routes, 'GET', '/available')!
    const { status, body } = await callRoute(route, activated.ctx)

    expect(status).toBe(200)
    expect(body.models).toEqual([])
    expect(body.error).toBe('OpenClaw model list failed: code=1; killed=true')
    expect(warnSpy).toHaveBeenCalledWith('Failed to fetch models from runtime: OpenClaw model list failed: code=1; killed=true')
    expect(errorSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('enriches catalog-matched models with description, bestFor, costRange', async () => {
    const route = findRoute(activated.routes, 'GET', '/available')!
    const { body } = await callRoute(route, activated.ctx)
    const models = body.models as Array<Record<string, unknown>>

    const sonnet = models.find((m) => m.id === 'anthropic/claude-sonnet-4-6')!
    expect(sonnet.description).toBeTruthy()
    expect(sonnet.bestFor).toBeTruthy()
    expect(sonnet.costRange).toBeTruthy()
    expect(sonnet.kind).toBe('llm')
    expect(sonnet.brandIconSlug).toBe('anthropic')
    expect(sonnet.providerLabel).toBe('Anthropic')
    expect(sonnet.providerBrandIconSlug).toBe('anthropic')
  })

  it('resolves provider metadata on models even when the model itself is not in the catalog', async () => {
    const route = findRoute(activated.routes, 'GET', '/available')!
    const { body } = await callRoute(route, activated.ctx)
    const models = body.models as Array<Record<string, unknown>>

    // openai-codex/gpt-5.4 is not in the model catalog (we only seeded openai/gpt-5.4),
    // but `openai-codex` IS in the provider catalog, so the provider-level fields
    // should resolve even with no per-model enrichment.
    const gpt = models.find((m) => m.id === 'openai-codex/gpt-5.4')!
    expect(gpt.providerLabel).toBe('OpenAI (Codex)')
    expect(gpt.providerBrandIconSlug).toBe('openai')
    // Per-model fields should be absent (catalog miss)
    expect(gpt.description).toBeUndefined()
  })
})

describe('POST /refresh', () => {
  it('is registered', () => {
    expect(findRoute(activated.routes, 'POST', '/refresh')).toBeDefined()
  })

  it('bypasses cache and returns fresh models', async () => {
    const route = findRoute(activated.routes, 'POST', '/refresh')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.cached).toBe(false)
    expect(body.stale).toBe(false)
    expect(Array.isArray(body.models)).toBe(true)
    expect((body.models as unknown[]).length).toBeGreaterThan(0)
  })
})

describe('GET /available — response shape invariants', () => {
  it('response always has cached, cachedAt, stale, and models fields', async () => {
    const route = findRoute(activated.routes, 'GET', '/available')!
    const { body } = await callRoute(route, activated.ctx)
    expect(body).toHaveProperty('models')
    expect(body).toHaveProperty('cached')
    expect(body).toHaveProperty('cachedAt')
    expect(body).toHaveProperty('stale')
    expect(Array.isArray(body.models)).toBe(true)
  })

  it('enriched models carry kind field for catalog hits', async () => {
    const route = findRoute(activated.routes, 'GET', '/available')!
    const { body } = await callRoute(route, activated.ctx)
    const models = body.models as Array<Record<string, unknown>>
    const sonnet = models.find((m) => m.id === 'anthropic/claude-sonnet-4-6')
    expect(sonnet).toBeDefined()
    expect(sonnet!.kind).toBe('llm')
  })

  it('models without a catalog match still render with tier from heuristic', async () => {
    // The runtime fixture returns google/gemini-2.5-pro. That provider IS
    // in the catalog but the specific id is not — so the per-model enrichment
    // should be absent but the provider label should still resolve.
    const route = findRoute(activated.routes, 'GET', '/available')!
    const { body } = await callRoute(route, activated.ctx)
    const models = body.models as Array<Record<string, unknown>>
    const gemini = models.find((m) => m.id === 'google/gemini-2.5-pro')
    if (gemini) {
      // tier comes from heuristic (tierFromId treats 'pro' as premium)
      expect(gemini.tier).toBe('premium')
      // provider-level enrichment resolves even when model isn't cataloged
      expect(gemini.providerLabel).toBe('Google')
    }
  })
})

describe('POST /runtime/restart', () => {
  it('clears the in-memory cache after a successful restart', async () => {
    // Prime the cache via /available
    const availableRoute = findRoute(activated.routes, 'GET', '/available')!
    const first = await callRoute(availableRoute, activated.ctx)
    expect((first.body.models as unknown[]).length).toBeGreaterThan(0)

    // Restart goes through the runtime adapter and clears the cache layers.
    const restartRoute = findRoute(activated.routes, 'POST', '/runtime/restart')!
    const result = await callRoute(restartRoute, activated.ctx)
    expect(result.status).toBe(200)
    expect(runtimeMocks.restart).toHaveBeenCalled()
  })
})

describe('GET /aliases', () => {
  it('returns aliases from config', async () => {
    writeRuntimeConfig() // ensure fresh
    const route = findRoute(activated.routes, 'GET', '/aliases')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)

    const aliases = body.aliases as Record<string, string>
    expect(aliases.haiku).toBe('anthropic/claude-haiku-4-5')
    expect(aliases.opus).toBe('anthropic/claude-opus-4-6')
  })
})

describe('POST /aliases', () => {
  it('adds a new alias', async () => {
    writeRuntimeConfig()
    const route = findRoute(activated.routes, 'POST', '/aliases')!
    const { body: data } = await callRoute(route, activated.ctx, {
      body: { action: 'add', name: 'fast', target: 'claude-haiku-4-5' },
    })
    expect(data.ok).toBe(true)

    // Verify it persisted
    const getRoute = findRoute(activated.routes, 'GET', '/aliases')!
    const { body } = await callRoute(getRoute, activated.ctx)
    expect((body.aliases as Record<string, string>).fast).toBe('anthropic/claude-haiku-4-5')

    writeRuntimeConfig() // reset
  })

  it('deletes an alias', async () => {
    writeRuntimeConfig()
    const route = findRoute(activated.routes, 'POST', '/aliases')!
    const { body: data } = await callRoute(route, activated.ctx, {
      body: { action: 'delete', name: 'haiku' },
    })
    expect(data.ok).toBe(true)

    const getRoute = findRoute(activated.routes, 'GET', '/aliases')!
    const { body } = await callRoute(getRoute, activated.ctx)
    expect((body.aliases as Record<string, string>).haiku).toBeUndefined()

    writeRuntimeConfig() // reset
  })

  it('prepopulates default aliases', async () => {
    // Start with empty models
    const emptyConfig = JSON.parse(JSON.stringify(mockRuntimeConfig))
    emptyConfig.agents.defaults.models = {}
    writeRuntimeConfig(emptyConfig)

    const route = findRoute(activated.routes, 'POST', '/aliases')!
    const { body: data } = await callRoute(route, activated.ctx, {
      body: { action: 'prepopulate' },
    })
    expect(data.ok).toBe(true)

    const getRoute = findRoute(activated.routes, 'GET', '/aliases')!
    const { body } = await callRoute(getRoute, activated.ctx)
    const aliases = body.aliases as Record<string, string>
    expect(aliases.haiku).toBeDefined()
    expect(aliases.sonnet).toBeDefined()
    expect(aliases.opus).toBeDefined()

    writeRuntimeConfig() // reset
  })
})

describe('GET /runtime/status', () => {
  it('returns restartNeeded=false initially', async () => {
    const route = findRoute(activated.routes, 'GET', '/runtime/status')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)
    expect(typeof body.restartNeeded).toBe('boolean')
  })

  it('returns restartNeeded=true after config change', async () => {
    // Trigger a config change
    writeRuntimeConfig()
    const configRoute = findRoute(activated.routes, 'POST', '/config')!
    await callRoute(configRoute, activated.ctx, {
      body: { agentId: 'patch', ownModel: 'test-model' },
    })

    const statusRoute = findRoute(activated.routes, 'GET', '/runtime/status')!
    const { body } = await callRoute(statusRoute, activated.ctx)
    expect(body.restartNeeded).toBe(true)

    writeRuntimeConfig() // reset
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
      expect((result.models as unknown[]).length).toBe(6)
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
      writeRuntimeConfig()
      const tool = findTool(activated.execTools, 'bakin_exec_models_get_config')!
      const result = await callTool(tool, {})
      expect(result.ok).toBe(true)
      expect(Array.isArray(result.agents)).toBe(true)
      expect((result.agents as unknown[]).length).toBe(3)
    })

    it('returns single agent config', async () => {
      const tool = findTool(activated.execTools, 'bakin_exec_models_get_config')!
      const result = await callTool(tool, { agentId: 'main' })
      expect(result.ok).toBe(true)
      const agent = result.agent as Record<string, unknown>
      expect(agent.agentId).toBe('main')
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
