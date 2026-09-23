/**
 * models.routing health check + recommended routes — misrouting is detected,
 * not discovered on the bill; proposals never guess.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), 'bakin-test-models-health')
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }) }))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import { checkModelRouting, recommendRoutes, recommendedRoutesRepair, type RoutingHealthDeps } from '../../../plugins/models/lib/health-checks'
import type { RunCostSpendRow } from '../../../src/core/execution-ledger'
import type { WorkClassRoute } from '../../../src/core/model-routing'
import { recommendPlan, type PlanCandidate } from '../../../src/core/model-plan'

const NOW = 1_752_000_000_000

function row(over: Partial<RunCostSpendRow>): RunCostSpendRow {
  return {
    runId: 'task:t:d1', agent: 'pixel', model: 'anthropic/claude-haiku-4-5', provider: 'anthropic',
    lane: 'metered', usageKind: 'tokens', totalTokens: 100, costUsdMicros: 100,
    workClass: 'auto-title', routeSource: 'class', occurredAt: NOW - 1000, ...over,
  }
}

const HAIKU: PlanCandidate = { id: 'anthropic/claude-haiku-4-5', tier: 'budget', lane: 'metered', pricePer1M: 6, vision: true }
const OPUS: PlanCandidate = { id: 'anthropic/claude-opus-4-6', tier: 'premium', lane: 'metered', pricePer1M: 90, vision: true }
const FLASH: PlanCandidate = { id: 'google/gemini-2.5-flash', tier: 'budget', lane: 'metered', pricePer1M: 3, vision: true }

/** Deps whose plan runs the REAL recommender over a candidate list (default: opus is the agent model). */
function deps(over: Partial<RoutingHealthDeps> & { candidates?: PlanCandidate[]; defaultModel?: string } = {}): RoutingHealthDeps {
  const { candidates = [HAIKU, OPUS, FLASH], defaultModel = OPUS.id, ...rest } = over
  const base: RoutingHealthDeps = {
    getRoutingConfig: () => ({ routes: [], tagOverrides: [] }),
    recommendPlan: async () => recommendPlan({ candidates, currentDefaultModel: defaultModel, routing: base.getRoutingConfig(), enrichmentEnabled: true }),
    supportedThinkingLevels: () => ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    supportsPerTurnModel: () => true,
    listRecentRunCosts: () => [],
    now: () => NOW,
  }
  return Object.assign(base, rest)
}

