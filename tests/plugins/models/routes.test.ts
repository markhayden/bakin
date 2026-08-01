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

// P2.3: the plugin reads the runtime roster (agents.list) + routing policy
// (models.routingPolicy) instead of raw runtime config. Mutable state the
// surface overrides below serve; writeRuntimeConfig() resets it.
interface TestAgent {
  id: string
  name: string
  model?: string
  subagentModel?: string
  status: 'active'
  metadata?: Record<string, unknown>
}
const seedAgents = (): TestAgent[] => [
  { id: 'main', name: 'Main Operator', model: 'anthropic/claude-opus-4-6', subagentModel: 'anthropic/claude-sonnet-4-6', status: 'active', metadata: { emoji: '🐾' } },
  { id: 'patch', name: 'Patch', status: 'active', metadata: { emoji: '⚙️' } },
  { id: 'pixel', name: 'Pixel', model: 'anthropic/claude-sonnet-4-6', status: 'active', metadata: { emoji: '🖼️' } },
]
const seedPolicy = () => ({
  defaultModel: 'anthropic/claude-sonnet-4-6',
  fallbackModels: [] as string[],
  defaultSubagentModel: 'anthropic/claude-haiku-4-5' as string | null,
  aliases: { haiku: 'claude-haiku-4-5', opus: 'claude-opus-4-6' } as Record<string, string>,
})
let runtimeAgents = seedAgents()
let routingPolicy = seedPolicy()

const runtimeModels = [
  { id: 'openai-codex/gpt-5.4', name: 'GPT-5.4', available: true, local: false, tags: ['default', 'configured'] },
  { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', available: true, local: false, tags: ['configured', 'alias:opus'] },
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', available: true, local: false, tags: ['configured', 'fallback#1', 'alias:sonnet'] },
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', available: true, local: false, tags: ['configured'] },
  { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', available: true, local: false, tags: [] },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', available: true, local: false, tags: [] },
  { id: 'xai/grok-4', name: 'Grok 4', available: false, local: false, tags: [] },
]

const runtimeMocks = {
  listAvailable: mock(async () => runtimeModels),
  restart: mock(async () => {}),
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
    warn: (...a: unknown[]) => { if (process.env.DEBUG_WARN) console.log('WARN:', ...a) },
    error: mock(),
    debug: mock(),
  }),
}))

// Spend route reads the ledger facade; mock it with canned rollups so the
// route test doesn't need a real db.
class FakeLedgerUnavailable extends Error {}
let incidentsList: unknown[] = []
const incidentResolves: Array<Record<string, unknown>> = []
mock.module('../../../src/core/execution-ledger', () => ({
  listRunCostsSince: mock(() => [
    { runId: 'r1', agent: 'pixel', model: 'anthropic/claude-sonnet-4-6', provider: 'anthropic', lane: 'metered', usageKind: 'tokens', totalTokens: 100, costUsdMicros: 150_000, workClass: 'scheduled', routeSource: 'class', occurredAt: Date.now() },
    { runId: 'r2', agent: 'patch', model: '', provider: null, lane: null, usageKind: 'tokens', totalTokens: 40, costUsdMicros: null, workClass: null, routeSource: null, occurredAt: Date.now() },
  ]),
  listBudgetIncidents: mock(() => incidentsList),
  resolveBudgetIncident: mock((input: unknown) => { incidentResolves.push(input as Record<string, unknown>); return true }),
  resolveExpiredBudgetIncidents: mock(() => 0),
  findOpenCapIncident: mock(() => null),
  // dispatch-turns (dynamic import in /budget/status) needs the dispatch verbs at load.
  claimNextRun: mock(() => ({ claimed: false })),
  settleRun: mock(() => true),
  loseRun: mock(() => true),
  currentSeq: mock(() => 0),
  recordRunCost: mock(() => {}),
  openBudgetIncident: mock(() => ({ opened: false, id: 1 })),
  LedgerUnavailableError: FakeLedgerUnavailable,
}))
// dispatch-turns (dynamically imported by /budget/status perTask) pulls
// app-services + the adapter home transitively — stub them so the import is
// side-effect-free in this test env (same trio as budget-gate.test.ts).
mock.module('../../../src/core/app-services', () => ({ getAppServices: () => ({ runtime: { messaging: { send: async () => ({ id: 'm' }) }, agents: { list: async () => [{ id: 'main', name: 'Main' }] } } }) }))
mock.module('@/core/app-services', () => ({ getAppServices: () => ({ runtime: { messaging: { send: async () => ({ id: 'm' }) }, agents: { list: async () => [{ id: 'main', name: 'Main' }] } } }) }))
mock.module('@bakin/adapter-openclaw/home', () => ({ getOpenClawHome: () => testDir, getOpenClawPath: (s: string) => join(testDir, s), resetOpenClawHome: () => {} }))

