/**
 * Budget evaluation — pure policy logic over the spend-engine facets. A
 * policy is a list of scoped cap RULES (global | agent | provider | model ×
 * metered | subscription lane); a rule gates a turn when its scope matches
 * the turn's billing context AND its lane matches the turn's lane.
 * Unit-per-lane: metered rules cap estimated USD, subscription rules cap
 * tokens. defer beats warn beats allow; no rules → always allow.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), 'bakin-test-budget')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ root: testDir }) }))

import { evaluateBudget, dayStartMs, monthStartMs, type BudgetPolicy } from '../../src/core/budget'
import type { BudgetSpendFacets, ScopeSpend, LaneSums, WindowSpend } from '../../src/core/budget-spend'

// ---- facet fixture helpers -------------------------------------------------
function lanes(over: Partial<LaneSums> = {}): LaneSums {
  return { meteredUsdMicros: 0, meteredTokens: 0, subscriptionTokens: 0, unpricedMeteredTokens: 0, ...over }
}
function scope(over: Partial<LaneSums> = {}, unattr: Partial<ScopeSpend['unattributed']> = {}): ScopeSpend {
  return { ...lanes(over), unattributed: { meteredUsdMicros: 0, meteredTokens: 0, subscriptionTokens: 0, ...unattr } }
}
function window(over: Partial<WindowSpend> = {}): WindowSpend {
  return { startMs: 0, global: scope(), byAgent: {}, byProvider: {}, byModel: {}, byWorkClass: {}, ...over }
}
function facets(daily: Partial<WindowSpend> = {}, monthly: Partial<WindowSpend> = {}): BudgetSpendFacets {
  return {
    computedAt: 0,
    observedUsageEvidence: { status: 'available' },
    spendEvidence: {
      daily: { status: 'complete', gaps: [] },
      monthly: { status: 'complete', gaps: [] },
    },
    daily: window(daily),
    monthly: window(monthly),
  }
}
const TURN = { agent: 'pixel' } // lane defaults to metered

describe('dayStartMs / monthStartMs', () => {
  it('day start is local midnight at or before now', () => {
    const now = Date.parse('2026-06-13T15:30:00')
    const ds = dayStartMs(now)
    expect(ds).toBeLessThanOrEqual(now)
    const d = new Date(ds)
    expect(d.getHours()).toBe(0)
    expect(d.getMinutes()).toBe(0)
  })
  it('month start is the 1st at local midnight', () => {
    const now = Date.parse('2026-06-13T15:30:00')
    const d = new Date(monthStartMs(now))
    expect(d.getDate()).toBe(1)
    expect(d.getHours()).toBe(0)
  })
})

describe('evaluateBudget — rule matching and units', () => {
  it('allows when no rules are set', () => {
    expect(evaluateBudget({ policy: {}, turn: TURN, facets: facets() })).toEqual({ action: 'allow' })
    expect(evaluateBudget({ policy: { rules: [] }, turn: TURN, facets: facets() })).toEqual({ action: 'allow' })
  })

  it('global metered rule: warns at 80%, defers at 100% (USD micros)', () => {
    const policy: BudgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] }
    const under = evaluateBudget({ policy, turn: TURN, facets: facets({ global: scope({ meteredUsdMicros: 5_000_000 }) }) })
    expect(under).toEqual({ action: 'allow' })

    const warn = evaluateBudget({ policy, turn: TURN, facets: facets({ global: scope({ meteredUsdMicros: 8_500_000 }) }) })
    expect(warn.action).toBe('warn')
    if (warn.action !== 'allow') {
      expect(warn.unit).toBe('usd_micros')
      expect(warn.window).toBe('daily')
      expect(warn.capValue).toBe(10_000_000)
    }

    const defer = evaluateBudget({ policy, turn: TURN, facets: facets({ global: scope({ meteredUsdMicros: 10_000_000 }) }) })
    expect(defer.action).toBe('defer')
  })

  it('metered rules count the unattributed metered delta (total-observed)', () => {
    const policy: BudgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] }
    const r = evaluateBudget({
      policy, turn: TURN,
      facets: facets({ global: scope({ meteredUsdMicros: 6_000_000 }, { meteredUsdMicros: 4_000_000 }) }),
    })
    expect(r.action).toBe('defer')
  })

  it('subscription rule caps TOKENS and ignores dollars entirely', () => {
    const policy: BudgetPolicy = { rules: [{ scope: 'global', lane: 'subscription', dailyCap: 1000 }] }
    const turn = { agent: 'pixel', lane: 'subscription' as const }
    const r = evaluateBudget({
      policy, turn,
      facets: facets({ global: scope({ subscriptionTokens: 900 }, { subscriptionTokens: 100 }) }),
    })
    expect(r.action).toBe('defer')
    if (r.action !== 'allow') {
      expect(r.unit).toBe('tokens')
      expect(r.spentValue).toBe(1000)
      expect(r.capValue).toBe(1000)
    }
  })

  it('defers a subscription token cap when a matching token total is unknown', () => {
    const policy: BudgetPolicy = { rules: [{ scope: 'agent', scopeId: 'pixel', lane: 'subscription', dailyCap: 1000 }] }
    const f = facets({ byAgent: { pixel: scope({ subscriptionTokens: 600 }) } })
    f.spendEvidence.daily = {
      status: 'incomplete',
      gaps: [{
        unit: 'tokens',
        source: 'attributed_run',
        lane: 'subscription',
        agent: 'pixel',
        provider: 'openai-codex',
        model: 'openai-codex/gpt-5.5-codex',
        reasons: ['value_missing'],
        unknownCount: 1,
      }],
    }

    expect(evaluateBudget({
      policy,
      turn: { agent: 'pixel', lane: 'subscription' },
      facets: f,
    })).toMatchObject({
      action: 'defer',
      cause: 'spend_evidence_incomplete',
      unit: 'tokens',
      spentValue: 600,
      unknownEvidenceCount: 1,
    })
  })

  it('defers when a known token value cannot be assigned to a billing lane', () => {
    const policy: BudgetPolicy = { rules: [{ scope: 'global', lane: 'subscription', dailyCap: 1000 }] }
    const f = facets({ global: scope({ subscriptionTokens: 200 }) })
    f.spendEvidence.daily = {
      status: 'incomplete',
      gaps: [{
        unit: 'tokens',
        source: 'attributed_run',
        lane: null,
        agent: 'pixel',
        provider: 'openai-codex',
        model: 'openai-codex/gpt-5.5-codex',
        reasons: ['lane_unknown'],
        unknownCount: 1,
      }],
    }

    expect(evaluateBudget({
      policy,
      turn: { agent: 'pixel', lane: 'subscription' },
      facets: f,
    })).toMatchObject({
      action: 'defer',
      cause: 'spend_evidence_incomplete',
      unit: 'tokens',
      spentValue: 200,
      unknownEvidenceCount: 1,
    })
  })

  it('defers a metered cap when matching media or run cost was not priced', () => {
    const policy: BudgetPolicy = { rules: [{ scope: 'agent', scopeId: 'pixel', lane: 'metered', dailyCap: 10 }] }
    const f = facets({ byAgent: { pixel: scope({ meteredUsdMicros: 2_000_000 }) } })
    f.spendEvidence.daily = {
      status: 'incomplete',
      gaps: [{
        unit: 'usd_micros',
        source: 'attributed_run',
        lane: 'metered',
        agent: 'pixel',
        provider: 'openai',
        model: 'openai/gpt-image-2',
        reasons: ['value_missing'],
        unknownCount: 1,
      }],
    }

    expect(evaluateBudget({ policy, turn: { agent: 'pixel' }, facets: f })).toMatchObject({
      action: 'defer',
      cause: 'spend_evidence_incomplete',
      unit: 'usd_micros',
      spentValue: 2_000_000,
      unknownEvidenceCount: 1,
    })
  })

  it('preserves partial observed cost but fails closed for matching global and agent caps', () => {
    const f = facets({
      global: scope({}, { meteredUsdMicros: 250_000 }),
      byAgent: { pixel: scope({}, { meteredUsdMicros: 250_000 }) },
    })
    f.spendEvidence.daily = {
      status: 'incomplete',
      gaps: [{
        unit: 'usd_micros',
        source: 'observed_message',
        lane: 'metered',
        agent: 'pixel',
        provider: null,
        model: 'google/gemini-3-flash',
        reasons: ['value_missing'],
        unknownCount: 2,
      }],
    }

    for (const rule of [
      { scope: 'global' as const, lane: 'metered' as const, dailyCap: 10 },
      { scope: 'agent' as const, scopeId: 'pixel', lane: 'metered' as const, dailyCap: 10 },
    ]) {
      expect(evaluateBudget({ policy: { rules: [rule] }, turn: TURN, facets: f })).toMatchObject({
        action: 'defer',
        cause: 'spend_evidence_incomplete',
        spentValue: 250_000,
        unknownEvidenceCount: 2,
      })
    }
  })

  it('does not apply observed-message gaps to attributed-only provider caps', () => {
    const f = facets({ byProvider: { google: lanes({ meteredUsdMicros: 100_000 }) } })
    f.spendEvidence.daily = {
      status: 'incomplete',
      gaps: [{
        unit: 'usd_micros',
        source: 'observed_message',
        lane: 'metered',
        agent: 'pixel',
        provider: null,
        model: 'google/gemini-3-flash',
        reasons: ['value_missing'],
        unknownCount: 2,
      }],
    }

    expect(evaluateBudget({
      policy: { rules: [{ scope: 'provider', scopeId: 'google', lane: 'metered', dailyCap: 10 }] },
      turn: { agent: 'pixel', provider: 'google' },
      facets: f,
    })).toEqual({ action: 'allow' })
  })

  it('applies aggregate-overflow evidence only to the affected rollup scope', () => {
    const f = facets({
      global: scope({ meteredUsdMicros: 500_000 }),
      byAgent: { pixel: scope({ meteredUsdMicros: 100_000 }) },
    })
    f.spendEvidence.daily = {
      status: 'incomplete',
      gaps: [{
        unit: 'usd_micros',
        source: 'attributed_run',
        lane: 'metered',
        agent: 'pixel',
        provider: 'google',
        model: 'google/gemini-3-flash',
        affectedScope: 'global',
        reasons: ['value_missing'],
        unknownCount: 1,
      }],
    }

    expect(evaluateBudget({
      policy: { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] },
      turn: TURN,
      facets: f,
    })).toMatchObject({ action: 'defer', cause: 'spend_evidence_incomplete' })
    expect(evaluateBudget({
      policy: { rules: [{ scope: 'agent', scopeId: 'pixel', lane: 'metered', dailyCap: 10 }] },
      turn: TURN,
      facets: f,
    })).toEqual({ action: 'allow' })
  })

  it('saturates matching evidence counts without returning an unsafe integer', () => {
    const f = facets()
    const gap = {
      unit: 'usd_micros' as const,
      source: 'attributed_run' as const,
      lane: 'metered' as const,
      agent: 'pixel',
      provider: 'google',
      model: 'google/gemini-3-flash',
      reasons: ['value_missing' as const],
      unknownCount: Number.MAX_SAFE_INTEGER,
    }
    f.spendEvidence.daily = { status: 'incomplete', gaps: [gap, { ...gap, model: 'google/gemini-3-pro' }] }

    const decision = evaluateBudget({
      policy: { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] },
      turn: TURN,
      facets: f,
    })

    expect(decision).toMatchObject({
      action: 'defer',
      cause: 'spend_evidence_incomplete',
      unknownEvidenceCount: Number.MAX_SAFE_INTEGER,
    })
    if (decision.action === 'defer' && decision.cause === 'spend_evidence_incomplete') {
      expect(Number.isSafeInteger(decision.unknownEvidenceCount)).toBe(true)
    }
  })

  it('returns a real threshold breach before incomplete evidence', () => {
    const policy: BudgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 1 }] }
    const f = facets({ global: scope({ meteredUsdMicros: 1_000_000 }) })
    f.spendEvidence.daily = {
      status: 'incomplete',
      gaps: [{
        unit: 'usd_micros',
        source: 'attributed_run',
        lane: 'metered',
        agent: 'pixel',
        provider: 'openai',
        model: 'openai/gpt-image-2',
        reasons: ['value_missing'],
        unknownCount: 1,
      }],
    }

    expect(evaluateBudget({ policy, turn: TURN, facets: f })).toMatchObject({
      action: 'defer',
      cause: 'threshold',
      spentValue: 1_000_000,
    })
  })

  it('fails closed for legacy facets without the spend-evidence contract', () => {
    const legacy = facets() as unknown as Omit<BudgetSpendFacets, 'spendEvidence'> & {
      spendEvidence?: BudgetSpendFacets['spendEvidence']
    }
    delete legacy.spendEvidence

    expect(evaluateBudget({
      policy: { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] },
      turn: TURN,
      facets: legacy as BudgetSpendFacets,
    })).toMatchObject({
      action: 'defer',
      cause: 'spend_evidence_incomplete',
      unknownEvidenceCount: null,
    })
  })

  it('fails closed when observed totals are unavailable for global or agent rules', () => {
    const f = facets({
      global: scope({ meteredUsdMicros: 500_000 }),
      byAgent: { pixel: scope({ meteredUsdMicros: 100_000 }) },
    })
    f.observedUsageEvidence = { status: 'unavailable', reason: 'usage_store_unavailable' }

    for (const rule of [
      { scope: 'global' as const, lane: 'metered' as const, dailyCap: 10 },
      { scope: 'agent' as const, scopeId: 'pixel', lane: 'metered' as const, dailyCap: 10 },
    ]) {
      expect(evaluateBudget({ policy: { rules: [rule] }, turn: TURN, facets: f })).toMatchObject({
        action: 'defer',
        cause: 'spend_evidence_unavailable',
      })
    }
  })

  it('does not require observed totals for attributed-only provider and model rules', () => {
    const f = facets({
      byProvider: { google: lanes({ meteredUsdMicros: 100_000 }) },
      byModel: { 'google/gemini-3-flash': lanes({ meteredUsdMicros: 100_000 }) },
    })
    f.observedUsageEvidence = { status: 'unavailable', reason: 'usage_store_unavailable' }
    const turn = { agent: 'pixel', provider: 'google', model: 'google/gemini-3-flash' }

    expect(evaluateBudget({
      policy: { rules: [{ scope: 'provider', scopeId: 'google', lane: 'metered', dailyCap: 10 }] },
      turn,
      facets: f,
    })).toEqual({ action: 'allow' })
    expect(evaluateBudget({
      policy: { rules: [{ scope: 'model', scopeId: 'google/gemini-3-flash', lane: 'metered', dailyCap: 10 }] },
      turn,
      facets: f,
    })).toEqual({ action: 'allow' })
  })

  it('returns a known threshold breach even when observed totals are unavailable', () => {
    const f = facets({ global: scope({ meteredUsdMicros: 10_000_000 }) })
    f.observedUsageEvidence = { status: 'unavailable', reason: 'usage_store_unavailable' }

    expect(evaluateBudget({
      policy: { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] },
      turn: TURN,
      facets: f,
    })).toMatchObject({ action: 'defer', cause: 'threshold', spentValue: 10_000_000 })
  })

  it('does not defer a scoped token cap for another agent\'s evidence gap', () => {
    const policy: BudgetPolicy = { rules: [{ scope: 'agent', scopeId: 'pixel', lane: 'subscription', dailyCap: 1000 }] }
    const f = facets({ byAgent: { pixel: scope({ subscriptionTokens: 100 }) } })
    f.spendEvidence.daily = {
      status: 'incomplete',
      gaps: [{
        unit: 'tokens',
        source: 'attributed_run',
        lane: 'subscription',
        agent: 'rolo',
        provider: 'openai-codex',
        model: 'openai-codex/gpt-5.5-codex',
        reasons: ['value_missing'],
        unknownCount: 1,
      }],
    }

    expect(evaluateBudget({
      policy,
      turn: { agent: 'pixel', lane: 'subscription' },
      facets: f,
    })).toEqual({ action: 'allow' })
  })

  it('treats an unknown provider dimension as relevant to a provider token cap', () => {
    const policy: BudgetPolicy = { rules: [{ scope: 'provider', scopeId: 'openai-codex', lane: 'subscription', dailyCap: 1000 }] }
    const f = facets({ byProvider: { 'openai-codex': lanes({ subscriptionTokens: 100 }) } })
    f.spendEvidence.daily = {
      status: 'incomplete',
      gaps: [{
        unit: 'tokens',
        source: 'attributed_run',
        lane: 'subscription',
        agent: 'pixel',
        provider: null,
        model: null,
        reasons: ['provider_unknown', 'model_unknown'],
        unknownCount: 1,
      }],
    }

    expect(evaluateBudget({
      policy,
      turn: { agent: 'pixel', provider: 'openai-codex', lane: 'subscription' },
      facets: f,
    })).toMatchObject({ action: 'defer', cause: 'spend_evidence_incomplete', unknownEvidenceCount: 1 })
  })

  it('treats an unknown lane and model as relevant to a model token cap', () => {
    const policy: BudgetPolicy = { rules: [{ scope: 'model', scopeId: 'openai-codex/gpt-5.5-codex', lane: 'subscription', dailyCap: 1000 }] }
    const f = facets({ byModel: { 'openai-codex/gpt-5.5-codex': lanes({ subscriptionTokens: 100 }) } })
    f.spendEvidence.daily = {
      status: 'incomplete',
      gaps: [{
        unit: 'tokens',
        source: 'attributed_run',
        lane: null,
        agent: 'pixel',
        provider: null,
        model: null,
        reasons: ['lane_unknown', 'provider_unknown', 'model_unknown'],
        unknownCount: 1,
      }],
    }

    expect(evaluateBudget({
      policy,
      turn: { agent: 'pixel', model: 'openai-codex/gpt-5.5-codex', lane: 'subscription' },
      facets: f,
    })).toMatchObject({ action: 'defer', cause: 'spend_evidence_incomplete', unknownEvidenceCount: 1 })
  })

  it('does not defer provider or model caps for known mismatched dimensions', () => {
    const f = facets()
    f.spendEvidence.daily = {
      status: 'incomplete',
      gaps: [{
        unit: 'tokens',
        source: 'attributed_run',
        lane: 'subscription',
        agent: 'pixel',
        provider: 'anthropic',
        model: 'anthropic/claude-sonnet-4-6',
        reasons: ['value_missing'],
        unknownCount: 1,
      }],
    }
    const turn = {
      agent: 'pixel',
      provider: 'openai-codex',
      model: 'openai-codex/gpt-5.5-codex',
      lane: 'subscription' as const,
    }

    expect(evaluateBudget({
      policy: { rules: [{ scope: 'provider', scopeId: 'openai-codex', lane: 'subscription', dailyCap: 1000 }] },
      turn,
      facets: f,
    })).toEqual({ action: 'allow' })
    expect(evaluateBudget({
      policy: { rules: [{ scope: 'model', scopeId: 'openai-codex/gpt-5.5-codex', lane: 'subscription', dailyCap: 1000 }] },
      turn,
      facets: f,
    })).toEqual({ action: 'allow' })
  })

  it('a rule only gates turns on ITS lane', () => {
    // Metered global cap exhausted; a subscription-lane turn adds no metered dollars → allowed.
    const policy: BudgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10 }] }
    const r = evaluateBudget({
      policy,
      turn: { agent: 'pixel', lane: 'subscription' },
      facets: facets({ global: scope({ meteredUsdMicros: 99_000_000 }) }),
    })
    expect(r).toEqual({ action: 'allow' })
  })

  it('agent rule gates only the named agent', () => {
    const policy: BudgetPolicy = { rules: [{ scope: 'agent', scopeId: 'pixel', lane: 'metered', dailyCap: 5 }] }
    const f = facets({ byAgent: { pixel: scope({ meteredUsdMicros: 5_000_000 }) } })
    expect(evaluateBudget({ policy, turn: { agent: 'pixel' }, facets: f }).action).toBe('defer')
    expect(evaluateBudget({ policy, turn: { agent: 'rolo' }, facets: f }).action).toBe('allow')
  })

  it('provider rule gates only turns bound for that provider (attributed spend)', () => {
    const policy: BudgetPolicy = { rules: [{ scope: 'provider', scopeId: 'google', lane: 'metered', dailyCap: 5 }] }
    const f = facets({ byProvider: { google: lanes({ meteredUsdMicros: 5_000_000 }) } })
    expect(evaluateBudget({ policy, turn: { agent: 'pixel', provider: 'google' }, facets: f }).action).toBe('defer')
    expect(evaluateBudget({ policy, turn: { agent: 'pixel', provider: 'anthropic' }, facets: f }).action).toBe('allow')
    expect(evaluateBudget({ policy, turn: { agent: 'pixel' }, facets: f }).action).toBe('allow') // unknown provider ≠ google
  })

  it('model scope is accepted (future-proofing: evaluator handles it today)', () => {
    const policy: BudgetPolicy = { rules: [{ scope: 'model', scopeId: 'google/gemini-3-flash', lane: 'metered', monthlyCap: 1 }] }
    const f = facets({}, { byModel: { 'google/gemini-3-flash': lanes({ meteredUsdMicros: 1_000_000 }) } })
    expect(evaluateBudget({ policy, turn: { agent: 'pixel', model: 'google/gemini-3-flash' }, facets: f }).action).toBe('defer')
  })

  it('defer on any rule beats warn on another; the breaching rule is returned', () => {
    const policy: BudgetPolicy = {
      rules: [
        { scope: 'global', lane: 'metered', dailyCap: 100 },                     // at 85% → warn
        { scope: 'agent', scopeId: 'pixel', lane: 'metered', dailyCap: 5 },      // at 100% → defer
      ],
    }
    const f = facets({ global: scope({ meteredUsdMicros: 85_000_000 }), byAgent: { pixel: scope({ meteredUsdMicros: 5_000_000 }) } })
    const r = evaluateBudget({ policy, turn: { agent: 'pixel' }, facets: f })
    expect(r.action).toBe('defer')
    if (r.action !== 'allow') expect(r.rule.scope).toBe('agent')
  })

  it('respects a per-rule warnPct', () => {
    const policy: BudgetPolicy = { rules: [{ scope: 'global', lane: 'metered', dailyCap: 10, warnPct: 0.5 }] }
    const r = evaluateBudget({ policy, turn: TURN, facets: facets({ global: scope({ meteredUsdMicros: 6_000_000 }) }) })
    expect(r.action).toBe('warn')
  })

  it('monthly window evaluates against monthly facets', () => {
    const policy: BudgetPolicy = { rules: [{ scope: 'global', lane: 'metered', monthlyCap: 100 }] }
    const r = evaluateBudget({
      policy, turn: TURN,
      facets: facets({ global: scope({ meteredUsdMicros: 1_000_000 }) }, { global: scope({ meteredUsdMicros: 100_000_000 }) }),
    })
    expect(r.action).toBe('defer')
    if (r.action !== 'allow') expect(r.window).toBe('monthly')
  })
})