describe('recommendRoutes', () => {
  it('proposes the plan\'s chores model for each unrouted chores class', async () => {
    const { proposals, skipped } = await recommendRoutes(deps())
    const byClass = new Map(proposals.map((p) => [p.workClass, p]))
    // gemini flash is the cheapest priced model in the pool (catalog truth).
    expect(byClass.get('auto-title')?.model).toBe('google/gemini-2.5-flash')
    expect(byClass.get('relay')?.model).toBe('google/gemini-2.5-flash')
    expect(byClass.get('team-routing')?.model).toBe('google/gemini-2.5-flash')
    // enrichment needs vision — flash is vision-capable and available.
    expect(byClass.get('enrichment')?.model).toBe('google/gemini-2.5-flash')
    expect(skipped).toEqual([])
    // Non-recommended classes are never proposed.
    expect(byClass.has('send')).toBe(false)
    expect(byClass.has('adhoc')).toBe(false)
  })

  it('skips enrichment with a reason when no eligible model can see — never blind', async () => {
    const { proposals, skipped } = await recommendRoutes(deps({
      candidates: [
        { id: 'openai-codex/gpt-5.5-codex', tier: 'premium', lane: 'subscription', vision: false },
        { id: 'openai-codex/gpt-5.4-mini', tier: 'budget', lane: 'subscription', vision: false },
      ],
      defaultModel: 'openai-codex/gpt-5.5-codex',
    }))
    expect(skipped).toEqual([expect.objectContaining({ workClass: 'enrichment', reason: expect.stringContaining('vision-capable') })])
    expect(proposals.find((p) => p.workClass === 'enrichment')).toBeUndefined()
    expect(proposals.find((p) => p.workClass === 'relay')?.model).toBe('openai-codex/gpt-5.4-mini')
  })

  it('Codex-only box with unknown vision metadata: the lightest model is proposed for every chore (disclosed, never withheld)', async () => {
    const { proposals, skipped } = await recommendRoutes(deps({
      candidates: [
        { id: 'openai-codex/gpt-5.4', tier: 'premium', lane: 'subscription', vision: null },
        { id: 'openai-codex/gpt-5.4-mini', tier: 'budget', lane: 'subscription', vision: null },
        { id: 'openai-codex/gpt-5.5', tier: 'premium', lane: 'subscription', vision: null },
      ],
      defaultModel: 'openai-codex/gpt-5.5',
    }))
    const byClass = new Map(proposals.map((p) => [p.workClass, p]))
    expect(byClass.get('auto-title')?.model).toBe('openai-codex/gpt-5.4-mini')
    expect(byClass.get('enrichment')?.model).toBe('openai-codex/gpt-5.4-mini')
    expect(skipped).toEqual([])
  })

  it('a plan row that names the AGENT model is never a proposal — unrouted already inherits it (enrichment → agent case)', async () => {
    // opus (premium, sees) + a blind budget model: the plan sends the four
    // chores to the budget model and enrichment to the agent model. Unrouted
    // enrichment already resolves to opus, so proposing "route:enrichment →
    // opus" would be a standing false "unrouted, route it cheap" finding
    // whose repair routes background work to the PREMIUM model.
    const blindMini: PlanCandidate = { id: 'openai-codex/gpt-5.4-mini', tier: 'budget', lane: 'subscription', vision: false }
    const d = deps({ candidates: [OPUS, blindMini], defaultModel: OPUS.id })
    const { proposals, skipped } = await recommendRoutes(d)
    expect(proposals.map((p) => p.workClass).sort()).toEqual(['auto-title', 'relay', 'skill-mapping', 'team-routing'])
    expect(skipped).toEqual([expect.objectContaining({ workClass: 'enrichment', reason: expect.stringContaining('inherits the agent model') })])
    // …and once those four are routed, the check is clean — no finding lingers on enrichment.
    const routed = deps({
      candidates: [OPUS, blindMini], defaultModel: OPUS.id,
      getRoutingConfig: () => ({ routes: ['auto-title', 'relay', 'skill-mapping', 'team-routing'].map((workClass) => ({ workClass: workClass as WorkClassRoute['workClass'], model: blindMini.id })), tagOverrides: [] }),
    })
    const result = await checkModelRouting(routed)
    if (result.outcome !== 'observed') throw new Error('expected observed')
    expect(result.observations.find((o) => o.key === 'unrouted-system-classes')).toBeUndefined()
  })

  it('only the agent model exists ⇒ nothing to propose; every class skips as inherit', async () => {
    const { proposals, skipped } = await recommendRoutes(deps({
      candidates: [{ id: 'openai-codex/gpt-5.5', tier: 'premium', lane: 'subscription', vision: null }],
      defaultModel: 'openai-codex/gpt-5.5',
    }))
    expect(proposals).toEqual([])
    expect(skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ workClass: 'relay', reason: expect.stringContaining('inherits the agent model') }),
    ]))
  })

  it('already-routed classes are not proposed', async () => {
    const { proposals } = await recommendRoutes(deps({
      getRoutingConfig: () => ({ routes: [{ workClass: 'auto-title', model: 'x/y' }], tagOverrides: [] }),
    }))
    expect(proposals.find((p) => p.workClass === 'auto-title')).toBeUndefined()
  })
})

