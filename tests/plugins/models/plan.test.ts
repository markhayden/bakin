/**
 * Plugin-side composition of the model plan (spec §3.4): the candidate list
 * is built from the eligibility-overlaid catalog (ineligible rows never
 * enter it), vision resolves runtime `input` modalities → curated list →
 * unknown, the billing lane comes from the spend plugin's hook (metered when
 * the hook is absent), enrichment-on comes from the assets hook (on when
 * absent), and route proposals derive from the plan for UNROUTED chores
 * classes only.
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { mkdirSync, rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-models-plan-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import type { PluginContext } from '@bakin/core/plugin-types'
import { closeDb } from '../../../packages/core/src/storage/db'
import { setModelsCache } from '../../../plugins/models/lib/available-models'
import { clearPersistedCache } from '../../../plugins/models/lib/models-cache'
import { buildPlanInput, routeProposals, visionOf } from '../../../plugins/models/lib/plan'
import { recommendPlan } from '../../../src/core/model-plan'
import type { AvailableModel } from '../../../plugins/models/types'

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

const LUNA = 'openai-codex/gpt-5.6-luna'
const MINI = 'openai-codex/gpt-5.4-mini'
const HAIKU = 'anthropic/claude-haiku-4-5'
const DEAD = 'openai/gpt-6-astra'

function catalog(): AvailableModel[] {
  return [
    { id: LUNA, name: 'luna', tier: 'premium', provider: 'openai-codex', available: true, input: 'text,image', contextWindow: 400_000 },
    { id: MINI, name: 'mini', tier: 'budget', provider: 'openai-codex', available: true, input: 'text', contextWindow: 200_000 },
    { id: HAIKU, name: 'haiku', tier: 'budget', provider: 'anthropic', available: true },
    { id: DEAD, name: 'astra', tier: 'premium', provider: 'openai', available: false, unavailableReason: 'no_credentials' },
  ]
}

interface FakeCtxOpts {
  hooks?: Record<string, (data: Record<string, unknown>) => unknown>
  routing?: { routes: Array<{ workClass: string; model?: string | null }>; tagOverrides: unknown[] }
  defaultModel?: string
}

function fakeCtx(opts: FakeCtxOpts = {}): PluginContext {
  const hooks = opts.hooks ?? {}
  return {
    getSettings: () => ({ routing: opts.routing ?? { routes: [], tagOverrides: [] } }),
    hooks: {
      has: (name: string) => name in hooks,
      invoke: async (name: string, data: Record<string, unknown>) => {
        if (!(name in hooks)) throw new Error(`no handler for ${name}`)
        return hooks[name]!(data)
      },
    },
    runtime: {
      models: {
        listAvailable: async () => catalog().map((m) => ({ id: m.id, name: m.name, available: m.available, ...(m.input ? { input: m.input } : {}) })),
        routingPolicy: async () => ({ defaultModel: opts.defaultModel ?? LUNA, fallbackModels: [], aliases: {} }),
      },
      agents: { list: async () => [] },
    },
  } as unknown as PluginContext
}

beforeEach(() => {
  setModelsCache({ models: catalog(), fetchedAt: Date.now() })
  clearPersistedCache()
})

describe('visionOf', () => {
  it('runtime input modalities decide when present; the curated list only ever says yes; else unknown', () => {
    expect(visionOf({ id: 'x/y', input: 'text,image' })).toBe(true)
    expect(visionOf({ id: 'x/y', input: 'text' })).toBe(false)
    expect(visionOf({ id: HAIKU })).toBe(true)
    expect(visionOf({ id: 'x/unlisted' })).toBeNull()
  })
})

describe('buildPlanInput', () => {
  it('candidates = eligible rows only, with tier, lane from the spend hook, vision, context and catalog price', async () => {
    const seen: string[] = []
    const input = await buildPlanInput(fakeCtx({
      hooks: {
        'spend.resolveBilling': (d) => { seen.push(String(d.model)); return { lane: String(d.model).startsWith('openai-codex/') ? 'subscription' : 'metered', provider: 'p' } },
        'assets.enrichmentEnabled': () => false,
      },
    }))
    expect(input.candidates.map((c) => c.id).sort()).toEqual([HAIKU, MINI, LUNA].sort())
    const luna = input.candidates.find((c) => c.id === LUNA)!
    expect(luna).toMatchObject({ tier: 'premium', lane: 'subscription', vision: true, contextWindow: 400_000 })
    expect(luna.pricePer1M).toBeUndefined()
    const haiku = input.candidates.find((c) => c.id === HAIKU)!
    expect(haiku).toMatchObject({ tier: 'budget', lane: 'metered', vision: true })
    expect(haiku.pricePer1M).toBeGreaterThan(0)
    expect(input.currentDefaultModel).toBe(LUNA)
    expect(input.enrichmentEnabled).toBe(false)
    // One billing resolution per PROVIDER, never per model.
    expect(seen.length).toBe(2)
  })

  it('missing hooks: lane reads metered, enrichment reads enabled — never a throw', async () => {
    const input = await buildPlanInput(fakeCtx())
    expect(input.candidates.every((c) => c.lane === 'metered')).toBe(true)
    expect(input.enrichmentEnabled).toBe(true)
  })

  it('feeds the recommender: Codex-only style input yields the chores lane from the same catalog', async () => {
    const input = await buildPlanInput(fakeCtx({
      hooks: { 'spend.resolveBilling': (d) => ({ lane: String(d.model).startsWith('openai-codex/') ? 'subscription' : 'metered', provider: 'p' }) },
    }))
    const plan = recommendPlan(input)
    expect(plan.agent.model).toBe(LUNA)
    // mini is blind (runtime says text-only), so the lightest model that can see — haiku — takes the chores.
    expect(plan.chores.model).toBe(HAIKU)
    expect(plan.enrichment).toBe('chores')
    expect(plan.ops.some((op) => op.ref === 'policy:defaultModel')).toBe(false)
  })
})

describe('routeProposals', () => {
  it('proposes only UNROUTED chores classes from the plan ops; an unset enrichment target is a skip with the reason', () => {
    const routing = { routes: [{ workClass: 'relay' as const, model: HAIKU }], tagOverrides: [] }
    const plan = recommendPlan({
      candidates: [
        { id: LUNA, tier: 'premium', lane: 'subscription', vision: false },
        { id: MINI, tier: 'budget', lane: 'subscription', vision: false },
      ],
      currentDefaultModel: LUNA,
      routing,
      enrichmentEnabled: true,
    })
    const { proposals, skipped } = routeProposals(plan, routing)
    expect(proposals.map((p) => p.workClass).sort()).toEqual(['auto-title', 'skill-mapping', 'team-routing'])
    expect(proposals.every((p) => p.model === MINI)).toBe(true)
    expect(skipped).toEqual([{ workClass: 'enrichment', reason: expect.stringContaining('enrichment will fail') }])
  })
})
