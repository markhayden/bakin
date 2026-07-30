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

const NOW = 1_752_000_000_000

function row(over: Partial<RunCostSpendRow>): RunCostSpendRow {
  return {
    runId: 'task:t:d1', agent: 'pixel', model: 'anthropic/claude-haiku-4-5', provider: 'anthropic',
    lane: 'metered', usageKind: 'tokens', totalTokens: 100, costUsdMicros: 100,
    workClass: 'auto-title', routeSource: 'class', occurredAt: NOW - 1000, ...over,
  }
}

function deps(over: Partial<RoutingHealthDeps> = {}): RoutingHealthDeps {
  return {
    getRoutingConfig: () => ({ routes: [], tagOverrides: [] }),
    listAvailableModels: async () => [
      { id: 'anthropic/claude-haiku-4-5' },
      { id: 'anthropic/claude-opus-4-6' },
      { id: 'google/gemini-2.5-flash' },
    ],
    supportedThinkingLevels: () => ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    listRecentRunCosts: () => [],
    now: () => NOW,
    ...over,
  }
}

describe('recommendRoutes', () => {
  it('proposes the cheapest available model for each unrouted recommended class', async () => {
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

  it('skips cheap-vision with a reason when no vision model is available — never blind', async () => {
    const { proposals, skipped } = await recommendRoutes(deps({
      listAvailableModels: async () => [{ id: 'openai-codex/gpt-5.5-codex' }, { id: 'anthropic/claude-opus-4-6' }],
    }))
    expect(skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ workClass: 'enrichment', reason: expect.stringContaining('vision') }),
    ]))
    expect(proposals.find((p) => p.workClass === 'enrichment')).toBeUndefined()
  })

  it('uses runtime-merged tiers when the catalog has no entry (Codex-only box)', async () => {
    const { proposals, skipped } = await recommendRoutes(deps({
      listAvailableModels: async () => [
        { id: 'openai-codex/gpt-5.4', tier: 'premium' },
        { id: 'openai-codex/gpt-5.4-mini', tier: 'budget' },
        { id: 'openai-codex/gpt-5.5', tier: 'premium' },
      ],
    }))
    const byClass = new Map(proposals.map((p) => [p.workClass, p]))
    expect(byClass.get('auto-title')?.model).toBe('openai-codex/gpt-5.4-mini')
    expect(byClass.get('relay')?.model).toBe('openai-codex/gpt-5.4-mini')
    // No vision model on this runtime — enrichment skips honestly.
    expect(skipped).toEqual([expect.objectContaining({ workClass: 'enrichment' })])
  })

  it('skips with an honest reason when only premium models exist', async () => {
    const { proposals, skipped } = await recommendRoutes(deps({
      listAvailableModels: async () => [{ id: 'openai-codex/gpt-5.5', tier: 'premium' }],
    }))
    expect(proposals).toEqual([])
    expect(skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ workClass: 'relay', reason: expect.stringContaining('Only premium-tier') }),
    ]))
  })

  it('already-routed classes are not proposed', async () => {
    const { proposals } = await recommendRoutes(deps({
      getRoutingConfig: () => ({ routes: [{ workClass: 'auto-title', model: 'x/y' }], tagOverrides: [] }),
    }))
    expect(proposals.find((p) => p.workClass === 'auto-title')).toBeUndefined()
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

  it('errors when a route targets an unavailable model', async () => {
    const result = await checkModelRouting(deps({
      getRoutingConfig: () => ({ routes: [{ workClass: 'relay', model: 'gone/model' }], tagOverrides: [] }),
    }))
    if (result.outcome !== 'observed') throw new Error('expected observed')
    expect(result.observations.find((o) => o.key === 'route-model-missing-relay')?.status).toBe('error')
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
    const repair = recommendedRoutesRepair(deps(), (routes) => applied.push(routes))
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
