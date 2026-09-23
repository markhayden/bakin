/**
 * The model-plan recommender (spec §3.4): deterministic per-lane ranking,
 * agent pick = current default if eligible else strongest, chores pick =
 * lightest suitable not heavier than the agent model, the three enrichment
 * branches (chores sees / only the agent sees / nobody sees), unknown
 * metadata ranked below known and disclosed, and the ops diff that reaches
 * the plan from the current state. Pure — no I/O, no curated vision import.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// The module is pure, but it sits in src/core: keep the isolation mocks so
// nothing it (or a future import) reaches can touch ~/.bakin.
const testDir = join(tmpdir(), 'bakin-test-model-plan')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) }))

import { CHORES_CLASSES, choresLaneState, pickAgentModel, rankCandidates, recommendPlan, type PlanCandidate, type PlanInput } from '../../src/core/model-plan'

const luna: PlanCandidate = { id: 'openai-codex/gpt-5.6-luna', tier: 'premium', lane: 'subscription', contextWindow: 400_000, vision: true }
const terra: PlanCandidate = { id: 'openai-codex/gpt-5.6-terra', tier: 'standard', lane: 'subscription', contextWindow: 400_000, vision: true }
const mini: PlanCandidate = { id: 'openai-codex/gpt-5.4-mini', tier: 'budget', lane: 'subscription', contextWindow: 200_000, vision: false }
const miniUnknown: PlanCandidate = { id: 'openai-codex/gpt-5.4-nano', tier: 'budget', lane: 'subscription', contextWindow: 128_000, vision: null }
const haiku: PlanCandidate = { id: 'anthropic/claude-haiku-4-5', tier: 'budget', lane: 'metered', pricePer1M: 6, vision: true }
const sonnet: PlanCandidate = { id: 'anthropic/claude-sonnet-4-6', tier: 'standard', lane: 'metered', pricePer1M: 18, vision: true }
const opus: PlanCandidate = { id: 'anthropic/claude-opus-4-6', tier: 'premium', lane: 'metered', pricePer1M: 90, vision: true }
const unpriced: PlanCandidate = { id: 'mystery/cheap', tier: 'budget', lane: 'metered', vision: null }

function input(over: Partial<PlanInput>): PlanInput {
  return { candidates: [], currentDefaultModel: null, routing: { routes: [], tagOverrides: [] }, enrichmentEnabled: true, ...over }
}

describe('rankCandidates', () => {
  it('subscription: tier asc, context desc, id — deterministic', () => {
    const ranked = rankCandidates([luna, miniUnknown, terra, mini])
    expect(ranked.map((c) => c.id)).toEqual([mini.id, miniUnknown.id, terra.id, luna.id])
    // Same input, any order in ⇒ same order out.
    expect(rankCandidates([terra, mini, luna, miniUnknown]).map((c) => c.id)).toEqual([mini.id, miniUnknown.id, terra.id, luna.id])
  })

  it('metered: price asc with unknown price LAST, then tier, then id', () => {
    expect(rankCandidates([opus, unpriced, sonnet, haiku]).map((c) => c.id)).toEqual([haiku.id, sonnet.id, opus.id, unpriced.id])
  })
})

describe('pickAgentModel', () => {
  it('keeps the current default when it is eligible', () => {
    expect(pickAgentModel(input({ candidates: [luna, terra], currentDefaultModel: terra.id }))).toMatchObject({ model: terra.id, suitability: 'known' })
  })

  it('a dead default ⇒ the strongest eligible model, with the reason naming the dead one', () => {
    const pick = pickAgentModel(input({ candidates: [terra, luna, mini], currentDefaultModel: 'openai/gpt-6-astra' }))
    expect(pick.model).toBe(luna.id)
    expect(pick.why).toContain('openai/gpt-6-astra')
  })

  it('nothing eligible ⇒ null with the credentials hint', () => {
    expect(pickAgentModel(input({}))).toMatchObject({ model: null, suitability: 'none' })
  })
})

describe('recommendPlan', () => {
  it('Codex-only box: agent = current default, chores = lightest vision-capable model not heavier than it; ops set the five chores routes', () => {
    const plan = recommendPlan(input({ candidates: [luna, terra, mini], currentDefaultModel: luna.id }))
    expect(plan.agent.model).toBe(luna.id)
    // mini is lighter but blind; terra is the lightest that can see.
    expect(plan.chores.model).toBe(terra.id)
    expect(plan.chores.why).toBe('included in your plan · lightest tier that can do these jobs')
    expect(plan.enrichment).toBe('chores')
    expect(plan.ops).toEqual(CHORES_CLASSES.map((workClass) => ({ ref: `route:${workClass}`, set: { model: terra.id } })))
    expect(plan.notes).toEqual([])
  })

  it('metered: chores = cheapest known-capable; why compares prices against the agent model', () => {
    const plan = recommendPlan(input({ candidates: [opus, sonnet, haiku], currentDefaultModel: opus.id }))
    expect(plan.chores.model).toBe(haiku.id)
    expect(plan.chores.why).toBe(`~$6 per 1M tokens vs ~$90 for ${opus.id}`)
  })

  it('enrichment → agent: no lighter model can see but the agent model can; every other chore goes light, enrichment stays UNROUTED (inherits — follows the default when it moves)', () => {
    const plan = recommendPlan(input({ candidates: [luna, mini], currentDefaultModel: luna.id }))
    expect(plan.chores.model).toBe(mini.id)
    expect(plan.enrichment).toBe('agent')
    expect(plan.routes.find((r) => r.workClass === 'enrichment')).toMatchObject({ model: null, reason: expect.stringContaining('inherits the agent model') })
    expect(plan.ops).toEqual(CHORES_CLASSES.filter((c) => c !== 'enrichment').map((workClass) => ({ ref: `route:${workClass}`, set: { model: mini.id } })))
    expect(plan.notes[0]).toContain('cannot see images')
    // A stray explicit enrichment pin is cleared back to inherit.
    const pinned = recommendPlan(input({ candidates: [luna, mini], currentDefaultModel: luna.id, routing: { routes: [{ workClass: 'enrichment', model: luna.id }], tagOverrides: [] } }))
    expect(pinned.ops).toContainEqual({ ref: 'route:enrichment', set: { model: null } })
  })

  it('no eligible model can see ⇒ enrichment unset (an existing enrichment route is cleared) and the plan says so', () => {
    const blindLuna = { ...luna, vision: false }
    const plan = recommendPlan(input({ candidates: [blindLuna, mini], currentDefaultModel: blindLuna.id, routing: { routes: [{ workClass: 'enrichment', model: 'anthropic/claude-haiku-4-5' }], tagOverrides: [] } }))
    expect(plan.enrichment).toBe('unset')
    expect(plan.ops).toContainEqual({ ref: 'route:enrichment', set: { model: null } })
    expect(plan.ops.filter((op) => op.ref !== 'route:enrichment').every((op) => op.set.model === mini.id)).toBe(true)
    expect(plan.notes[0]).toContain('enrichment will fail')
  })

  it('unknown vision ranks below known-capable (even a heavier one) and is disclosed when it wins', () => {
    const plan = recommendPlan(input({ candidates: [luna, miniUnknown], currentDefaultModel: luna.id }))
    expect(plan.chores.model).toBe(miniUnknown.id)
    expect(plan.chores.suitability).toBe('unknown')
    expect(plan.enrichment).toBe('chores')
    expect(plan.notes[0]).toContain('unknown')
    // terra (standard, known-capable) beats the lighter unknown nano.
    expect(recommendPlan(input({ candidates: [luna, miniUnknown, mini, terra], currentDefaultModel: luna.id })).chores.model).toBe(terra.id)
  })

  it('a free subscription agent model is never displaced by a PAID same-tier model: chores inherit, zero ops', () => {
    // Codex subscription + an Anthropic key: opus is "not heavier" than luna
    // by tier, but it costs money where luna is included — luna stays.
    const plan = recommendPlan(input({ candidates: [luna, opus], currentDefaultModel: luna.id }))
    expect(plan.chores.model).toBe(luna.id)
    expect(plan.chores.why).toContain('nothing lighter')
    expect(plan.enrichment).toBe('chores')
    expect(plan.routes.every((r) => r.model === null)).toBe(true)
    expect(plan.ops).toEqual([])
    // The other way round a free premium model IS lighter than a paid one.
    expect(recommendPlan(input({ candidates: [opus, luna], currentDefaultModel: opus.id })).chores.model).toBe(luna.id)
  })

  it('only the agent model is eligible ⇒ it takes the chores too, as inherit (no explicit routes); a stray route is cleared', () => {
    const plan = recommendPlan(input({ candidates: [luna], currentDefaultModel: luna.id }))
    expect(plan.chores.model).toBe(luna.id)
    expect(plan.enrichment).toBe('chores')
    expect(plan.routes.every((r) => r.model === null)).toBe(true)
    expect(plan.ops).toEqual([])
    const stray = recommendPlan(input({ candidates: [luna], currentDefaultModel: luna.id, routing: { routes: [{ workClass: 'relay', model: 'x/y' }], tagOverrides: [] } }))
    expect(stray.ops).toEqual([{ ref: 'route:relay', set: { model: null } }])
  })

  it('enrichment disabled ⇒ no vision requirement: the lightest model wins and enrichment is disabled', () => {
    const plan = recommendPlan(input({ candidates: [luna, mini], currentDefaultModel: luna.id, enrichmentEnabled: false }))
    expect(plan.chores.model).toBe(mini.id)
    expect(plan.enrichment).toBe('disabled')
    expect(plan.ops.find((op) => op.ref === 'route:enrichment')?.set.model).toBe(mini.id)
  })

  it('already on the plan ⇒ zero ops; a dead default adds the policy op', () => {
    const routing = { routes: CHORES_CLASSES.map((workClass) => ({ workClass, model: terra.id })), tagOverrides: [] }
    expect(recommendPlan(input({ candidates: [luna, terra], currentDefaultModel: luna.id, routing })).ops).toEqual([])
    const moved = recommendPlan(input({ candidates: [luna, terra], currentDefaultModel: 'openai/dead', routing }))
    expect(moved.ops).toEqual([{ ref: 'policy:defaultModel', set: { model: luna.id } }])
  })
})

describe('choresLaneState (Simple view)', () => {
  it('ONE value only when all five routes name the same model and none sets thinking; otherwise Mixed', () => {
    const same = { routes: CHORES_CLASSES.map((workClass) => ({ workClass, model: terra.id })), tagOverrides: [] }
    expect(choresLaneState(same, luna.id)).toEqual({ model: terra.id, models: [terra.id], mixed: false })
    const unrouted = { routes: [], tagOverrides: [] }
    expect(choresLaneState(unrouted, luna.id)).toEqual({ model: luna.id, models: [luna.id], mixed: false })
    const mixed = { routes: [{ workClass: 'relay' as const, model: mini.id }], tagOverrides: [] }
    expect(choresLaneState(mixed, luna.id)).toMatchObject({ model: null, mixed: true, models: [luna.id, mini.id] })
    const thinking = { routes: CHORES_CLASSES.map((workClass) => ({ workClass, model: terra.id, thinking: 'low' as const })), tagOverrides: [] }
    expect(choresLaneState(thinking, luna.id).mixed).toBe(true)
  })
})