// Task board for the /budget/status perTask computation — one unassigned todo task.
mock.module('../../../src/core/task-store', () => ({
  // dispatch-turns (dynamically imported by /budget/status) needs the full
  // facade shape at load — partial mocks break on missing exports.
  readTaskboard: () => ({ columns: { todo: [{ id: 't-unassigned', title: 'Badge me' }] } }),
  moveTask: async () => {},
  addTaskLog: async () => {},
  updateTask: async () => {},
  blockTask: async () => {},
}))

// The spend engine's observed side — empty for route tests.
mock.module('../../../packages/core/src/usage-history/store', () => ({
  readUsageByAgentModelDaySince: () => [],
  toLocalDayKey: (tsMs: number) => {
    const d = new Date(tsMs)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  },
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

/** Reset runtime-side state (roster + routing policy) to the seed. */
function writeRuntimeConfig(overrides: { aliases?: Record<string, string> } = {}) {
  runtimeAgents = seedAgents()
  routingPolicy = seedPolicy()
  if (overrides.aliases !== undefined) routingPolicy.aliases = overrides.aliases
}

beforeAll(async () => {
  mkdirSync(testDir, { recursive: true })
  writeRuntimeConfig()

  // Plugin settings dir
  mkdirSync(join(testDir, '.bakin', 'plugin-settings'), { recursive: true })

  activated = await activatePlugin(modelsPlugin, testDir)
  activated.ctx.runtime.models.listAvailable = runtimeMocks.listAvailable as typeof activated.ctx.runtime.models.listAvailable
  activated.ctx.runtime.restart = runtimeMocks.restart
  // P2.3 surfaces: roster + routing policy served from the mutable test state.
  activated.ctx.runtime.agents.list = async () => runtimeAgents.map((a) => ({ ...a }))
  activated.ctx.runtime.agents.update = async (agentId, input) => {
    const agent = runtimeAgents.find((a) => a.id === agentId)
    if (!agent) throw new Error(`Agent not found: ${agentId}`)
    if (input.model !== undefined) {
      if (input.model === null) delete agent.model
      else agent.model = input.model
    }
    if (input.subagentModel !== undefined) {
      if (input.subagentModel === null) delete agent.subagentModel
      else agent.subagentModel = input.subagentModel
    }
    return { ...agent }
  }
  activated.ctx.runtime.models.routingPolicy = async () => ({ ...routingPolicy, fallbackModels: [...routingPolicy.fallbackModels], aliases: { ...routingPolicy.aliases } })
  activated.ctx.runtime.models.setRoutingPolicy = async (patch, reason) => {
    if (!reason) throw new Error('setRoutingPolicy reason required')
    Object.assign(routingPolicy, patch)
  }
  activated.ctx.runtime.models.routingSupport = () => ({
    defaultModel: true,
    fallbackModels: true,
    defaultSubagentModel: true,
    aliases: true,
    perAgentSubagentModel: true,
    supportedThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max'],
  })
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
      'GET /budget',
      'GET /budget/incidents',
      'GET /budget/status',
      'GET /config',
      'GET /routing',
      'GET /runtime/status',
      'GET /spend',
      'POST /aliases',
      'POST /budget/incidents/:id/resolve',
      'POST /config',
      'POST /defaults',
      'POST /refresh',
      'POST /routing/recommend',
      'POST /runtime/restart',
      'PUT /billing/overrides',
      'PUT /budget',
      'PUT /routing',
    ])
    expect(activated.routes.find((route) => route.path === '/budget/status')?.activityClass).toBe('routine')
  })

  it('registers 2 exec tools', () => {
    expect(activated.execTools.length).toBe(2)
    expect(activated.execTools.map((t) => t.name).sort()).toEqual([
      'bakin_exec_models_get_config',
      'bakin_exec_models_list',
    ])
  })

  it('registers 12 hooks', () => {
    expect(activated.ctx.hooks.register).toHaveBeenCalledTimes(12)
    const hookNames = (activated.ctx.hooks.register as ReturnType<typeof mock>).mock.calls.map(
      (c: unknown[]) => c[0]
    )
    expect(hookNames.sort()).toEqual([
      'models.configChanged',
      'models.getAvailableModels',
      'models.getBudgetPolicy',
      'models.getEffectiveModel',
      'models.getRoutingConfig',
      'models.markConfigDirty',
      'models.markRuntimeRestarted',
      'models.priceImage',
      'models.priceTurn',
      'models.refreshAvailableModels',
      'models.resolveBilling',
      'models.updateBudgetPolicy',
    ])
  })

  describe('models.priceTurn hook', () => {
    function priceTurnHandler(): (data: Record<string, unknown>) => Promise<{ model: string | null; costUsdMicros: number | null }> {
      const call = (activated.ctx.hooks.register as ReturnType<typeof mock>).mock.calls.find(
        (c: unknown[]) => c[0] === 'models.priceTurn'
      )!
      return call[1] as (data: Record<string, unknown>) => Promise<{ model: string | null; costUsdMicros: number | null }>
    }

    it('prices a turn from an explicit catalog model', async () => {
      const result = await priceTurnHandler()({ model: 'anthropic/claude-sonnet-4-6', input: 1_000_000, output: 1_000_000 })
      expect(result.model).toBe('anthropic/claude-sonnet-4-6')
      // 1M in @ $3 + 1M out @ $15 = $18 → 18_000_000 micro-$
      expect(result.costUsdMicros).toBe(18_000_000)
    })

    it('returns null cost for an unpriced model but still resolves the model id', async () => {
      const result = await priceTurnHandler()({ model: 'mystery/unknown', input: 1000, output: 500 })
      expect(result.model).toBe('mystery/unknown')
      expect(result.costUsdMicros).toBeNull()
    })

    it('returns null cost when token counts are absent', async () => {
      const result = await priceTurnHandler()({ model: 'anthropic/claude-sonnet-4-6' })
      expect(result.costUsdMicros).toBeNull()
    })
  })

  describe('models.priceImage hook', () => {
    function priceImageHandler(): (data: Record<string, unknown>) => Promise<{ model: string | null; provider: string; lane: string; costUsdMicros: number | null }> {
      const call = (activated.ctx.hooks.register as ReturnType<typeof mock>).mock.calls.find(
        (c: unknown[]) => c[0] === 'models.priceImage'
      )!
      return call[1] as (data: Record<string, unknown>) => Promise<{ model: string | null; provider: string; lane: string; costUsdMicros: number | null }>
    }

    it('prices an image at the flat per-image rate × count', async () => {
      const r = await priceImageHandler()({ model: 'black-forest-labs/flux-pro', count: 2 })
      expect(r.costUsdMicros).toBe(110_000)
      expect(r.provider).toBe('black-forest-labs')
      expect(r.lane).toBe('metered') // no auth-profile info in this ctx → conservative default
    })

    it('returns null cost for a provider-priced image model', async () => {
      const r = await priceImageHandler()({ model: 'openai/gpt-image-2', count: 1 })
      expect(r.model).toBe('openai/gpt-image-2')
      expect(r.costUsdMicros).toBeNull()
    })

    it("REGRESSION: an agent's subscription CHAT auth never suppresses billed-image dollars", async () => {
      // Image generation bills via provider credentials, not the agent's
      // chat auth — a Codex-OAuth agent generating on a metered image key
      // must still book real dollars against the caps.
      const originalStatus = activated.ctx.runtime.credentialStatus
      activated.ctx.runtime.credentialStatus = (async () => ({
        llmProviders: ['black-forest-labs'],
        llmCredentials: [{ provider: 'black-forest-labs', kind: 'oauth' as const }],
        channels: [],
      })) as typeof activated.ctx.runtime.credentialStatus
      try {
        const r = await priceImageHandler()({ agentId: 'main', model: 'black-forest-labs/flux-pro', count: 2 })
        expect(r.lane).toBe('metered')
        expect(r.costUsdMicros).toBe(110_000)
      } finally {
        activated.ctx.runtime.credentialStatus = originalStatus
      }
    })
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
    // Start with an empty alias map
    writeRuntimeConfig({ aliases: {} })

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

describe('routing config', () => {
  it('GET /routing returns an empty config by default', async () => {
    const route = findRoute(activated.routes, 'GET', '/routing')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)
    expect(body).toEqual({ routes: [], tagOverrides: [] })
  })

  it('PUT /routing validates and persists routes + tag overrides', async () => {
    const route = findRoute(activated.routes, 'PUT', '/routing')!
    const config = {
      routes: [{ workClass: 'scheduled', model: 'anthropic/claude-haiku-4-5', thinking: 'low' }],
      tagOverrides: [{ tag: 'heavy', model: 'anthropic/claude-opus-4-6' }],
    }
    const { status, body } = await callRoute(route, activated.ctx, { body: config })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(activated.ctx.updateSettings).toHaveBeenCalledWith({ routing: config })
  })

  it('PUT /routing rejects an unknown work class', async () => {
    const route = findRoute(activated.routes, 'PUT', '/routing')!
    const { status } = await callRoute(route, activated.ctx, {
      body: { routes: [{ workClass: 'bogus', model: 'm' }], tagOverrides: [] },
    })
    expect(status).toBe(400)
  })

})

describe('budget policy', () => {
  it('GET /budget returns an empty policy by default', async () => {
    const route = findRoute(activated.routes, 'GET', '/budget')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)
    expect(body).toEqual({})
  })

  it('PUT /budget validates and persists the FULL rule list (agent/provider rules round-trip)', async () => {
    const route = findRoute(activated.routes, 'PUT', '/budget')!
    const policy = {
      rules: [
        { scope: 'global', lane: 'metered', dailyCap: 25, monthlyCap: 500, warnPct: 0.8 },
        { scope: 'agent', scopeId: 'pixel', lane: 'metered', dailyCap: 5 },
        { scope: 'provider', scopeId: 'google', lane: 'metered', dailyCap: 5, atCap: 'pause' },
        { scope: 'agent', scopeId: 'main', lane: 'subscription', dailyCap: 5_000_000 },
      ],
    }
    const { status, body } = await callRoute(route, activated.ctx, { body: policy })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(activated.ctx.updateSettings).toHaveBeenCalledWith({ budget: policy })
  })

  it('PUT /budget rejects a negative cap', async () => {
    const route = findRoute(activated.routes, 'PUT', '/budget')!
    const { status } = await callRoute(route, activated.ctx, { body: { rules: [{ scope: 'global', lane: 'metered', dailyCap: -5 }] } })
    expect(status).toBe(400)
  })

  it('PUT /budget rejects a scoped rule without a scopeId', async () => {
    const route = findRoute(activated.routes, 'PUT', '/budget')!
    const { status } = await callRoute(route, activated.ctx, { body: { rules: [{ scope: 'provider', lane: 'metered', dailyCap: 5 }] } })
    expect(status).toBe(400)
  })
})

describe('budget status + incidents routes (cost-control v2)', () => {
  it('GET /budget/status is side-effect-free and reports configured=false with no rules', async () => {
    const route = findRoute(activated.routes, 'GET', '/budget/status')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)
    expect(body.configured).toBe(false)
    expect(body.paused).toBe(false)
    expect(body.perAgent).toEqual({})
  })

  it('REGRESSION: /budget/status degrades (200, empty perAgent) when the runtime config is unreadable', async () => {
    // Found live at checkpoint E: resolveAgents threw (no runtime installed)
    // and the status poll 500'd — killing task badges + the pause banner.
    const originalGetSettings = activated.ctx.getSettings
    const originalList = activated.ctx.runtime.agents.list
    activated.ctx.getSettings = (() => ({ budget: { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] } })) as typeof activated.ctx.getSettings
    activated.ctx.runtime.agents.list = (async () => { throw new Error('runtime down') }) as typeof activated.ctx.runtime.agents.list
    try {
      const route = findRoute(activated.routes, 'GET', '/budget/status')!
      const { status, body } = await callRoute(route, activated.ctx)
      expect(status).toBe(200)
      expect(body.configured).toBe(true)
      expect(body.perAgent).toEqual({})
    } finally {
      activated.ctx.getSettings = originalGetSettings
      activated.ctx.runtime.agents.list = originalList
    }
  })

  it('PUT /budget warns on unknown agent/provider scopeIds (typo = fake safety)', async () => {
    const route = findRoute(activated.routes, 'PUT', '/budget')!
    const { status, body } = await callRoute(route, activated.ctx, {
      body: { rules: [
        { scope: 'agent', scopeId: 'no-such-agent', lane: 'metered', dailyCap: 5 },
        { scope: 'provider', scopeId: 'Anthropic', lane: 'metered', dailyCap: 5 },
      ] },
    })
    expect(status).toBe(200)
    const warnings = body.warnings as string[]
    expect(warnings.some((w) => w.includes('no-such-agent'))).toBe(true)
    expect(warnings.some((w) => w.includes("'Anthropic'"))).toBe(true)
  })

  it('PUT /budget normalizes model-scope scopeIds so they key like spend rows', async () => {
    const route = findRoute(activated.routes, 'PUT', '/budget')!
    const originalGetSettings = activated.ctx.getSettings
    const writes: Array<Record<string, unknown>> = []
    const originalUpdate = activated.ctx.updateSettings
    activated.ctx.updateSettings = ((patch: Record<string, unknown>) => { writes.push(patch); return (originalUpdate as (p: Record<string, unknown>) => unknown)(patch) }) as typeof activated.ctx.updateSettings
    try {
      const { status } = await callRoute(route, activated.ctx, {
        body: { rules: [{ scope: 'model', scopeId: 'claude-opus-4-6', lane: 'metered', dailyCap: 10 }] },
      })
      expect(status).toBe(200)
      const saved = writes.at(-1) as { budget?: { rules?: Array<{ scopeId?: string }> } }
      expect(saved.budget?.rules?.[0]?.scopeId).toBe('anthropic/claude-opus-4-6')
    } finally {
      activated.ctx.updateSettings = originalUpdate
      activated.ctx.getSettings = originalGetSettings
    }
  })

  it('PUT /budget resolves live incidents whose rule was deleted (no orphaned banner rows)', async () => {
    incidentsList = [{ id: 12, scope: 'provider', scopeId: 'google', lane: 'metered', window: 'daily', kind: 'cap', status: 'open' }]
    const route = findRoute(activated.routes, 'PUT', '/budget')!
    const { status } = await callRoute(route, activated.ctx, { body: { rules: [] } })
    expect(status).toBe(200)
    expect(incidentResolves.at(-1)).toMatchObject({ id: 12, status: 'resolved', resolution: 'rule_removed' })
    incidentsList = []
  })

  it('PUT /billing/overrides validates and persists lane overrides', async () => {
    const route = findRoute(activated.routes, 'PUT', '/billing/overrides')!
    const ok = await callRoute(route, activated.ctx, { body: { overrides: [{ agentId: 'main', lane: 'subscription' }] } })
    expect(ok.status).toBe(200)
    const bad = await callRoute(route, activated.ctx, { body: { overrides: [{ lane: 'metered' }] } })
    expect(bad.status).toBe(400)
  })

  it('GET /budget/status computes perTask holds with the main-agent fallback (unassigned tasks badge)', async () => {
    const originalGetSettings = activated.ctx.getSettings
    const originalAgents = activated.ctx.runtime.agents
    // $0.10 daily cap; the mocked ledger has $0.15 attributed → deferred.
    activated.ctx.getSettings = (() => ({ budget: { rules: [{ scope: 'global', lane: 'metered', dailyCap: 0.1 }] } })) as typeof activated.ctx.getSettings
    activated.ctx.runtime.agents = { ...originalAgents, list: (async () => [{ id: 'main', name: 'Main' }]) } as typeof activated.ctx.runtime.agents
    try {
      const route = findRoute(activated.routes, 'GET', '/budget/status')!
      const { status, body } = await callRoute(route, activated.ctx)
      expect(status).toBe(200)
      expect((body.perTask as Record<string, string>)['t-unassigned']).toBe('deferred')
    } finally {
      activated.ctx.getSettings = originalGetSettings
      activated.ctx.runtime.agents = originalAgents
    }
  })

  it('models.getBudgetPolicy migrates a legacy shape ON READ (runtime-restored settings file)', async () => {
    const call = (activated.ctx.hooks.register as ReturnType<typeof mock>).mock.calls.find((c: unknown[]) => c[0] === 'models.getBudgetPolicy')!
    const handler = call[1] as () => { rules?: unknown[] }
    const originalGetSettings = activated.ctx.getSettings
    activated.ctx.getSettings = (() => ({ budget: { global: { dailyUsd: 10 } } })) as typeof activated.ctx.getSettings
    try {
      const policy = handler()
      expect(policy.rules).toEqual([{ scope: 'global', lane: 'metered', dailyCap: 10 }])
    } finally {
      activated.ctx.getSettings = originalGetSettings
    }
  })

  it('GET /budget/status?lite=1 returns only the kill-switch bit', async () => {
    const route = findRoute(activated.routes, 'GET', '/budget/status')!
    const { status, body } = await callRoute(route, activated.ctx, { searchParams: { lite: '1' } })
    expect(status).toBe(200)
    expect(Object.keys(body)).toEqual(['paused'])
  })

  it('GET /budget/incidents lists open incidents', async () => {
    incidentsList = [{ id: 1, scope: 'global', scopeId: '', lane: 'metered', window: 'daily', kind: 'cap', status: 'open' }]
    const route = findRoute(activated.routes, 'GET', '/budget/incidents')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)
    expect((body.incidents as unknown[]).length).toBe(1)
    incidentsList = []
  })

  it('POST resolve ack acknowledges without touching settings', async () => {
    incidentsList = [{ id: 4, scope: 'global', scopeId: '', lane: 'metered', window: 'daily', kind: 'cap', status: 'open' }]
    const route = findRoute(activated.routes, 'POST', '/budget/incidents/:id/resolve')!
    const { status, body } = await callRoute(route, activated.ctx, { searchParams: { id: '4' }, body: { action: 'ack' } })
    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(incidentResolves.at(-1)).toMatchObject({ id: 4, status: 'acknowledged' })
    incidentsList = []
  })

  it('POST resolve raise validates the new cap against current spend and updates the rule', async () => {
    // Rule + settings: global metered $0.10 daily cap; attributed spend is 150_000 micros ($0.15).
    const originalGetSettings = activated.ctx.getSettings
    activated.ctx.getSettings = (() => ({ budget: { rules: [{ scope: 'global', lane: 'metered', dailyCap: 0.1 }] } })) as typeof activated.ctx.getSettings
    incidentsList = [{ id: 9, scope: 'global', scopeId: '', lane: 'metered', window: 'daily', kind: 'cap', status: 'open' }]
    const route = findRoute(activated.routes, 'POST', '/budget/incidents/:id/resolve')!
    try {
      // Too low (≤ current $0.15 spend) → 400.
      const low = await callRoute(route, activated.ctx, { searchParams: { id: '9' }, body: { action: 'raise', cap: 0.12 } })
      expect(low.status).toBe(400)
      expect(String(low.body.error)).toContain('must exceed current')

      // High enough → rule updated + incident resolved.
      const ok = await callRoute(route, activated.ctx, { searchParams: { id: '9' }, body: { action: 'raise', cap: 5 } })
      expect(ok.status).toBe(200)
      expect(activated.ctx.updateSettings).toHaveBeenCalledWith({ budget: { rules: [{ scope: 'global', lane: 'metered', dailyCap: 5 }] } })
      expect(incidentResolves.at(-1)).toMatchObject({ id: 9, status: 'resolved', resolution: 'raised' })
    } finally {
      incidentsList = []
      activated.ctx.getSettings = originalGetSettings
    }
  })

  it('POST resolve 404s for an unknown incident', async () => {
    const route = findRoute(activated.routes, 'POST', '/budget/incidents/:id/resolve')!
    const { status } = await callRoute(route, activated.ctx, { searchParams: { id: '999' }, body: { action: 'ack' } })
    expect(status).toBe(404)
  })
})

