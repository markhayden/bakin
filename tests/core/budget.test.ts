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
  return { startMs: 0, global: scope(), byAgent: {}, byProvider: {}, byModel: {}, ...over }
}
function facets(daily: Partial<WindowSpend> = {}, monthly: Partial<WindowSpend> = {}): BudgetSpendFacets {
  return { computedAt: 0, observedUsageEvidence: { status: 'available' }, daily: window(daily), monthly: window(monthly) }
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
