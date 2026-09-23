/**
 * Plugin-side composition of the model plan (spec §3.4): the candidate list
 * is built from the eligibility-overlaid catalog (ineligible rows never
 * enter it), vision resolves runtime `input` modalities → curated list →
 * unknown, the billing lane comes from the runtime's credential shapes with
 * the spend plugin's overrides on top (metered when the hook is absent),
 * enrichment-on comes from the assets hook (on when absent), and route
 * proposals derive from the plan for UNROUTED chores classes only.
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
import { buildPlanInput, describePlan, lastPlan, routeProposals } from '../../../plugins/models/lib/plan'
import { recommendForRef, visionOf } from '../../../src/core/model-plan-input'
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
  credentials?: Array<{ provider: string; kind: 'oauth' | 'api-key' }>
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
      credentialStatus: async () => ({ llmProviders: [], channels: [], llmCredentials: opts.credentials ?? [{ provider: 'openai-codex', kind: 'oauth' }, { provider: 'anthropic', kind: 'api-key' }] }),
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
  it('candidates = eligible rows only, with tier, lane from credentials, vision, context and catalog price', async () => {
    const input = await buildPlanInput(fakeCtx({ hooks: { 'assets.enrichmentEnabled': () => false } }))
    expect(input.candidates.map((c) => c.id).sort()).toEqual([HAIKU, MINI, LUNA].sort())
    const luna = input.candidates.find((c) => c.id === LUNA)!
    expect(luna).toMatchObject({ tier: 'premium', lane: 'subscription', vision: true, contextWindow: 400_000 })
    expect(luna.pricePer1M).toBeUndefined()
    const haiku = input.candidates.find((c) => c.id === HAIKU)!
    expect(haiku).toMatchObject({ tier: 'budget', lane: 'metered', vision: true })
    expect(haiku.pricePer1M).toBeGreaterThan(0)
    expect(input.currentDefaultModel).toBe(LUNA)
    expect(input.enrichmentEnabled).toBe(false)
  })

  it('a spend override beats detection; missing hooks read metered/enabled and never throw', async () => {
    const overridden = await buildPlanInput(fakeCtx({ hooks: { 'spend.listBillingOverrides': () => [{ provider: 'anthropic', lane: 'subscription' }] } }))
    expect(overridden.candidates.find((c) => c.id === HAIKU)!.lane).toBe('subscription')
    const bare = await buildPlanInput(fakeCtx({ credentials: [] }))
    expect(bare.candidates.every((c) => c.lane === 'metered')).toBe(true)
    expect(bare.enrichmentEnabled).toBe(true)
  })

  it('feeds the recommender: Codex-only style input yields the chores lane from the same catalog', async () => {
    const input = await buildPlanInput(fakeCtx())
    const plan = recommendPlan(input)
    expect(plan.agent.model).toBe(LUNA)
    // mini is blind (runtime says text-only) but included in the plan; haiku
    // is metered and so never "lighter" than a free model — mini takes the
    // chores and enrichment rides the (free, seeing) agent model.
    expect(plan.chores.model).toBe(MINI)
    expect(plan.enrichment).toBe('agent')
    expect(plan.routes.find((r) => r.workClass === 'enrichment')?.model).toBe(LUNA)
    expect(plan.ops.some((op) => op.ref === 'policy:defaultModel')).toBe(false)
  })
})

describe('recommendForRef', () => {
  it('chores routes get the plan route (or the chores model through inherit); everything else the agent model; unset enrichment has no answer', () => {
    const plan = recommendPlan({
      candidates: [
        { id: LUNA, tier: 'premium', lane: 'subscription', vision: true },
        { id: MINI, tier: 'budget', lane: 'subscription', vision: false },
      ],
      currentDefaultModel: LUNA,
      routing: { routes: [], tagOverrides: [] },
      enrichmentEnabled: true,
    })
    expect(recommendForRef(plan, 'route:relay')).toBe(MINI)
    expect(recommendForRef(plan, 'route:enrichment')).toBe(LUNA)
    expect(recommendForRef(plan, 'policy:defaultModel')).toBe(LUNA)
    expect(recommendForRef(plan, 'agent:pixel:model')).toBe(LUNA)
    expect(recommendForRef(plan, 'route:adhoc')).toBe(LUNA)
    const blind = recommendPlan({ ...plan, candidates: [{ id: LUNA, tier: 'premium', lane: 'subscription', vision: false }], currentDefaultModel: LUNA, routing: { routes: [], tagOverrides: [] }, enrichmentEnabled: true } as never)
    expect(recommendForRef(blind, 'route:enrichment')).toBeNull()
    expect(recommendForRef(blind, 'route:relay')).toBe(LUNA)
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

  it('a plan row naming the agent model is a skip, not a proposal — unrouted already inherits it', () => {
    const routing = { routes: [], tagOverrides: [] }
    const plan = recommendPlan({
      candidates: [
        { id: LUNA, tier: 'premium', lane: 'subscription', vision: true },
        { id: MINI, tier: 'budget', lane: 'subscription', vision: false },
      ],
      currentDefaultModel: LUNA,
      routing,
      enrichmentEnabled: true,
    })
    expect(plan.enrichment).toBe('agent')
    const { proposals, skipped } = routeProposals(plan, routing)
    expect(proposals.map((p) => p.workClass)).not.toContain('enrichment')
    expect(skipped).toEqual([{ workClass: 'enrichment', reason: expect.stringContaining('inherits the agent model') }])
  })
})

describe('describePlan (GET /plan payload)', () => {
  it('carries the caller\'s revision, the current lanes, the recommendation, the route-only proposals and the candidate count', async () => {
    const payload = await describePlan(fakeCtx({ hooks: { 'assets.enrichmentEnabled': () => true, 'spend.listBillingOverrides': () => [] } }), 'rev-abc')
    expect(payload.revision).toBe('rev-abc')
    expect(payload.current).toEqual({ agent: LUNA, chores: { model: LUNA, models: [LUNA], mixed: false }, enrichmentEnabled: true })
    expect(payload.recommended.agent.model).toBe(LUNA)
    expect(payload.recommended.ops.length).toBeGreaterThan(0)
    expect(payload.routeProposals.proposals.length + payload.routeProposals.skipped.length).toBe(5)
    expect(payload.candidates).toBe(3)
    // …and it is the plan a later refused write proposes from.
    expect(lastPlan()?.agent.model).toBe(LUNA)
  })
})
