/**
 * assembleBudgetSpend — the ONE spend engine every budget surface consumes
 * (gate, health check, /spend, /budget/status, CLI). Facets: daily + monthly
 * local-calendar windows × {global, byAgent, byProvider, byModel} × lanes.
 *
 * Cap basis is TOTAL OBSERVED (spec V4): attributed run_costs plus the
 * observed-minus-attributed delta from usage.db, computed per (agent, local
 * day, lane) and clamped ≥ 0. Dollars only where actually reported/priced —
 * NULL-honest; subscription lanes never carry dollars (unit-per-lane, V8).
 * Provider/model facets are attributed-only (observed model ids can't be
 * provider-resolved authoritatively).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const dir = join(tmpdir(), 'bakin-test-budget-spend')
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => dir, getBakinPaths: () => ({ root: dir, db: join(dir, 'bakin.db') }) }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => dir, getBakinPaths: () => ({ root: dir, db: join(dir, 'bakin.db') }) }))
mock.module('../../src/core/logger', () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) }))

// ---- fixture state the mocked stores serve -------------------------------
type CostRow = {
  runId: string; agent: string; model: string | null; provider: string | null
  lane: 'metered' | 'subscription' | null; usageKind: 'tokens' | 'media'; totalTokens: number | null
  costUsdMicros: number | null; workClass?: string | null; occurredAt: number
}
type UsageCell = {
  agent: string; day: string; model: string
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
  costUsdMicros: number | null; costedMessages: number; messageCount: number
}
const costRows: CostRow[] = []
const usageCells: UsageCell[] = []
let usageReadFails = false

mock.module('../../src/core/execution-ledger', () => ({
  listRunCostsSince: (sinceMs: number) => costRows.filter((r) => r.occurredAt >= sinceMs),
}))

// Faithful copy of the canonical local-day key (packages/core/src/usage-history/store.ts).
function localDayKey(tsMs: number): string {
  const d = new Date(tsMs)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
mock.module('../../packages/core/src/usage-history/store', () => ({
  readUsageByAgentModelDaySince: (sinceDay: string) => {
    if (usageReadFails) throw new Error('usage store unavailable')
    return usageCells.filter((c) => c.day >= sinceDay)
  },
  toLocalDayKey: localDayKey,
}))

// Billing resolution for observed (usage.db) rows — the models plugin hook.
let resolveBillingMode: 'normal' | 'undefined' | 'throw' | 'lane-only' | 'agent-override' = 'normal'
const resolveBillingCalls: Array<Record<string, unknown>> = []
const resolveBillingImpl: (data: Record<string, unknown>) => unknown = (d) => {
  resolveBillingCalls.push(d)
  if (resolveBillingMode === 'throw') throw new Error('billing hook unavailable')
  if (resolveBillingMode === 'undefined') return undefined
  if (resolveBillingMode === 'lane-only') return { lane: 'metered' }
  // An operator override laning a model Bakin cannot resolve (provider 'other').
  if (resolveBillingMode === 'agent-override') return { provider: 'other', lane: 'subscription', laneSource: 'override' }
  const model = (d.model as string) ?? ''
  const provider = model.includes('/') ? model.split('/')[0] : model.startsWith('claude-') ? 'anthropic' : 'other'
  return {
    provider,
    lane: provider === 'openai-codex' ? 'subscription' : 'metered',
    laneSource: provider === 'other' ? 'default' : 'detected',
  }
}
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: async (name: string, data: Record<string, unknown>) =>
      name === 'models.resolveBilling' ? resolveBillingImpl(data) : undefined,
  }),
}))

import { assembleBudgetSpend, paceProjection } from '../../src/core/budget-spend'
import { dayStartMs, monthStartMs } from '../../src/core/budget'

// NOW: mid-month, mid-day, local — 2026-07-15 12:00.
const NOW = new Date(2026, 6, 15, 12, 0, 0).getTime()
const TODAY = new Date(2026, 6, 15, 9, 0, 0).getTime()
const EARLIER_THIS_MONTH = new Date(2026, 6, 3, 9, 0, 0).getTime()

function usage(agent: string, tsMs: number, model: string, total: number, costUsdMicros: number | null): UsageCell {
  return {
    agent, day: localDayKey(tsMs), model,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
    costUsdMicros, costedMessages: costUsdMicros === null ? 0 : 1, messageCount: 1,
  }
}

beforeEach(() => {
  costRows.length = 0
  usageCells.length = 0
  usageReadFails = false
  resolveBillingMode = 'normal'
  resolveBillingCalls.length = 0
})

describe('assembleBudgetSpend', () => {
  it('facets attributed spend by window, agent, provider, model and lane', async () => {
    costRows.push(
      { runId: 'r1', agent: 'pixel', model: 'google/gemini-3-flash', provider: 'google', lane: 'metered', usageKind: 'tokens', totalTokens: 1000, costUsdMicros: 2_000_000, occurredAt: TODAY },
      { runId: 'r2', agent: 'pixel', model: 'openai-codex/gpt-5.5-codex', provider: 'openai-codex', lane: 'subscription', usageKind: 'tokens', totalTokens: 5000, costUsdMicros: null, occurredAt: TODAY },
      { runId: 'r3', agent: 'rolo', model: 'google/gemini-3-flash', provider: 'google', lane: 'metered', usageKind: 'tokens', totalTokens: 400, costUsdMicros: 1_000_000, occurredAt: EARLIER_THIS_MONTH },
    )
    const s = await assembleBudgetSpend(NOW)
    expect(s.observedUsageEvidence).toEqual({ status: 'available' })

    // Daily window: only today's rows.
    expect(s.daily.startMs).toBe(dayStartMs(NOW))
    expect(s.daily.global.meteredUsdMicros).toBe(2_000_000)
    expect(s.daily.global.subscriptionTokens).toBe(5000)
    expect(s.daily.byAgent.pixel?.meteredUsdMicros).toBe(2_000_000)
    expect(s.daily.byAgent.rolo).toBeUndefined()

    // Monthly window: both days.
    expect(s.monthly.startMs).toBe(monthStartMs(NOW))
    expect(s.monthly.global.meteredUsdMicros).toBe(3_000_000)
    expect(s.monthly.byProvider.google?.meteredUsdMicros).toBe(3_000_000)
    expect(s.monthly.byProvider['openai-codex']?.subscriptionTokens).toBe(5000)
    expect(s.monthly.byModel['google/gemini-3-flash']?.meteredUsdMicros).toBe(3_000_000)
  })

  it('facets attributed spend by work class (unit economics slice)', async () => {
    costRows.push(
      { runId: 't1', agent: 'pixel', model: 'g/f', provider: 'g', lane: 'metered', usageKind: 'tokens', totalTokens: 1000, costUsdMicros: 2_000_000, workClass: 'scheduled', occurredAt: TODAY },
      { runId: 't2', agent: 'pixel', model: 'g/f', provider: 'g', lane: 'metered', usageKind: 'tokens', totalTokens: 200, costUsdMicros: 400_000, workClass: 'scheduled', occurredAt: TODAY },
      { runId: 't3', agent: 'main', model: 'a/h', provider: 'a', lane: 'subscription', usageKind: 'tokens', totalTokens: 500, costUsdMicros: null, workClass: 'auto-title', occurredAt: TODAY },
      { runId: 't4', agent: 'main', model: 'legacy', provider: null, lane: 'metered', usageKind: 'tokens', totalTokens: 50, costUsdMicros: 10_000, workClass: null, occurredAt: TODAY },
      { runId: 'img1', agent: 'pixel', model: 'g/img', provider: 'g', lane: 'metered', usageKind: 'media', totalTokens: null, costUsdMicros: 39_000, workClass: null, occurredAt: TODAY },
    )
    const s = await assembleBudgetSpend(NOW)
    const wc = s.daily.byWorkClass
    expect(wc.scheduled).toMatchObject({ runs: 2, meteredUsdMicros: 2_400_000, meteredTokens: 1200 })
    expect(wc['auto-title']).toMatchObject({ runs: 1, subscriptionTokens: 500, meteredUsdMicros: 0 })
    // Pre-migration token rows are honestly 'unclassified'; media rows are
    // classless by design and get their own bucket — never mixed.
    expect(wc.unclassified).toMatchObject({ runs: 1, meteredUsdMicros: 10_000 })
    expect(wc.media).toMatchObject({ runs: 1, meteredUsdMicros: 39_000 })
  })

  it('does not silently classify NULL-lane rows as metered', async () => {
    costRows.push({ runId: 'r4', agent: 'main', model: 'mystery/x', provider: 'mystery', lane: null, usageKind: 'tokens', totalTokens: 300, costUsdMicros: null, occurredAt: TODAY })
    const s = await assembleBudgetSpend(NOW)
    expect(s.daily.global.meteredUsdMicros).toBe(0)
    expect(s.daily.global.unpricedMeteredTokens).toBe(0)
    expect(s.daily.global.meteredTokens).toBe(0)
    expect(s.spendEvidence.daily.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ unit: 'tokens', lane: null, reasons: ['lane_unknown'] }),
      expect.objectContaining({ unit: 'usd_micros', lane: null, reasons: ['lane_unknown', 'value_missing'] }),
    ]))
  })

  it('adds the observed-minus-attributed delta per agent/day/lane, clamped at zero', async () => {
    // Attributed: 1000 metered tokens, $2 — Observed: 1500 tokens, $2.9.
    costRows.push({ runId: 'r5', agent: 'pixel', model: 'google/gemini-3-flash', provider: 'google', lane: 'metered', usageKind: 'tokens', totalTokens: 1000, costUsdMicros: 2_000_000, occurredAt: TODAY })
    usageCells.push(usage('pixel', TODAY, 'google/gemini-3-flash', 1500, 2_900_000))
    // Over-attributed agent (observed < attributed) must clamp to zero, not go negative.
    costRows.push({ runId: 'r6', agent: 'rolo', model: 'google/gemini-3-flash', provider: 'google', lane: 'metered', usageKind: 'tokens', totalTokens: 900, costUsdMicros: 1_000_000, occurredAt: TODAY })
    usageCells.push(usage('rolo', TODAY, 'google/gemini-3-flash', 100, 200_000))

    const s = await assembleBudgetSpend(NOW)
    expect(s.daily.byAgent.pixel?.unattributed.meteredUsdMicros).toBe(900_000)
    expect(s.daily.byAgent.pixel?.unattributed.meteredTokens).toBe(500)
    expect(s.daily.byAgent.rolo?.unattributed.meteredUsdMicros).toBe(0)
    expect(s.daily.byAgent.rolo?.unattributed.meteredTokens).toBe(0)
    // Global = sum of per-agent deltas (clamped per agent, not netted).
    expect(s.daily.global.unattributed.meteredUsdMicros).toBe(900_000)
  })

  it('routes observed subscription-lane usage to subscription tokens with no dollars', async () => {
    usageCells.push(usage('main', TODAY, 'openai-codex/gpt-5.5-codex', 8000, 5_000_000))
    const s = await assembleBudgetSpend(NOW)
    expect(s.daily.byAgent.main?.unattributed.subscriptionTokens).toBe(8000)
    expect(s.daily.byAgent.main?.unattributed.meteredUsdMicros).toBe(0) // reported $ suppressed on the subscription lane
  })

  it('bare-model observed rows are an evidence gap, never confident metered dollars (#689)', async () => {
    // A Codex subscription day exactly as usage.db stored it before provider
    // qualification: bare id + runtime-reported theoretical cost. The billing
    // hook resolves bare ids to provider 'other' (could-not-resolve) whose
    // default lane is metered — that default must not book dollars.
    usageCells.push(usage('main', TODAY, 'gpt-5.5', 157_286, 5_168_103))
    const s = await assembleBudgetSpend(NOW)
    expect(s.daily.global.meteredUsdMicros).toBe(0)
    expect(s.daily.global.unattributed.meteredUsdMicros).toBe(0)
    expect(s.daily.global.unattributed.meteredTokens).toBe(0)
    expect(s.spendEvidence.daily.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ lane: null, model: 'gpt-5.5', reasons: ['lane_unknown'] }),
    ]))
  })

  it('a lane without provider evidence is not trusted', async () => {
    resolveBillingMode = 'lane-only'
    usageCells.push(usage('main', TODAY, 'mystery-model', 500, 900_000))
    const s = await assembleBudgetSpend(NOW)
    expect(s.daily.global.meteredUsdMicros).toBe(0)
    expect(s.spendEvidence.daily.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ lane: null, model: 'mystery-model', reasons: ['lane_unknown'] }),
    ]))
  })

  it('an empty-model row never trusts current-model guessing (#689 review)', async () => {
    // With no model the hook substitutes the agent's CURRENT effective model
    // — a guess about the past. Its resolved provider proves nothing; the
    // row stays an honest gap unless an operator override decides the lane.
    usageCells.push(usage('main', TODAY, '', 500, 900_000))
    const s = await assembleBudgetSpend(NOW)
    expect(s.daily.global.meteredUsdMicros).toBe(0)
    expect(s.spendEvidence.daily.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ lane: null, model: null, reasons: ['lane_unknown'] }),
    ]))
  })

  it('an operator override reaches empty-model rows too (#689 second pass)', async () => {
    // Transcript rows with no model field must still honor an explicit
    // agent-scoped billing override — otherwise their spend never counts
    // against any cap the operator configured.
    resolveBillingMode = 'agent-override'
    usageCells.push(usage('main', TODAY, '', 8_000, 5_000_000))
    const s = await assembleBudgetSpend(NOW)
    expect(s.daily.byAgent.main?.unattributed.subscriptionTokens).toBe(8_000)
    expect(s.daily.global.meteredUsdMicros).toBe(0)
    // The hook received NO model — no fabricated model reached resolution.
    expect(resolveBillingCalls).toEqual([{ agentId: 'main', model: undefined }])
  })

  it('an explicit operator lane override is trusted even for an unresolvable model (#689 review)', async () => {
    resolveBillingMode = 'agent-override'
    usageCells.push(usage('main', TODAY, 'weird-local-model', 8_000, 5_000_000))
    const s = await assembleBudgetSpend(NOW)
    // Operator said subscription: tokens count, theoretical dollars stay suppressed.
    expect(s.daily.byAgent.main?.unattributed.subscriptionTokens).toBe(8_000)
    expect(s.daily.global.meteredUsdMicros).toBe(0)
  })

  it('NULL-cost observed metered rows contribute tokens but no dollars', async () => {
    usageCells.push(usage('main', TODAY, 'google/gemini-3-flash', 700, null))
    const s = await assembleBudgetSpend(NOW)
    expect(s.daily.byAgent.main?.unattributed.meteredTokens).toBe(700)
    expect(s.daily.byAgent.main?.unattributed.meteredUsdMicros).toBe(0)
  })

  it('charges media dollars without treating media work as token spend', async () => {
    costRows.push({
      runId: 'image:r-media',
      agent: 'pixel',
      model: 'openai/gpt-image-2',
      provider: 'openai',
      lane: 'metered',
      usageKind: 'media',
      // Defensive fixture: even a malformed legacy media subtotal must not
      // enter token caps once the durable usage kind says it is media.
      totalTokens: 999,
      costUsdMicros: 75_000,
      occurredAt: TODAY,
    })

    const s = await assembleBudgetSpend(NOW)

    expect(s.daily.global.meteredUsdMicros).toBe(75_000)
    expect(s.daily.global.meteredTokens).toBe(0)
    expect(s.spendEvidence.daily).toEqual({ status: 'complete', gaps: [] })
  })

  it('keeps token-bearing rows with unknown totals explicitly incomplete', async () => {
    costRows.push({
      runId: 'turn:unknown-tokens',
      agent: 'main',
      model: 'openai-codex/gpt-5.5-codex',
      provider: 'openai-codex',
      lane: 'subscription',
      usageKind: 'tokens',
      totalTokens: null,
      costUsdMicros: null,
      occurredAt: TODAY,
    })

    const s = await assembleBudgetSpend(NOW)

    // The numeric subtotal remains the sum of KNOWN tokens. Its evidence
    // contract makes clear that zero is not a complete observed total.
    expect(s.daily.global.subscriptionTokens).toBe(0)
    expect(s.spendEvidence.daily).toEqual({
      status: 'incomplete',
      gaps: [{
        unit: 'tokens',
        source: 'attributed_run',
        lane: 'subscription',
        agent: 'main',
        provider: 'openai-codex',
        model: 'openai-codex/gpt-5.5-codex',
        reasons: ['value_missing'],
        unknownCount: 1,
      }],
    })
    expect(s.spendEvidence.monthly).toEqual(s.spendEvidence.daily)
  })

  it('preserves an unknown billing lane in incomplete token evidence', async () => {
    costRows.push({
      runId: 'turn:unknown-lane-and-tokens',
      agent: 'main',
      model: null,
      provider: null,
      lane: null,
      usageKind: 'tokens',
      totalTokens: null,
      costUsdMicros: null,
      occurredAt: TODAY,
    })

    const s = await assembleBudgetSpend(NOW)

    expect(s.spendEvidence.daily.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        unit: 'tokens',
        lane: null,
        agent: 'main',
        provider: null,
        model: null,
        reasons: ['lane_unknown', 'model_unknown', 'provider_unknown', 'value_missing'],
        unknownCount: 1,
      }),
      expect.objectContaining({
        unit: 'usd_micros',
        lane: null,
        reasons: ['lane_unknown', 'model_unknown', 'provider_unknown', 'value_missing'],
        unknownCount: 1,
      }),
    ]))
  })

  it('does not assign known tokens to a subscription lane that was never resolved', async () => {
    costRows.push({
      runId: 'turn:known-tokens-unknown-lane',
      agent: 'main',
      model: 'openai-codex/gpt-5.5-codex',
      provider: 'openai-codex',
      lane: null,
      usageKind: 'tokens',
      totalTokens: 900,
      costUsdMicros: null,
      occurredAt: TODAY,
    })

    const s = await assembleBudgetSpend(NOW)

    expect(s.daily.global.subscriptionTokens).toBe(0)
    expect(s.spendEvidence.daily.status).toBe('incomplete')
    expect(s.spendEvidence.daily.gaps).toContainEqual(expect.objectContaining({
      unit: 'tokens',
      source: 'attributed_run',
      lane: null,
      agent: 'main',
      reasons: ['lane_unknown'],
      unknownCount: 1,
    }))
  })

  it('marks unpriced metered media as incomplete dollar evidence', async () => {
    costRows.push({
      runId: 'image:unpriced',
      agent: 'pixel',
      model: 'openai/gpt-image-2',
      provider: 'openai',
      lane: 'metered',
      usageKind: 'media',
      totalTokens: null,
      costUsdMicros: null,
      occurredAt: TODAY,
    })

    const s = await assembleBudgetSpend(NOW)

    expect(s.daily.global.meteredUsdMicros).toBe(0)
    expect(s.spendEvidence.daily.gaps).toContainEqual(expect.objectContaining({
      unit: 'usd_micros',
      source: 'attributed_run',
      lane: 'metered',
      agent: 'pixel',
      reasons: ['value_missing'],
      unknownCount: 1,
    }))
  })

  it('preserves reported observed cost while exposing missing message costs', async () => {
    usageCells.push({
      agent: 'main',
      day: localDayKey(TODAY),
      model: 'google/gemini-3-flash',
      tokens: { input: 500, output: 100, cacheRead: 0, cacheWrite: 0, total: 600 },
      costUsdMicros: 250_000,
      costedMessages: 1,
      messageCount: 3,
    })

    const s = await assembleBudgetSpend(NOW)

    expect(s.daily.global.unattributed.meteredUsdMicros).toBe(250_000)
    expect(s.spendEvidence.daily.gaps).toContainEqual(expect.objectContaining({
      unit: 'usd_micros',
      source: 'observed_message',
      lane: 'metered',
      agent: 'main',
      reasons: ['value_missing'],
      unknownCount: 2,
    }))
  })

  it('does not assign observed usage to a lane when billing resolution returns no answer', async () => {
    resolveBillingMode = 'undefined'
    usageCells.push(usage('main', TODAY, 'openai-codex/gpt-5.5-codex', 700, 500_000))

    const s = await assembleBudgetSpend(NOW)

    expect(s.daily.global.unattributed.subscriptionTokens).toBe(0)
    expect(s.daily.global.unattributed.meteredTokens).toBe(0)
    expect(s.daily.global.unattributed.meteredUsdMicros).toBe(0)
    expect(s.spendEvidence.daily.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        unit: 'tokens', source: 'observed_message', lane: null,
        agent: 'main', reasons: ['lane_unknown'], unknownCount: 1,
      }),
      expect.objectContaining({
        unit: 'usd_micros', source: 'observed_message', lane: null,
        agent: 'main', reasons: ['lane_unknown'], unknownCount: 1,
      }),
    ]))
  })

  it('does not treat a failed observed billing hook as exact metered evidence', async () => {
    resolveBillingMode = 'throw'
    usageCells.push(usage('main', TODAY, 'google/gemini-3-flash', 400, null))

    const s = await assembleBudgetSpend(NOW)

    expect(s.daily.global.unattributed.meteredTokens).toBe(0)
    expect(s.spendEvidence.daily.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        unit: 'tokens', lane: null, reasons: ['lane_unknown'], unknownCount: 1,
      }),
      expect.objectContaining({
        unit: 'usd_micros', lane: null,
        reasons: ['lane_unknown', 'value_missing'], unknownCount: 1,
      }),
    ]))
  })

  it('stops attributed dollar aggregation before it exceeds the safe-integer boundary', async () => {
    const subtotal = Number.MAX_SAFE_INTEGER - 5
    costRows.push(
      { runId: 'usd-safe-prefix', agent: 'main', model: 'google/g', provider: 'google', lane: 'metered', usageKind: 'tokens', totalTokens: 1, costUsdMicros: subtotal, occurredAt: TODAY },
      { runId: 'usd-overflow', agent: 'main', model: 'google/g', provider: 'google', lane: 'metered', usageKind: 'tokens', totalTokens: 1, costUsdMicros: 10, occurredAt: TODAY },
    )

    const s = await assembleBudgetSpend(NOW)

    expect(s.daily.global.meteredUsdMicros).toBe(subtotal)
    expect(Number.isSafeInteger(s.daily.global.meteredUsdMicros)).toBe(true)
    expect(s.spendEvidence.daily.gaps).toContainEqual(expect.objectContaining({
      unit: 'usd_micros', source: 'attributed_run', reasons: ['value_missing'],
      affectedScope: 'global', unknownCount: 1,
    }))
  })

  it('stops attributed subscription-token aggregation before it exceeds the safe-integer boundary', async () => {
    const subtotal = Number.MAX_SAFE_INTEGER - 5
    costRows.push(
      { runId: 'tokens-safe-prefix', agent: 'main', model: 'openai-codex/g', provider: 'openai-codex', lane: 'subscription', usageKind: 'tokens', totalTokens: subtotal, costUsdMicros: null, occurredAt: TODAY },
      { runId: 'tokens-overflow', agent: 'main', model: 'openai-codex/g', provider: 'openai-codex', lane: 'subscription', usageKind: 'tokens', totalTokens: 10, costUsdMicros: null, occurredAt: TODAY },
    )

    const s = await assembleBudgetSpend(NOW)

    expect(s.daily.global.subscriptionTokens).toBe(subtotal)
    expect(Number.isSafeInteger(s.daily.global.subscriptionTokens)).toBe(true)
    expect(s.spendEvidence.daily.gaps).toContainEqual(expect.objectContaining({
      unit: 'tokens', source: 'attributed_run', reasons: ['value_missing'],
      affectedScope: 'global', unknownCount: 1,
    }))
  })

  it('keeps an exact observed prefix and marks token and dollar delta overflow incomplete', async () => {
    const subtotal = Number.MAX_SAFE_INTEGER - 5
    usageCells.push(
      {
        ...usage('main', TODAY, 'google/one', subtotal, subtotal),
        costedMessages: 1,
        messageCount: 1,
      },
      {
        ...usage('main', TODAY, 'google/two', 10, 10),
        costedMessages: 1,
        messageCount: 1,
      },
    )

    const s = await assembleBudgetSpend(NOW)

    expect(s.daily.global.unattributed.meteredTokens).toBe(subtotal)
    expect(s.daily.global.unattributed.meteredUsdMicros).toBe(subtotal)
    expect(Number.isSafeInteger(s.daily.global.unattributed.meteredTokens)).toBe(true)
    expect(Number.isSafeInteger(s.daily.global.unattributed.meteredUsdMicros)).toBe(true)
    expect(s.spendEvidence.daily.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        unit: 'tokens', source: 'observed_message', reasons: ['value_missing'],
        affectedScope: 'global', unknownCount: 1,
      }),
      expect.objectContaining({
        unit: 'usd_micros', source: 'observed_message', reasons: ['value_missing'],
        affectedScope: 'global', unknownCount: 1,
      }),
    ]))
  })

  it('saturates aggregated evidence counts at a safe integer', async () => {
    usageCells.push(
      {
        ...usage('main', TODAY, 'google/gemini-3-flash', 0, null),
        costedMessages: 0,
        messageCount: Number.MAX_SAFE_INTEGER,
      },
      {
        ...usage('main', TODAY, 'google/gemini-3-flash', 0, null),
        costedMessages: 0,
        messageCount: Number.MAX_SAFE_INTEGER,
      },
    )

    const s = await assembleBudgetSpend(NOW)
    const gap = s.spendEvidence.daily.gaps.find((entry) =>
      entry.unit === 'usd_micros'
      && entry.source === 'observed_message'
      && entry.reasons.includes('value_missing'))

    expect(gap?.unknownCount).toBe(Number.MAX_SAFE_INTEGER)
    expect(Number.isSafeInteger(gap?.unknownCount)).toBe(true)
  })

  it('monthly window sums every local day since the 1st; daily only today', async () => {
    usageCells.push(usage('main', EARLIER_THIS_MONTH, 'google/gemini-3-flash', 100, 100_000))
    usageCells.push(usage('main', TODAY, 'google/gemini-3-flash', 10, 10_000))
    const s = await assembleBudgetSpend(NOW)
    expect(s.daily.global.unattributed.meteredUsdMicros).toBe(10_000)
    expect(s.monthly.global.unattributed.meteredUsdMicros).toBe(110_000)
  })

  it('marks observed usage unavailable without discarding attributed spend', async () => {
    costRows.push({ runId: 'r7', agent: 'pixel', model: 'google/gemini-3-flash', provider: 'google', lane: 'metered', usageKind: 'tokens', totalTokens: 1000, costUsdMicros: 2_000_000, occurredAt: TODAY })
    usageReadFails = true

    const s = await assembleBudgetSpend(NOW)

    expect(s.observedUsageEvidence).toEqual({ status: 'unavailable', reason: 'usage_store_unavailable' })
    expect(s.daily.global.meteredUsdMicros).toBe(2_000_000)
    expect(s.daily.global.unattributed.meteredUsdMicros).toBe(0)
  })
})

describe('laneKey isolation', () => {
  it('agent ids containing spaces never collide or corrupt the delta keys', async () => {
    // 'a b' spends; a hypothetical agent named 'a' must see NO delta.
    usageCells.push(usage('a b', TODAY, 'google/gemini-3-flash', 500, 400_000))
    const s = await assembleBudgetSpend(NOW)
    expect(s.daily.byAgent['a b']?.unattributed.meteredUsdMicros).toBe(400_000)
    expect(s.daily.byAgent['a']).toBeUndefined()
  })
})

describe('paceProjection', () => {
  const dayStart = dayStartMs(NOW)
  const nextDay = dayStart + 24 * 3600 * 1000
  it('linearly extrapolates the window spend', () => {
    // Half the day elapsed, $5 spent → on pace for $10.
    expect(paceProjection(5, dayStart, nextDay, dayStart + 12 * 3600 * 1000)).toBe(10)
  })
  it('returns null when almost nothing has elapsed (no signal)', () => {
    expect(paceProjection(5, dayStart, nextDay, dayStart + 1000)).toBeNull()
  })
})