describe('routes-model-clamped — runtime refuses per-turn overrides (#880)', () => {
  it('fires a watch finding when model routes exist and the runtime clamps them', async () => {
    const result = await checkModelRouting(deps({
      getRoutingConfig: () => ({ routes: [{ workClass: 'relay', model: 'openai/gpt-5.5' }, { workClass: 'auto-title', model: 'openai/gpt-5.5' }], tagOverrides: [] }),
      supportsPerTurnModel: () => false,
      candidates: [{ id: 'openai/gpt-5.5', tier: 'premium', lane: 'metered', vision: true }],
      defaultModel: 'openai/gpt-5.5',
    }))
    if (result.outcome !== 'observed') throw new Error('expected observed')
    const finding = result.observations.find((o) => o.key === 'routes-model-clamped')!
    expect(finding.status).toBe('warning')
    expect(finding.evidence).toMatchObject({ workClasses: ['relay', 'auto-title'], perTurnModel: false })
  })

  it('counts tag overrides too — a tag-only routing config still clamps (#880 review R4)', async () => {
    const result = await checkModelRouting(deps({
      getRoutingConfig: () => ({ routes: [], tagOverrides: [{ tag: 'heavy', model: 'openai/gpt-5.5' }] }),
      supportsPerTurnModel: () => false,
      candidates: [{ id: 'openai/gpt-5.5', tier: 'premium', lane: 'metered', vision: true }],
      defaultModel: 'openai/gpt-5.5',
    }))
    if (result.outcome !== 'observed') throw new Error('expected observed')
    const finding = result.observations.find((o) => o.key === 'routes-model-clamped')!
    expect(finding.status).toBe('warning')
    expect(finding.evidence).toMatchObject({ workClasses: [], tags: ['heavy'] })
  })

  it('stays silent with no model routes, or when overrides are honored', async () => {
    const noRoutes = await checkModelRouting(deps({ supportsPerTurnModel: () => false }))
    if (noRoutes.outcome !== 'observed') throw new Error('expected observed')
    expect(noRoutes.observations.find((o) => o.key === 'routes-model-clamped')).toBeUndefined()

    const honored = await checkModelRouting(deps({
      getRoutingConfig: () => ({ routes: [{ workClass: 'relay', model: 'anthropic/claude-haiku-4-5' }], tagOverrides: [] }),
    }))
    if (honored.outcome !== 'observed') throw new Error('expected observed')
    expect(honored.observations.find((o) => o.key === 'routes-model-clamped')).toBeUndefined()
  })
})