describe('GET /spend', () => {
  it('exposes cap-window facets + pace alongside the rolling rollups', async () => {
    const route = findRoute(activated.routes, 'GET', '/spend')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)
    const facets = body.facets as { daily: { global: Record<string, unknown> } }
    expect(facets.daily.global.meteredUsdMicros).toBe(150_000)
    expect(body.pace).toHaveProperty('daily')
    expect(body.pace).toHaveProperty('monthly')
    const timeline = body.timeline as Array<{ costUsdMicros: number | null }>
    expect(timeline).toHaveLength(6)
    expect(timeline.reduce(
      (sum: number, bucket: { costUsdMicros: number | null }) => sum + (bucket.costUsdMicros ?? 0),
      0,
    )).toBe(150_000)
  })

  it('returns windowed spend rollups (total, byAgent, byModel, byWorkClass) — NULL-honest', async () => {
    const route = findRoute(activated.routes, 'GET', '/spend')!
    const { status, body } = await callRoute(route, activated.ctx, { searchParams: { window: '24h' } })
    expect(status).toBe(200)
    expect(body.window).toBe('24h')
    expect(body.totalUsdMicros).toBe(150_000)
    expect(body.byAgent).toEqual([
      { agent: 'pixel', costUsdMicros: 150_000, runs: 1 },
      // Unpriced bucket reports null — never the legacy fabricated $0.
      { agent: 'patch', costUsdMicros: null, runs: 1 },
    ])
    // Unmodeled '' model id surfaces as a recognizable "unknown" label.
    expect(body.byModel).toEqual(expect.arrayContaining([
      { model: 'anthropic/claude-sonnet-4-6', costUsdMicros: 150_000, runs: 1 },
      { model: 'unknown', costUsdMicros: null, runs: 1 },
    ]))
    expect(body.byWorkClass).toEqual(expect.arrayContaining([
      expect.objectContaining({ workClass: 'scheduled', runs: 1, costUsdMicros: 150_000, avgCostUsdMicros: 150_000 }),
      expect.objectContaining({ workClass: 'unclassified', runs: 1, costUsdMicros: null }),
    ]))
  })

  it('defaults to a 24h window when none is given', async () => {
    const route = findRoute(activated.routes, 'GET', '/spend')!
    const { status, body } = await callRoute(route, activated.ctx)
    expect(status).toBe(200)
    expect(body.window).toBe('24h')
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