describe('checkModelRouting', () => {
  it('warns on unrouted recommended system classes with per-class spend evidence', async () => {
    const result = await checkModelRouting(deps({
      listRecentRunCosts: () => [row({ workClass: 'auto-title' }), row({ runId: 'x2', workClass: 'auto-title', costUsdMicros: 50 })],
    }))
    if (result.outcome !== 'observed') throw new Error('expected observed')
    const warn = result.observations.find((o) => o.key === 'unrouted-system-classes')
    expect(warn?.status).toBe('warning')
    const classes = (warn?.evidence as { classes: Array<{ workClass: string; last7d: { runs: number } }> }).classes
    expect(classes.find((c) => c.workClass === 'auto-title')?.last7d.runs).toBe(2)
    expect(warn?.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'apply-recommended-routes' })
  })

  it('a route to a model that cannot run is NOT this check\'s finding (models.dead-selections owns it, #907)', async () => {
    const result = await checkModelRouting(deps({
      getRoutingConfig: () => ({ routes: [{ workClass: 'relay', model: 'gone/model' }], tagOverrides: [] }),
    }))
    if (result.outcome !== 'observed') throw new Error('expected observed')
    expect(result.observations.some((o) => o.key.startsWith('route-model-missing'))).toBe(false)
  })

  it('warns on a standing clamp (route thinking unsupported on the active runtime)', async () => {
    const result = await checkModelRouting(deps({
      getRoutingConfig: () => ({ routes: [{ workClass: 'relay', model: 'anthropic/claude-haiku-4-5', thinking: 'max' }], tagOverrides: [] }),
    }))
    if (result.outcome !== 'observed') throw new Error('expected observed')
    expect(result.observations.find((o) => o.key === 'route-thinking-clamped-relay')?.status).toBe('warning')
  })

  it('premium-on-cheap is ADVISORY with the one-click routes repair below the dollar threshold', async () => {
    const result = await checkModelRouting(deps({
      listRecentRunCosts: () => [row({ workClass: 'relay', model: 'anthropic/claude-opus-4-6', costUsdMicros: 40_000 })],
    }))
    if (result.outcome !== 'observed') throw new Error('expected observed')
    const warn = result.observations.find((o) => o.key === 'premium-on-cheap-relay')
    expect(warn?.status).toBe('warning')
    expect(warn?.incident?.disposition).toBe('advisory')
    expect(warn?.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'apply-recommended-routes' })
    expect(warn?.evidence).toMatchObject({ runs: 1, models: ['anthropic/claude-opus-4-6'], knownUsdMicros: 40_000 })
  })

  it('premium-on-cheap escalates to WATCH past $5 of KNOWN spend in the window — unpriced rows never fabricate', async () => {
    const expensive = await checkModelRouting(deps({
      listRecentRunCosts: () => [
        row({ workClass: 'relay', model: 'anthropic/claude-opus-4-6', costUsdMicros: 6_000_000 }),
        row({ workClass: 'relay', model: 'anthropic/claude-opus-4-6', costUsdMicros: null }),
      ],
    }))
    if (expensive.outcome !== 'observed') throw new Error('expected observed')
    const escalated = expensive.observations.find((o) => o.key === 'premium-on-cheap-relay')
    expect(escalated?.incident?.disposition).toBe('watch')
    expect(escalated?.evidence).toMatchObject({ knownUsdMicros: 6_000_000, unpricedRuns: 1 })

    const unpricedOnly = await checkModelRouting(deps({
      listRecentRunCosts: () => Array.from({ length: 50 }, () =>
        row({ workClass: 'relay', model: 'anthropic/claude-opus-4-6', costUsdMicros: null })),
    }))
    if (unpricedOnly.outcome !== 'observed') throw new Error('expected observed')
    expect(unpricedOnly.observations.find((o) => o.key === 'premium-on-cheap-relay')?.incident?.disposition).toBe('advisory')
  })

  it('is healthy when every recommended class is routed to available models', async () => {
    const routes: WorkClassRoute[] = [
      { workClass: 'auto-title', model: 'anthropic/claude-haiku-4-5' },
      { workClass: 'enrichment', model: 'anthropic/claude-haiku-4-5' },
      { workClass: 'relay', model: 'anthropic/claude-haiku-4-5' },
      { workClass: 'team-routing', model: 'anthropic/claude-haiku-4-5' },
      { workClass: 'skill-mapping', model: 'anthropic/claude-haiku-4-5' },
    ]
    const result = await checkModelRouting(deps({ getRoutingConfig: () => ({ routes, tagOverrides: [] }) }))
    if (result.outcome !== 'observed') throw new Error('expected observed')
    expect(result.observations).toHaveLength(1)
    expect(result.observations[0]?.status).toBe('healthy')
  })
})

describe('recommendedRoutesRepair', () => {
  it('plans the proposal diff and applies it through the writer', async () => {
    const applied: WorkClassRoute[][] = []
    const repair = recommendedRoutesRepair(deps(), (routes) => { applied.push(routes) })
    const plan = await repair.plan({ kind: 'check', checkId: 'models.routing' } as never)
    expect(plan).toHaveLength(1)
    expect(plan[0]?.changes.length).toBeGreaterThanOrEqual(4)
    const results = await repair.apply(plan)
    expect(results[0]?.status).toBe('applied')
    expect(applied[0]?.find((r) => r.workClass === 'auto-title')?.model).toBe('google/gemini-2.5-flash')
  })

  it('plans nothing when every class is routed', async () => {
    const repair = recommendedRoutesRepair(deps({
      getRoutingConfig: () => ({
        routes: ['auto-title', 'enrichment', 'relay', 'team-routing', 'skill-mapping'].map((workClass) => ({ workClass, model: 'anthropic/claude-haiku-4-5' })) as WorkClassRoute[],
        tagOverrides: [],
      }),
    }), () => {})
    expect(await repair.plan({ kind: 'check', checkId: 'models.routing' } as never)).toEqual([])
  })
})
